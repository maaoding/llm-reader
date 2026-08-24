import type { BookFormat, SelectionContext, TocItem } from '@shared/contracts'
import { copy } from '@shared/copy'
import { buildBoundedPassages, codePointLength, type ContextBlock } from './context'
import {
  cssFontFamily,
  fontFamilyStack,
  normalizeReadingPreferences,
  READING_CONTENT_WIDTH_PIXELS,
  READING_PAPER_THEME_TOKENS,
  READING_PARAGRAPH_SPACING_EM,
  readingPreferencesEqual
} from './reading-preferences'
import {
  literalSearchExpression,
  normalizeReaderSearchQuery,
  searchExcerpt,
  yieldSearchWork
} from './search'
import type {
  ReadingPreferences,
  ReaderAdapter,
  ReaderCallbacks,
  ReaderDocumentInfo,
  ReaderHighlightAnchor,
  ReaderRelocation,
  ReaderRelocationReason,
  ReaderSearchResult
} from './types'
import {
  DEFAULT_READING_PREFERENCES,
  readerSelectionBackground,
  READER_SEARCH_RESULT_LIMIT
} from './types'

const PERSISTENT_HIGHLIGHT_NAME = 'llm-reader-persistent'
const PERSISTENT_HIGHLIGHT_FALLBACK_CLASS = 'llm-reader-persistent-fallback'

const TXT_ANCHOR_PATTERN = /^txt:(\d+):(\d+)$/u
const TEXT_BLOCK_PATTERN = /[^\n]+(?:\n(?![\t ]*\n)[^\n]*)*/gu
const HEADING_PATTERNS = [
  /^#{1,6}\s+\S/u,
  /^第.{1,12}[章节部篇卷](?:\s|$)/u,
  /^(?:chapter|part)\s+(?:\d+|[ivxlcdm]+)(?:\s|[.:：-]|$)/iu,
  /^[一二三四五六七八九十百]+[、.．]\s*\S/u
]

interface TextAnchor {
  start: number
  end: number
}

interface TextChapter {
  title: string
  start: number
  paragraphIndexes: number[]
}

interface TextParagraph {
  index: number
  text: string
  start: number
  end: number
  chapterIndex: number
  element: HTMLParagraphElement | HTMLHeadingElement
}

interface ParsedTextParagraph {
  index: number
  text: string
  start: number
  end: number
  heading: boolean
}

function createUtf16ToCodePointMap(value: string): Uint32Array {
  const map = new Uint32Array(value.length + 1)
  let utf16Index = 0
  let codePointIndex = 0

  while (utf16Index < value.length) {
    const width = value.codePointAt(utf16Index)! > 0xffff ? 2 : 1
    map[utf16Index] = codePointIndex
    if (width === 2) {
      map[utf16Index + 1] = codePointIndex
    }
    utf16Index += width
    codePointIndex += 1
    map[utf16Index] = codePointIndex
  }

  return map
}

function isHeading(text: string): boolean {
  if (text.includes('\n') || codePointLength(text) > 120) {
    return false
  }
  return HEADING_PATTERNS.some((pattern) => pattern.test(text))
}

function cleanHeading(text: string): string {
  return text.replace(/^#{1,6}\s+/u, '').trim()
}

function parseTextParagraphs(text: string): ParsedTextParagraph[] {
  const utf16ToCodePoint = createUtf16ToCodePointMap(text)
  const matches = Array.from(text.matchAll(TEXT_BLOCK_PATTERN))
  const paragraphs: ParsedTextParagraph[] = []

  for (const match of matches) {
    const raw = match[0]
    const trimmed = raw.trim()
    if (trimmed.length === 0 || match.index === undefined) {
      continue
    }

    const localStart = raw.indexOf(trimmed)
    const utf16Start = match.index + localStart
    const utf16End = utf16Start + trimmed.length
    paragraphs.push({
      index: paragraphs.length,
      text: trimmed,
      start: utf16ToCodePoint[utf16Start],
      end: utf16ToCodePoint[utf16End],
      heading: isHeading(trimmed)
    })
  }

  return paragraphs
}

function parseTextAnchor(anchor: string, maximum: number): TextAnchor | null {
  const match = TXT_ANCHOR_PATTERN.exec(anchor)
  if (!match) {
    return null
  }

  const start = Number(match[1])
  const end = Number(match[2])
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end > maximum) {
    return null
  }
  return { start, end }
}

