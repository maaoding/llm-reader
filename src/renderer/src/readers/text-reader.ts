import type { BookFormat, SelectionContext, TocItem } from '@shared/contracts'
import { copy } from '@shared/copy'
import { buildBoundedPassages, codePointLength, type ContextBlock } from './context'
import {
  cssFontFamily,
  fontFamilyStack,
  normalizeReadingPreferences,
  readingPreferencesEqual
} from './reading-preferences'
import type {
  ReadingPreferences,
  ReaderAdapter,
  ReaderCallbacks,
  ReaderDocumentInfo,
  ReaderRelocation
} from './types'
import { DEFAULT_READING_PREFERENCES, READER_SELECTION_BACKGROUND } from './types'

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
  private highlightedElements: HTMLElement[] = []
  private highlightRegistry: { delete(name: string): void; set(name: string, value: unknown): void } | null = null
  private relocationFrame: number | null = null
  private preferences: ReadingPreferences = { ...DEFAULT_READING_PREFERENCES }

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
    style.textContent = `
      .reader-document ::selection { background: ${READER_SELECTION_BACKGROUND}; color: inherit; }
      ::highlight(llm-reader-temporary) { background: rgba(246, 190, 72, .36); }
      .llm-reader-temporary-fallback { background: rgba(246, 190, 72, .25); outline: 2px solid rgba(196, 130, 18, .45); }
    `
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

    if (lastLocator && parseTextAnchor(lastLocator, this.textCharacters.length)) {
      await this.goTo(lastLocator)
    } else {
      this.emitRelocation({ locator: makeTextAnchor(0), progress: 0 })
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

  async goTo(anchor: string): Promise<void> {
    const parsed = parseTextAnchor(anchor, this.textCharacters.length)
    if (!parsed) {
      throw new Error(copy('reader.txtInvalidAnchor'))
    }

    const paragraph = this.findParagraphAt(parsed.start)
    if (!paragraph) {
      throw new Error(copy('reader.txtAnchorOutside'))
    }

    if (typeof paragraph.element.scrollIntoView === 'function') {
      paragraph.element.scrollIntoView({ behavior: 'auto', block: 'start' })
    } else {
      this.host.scrollTop = paragraph.element.offsetTop
    }

    this.emitRelocation({
      locator: makeTextAnchor(parsed.start),
      progress: this.textCharacters.length === 0 ? 0 : parsed.start / this.textCharacters.length
    })
  }

  getSelection(): SelectionContext | null {
    return this.selection
  }

  async highlight(anchor: string): Promise<void> {
    const parsed = parseTextAnchor(anchor, this.textCharacters.length)
    if (!parsed || parsed.end <= parsed.start) {
      throw new Error(copy('reader.txtInvalidHighlight'))
    }
    const startParagraph = this.findParagraphAt(parsed.start)
    const endParagraph = this.findParagraphAt(Math.max(parsed.start, parsed.end - 1))
    if (!startParagraph || !endParagraph || parsed.end > endParagraph.end) {
      throw new Error(copy('reader.txtHighlightOutside'))
    }

    this.clearHighlight()
    const range = this.document.createRange()
    const startTextNode = startParagraph.element.firstChild
    const endTextNode = endParagraph.element.firstChild
    if (!startTextNode || !endTextNode) {
      return
    }

    const localStart = parsed.start - startParagraph.start
    const localEnd = parsed.end - endParagraph.start
    const utf16Start = this.codePointOffsetToUtf16(startParagraph.text, localStart)
    const utf16End = this.codePointOffsetToUtf16(endParagraph.text, localEnd)
    range.setStart(startTextNode, utf16Start)
    range.setEnd(endTextNode, utf16End)

    const view = this.document.defaultView as
      | (Window & { Highlight?: new (...ranges: Range[]) => unknown })
      | null
    const cssWithHighlights = (view as unknown as {
      CSS?: { highlights?: { delete(name: string): void; set(name: string, value: unknown): void } }
    } | null)?.CSS
    if (view?.Highlight && cssWithHighlights?.highlights) {
      this.highlightRegistry = cssWithHighlights.highlights
      this.highlightRegistry.set('llm-reader-temporary', new view.Highlight(range))
      return
    }

    this.highlightedElements = this.paragraphs
      .slice(startParagraph.index, endParagraph.index + 1)
      .map((paragraph) => paragraph.element)
    this.highlightedElements.forEach((element) =>
      element.classList.add('llm-reader-temporary-fallback')
    )
  }

  clearHighlight(): void {
    this.highlightRegistry?.delete('llm-reader-temporary')
    this.highlightRegistry = null
    this.highlightedElements.forEach((element) =>
      element.classList.remove('llm-reader-temporary-fallback')
    )
    this.highlightedElements = []
  }

  async setPreferences(preferences: ReadingPreferences): Promise<void> {
    const normalized = normalizeReadingPreferences(preferences)
    if (readingPreferencesEqual(this.preferences, normalized)) {
      return
    }
    this.preferences = normalized
    this.applyPreferences()
  }

  private applyPreferences(): void {
    if (!this.root) {
      return
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
    const hostTop = this.host.getBoundingClientRect().top
    const firstVisible =
      this.paragraphs.find((paragraph) => paragraph.element.getBoundingClientRect().bottom > hostTop + 8) ??
      this.paragraphs[this.paragraphs.length - 1]
    if (!firstVisible) {
      return
    }
    const scrollable = Math.max(0, this.host.scrollHeight - this.host.clientHeight)
    const progress = scrollable === 0 ? firstVisible.start / this.textCharacters.length : this.host.scrollTop / scrollable
    this.emitRelocation({
      locator: makeTextAnchor(firstVisible.start),
      progress: Math.min(1, Math.max(0, progress))
    })
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

  private setSelection(selection: SelectionContext | null): void {
    this.selection = selection
    this.callbacks.onSelectionChanged?.(selection)
  }

  private emitRelocation(relocation: ReaderRelocation): void {
    this.callbacks.onRelocated?.({
      locator: relocation.locator,
      progress: Math.min(1, Math.max(0, relocation.progress))
    })
  }

  private resetDocument(): void {
    this.document.removeEventListener('selectionchange', this.handleSelectionChange)
    this.host.removeEventListener('scroll', this.handleScroll)
    if (this.relocationFrame !== null && this.document.defaultView) {
      this.document.defaultView.cancelAnimationFrame(this.relocationFrame)
    }
    this.relocationFrame = null
    this.clearHighlight()
    this.host.replaceChildren()
    this.root = null
    this.text = ''
    this.textCharacters = []
    this.paragraphs = []
    this.chapters = []
    this.selection = null
  }
}

export { makeTextAnchor, parseTextAnchor, parseTextParagraphs }
