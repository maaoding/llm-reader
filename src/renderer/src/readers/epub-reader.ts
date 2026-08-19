import ePub, {
  type Book,
  type Contents,
  type Location,
  type NavItem,
  type Rendition
} from 'epubjs'
import type { BookFormat, SelectionContext, TocItem } from '@shared/contracts'
import { copy } from '@shared/copy'
import { buildBoundedPassages, codePointLength, type ContextBlock } from './context'
import {
  cssFontFamily,
  fontFamilyStack,
  normalizeReadingPreferences,
  READING_CONTENT_WIDTH_PIXELS,
  READING_PARAGRAPH_SPACING_EM,
  READING_PAPER_THEME_TOKENS,
  readingPreferencesEqual
} from './reading-preferences'
import type {
  ReadingPreferences,
  ReaderAdapter,
  ReaderCallbacks,
  ReaderDocumentInfo,
  ReaderHighlightAnchor,
  ReaderRelocation,
  ReaderRelocationReason
} from './types'
import { DEFAULT_READING_PREFERENCES, READER_SELECTION_BACKGROUND } from './types'
import { stabilizeContinuousManager } from './epub-continuous-stability'

const EPUB_CFI_PATTERN = /^epubcfi\(.+\)$/u
const CONTENT_BLOCK_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,figcaption,dd,dt'
const TEMPORARY_HIGHLIGHT_CLASS = 'llm-reader-temporary-highlight'
const PERSISTENT_HIGHLIGHT_CLASS = 'llm-reader-persistent-highlight'
const READING_PREFERENCES_STYLESHEET = 'llm-reader-reading-preferences'
const READING_PREFERENCES_STYLE_ELEMENT_ID =
  `epubjs-inserted-css-${READING_PREFERENCES_STYLESHEET}`
const ORDINARY_PARAGRAPH_SELECTOR =
  'p:not(:where(pre *, code *, blockquote *, li *, table *, figcaption *, figure *))'
const CODE_BLOCK_SELECTOR = 'pre, code, kbd, samp, var'
const MONOSPACE_STACK = "ui-monospace, 'Cascadia Mono', Consolas, 'Courier New', monospace"
const READER_FONT_FACE_FAMILY = 'llm-reader-selected-font'
const CONTINUOUS_REFLOW_CSS =
  'html, body { height: auto !important; max-height: none !important; min-height: 0 !important; }'

interface FontFamilyCss {
  faceRule: string
  stack: string
}

/**
 * Wraps an installed font in a document-level @font-face whose src is the
 * local family name. Chromium's DirectWrite fallback can otherwise keep
 * rendering the EPUB iframe's original font when a per-user font is applied
 * after the iframe has already loaded; registering it as a document font
 * forces the iframe to rematch the family and use the installed glyphs.
 */
function readingFontFamilyCss(family: string): FontFamilyCss {
  const localSources = fontFamilyStack(family)
    .map((name) => `local(${cssFontFamily(name)})`)
    .join(', ')
  const stack = [
    cssFontFamily(READER_FONT_FACE_FAMILY),
    ...fontFamilyStack(family).map(cssFontFamily)
  ].join(', ')
  return {
    faceRule: `@font-face { font-family: ${cssFontFamily(READER_FONT_FACE_FAMILY)}; src: ${localSources}; }`,
    stack
  }
}

interface EpubParagraph {
  index: number
  element: Element
  text: string
  leadingCharacters: number
}

interface DomPosition {
  node: Text
  offset: number
}

function isEpubCfi(value: string): boolean {
  return value.length <= 16_384 && EPUB_CFI_PATTERN.test(value)
}

function isSafeInternalHref(value: string): boolean {
  const href = value.trim()
  return (
    href.length > 0 &&
    href.length <= 4_096 &&
    !href.startsWith('//') &&
    !href.startsWith('/') &&
    !/^[a-z][a-z\d+.-]*:/iu.test(href) &&
    !href.includes('\0')
  )
}