function makeTextAnchor(start: number, end = start): string {
  return `txt:${start}:${end}`
}

function decodeUtf8(bytes: Uint8Array): string {
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  return decoded.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n')
}

function titleFromParagraphs(paragraphs: ParsedTextParagraph[]): string {
  const first = paragraphs[0]?.text ?? ''
  if (!first.includes('\n') && codePointLength(first) <= 100) {
    return cleanHeading(first)
  }
  return copy('reader.txtDefaultTitle')
}

export class TextReaderAdapter implements ReaderAdapter {
  readonly format: BookFormat = 'txt'

  private readonly host: HTMLElement
  private readonly callbacks: ReaderCallbacks
  private readonly document: Document
  private readonly originalOverflowY: string
  private readonly originalPosition: string
  private root: HTMLElement | null = null
  private text = ''
  private textCharacters: string[] = []
  private paragraphs: TextParagraph[] = []
  private chapters: TextChapter[] = []
  private selection: SelectionContext | null = null
  private temporaryHighlightElements: HTMLElement[] = []
  private temporaryHighlightRegistry: { delete(name: string): void; set(name: string, value: unknown): void } | null = null
  private persistentHighlightAnchors: ReaderHighlightAnchor[] = []
  private persistentHighlightElements: HTMLElement[] = []
  private persistentHighlightRegistry: { delete(name: string): void; set(name: string, value: unknown): void } | null = null
  private relocationFrame: number | null = null
  private programmaticScroll = false
  private programmaticReleaseTimer: ReturnType<typeof setTimeout> | null = null
  private preferences: ReadingPreferences = { ...DEFAULT_READING_PREFERENCES }
  private highlightStyleElement: HTMLStyleElement | null = null
  private searchRevision = 0
  private searchQueue: Promise<void> = Promise.resolve()

  constructor(host: HTMLElement, callbacks: ReaderCallbacks) {
    this.host = host
    this.callbacks = callbacks
    this.document = host.ownerDocument
    this.originalOverflowY = host.style.overflowY
    this.originalPosition = host.style.position
  }