function normalizeHref(value: string): string {
  const withoutFragment = value.split('#', 1)[0].replace(/^\.\//u, '')
  try {
    return decodeURIComponent(withoutFragment)
  } catch {
    return withoutFragment
  }
}

function flattenToc(items: NavItem[], depth = 0, output: TocItem[] = []): TocItem[] {
  for (const item of items) {
    if (isSafeInternalHref(item.href)) {
      const label = item.label.replace(/\s+/gu, ' ').trim() || copy('reader.epubUntitledChapter')
      output.push({
        id: item.id || `epub-toc-${output.length + 1}`,
        label,
        href: item.href,
        depth
      })
    }
    if (item.subitems?.length) {
      flattenToc(item.subitems, depth + 1, output)
    }
  }
  return output
}

function textNodes(element: Element): Text[] {
  const nodes: Text[] = []
  const walker = element.ownerDocument.createTreeWalker(element, 4)
  let current = walker.nextNode()
  while (current) {
    if (current.nodeType === 3) {
      nodes.push(current as Text)
    }
    current = walker.nextNode()
  }
  return nodes
}

function domPositionAt(element: Element, codePointOffset: number): DomPosition | null {
  const nodes = textNodes(element)
  let remaining = Math.max(0, codePointOffset)
  for (const node of nodes) {
    const value = node.data
    const characters = Array.from(value)
    if (remaining <= characters.length) {
      return { node, offset: characters.slice(0, remaining).join('').length }
    }
    remaining -= characters.length
  }

  const last = nodes[nodes.length - 1]
  return last ? { node: last, offset: last.data.length } : null
}

function rangeForElementSlice(
  element: Element,
  start: number,
  end: number,
  leadingCharacters = 0
): Range {
  const range = element.ownerDocument.createRange()
  const startPosition = domPositionAt(element, leadingCharacters + start)
  const endPosition = domPositionAt(element, leadingCharacters + end)
  if (!startPosition || !endPosition) {
    range.selectNodeContents(element)
    return range
  }
  range.setStart(startPosition.node, startPosition.offset)
  range.setEnd(endPosition.node, endPosition.offset)
  return range
}

function extractParagraphs(contents: Contents): EpubParagraph[] {
  const candidates = Array.from(contents.content.querySelectorAll(CONTENT_BLOCK_SELECTOR)).filter(
    (element) => !element.querySelector(CONTENT_BLOCK_SELECTOR)
  )
  const source = candidates.length > 0 ? candidates : [contents.content]

  return source.flatMap((element, index) => {
    const raw = element.textContent ?? ''
    const text = raw.trim()
    if (text.length === 0) {
      return []
    }
    const leadingUtf16 = raw.indexOf(text)
    return [
      {
        index,
        element,
        text,
        leadingCharacters: codePointLength(raw.slice(0, Math.max(0, leadingUtf16)))
      }
    ]
  })
}

function offsetWithinElement(element: Element, node: Node, offset: number): number {
  const range = element.ownerDocument.createRange()
  range.selectNodeContents(element)
  try {
    range.setEnd(node, offset)
  } catch {
    return 0
  }
  return codePointLength(range.toString())
}

function sanitizeContents(contents: Contents): void {
  const root = contents.content
  root
    .querySelectorAll('script,iframe,frame,object,embed,applet,form,meta[http-equiv="refresh"],base')
    .forEach((element) => element.remove())

  root.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') {
        element.removeAttribute(attribute.name)
      }
    }

    for (const attributeName of ['src', 'poster']) {
      const value = element.getAttribute(attributeName)?.trim()
      if (value && (/^https?:/iu.test(value) || value.startsWith('//'))) {
        element.removeAttribute(attributeName)
      }
    }
  })

  root.querySelectorAll('a').forEach((anchor) => {
    anchor.removeAttribute('target')
    anchor.removeAttribute('href')
    ;(anchor as HTMLAnchorElement).onclick = null
    anchor.addEventListener(
      'click',
      (event) => {
        event.preventDefault()
        event.stopImmediatePropagation()
      },
      true
    )
  })
}

function readingPreferencesCss(preferences: ReadingPreferences): string {
  const rules: string[] = []
  if (preferences.paperTheme !== 'light') {
    const paper = READING_PAPER_THEME_TOKENS[preferences.paperTheme]
    rules.push(
      `html { color-scheme: ${paper.colorScheme}; background-color: ${paper.background} !important; }`,
      `body { background-color: ${paper.background} !important; color: ${paper.color} !important; }`
    )
  }
  if (preferences.fontScale !== DEFAULT_READING_PREFERENCES.fontScale) {
    rules.push(`body { font-size: ${preferences.fontScale}% !important; }`)
  }
  if (preferences.lineHeight !== 'original') {
    rules.push(`body, p { line-height: ${preferences.lineHeight} !important; }`)
  }
  if (preferences.indent !== 'original') {
    const indent = preferences.indent === 'none' ? '0' : '2em'
    rules.push(`${ORDINARY_PARAGRAPH_SELECTOR} { text-indent: ${indent} !important; }`)
  }
  if (preferences.contentWidth !== 'original') {
    const maximumWidth = READING_CONTENT_WIDTH_PIXELS[preferences.contentWidth]
    rules.push(
      `body { box-sizing: border-box !important; max-width: ${maximumWidth}px !important; margin-inline: auto !important; }`
    )
  }
  if (preferences.paragraphSpacing !== 'original') {
    const spacing = READING_PARAGRAPH_SPACING_EM[preferences.paragraphSpacing]
    rules.push(
      `${ORDINARY_PARAGRAPH_SELECTOR} { margin-block-start: 0 !important; margin-block-end: ${spacing}em !important; }`
    )
  }
  if (preferences.fontFamily) {
    const fontFamily = readingFontFamilyCss(preferences.fontFamily)
    rules.push(fontFamily.faceRule)
    rules.push(
      `body, body :not(${CODE_BLOCK_SELECTOR}) { font-family: ${fontFamily.stack} !important; }`
    )
    rules.push(`${CODE_BLOCK_SELECTOR} { font-family: ${MONOSPACE_STACK} !important; }`)
  }
  return rules.join('\n')
}

function readerStylesheetCss(preferences: ReadingPreferences, reflowable: boolean): string {
  const rules = [
    `::selection { background: ${READER_SELECTION_BACKGROUND}; color: inherit; }`,
    reflowable ? CONTINUOUS_REFLOW_CSS : '',
    reflowable ? readingPreferencesCss(preferences) : ''
  ]
  return rules.filter(Boolean).join('\n')
}

export class EpubReaderAdapter implements ReaderAdapter {
  readonly format: BookFormat = 'epub'

  private readonly host: HTMLElement
  private readonly callbacks: ReaderCallbacks
  private book: Book | null = null
  private rendition: Rendition | null = null
  private toc: TocItem[] = []
  private selection: SelectionContext | null = null
  private highlightedCfi: string | null = null
  private persistentHighlightAnchors: ReaderHighlightAnchor[] = []
  private persistentHighlightedCfi: string[] = []
  private spineCount = 0
  private locationsReady = false
  private preferences: ReadingPreferences = { ...DEFAULT_READING_PREFERENCES }
  private reflowable = true
  private latestLocator: string | null = null
  private currentSectionIndex = 0
  private preferencesRevision = 0
  private programmaticScroll = false
  private programmaticReleaseTimer: ReturnType<typeof setTimeout> | null = null
  private containerScrollFrame: number | null = null
  private scrollInputContainer: HTMLElement | null = null
  private relocationReason: ReaderRelocationReason = 'navigation'
  private sectionPercentageBounds = new Map<number, { start: number; end: number }>()

  constructor(host: HTMLElement, callbacks: ReaderCallbacks) {
    this.host = host
    this.callbacks = callbacks
  }