  async open(bytes: Uint8Array, lastLocator?: string | null): Promise<ReaderDocumentInfo> {
    this.resetDocument()
    this.text = decodeUtf8(bytes)
    this.textCharacters = Array.from(this.text)
    const parsedParagraphs = parseTextParagraphs(this.text)
    if (parsedParagraphs.length === 0) {
      throw new Error(copy('reader.txtEmpty'))
    }

    this.host.style.overflowY = 'auto'
    if (this.document.defaultView?.getComputedStyle(this.host).position === 'static') {
      this.host.style.position = 'relative'
    }

    const root = this.document.createElement('article')
    root.className = 'reader-document reader-document--txt'
    root.tabIndex = 0
    root.style.boxSizing = 'border-box'
    root.style.margin = '0 auto'
    root.style.maxWidth = '760px'
    root.style.minHeight = '100%'
    root.style.padding = '48px clamp(28px, 6vw, 72px) 35vh'
    root.style.whiteSpace = 'pre-wrap'
    root.style.overflowWrap = 'break-word'
    root.style.lineHeight = '1.82'

    const style = this.document.createElement('style')
    style.textContent = this.highlightStylesCss()
    this.highlightStyleElement = style
    root.append(style)

    this.chapters = this.buildChapters(parsedParagraphs)
    this.paragraphs = parsedParagraphs.map((paragraph) => {
      const element = this.document.createElement(paragraph.heading ? 'h2' : 'p')
      element.textContent = paragraph.text
      element.dataset.readerParagraph = String(paragraph.index)
      element.dataset.readerStart = String(paragraph.start)
      element.dataset.readerEnd = String(paragraph.end)
      element.style.scrollMarginTop = '32px'
      if (paragraph.heading) {
        element.style.margin = paragraph.index === 0 ? '0 0 1.2em' : '2.4em 0 1.2em'
      } else {
        element.style.margin = '0 0 1.35em'
      }
      root.append(element)

      const chapterIndex = this.chapters.findIndex((chapter) =>
        chapter.paragraphIndexes.includes(paragraph.index)
      )
      return {
        ...paragraph,
        chapterIndex: Math.max(0, chapterIndex),
        element
      }
    })

    this.root = root
    this.applyPreferences()
    this.host.replaceChildren(root)
    this.applyPersistentHighlights()
    this.bindUserScrollInput()
    this.document.addEventListener('selectionchange', this.handleSelectionChange)
    this.host.addEventListener('scroll', this.handleScroll, { passive: true })

    const toc: TocItem[] = this.chapters
      .filter((chapter) => this.chapters.length === 1 || chapter.title !== copy('reader.txtOpening'))
      .map((chapter, index) => ({
        id: `txt-toc-${index + 1}`,
        label: chapter.title,
        href: makeTextAnchor(chapter.start),
        depth: 0
      }))

    this.programmaticScroll = true
    if (lastLocator && parseTextAnchor(lastLocator, this.textCharacters.length)) {
      await this.goToWithReason(lastLocator, 'restore')
    } else {
      this.emitRelocation({
        locator: makeTextAnchor(0),
        progress: 0,
        chapterProgress: this.chapterProgressAt(0),
        chapterTitle: this.chapters[0]?.title ?? copy('reader.txtFullText'),
        chapterHref: this.chapters[0] ? makeTextAnchor(this.chapters[0].start) : null,
        reason: 'restore'
      })
      this.scheduleProgrammaticScrollRelease()
    }

    return {
      metadata: { title: titleFromParagraphs(parsedParagraphs), author: null },
      toc
    }
  }

  destroy(): void {
    this.resetDocument()
    this.host.style.overflowY = this.originalOverflowY
    this.host.style.position = this.originalPosition
  }