  async open(bytes: Uint8Array, lastLocator?: string | null): Promise<ReaderDocumentInfo> {
    this.resetDocument()
    if (bytes.byteLength === 0) {
      throw new Error(copy('reader.epubEmpty'))
    }

    const book = ePub(Uint8Array.from(bytes).buffer)
    this.book = book
    await book.ready
    const [metadata, navigation, spine] = await Promise.all([
      book.loaded.metadata,
      book.loaded.navigation,
      book.loaded.spine
    ])
    this.toc = flattenToc(navigation.toc)
    this.spineCount = spine.length
    this.reflowable = metadata.layout !== 'pre-paginated'

    const rendition = book.renderTo(this.host, {
      width: '100%',
      height: '100%',
      manager: this.reflowable ? 'continuous' : 'default',
      flow: this.reflowable ? 'scrolled-doc' : 'paginated',
      spread: 'none',
      allowScriptedContent: false
    })
    this.rendition = rendition
    rendition.hooks.content.register(this.handleContents)
    rendition.on('selected', this.handleSelected)
    rendition.on('relocated', this.handleRelocated)

    await rendition.started
    if (rendition.settings?.layout === 'pre-paginated') {
      this.reflowable = false
    }
    if (this.reflowable) {
      stabilizeContinuousManager(rendition)
    }
    this.bindRendererScrollInput(rendition)

    try {
      const generatedLocations = await book.locations.generate(1_600)
      this.locationsReady = true
      this.buildSectionPercentageBounds(generatedLocations)
    } catch {
      this.locationsReady = false
      this.sectionPercentageBounds.clear()
    }

    this.programmaticScroll = true
    this.relocationReason = 'restore'
    const initialLocator = lastLocator && isEpubCfi(lastLocator) ? lastLocator : undefined
    if (initialLocator) {
      try {
        await rendition.display(initialLocator)
      } catch {
        await rendition.display()
      }
    } else {
      await rendition.display()
    }
    this.scheduleProgrammaticScrollRelease()

    return {
      metadata: {
        title: metadata.title?.trim() || copy('reader.epubUntitled'),
        author: metadata.creator?.trim() || null
      },
      toc: this.toc
    }
  }

  destroy(): void {
    this.resetDocument()
  }

  async goTo(anchor: string): Promise<void> {
    const rendition = this.requireRendition()
    if (!isEpubCfi(anchor) && !this.toc.some((item) => item.href === anchor)) {
      throw new Error(copy('reader.epubInvalidAnchor'))
    }
    this.programmaticScroll = true
    this.relocationReason = 'navigation'
    try {
      await rendition.display(anchor)
    } catch {
      throw new Error(copy('reader.epubAnchorFailed'))
    }
    this.scheduleProgrammaticScrollRelease()
  }

  getSelection(): SelectionContext | null {
    return this.selection
  }

  async selectAnchor(anchor: string): Promise<boolean> {
    if (!isEpubCfi(anchor)) {
      throw new Error(copy('reader.epubInvalidHighlight'))
    }
    const rendition = this.requireRendition()
    await this.waitForLayout()
    const range = rendition.getRange(anchor) as Range | null
    if (!range) return false

    const ownerDocument = range.commonAncestorContainer.ownerDocument
    const frameElement = ownerDocument?.defaultView?.frameElement as HTMLElement | null
    const frameRect = frameElement?.getBoundingClientRect()
    const offsetX = frameRect?.left ?? 0
    const offsetY = frameRect?.top ?? 0
    const hostRect = this.host.getBoundingClientRect()
    const visible = Array.from(range.getClientRects()).some((rect) => {
      const left = rect.left + offsetX
      const right = rect.right + offsetX
      const top = rect.top + offsetY
      const bottom = rect.bottom + offsetY
      return bottom > hostRect.top && top < hostRect.bottom && right > hostRect.left && left < hostRect.right
    })
    if (!visible) return false

    const nativeSelection = ownerDocument?.defaultView?.getSelection()
    if (!nativeSelection) return false
    nativeSelection.removeAllRanges()
    nativeSelection.addRange(range)
    return true
  }
  async highlight(anchor: string): Promise<void> {
    if (!isEpubCfi(anchor)) {
      throw new Error(copy('reader.epubInvalidHighlight'))
    }
    const rendition = this.requireRendition()
    this.clearHighlight()
    rendition.annotations.highlight(
      anchor,
      { temporary: true },
      undefined,
      TEMPORARY_HIGHLIGHT_CLASS,
      {
        fill: '#f6be48',
        'fill-opacity': '0.32',
        'mix-blend-mode': 'multiply'
      }
    )
    this.highlightedCfi = anchor
  }

  clearHighlight(): void {
    if (this.highlightedCfi && this.rendition) {
      this.rendition.annotations.remove(this.highlightedCfi, 'highlight')
    }
    this.highlightedCfi = null
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
    const revision = ++this.preferencesRevision
    const rendition = this.rendition
    if (!rendition || !this.reflowable) {
      return
    }

    const locator = this.latestLocator ?? rendition.location?.start?.cfi ?? null
    this.currentContents(rendition).forEach((contents) => this.applyPreferences(contents))
    if (!locator || !isEpubCfi(locator)) {
      return
    }

    await this.waitForLayout()
    if (this.rendition !== rendition || revision !== this.preferencesRevision) {
      return
    }
    this.programmaticScroll = true
    this.relocationReason = 'navigation'
    await rendition.display(locator)
    this.scheduleProgrammaticScrollRelease()
  }

  private readonly handleContents = (contents: Contents): void => {
    sanitizeContents(contents)
    this.applyPreferences(contents)
    this.bindContentsScrollInput(contents)
    this.attachContainerScrollInput(
      this.rendition ? this.managerContainer(this.rendition) : null
    )
    this.applyPersistentHighlights()
  }

  private applyPreferences(contents: Contents): void {
    contents.document.getElementById(READING_PREFERENCES_STYLE_ELEMENT_ID)?.remove()
    const css = readerStylesheetCss(this.preferences, this.reflowable)
    if (css) {
      void contents.addStylesheetCss(css, READING_PREFERENCES_STYLESHEET)
    }
  }

  private currentContents(rendition: Rendition): Contents[] {
    const getContents = (rendition as Rendition & { getContents?: () => unknown }).getContents
    if (typeof getContents !== 'function') return []
    const contents = getContents.call(rendition) as unknown
    if (Array.isArray(contents)) {
      return contents as Contents[]
    }
    return contents ? [contents as Contents] : []
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

  private bindRendererScrollInput(rendition: Rendition): void {
    this.host.addEventListener('wheel', this.handleUserScrollInput, { passive: true })
    this.host.addEventListener('touchmove', this.handleUserScrollInput, { passive: true })
    this.host.addEventListener('pointerdown', this.handleUserScrollInput)
    this.host.addEventListener('keydown', this.handleUserScrollInput)

    const manager = (rendition as { manager?: { container?: HTMLElement } } | null)?.manager
    const container = manager?.container ?? this.host.querySelector<HTMLElement>(':scope > .epub-container')
    if (container) this.attachContainerScrollInput(container)
  }

  private attachContainerScrollInput(container: HTMLElement | null): void {
    if (!container || container === this.scrollInputContainer) return
    if (this.scrollInputContainer) {
      this.scrollInputContainer.removeEventListener('wheel', this.handleUserScrollInput)
      this.scrollInputContainer.removeEventListener('touchmove', this.handleUserScrollInput)
      this.scrollInputContainer.removeEventListener('pointerdown', this.handleUserScrollInput)
      this.scrollInputContainer.removeEventListener('scroll', this.handleContainerScroll)
    }
    this.scrollInputContainer = container
    container.addEventListener('wheel', this.handleUserScrollInput, { passive: true })
    container.addEventListener('touchmove', this.handleUserScrollInput, { passive: true })
    container.addEventListener('pointerdown', this.handleUserScrollInput)
    container.addEventListener('scroll', this.handleContainerScroll, { passive: true })
  }

  private readonly handleContainerScroll = (): void => {
    if (this.containerScrollFrame !== null) return
    const view = this.host.ownerDocument.defaultView
    if (!view || typeof view.requestAnimationFrame !== 'function') {
      this.emitNaturalScrollState()
      return
    }
    this.containerScrollFrame = view.requestAnimationFrame(() => {
      this.containerScrollFrame = null
      this.emitNaturalScrollState()
    })
  }

  private managerContainer(rendition: Rendition): HTMLElement | null {
    const container = (rendition as { manager?: { container?: HTMLElement } } | null)
      ?.manager?.container
    return container ?? this.host.querySelector<HTMLElement>(':scope > .epub-container')
  }

  private sectionIndexAtContainerScroll(container: HTMLElement): number | null {
    const rendition = this.rendition
    if (!rendition) return null
    const contents = this.currentContents(rendition)
    if (contents.length === 0) return null
    const containerRect = container.getBoundingClientRect()
    const readingLine = containerRect.top + Math.min(24, containerRect.height * 0.5)
    let nearestIndex: number | null = null
    let nearestDistance = Number.POSITIVE_INFINITY

    for (const item of contents) {
      const frame = (item.window as Window & { frameElement?: HTMLElement | null })
        .frameElement
      if (!frame) continue
      const frameRect = frame.getBoundingClientRect()
      if (frameRect.top <= readingLine && frameRect.bottom > readingLine) {
        return item.sectionIndex
      }
      const distance = Math.min(
        Math.abs(frameRect.top - readingLine),
        Math.abs(frameRect.bottom - readingLine)
      )
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestIndex = item.sectionIndex
      }
    }
    return nearestIndex
  }