  search(query: string): Promise<ReadonlyArray<ReaderSearchResult>> {
    const normalized = normalizeReaderSearchQuery(query)
    if (!normalized) {
      return Promise.reject(new Error(copy('reader.searchInvalid')))
    }
    const revision = ++this.searchRevision
    const run = async (): Promise<ReadonlyArray<ReaderSearchResult>> => {
      if (revision !== this.searchRevision) return []
      return this.searchDocument(normalized, revision)
    }
    const result = this.searchQueue.then(run, run)
    this.searchQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async searchDocument(
    query: string,
    revision: number
  ): Promise<ReadonlyArray<ReaderSearchResult>> {
    const results: ReaderSearchResult[] = []
    for (let paragraphIndex = 0; paragraphIndex < this.paragraphs.length; paragraphIndex += 1) {
      if (revision !== this.searchRevision) return []
      const paragraph = this.paragraphs[paragraphIndex]
      const expression = literalSearchExpression(query)
      let previousUtf16 = 0
      let previousCodePoints = 0
      let match = expression.exec(paragraph.text)
      while (match) {
        const localStart = previousCodePoints + codePointLength(
          paragraph.text.slice(previousUtf16, match.index)
        )
        const localEnd = localStart + codePointLength(match[0])
        results.push({
          anchor: makeTextAnchor(paragraph.start + localStart, paragraph.start + localEnd),
          excerpt: searchExcerpt(paragraph.text, match.index, match.index + match[0].length),
          chapterTitle: this.chapters[paragraph.chapterIndex]?.title ?? copy('reader.txtFullText')
        })
        if (results.length >= READER_SEARCH_RESULT_LIMIT) return results
        previousUtf16 = match.index
        previousCodePoints = localStart
        match = expression.exec(paragraph.text)
      }
      if (paragraphIndex > 0 && paragraphIndex % 120 === 0) {
        await yieldSearchWork()
      }
    }
    return revision === this.searchRevision ? results : []
  }

  async goTo(anchor: string): Promise<void> {
    await this.goToWithReason(anchor, 'navigation')
  }

  private async goToWithReason(anchor: string, reason: ReaderRelocationReason): Promise<void> {
    const parsed = parseTextAnchor(anchor, this.textCharacters.length)
    if (!parsed) {
      throw new Error(copy('reader.txtInvalidAnchor'))
    }

    const paragraph = this.findParagraphAt(parsed.start)
    if (!paragraph) {
      throw new Error(copy('reader.txtAnchorOutside'))
    }

    this.programmaticScroll = true
    if (typeof paragraph.element.scrollIntoView === 'function') {
      paragraph.element.scrollIntoView({ behavior: 'auto', block: 'start' })
    } else {
      this.host.scrollTop = paragraph.element.offsetTop
    }

    this.emitRelocation({
      locator: makeTextAnchor(parsed.start),
      progress: this.textCharacters.length === 0 ? 0 : parsed.start / this.textCharacters.length,
      chapterProgress: this.chapterProgressAt(parsed.start),
      chapterTitle: this.chapters[paragraph.chapterIndex]?.title ?? copy('reader.txtFullText'),
      chapterHref: makeTextAnchor(this.chapters[paragraph.chapterIndex]?.start ?? paragraph.start),
      reason
    })
    this.scheduleProgrammaticScrollRelease()
  }

  getSelection(): SelectionContext | null {
    return this.selection
  }

  async selectAnchor(anchor: string): Promise<boolean> {
    const range = this.rangeForAnchor(anchor)
    if (!range) {
      throw new Error(copy('reader.txtInvalidHighlight'))
    }
    const hostRect = this.host.getBoundingClientRect()
    const visible = Array.from(range.getClientRects()).some((rect) => (
      rect.bottom > hostRect.top && rect.top < hostRect.bottom && rect.right > hostRect.left && rect.left < hostRect.right
    ))
    if (!visible) return false
    const nativeSelection = this.document.defaultView?.getSelection()
    if (!nativeSelection) return false
    nativeSelection.removeAllRanges()
    nativeSelection.addRange(range)
    this.handleSelectionChange()
    return true
  }

  async highlight(anchor: string): Promise<void> {
    const range = this.rangeForAnchor(anchor)
    if (!range) {
      throw new Error(copy('reader.txtInvalidHighlight'))
    }

    this.clearTemporaryHighlight()
    const view = this.document.defaultView as
      | (Window & { Highlight?: new (...ranges: Range[]) => unknown })
      | null
    const cssWithHighlights = (view as unknown as {
      CSS?: { highlights?: { delete(name: string): void; set(name: string, value: unknown): void } }
    } | null)?.CSS
    if (view?.Highlight && cssWithHighlights?.highlights) {
      this.temporaryHighlightRegistry = cssWithHighlights.highlights
      this.temporaryHighlightRegistry.set('llm-reader-temporary', new view.Highlight(range))
      return
    }

    const rangeInfo = this.paragraphRangeForAnchor(anchor)
    if (!rangeInfo) return
    const { startParagraph, endParagraph } = rangeInfo
    this.temporaryHighlightElements = this.paragraphs
      .slice(startParagraph.index, endParagraph.index + 1)
      .map((paragraph) => paragraph.element)
    this.temporaryHighlightElements.forEach((element) =>
      element.classList.add('llm-reader-temporary-fallback')
    )
  }

  clearHighlight(): void {
    this.clearTemporaryHighlight()
  }

  async setHighlights(highlights: ReadonlyArray<ReaderHighlightAnchor>): Promise<void> {
    this.persistentHighlightAnchors = highlights.map((highlight) => ({ anchor: highlight.anchor }))
    this.applyPersistentHighlights()
  }

  async setPreferences(preferences: ReadingPreferences): Promise<void> {
    const normalized = normalizeReadingPreferences(preferences)
    if (readingPreferencesEqual(this.preferences, normalized)) {
      return
    }
    this.preferences = normalized
    this.applyPreferences()
  }

  private highlightStylesCss(): string {
    return `
      .reader-document ::selection { background: ${readerSelectionBackground(this.preferences.paperTheme)}; color: inherit; }
      ::highlight(llm-reader-temporary) { background: rgba(246, 190, 72, .36); }
      .llm-reader-temporary-fallback { background: rgba(246, 190, 72, .25); outline: 2px solid rgba(196, 130, 18, .45); }
      ::highlight(${PERSISTENT_HIGHLIGHT_NAME}) { background: rgba(126, 188, 148, .36); }
      .${PERSISTENT_HIGHLIGHT_FALLBACK_CLASS} { background: rgba(126, 188, 148, .30); outline: 1px solid rgba(61, 135, 91, .55); }
    `
  }

  private applyPreferences(): void {
    if (!this.root) {
      return
    }

    if (this.highlightStyleElement) {
      this.highlightStyleElement.textContent = this.highlightStylesCss()
    }

    if (this.preferences.fontScale === DEFAULT_READING_PREFERENCES.fontScale) {
      this.root.style.removeProperty('font-size')
    } else {
      this.root.style.fontSize = `${this.preferences.fontScale}%`
    }

    if (this.preferences.fontFamily === null) {
      this.root.style.removeProperty('font-family')
    } else {
      const stack = fontFamilyStack(this.preferences.fontFamily)
        .map(cssFontFamily)
        .join(', ')
      this.root.style.fontFamily = stack
    }

    this.root.style.maxWidth = this.preferences.contentWidth === 'original'
      ? '760px'
      : `${READING_CONTENT_WIDTH_PIXELS[this.preferences.contentWidth]}px`

    const paper = READING_PAPER_THEME_TOKENS[this.preferences.paperTheme]
    this.root.style.backgroundColor = paper.background
    this.root.style.color = paper.color
    this.root.style.colorScheme = paper.colorScheme

    for (const paragraph of this.paragraphs) {
      if (paragraph.element.tagName !== 'P') {
        continue
      }
      if (this.preferences.lineHeight === 'original') {
        paragraph.element.style.removeProperty('line-height')
      } else {
        paragraph.element.style.lineHeight = this.preferences.lineHeight
      }
      if (this.preferences.indent === 'original') {
        paragraph.element.style.removeProperty('text-indent')
      } else {
        paragraph.element.style.textIndent = this.preferences.indent === 'none' ? '0' : '2em'
      }
      paragraph.element.style.marginBottom = this.preferences.paragraphSpacing === 'original'
        ? '1.35em'
        : `${READING_PARAGRAPH_SPACING_EM[this.preferences.paragraphSpacing]}em`
    }
  }

  private readonly handleSelectionChange = (): void => {
    const nativeSelection = this.document.getSelection()
    if (!nativeSelection || nativeSelection.rangeCount === 0 || nativeSelection.isCollapsed) {
      this.setSelection(null)
      return
    }

    const range = nativeSelection.getRangeAt(0)
    if (!this.root?.contains(range.commonAncestorContainer)) {
      this.setSelection(null)
      return
    }

    const startParagraph = this.findParagraphForNode(range.startContainer)
    const endParagraph = this.findParagraphForNode(range.endContainer)
    if (!startParagraph || !endParagraph) {
      this.setSelection(null)
      return
    }

    const start = startParagraph.start + this.offsetWithinElement(
      startParagraph.element,
      range.startContainer,
      range.startOffset
    )
    const end = endParagraph.start + this.offsetWithinElement(
      endParagraph.element,
      range.endContainer,
      range.endOffset
    )
    if (end <= start) {
      this.setSelection(null)
      return
    }

    const quote = nativeSelection.toString().trim()
    if (quote.length === 0) {
      this.setSelection(null)
      return
    }

    const chapter = this.chapters[startParagraph.chapterIndex]
    const chapterParagraphs = chapter.paragraphIndexes
      .map((index) => this.paragraphs[index])
      .filter((paragraph): paragraph is TextParagraph => paragraph !== undefined)
    const startBlock = Math.max(0, chapterParagraphs.indexOf(startParagraph))
    const endBlock = Math.max(startBlock, chapterParagraphs.indexOf(endParagraph))
    const blocks: ContextBlock[] = chapterParagraphs.map((paragraph) => ({
      id: `P${paragraph.index + 1}`,
      text: paragraph.text,
      anchorForSlice: (localStart, localEnd) =>
        makeTextAnchor(paragraph.start + localStart, paragraph.start + localEnd)
    }))
    const passages = buildBoundedPassages(blocks, {
      startBlock,
      startOffset: start - startParagraph.start,
      endBlock,
      endOffset: end - endParagraph.start
    })

    this.setSelection({
      bookId: this.callbacks.bookId,
      quote,
      anchor: makeTextAnchor(start, end),
      chapterTitle: chapter.title,
      passages
    })
  }

  private readonly handleScroll = (): void => {
    if (this.relocationFrame !== null) {
      return
    }
    const view = this.document.defaultView
    if (!view) {
      this.reportScrollPosition()
      return
    }
    this.relocationFrame = view.requestAnimationFrame(() => {
      this.relocationFrame = null
      this.reportScrollPosition()
    })
  }

  private reportScrollPosition(): void {
    if (this.programmaticScroll) {
      return
    }
    const hostTop = this.host.getBoundingClientRect().top
    const firstVisible =
      this.paragraphs.find((paragraph) => paragraph.element.getBoundingClientRect().bottom > hostTop + 8) ??
      this.paragraphs[this.paragraphs.length - 1]
    if (!firstVisible) {
      return
    }
    const scrollable = Math.max(0, this.host.scrollHeight - this.host.clientHeight)
    const progress = scrollable === 0 ? firstVisible.start / this.textCharacters.length : this.host.scrollTop / scrollable
    const topEdge = hostTop + 8
    const paragraphRect = firstVisible.element.getBoundingClientRect()
    const visibleFraction = paragraphRect.height > 0
      ? Math.min(1, Math.max(0, (topEdge - paragraphRect.top) / paragraphRect.height))
      : 0
    this.emitRelocation({
      locator: makeTextAnchor(firstVisible.start),
      progress: Math.min(1, Math.max(0, progress)),
      chapterProgress: this.chapterProgressFor(firstVisible, visibleFraction),
      chapterTitle: this.chapters[firstVisible.chapterIndex]?.title ?? copy('reader.txtFullText'),
      chapterHref: makeTextAnchor(this.chapters[firstVisible.chapterIndex]?.start ?? firstVisible.start),
      reason: 'natural'
    })
  }

  private readonly handleUserScrollInput = (): void => {
    this.cancelProgrammaticScrollRelease()
    this.programmaticScroll = false
  }

  private scheduleProgrammaticScrollRelease(): void {
    this.cancelProgrammaticScrollRelease()
    this.programmaticReleaseTimer = setTimeout(() => {
      this.programmaticReleaseTimer = null
      this.programmaticScroll = false
    }, 320)
  }

  private cancelProgrammaticScrollRelease(): void {
    if (this.programmaticReleaseTimer) {
      clearTimeout(this.programmaticReleaseTimer)
      this.programmaticReleaseTimer = null
    }
  }

  private bindUserScrollInput(): void {
    this.host.addEventListener('wheel', this.handleUserScrollInput, { passive: true })
    this.host.addEventListener('touchmove', this.handleUserScrollInput, { passive: true })
    this.host.addEventListener('pointerdown', this.handleUserScrollInput)
    this.host.addEventListener('keydown', this.handleUserScrollInput)
  }

  private unbindUserScrollInput(): void {
    this.host.removeEventListener('wheel', this.handleUserScrollInput)
    this.host.removeEventListener('touchmove', this.handleUserScrollInput)
    this.host.removeEventListener('pointerdown', this.handleUserScrollInput)
    this.host.removeEventListener('keydown', this.handleUserScrollInput)
  }

  private buildChapters(paragraphs: ParsedTextParagraph[]): TextChapter[] {
    const hasHeadings = paragraphs.some((paragraph) => paragraph.heading)
    if (!hasHeadings) {
      return [
        {
          title: copy('reader.txtFullText'),
          start: paragraphs[0].start,
          paragraphIndexes: paragraphs.map((paragraph) => paragraph.index)
        }
      ]
    }

    const chapters: TextChapter[] = []
    for (const paragraph of paragraphs) {
      if (paragraph.heading || chapters.length === 0) {
        chapters.push({
          title: paragraph.heading ? cleanHeading(paragraph.text) : copy('reader.txtOpening'),
          start: paragraph.start,
          paragraphIndexes: []
        })
      }
      chapters[chapters.length - 1].paragraphIndexes.push(paragraph.index)
    }
    return chapters
  }

  private findParagraphAt(offset: number): TextParagraph | undefined {
    return (
      this.paragraphs.find((paragraph) => offset >= paragraph.start && offset <= paragraph.end) ??
      this.paragraphs.find((paragraph) => paragraph.start > offset) ??
      this.paragraphs[this.paragraphs.length - 1]
    )
  }

  private findParagraphForNode(node: Node): TextParagraph | undefined {
    return this.paragraphs.find((paragraph) => paragraph.element.contains(node))
  }

  private offsetWithinElement(element: HTMLElement, node: Node, offset: number): number {
    const range = this.document.createRange()
    range.selectNodeContents(element)
    try {
      range.setEnd(node, offset)
    } catch {
      return 0
    }
    return codePointLength(range.toString())
  }

  private codePointOffsetToUtf16(value: string, offset: number): number {
    return Array.from(value).slice(0, offset).join('').length
  }

  private chapterProgressFor(paragraph: TextParagraph, fraction = 0): number {
    const chapter = this.chapters[paragraph.chapterIndex]
    if (!chapter) return 0
    const lastParagraph = this.paragraphs[chapter.paragraphIndexes[chapter.paragraphIndexes.length - 1]]
    if (!lastParagraph) return 0
    const chapterEnd = lastParagraph.end
    const span = chapterEnd - chapter.start
    if (span <= 0) return 0
    const paragraphLength = Math.max(0, paragraph.end - paragraph.start)
    const localPosition = paragraph.start + paragraphLength * Math.min(1, Math.max(0, fraction))
    return Math.min(1, Math.max(0, (localPosition - chapter.start) / span))
  }

  private chapterProgressAt(offset: number): number {
    const paragraph = this.findParagraphAt(offset)
    if (!paragraph) return 0
    const paragraphLength = Math.max(1, paragraph.end - paragraph.start)
    const fraction = Math.min(1, Math.max(0, (offset - paragraph.start) / paragraphLength))
    return this.chapterProgressFor(paragraph, fraction)
  }

  private paragraphRangeForAnchor(anchor: string): { startParagraph: TextParagraph; endParagraph: TextParagraph } | null {
    const parsed = parseTextAnchor(anchor, this.textCharacters.length)
    if (!parsed || parsed.end <= parsed.start) return null
    const startParagraph = this.findParagraphAt(parsed.start)
    const endParagraph = this.findParagraphAt(Math.max(parsed.start, parsed.end - 1))
    if (!startParagraph || !endParagraph || parsed.end > endParagraph.end) return null
    return { startParagraph, endParagraph }
  }

  private rangeForAnchor(anchor: string): Range | null {
    const parsed = parseTextAnchor(anchor, this.textCharacters.length)
    if (!parsed || parsed.end <= parsed.start) return null
    const rangeInfo = this.paragraphRangeForAnchor(anchor)
    if (!rangeInfo) return null
    const { startParagraph, endParagraph } = rangeInfo
    const startTextNode = startParagraph.element.firstChild
    const endTextNode = endParagraph.element.firstChild
    if (!startTextNode || !endTextNode) return null

    const localStart = parsed.start - startParagraph.start
    const localEnd = parsed.end - endParagraph.start
    const range = this.document.createRange()
    range.setStart(startTextNode, this.codePointOffsetToUtf16(startParagraph.text, localStart))
    range.setEnd(endTextNode, this.codePointOffsetToUtf16(endParagraph.text, localEnd))
    return range
  }

  private applyPersistentHighlights(): void {
    this.clearPersistentHighlights()
    if (!this.root || this.persistentHighlightAnchors.length === 0) return

    const ranges: Range[] = []
    const fallbackElements = new Set<HTMLElement>()
    for (const { anchor } of this.persistentHighlightAnchors) {
      const range = this.rangeForAnchor(anchor)
      if (!range) continue
      ranges.push(range)
      const rangeInfo = this.paragraphRangeForAnchor(anchor)
      if (!rangeInfo) continue
      const { startParagraph, endParagraph } = rangeInfo
      this.paragraphs
        .slice(startParagraph.index, endParagraph.index + 1)
        .forEach((paragraph) => fallbackElements.add(paragraph.element))
    }

    const view = this.document.defaultView as
      | (Window & { Highlight?: new (...ranges: Range[]) => unknown })
      | null
    const cssWithHighlights = (view as unknown as {
      CSS?: { highlights?: { delete(name: string): void; set(name: string, value: unknown): void } }
    } | null)?.CSS
    if (view?.Highlight && cssWithHighlights?.highlights && ranges.length > 0) {
      this.persistentHighlightRegistry = cssWithHighlights.highlights
      this.persistentHighlightRegistry.set(
        PERSISTENT_HIGHLIGHT_NAME,
        new view.Highlight(...ranges)
      )
      return
    }

    this.persistentHighlightElements = Array.from(fallbackElements)
    this.persistentHighlightElements.forEach((element) =>
      element.classList.add(PERSISTENT_HIGHLIGHT_FALLBACK_CLASS)
    )
  }

  private clearPersistentHighlights(): void {
    this.persistentHighlightRegistry?.delete(PERSISTENT_HIGHLIGHT_NAME)
    this.persistentHighlightRegistry = null
    this.persistentHighlightElements.forEach((element) =>
      element.classList.remove(PERSISTENT_HIGHLIGHT_FALLBACK_CLASS)
    )
    this.persistentHighlightElements = []
  }

  private clearTemporaryHighlight(): void {
    this.temporaryHighlightRegistry?.delete('llm-reader-temporary')
    this.temporaryHighlightRegistry = null
    this.temporaryHighlightElements.forEach((element) =>
      element.classList.remove('llm-reader-temporary-fallback')
    )
    this.temporaryHighlightElements = []
  }

  private setSelection(selection: SelectionContext | null): void {
    this.selection = selection
    this.callbacks.onSelectionChanged?.(selection)
  }

  private emitRelocation(relocation: ReaderRelocation): void {
    this.callbacks.onRelocated?.({
      locator: relocation.locator,
      progress: Math.min(1, Math.max(0, relocation.progress)),
      chapterProgress: Math.min(1, Math.max(0, relocation.chapterProgress)),
      chapterTitle: relocation.chapterTitle,
      chapterHref: relocation.chapterHref ?? null,
      reason: relocation.reason
    })
  }

  private resetDocument(): void {
    this.searchRevision += 1
    this.document.removeEventListener('selectionchange', this.handleSelectionChange)
    this.host.removeEventListener('scroll', this.handleScroll)
    this.unbindUserScrollInput()
    if (this.relocationFrame !== null && this.document.defaultView) {
      this.document.defaultView.cancelAnimationFrame(this.relocationFrame)
    }
    this.relocationFrame = null
    this.cancelProgrammaticScrollRelease()
    this.clearTemporaryHighlight()
    this.clearPersistentHighlights()
    this.host.replaceChildren()
    this.root = null
    this.highlightStyleElement = null
    this.text = ''
    this.textCharacters = []
    this.paragraphs = []
    this.chapters = []
    this.selection = null
    this.persistentHighlightAnchors = []
    this.programmaticScroll = false
  }
}

export { makeTextAnchor, parseTextAnchor, parseTextParagraphs }