  private emitNaturalScrollState(): void {
    if (this.programmaticScroll || !this.latestLocator || !this.rendition || !this.reflowable) return
    const container = this.managerContainer(this.rendition)
    if (!container) return
    const sectionIndex = this.sectionIndexAtContainerScroll(container)
    if (sectionIndex === null) return
    const scrollable = Math.max(0, container.scrollHeight - container.clientHeight)
    const progress = scrollable === 0 ? 0 : container.scrollTop / scrollable
    this.emitRelocation({
      locator: this.latestLocator,
      progress,
      chapterProgress: this.chapterProgressFromDom(sectionIndex as number) ?? 0,
      chapterTitle: this.chapterTitle(sectionIndex),
      chapterHref: this.chapterHref(sectionIndex),
      reason: 'natural'
    })
  }

  private bindContentsScrollInput(contents: Contents): void {
    contents.window.addEventListener('wheel', this.handleUserScrollInput, { passive: true })
    contents.window.addEventListener('touchmove', this.handleUserScrollInput, { passive: true })
    contents.window.addEventListener('pointerdown', this.handleUserScrollInput)
    contents.window.addEventListener('keydown', this.handleUserScrollInput)
  }

  private unbindRendererScrollInput(): void {
    this.host.removeEventListener('wheel', this.handleUserScrollInput)
    this.host.removeEventListener('touchmove', this.handleUserScrollInput)
    this.host.removeEventListener('pointerdown', this.handleUserScrollInput)
    this.host.removeEventListener('keydown', this.handleUserScrollInput)
    if (this.scrollInputContainer) {
      this.scrollInputContainer.removeEventListener('wheel', this.handleUserScrollInput)
      this.scrollInputContainer.removeEventListener('touchmove', this.handleUserScrollInput)
      this.scrollInputContainer.removeEventListener('pointerdown', this.handleUserScrollInput)
      this.scrollInputContainer.removeEventListener('scroll', this.handleContainerScroll)
      this.scrollInputContainer = null
    }
    if (this.containerScrollFrame !== null && this.host.ownerDocument.defaultView) {
      this.host.ownerDocument.defaultView.cancelAnimationFrame(this.containerScrollFrame)
    }
    this.containerScrollFrame = null
  }

  private buildSectionPercentageBounds(locations: string[]): void {
    const bounds = new Map<number, { minimum: number; maximum: number }>()
    const lastIndex = Math.max(0, locations.length - 1)
    locations.forEach((cfi, index) => {
      const sectionIndex = this.spineIndexFromCfi(cfi)
      if (sectionIndex < 0) return
      const percentage = lastIndex === 0 ? 0 : index / lastIndex
      const current = bounds.get(sectionIndex)
      if (!current) {
        bounds.set(sectionIndex, { minimum: percentage, maximum: percentage })
      } else {
        current.minimum = Math.min(current.minimum, percentage)
        current.maximum = Math.max(current.maximum, percentage)
      }
    })

    this.sectionPercentageBounds.clear()
    for (const [sectionIndex, bound] of bounds) {
      this.sectionPercentageBounds.set(sectionIndex, {
        start: bound.minimum,
        end: bound.maximum
      })
    }
  }

  private spineIndexFromCfi(value: string): number {
    const match = /epubcfi\(\/6\/(\d+)/u.exec(value)
    if (!match) return -1
    const index = Number(match[1]) - 1
    return Number.isSafeInteger(index) && index >= 0 ? index : -1
  }

  private chapterProgressFor(location: Location): number {
    const sectionIndex = Number.isFinite(location.start.index) ? location.start.index : 0
    const domProgress = this.chapterProgressFromDom(sectionIndex)
    if (domProgress !== null) {
      return domProgress
    }

    const bounds = this.sectionPercentageBounds.get(sectionIndex)
    const percentage = location.start.percentage
    if (!bounds || !Number.isFinite(percentage) || bounds.end <= bounds.start) {
      return this.spineCount <= 1
        ? (Number.isFinite(percentage) ? percentage : 0)
        : sectionIndex / Math.max(1, this.spineCount - 1)
    }
    return Math.min(1, Math.max(0, (percentage - bounds.start) / (bounds.end - bounds.start)))
  }

  private chapterProgressFromDom(sectionIndex: number): number | null {
    const rendition = this.rendition
    if (!rendition) return null
    const contents = this.currentContents(rendition).find(
      (item) => item.sectionIndex === sectionIndex
    ) ?? this.currentContents(rendition)[0]
    if (!contents) return null
    const frame = (contents.window as Window & { frameElement?: HTMLElement | null })
      .frameElement
    const managerContainer = (rendition as { manager?: { container?: HTMLElement } } | null)
      ?.manager?.container
    const container = managerContainer ?? this.host.querySelector<HTMLElement>(':scope > .epub-container')
    if (!frame || !container) return null
    const frameRect = frame.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const frameTopInContent = frameRect.top - containerRect.top + container.scrollTop
    const localScroll = container.scrollTop - frameTopInContent
    const maximumLocalScroll = Math.max(0, frameRect.height - containerRect.height)
    if (maximumLocalScroll <= 0) return 0
    return Math.min(1, Math.max(0, localScroll / maximumLocalScroll))
  }

  private removeResidualHighlightOverlays(): void {
    this.host.querySelectorAll(`.${PERSISTENT_HIGHLIGHT_CLASS}`).forEach((element) => element.remove())
  }

  private applyPersistentHighlights(): void {
    const rendition = this.rendition
    if (!rendition) return
    for (const cfi of this.persistentHighlightedCfi) {
      rendition.annotations.remove(cfi, 'highlight')
    }
    this.persistentHighlightedCfi = []
    this.removeResidualHighlightOverlays()
    for (const { anchor } of this.persistentHighlightAnchors) {
      if (!isEpubCfi(anchor)) continue
      rendition.annotations.highlight(
        anchor,
        { persistent: true },
        undefined,
        PERSISTENT_HIGHLIGHT_CLASS,
        {
          fill: '#7cbd9a',
          'fill-opacity': '0.30',
          'mix-blend-mode': 'multiply'
        }
      )
      this.persistentHighlightedCfi.push(anchor)
    }
  }

  private clearPersistentHighlights(): void {
    const rendition = this.rendition
    if (rendition) {
      for (const cfi of this.persistentHighlightedCfi) {
        rendition.annotations.remove(cfi, 'highlight')
      }
    }
    this.removeResidualHighlightOverlays()
    this.persistentHighlightedCfi = []
  }

  private async waitForLayout(): Promise<void> {
    const view = this.host.ownerDocument.defaultView
    if (!view || typeof view.requestAnimationFrame !== 'function') {
      await Promise.resolve()
      return
    }
    await new Promise<void>((resolve) => {
      view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve()))
    })
  }

  private readonly handleSelected = (cfiRange: string, contents: Contents): void => {
    if (!isEpubCfi(cfiRange)) {
      this.setSelection(null)
      return
    }
    const nativeSelection = contents.window.getSelection()
    if (!nativeSelection || nativeSelection.rangeCount === 0 || nativeSelection.isCollapsed) {
      this.setSelection(null)
      return
    }
    const quote = nativeSelection.toString().trim()
    if (quote.length === 0) {
      this.setSelection(null)
      return
    }

    const range = nativeSelection.getRangeAt(0)
    const paragraphs = extractParagraphs(contents)
    if (paragraphs.length === 0) {
      this.setSelection(null)
      return
    }
    let startBlock = paragraphs.findIndex((paragraph) => paragraph.element.contains(range.startContainer))
    let endBlock = paragraphs.findIndex((paragraph) => paragraph.element.contains(range.endContainer))
    if (startBlock < 0) {
      startBlock = paragraphs.findIndex((paragraph) => range.intersectsNode(paragraph.element))
    }
    if (endBlock < 0) {
      for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
        if (range.intersectsNode(paragraphs[index].element)) {
          endBlock = index
          break
        }
      }
    }
    startBlock = Math.max(0, startBlock)
    endBlock = Math.max(startBlock, endBlock)

    const startParagraph = paragraphs[startBlock]
    const endParagraph = paragraphs[endBlock]
    const startOffset = Math.max(
      0,
      offsetWithinElement(startParagraph.element, range.startContainer, range.startOffset) -
        startParagraph.leadingCharacters
    )
    const endOffset = Math.max(
      0,
      offsetWithinElement(endParagraph.element, range.endContainer, range.endOffset) -
        endParagraph.leadingCharacters
    )
    const blocks: ContextBlock[] = paragraphs.map((paragraph, index) => ({
      id: `P${index + 1}`,
      text: paragraph.text,
      anchorForSlice: (localStart, localEnd) => {
        const passageRange = rangeForElementSlice(
          paragraph.element,
          localStart,
          localEnd,
          paragraph.leadingCharacters
        )
        return contents.cfiFromRange(passageRange)
      }
    }))
    const passages = buildBoundedPassages(blocks, {
      startBlock,
      startOffset,
      endBlock,
      endOffset
    })

    this.setSelection({
      bookId: this.callbacks.bookId,
      quote,
      anchor: cfiRange,
      chapterTitle: this.chapterTitle(contents.sectionIndex),
      passages
    })
  }

  private readonly handleRelocated = (location: Location): void => {
    const locator = location?.start?.cfi
    if (!locator || !isEpubCfi(locator)) {
      return
    }
    this.latestLocator = locator
    const hrefSectionIndex = this.sectionIndexFromHref(location.start.href)
    this.currentSectionIndex = hrefSectionIndex ?? (Number.isFinite(location.start.index) ? location.start.index : 0)
    const reportedPercentage = location.start.percentage
    const fallbackPercentage =
      this.spineCount <= 1 ? 0 : location.start.index / Math.max(1, this.spineCount - 1)
    const progress =
      this.locationsReady && Number.isFinite(reportedPercentage)
        ? reportedPercentage
        : fallbackPercentage
    const reason: ReaderRelocationReason = this.programmaticScroll
      ? this.relocationReason
      : 'natural'
    this.emitRelocation({
      locator,
      progress,
      chapterProgress: this.chapterProgressFor(location),
      chapterTitle: this.chapterTitle(this.currentSectionIndex, location.start.href),
      chapterHref: this.chapterHref(this.currentSectionIndex, location.start.href),
      reason
    })
  }

  private sectionIndexFromHref(href?: string): number | null {
    if (!href || !this.book) return null
    const normalized = normalizeHref(href)
    for (let index = 0; index < this.spineCount; index += 1) {
      const sectionHref = this.book.spine.get(index)?.href
      if (sectionHref && normalizeHref(sectionHref) === normalized) {
        return index
      }
    }
    return null
  }

  private chapterHref(sectionIndex: number, directHref?: string): string | null {
    const sectionHref = directHref || this.book?.spine.get(sectionIndex)?.href || null
    if (!sectionHref) return null
    const normalized = normalizeHref(sectionHref)
    const matches = this.toc.filter((item) => normalizeHref(item.href) === normalized)
    if (matches.length === 0) return sectionHref
    return (matches.find((item) => !item.href.includes('#')) ?? matches[0]).href
  }

  private chapterTitle(sectionIndex: number, directHref?: string): string {
    const sectionHref = this.chapterHref(sectionIndex, directHref)
    if (sectionHref) {
      const normalized = normalizeHref(sectionHref)
      const match = this.toc.find((item) => normalizeHref(item.href) === normalized)
      if (match) {
        return match.label
      }
    }
    return copy('reader.epubSection', { number: sectionIndex + 1 })
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

  private requireRendition(): Rendition {
    if (!this.rendition) {
      throw new Error(copy('reader.epubNotOpen'))
    }
    return this.rendition
  }

  private resetDocument(): void {
    if (this.rendition) {
      this.rendition.off('selected', this.handleSelected)
      this.rendition.off('relocated', this.handleRelocated)
    }
    this.clearHighlight()
    this.clearPersistentHighlights()
    this.cancelProgrammaticScrollRelease()
    this.unbindRendererScrollInput()
    this.book?.destroy()
    this.book = null
    this.rendition = null
    this.toc = []
    this.selection = null
    this.spineCount = 0
    this.locationsReady = false
    this.latestLocator = null
    this.currentSectionIndex = 0
    this.reflowable = true
    this.persistentHighlightAnchors = []
    this.sectionPercentageBounds.clear()
    this.programmaticScroll = false
    this.preferencesRevision += 1
    this.host.replaceChildren()
  }
}

export {
  extractParagraphs,
  flattenToc,
  isEpubCfi,
  isSafeInternalHref,
  rangeForElementSlice,
  sanitizeContents
}
