import type { BookFormat, SelectionContext, TocItem } from '@shared/contracts'
import { copy } from '@shared/copy'
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
  TextLayer
} from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { buildBoundedPassages, codePointLength, type ContextBlock } from './context'
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

const PDF_ANCHOR_PATTERN = /^pdf:(\d+):(\d+):(\d+)$/u
const MIN_ZOOM = 0.5
const MAX_ZOOM = 2.5
const ZOOM_STEP = 0.15
const PAGE_GUTTER = 48
const MAX_CANVAS_DIMENSION = 8_192
const MAX_CANVAS_PIXELS = 36_000_000
const TEMPORARY_HIGHLIGHT_NAME = 'llm-reader-pdf-temporary'
const PERSISTENT_HIGHLIGHT_NAME = 'llm-reader-pdf-persistent'

interface PdfAnchor {
  pageNumber: number
  start: number
  end: number
}

interface PdfPageState {
  pageNumber: number
  page: PDFPageProxy
  baseWidth: number
  baseHeight: number
  element: HTMLElement
  canvas: HTMLCanvasElement
  textLayerElement: HTMLElement
  linkLayerElement: HTMLElement
  textLayer: TextLayer | null
  renderTask: RenderTask | null
  renderPromise: Promise<void> | null
  rendered: boolean
  text: string | null
}

interface PdfOutlineNode {
  title: string
  dest: string | unknown[] | null
  url: string | null
  unsafeUrl?: string
  items: PdfOutlineNode[]
}

function makePdfAnchor(pageNumber: number, start = 0, end = start): string {
  return `pdf:${pageNumber}:${start}:${end}`
}

function parsePdfAnchor(anchor: string, pageCount: number, pageLength?: number): PdfAnchor | null {
  const match = PDF_ANCHOR_PATTERN.exec(anchor)
  if (!match) return null
  const pageNumber = Number(match[1])
  const start = Number(match[2])
  const end = Number(match[3])
  if (
    !Number.isSafeInteger(pageNumber) ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    pageNumber < 1 ||
    pageNumber > pageCount ||
    start < 0 ||
    start > end ||
    (pageLength !== undefined && end > pageLength)
  ) {
    return null
  }
  return { pageNumber, start, end }
}

function codePointOffsetToUtf16(value: string, offset: number): number {
  return Array.from(value).slice(0, offset).join('').length
}

function safeMetadataString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, 500) : null
}

export class PdfReaderAdapter implements ReaderAdapter {
  readonly format: BookFormat = 'pdf'

  private readonly host: HTMLElement
  private readonly callbacks: ReaderCallbacks
  private readonly document: Document
  private readonly originalOverflowY: string
  private readonly originalPosition: string
  private root: HTMLElement | null = null
  private documentElement: HTMLElement | null = null
  private capabilityBanner: HTMLElement | null = null
  private highlightStyleElement: HTMLStyleElement | null = null
  private pdfjs: typeof import('pdfjs-dist') | null = null
  private loadingTask: PDFDocumentLoadingTask | null = null
  private pdfDocument: PDFDocumentProxy | null = null
  private pages: PdfPageState[] = []
  private textPromise: Promise<void> | null = null
  private observer: IntersectionObserver | null = null
  private resizeObserver: ResizeObserver | null = null
  private relocationFrame: number | null = null
  private selectionRevision = 0
  private searchRevision = 0
  private searchQueue: Promise<void> = Promise.resolve()
  private zoomFactor = 1
  private preferences: ReadingPreferences = { ...DEFAULT_READING_PREFERENCES }
  private programmaticReason: ReaderRelocationReason | null = null
  private selection: SelectionContext | null = null
  private persistentHighlightAnchors: ReaderHighlightAnchor[] = []
  private temporaryHighlightRegistry: HighlightRegistry | null = null
  private persistentHighlightRegistry: HighlightRegistry | null = null
  private temporaryFallbackElements: HTMLElement[] = []
  private persistentFallbackElements: HTMLElement[] = []

  constructor(host: HTMLElement, callbacks: ReaderCallbacks) {
    this.host = host
    this.callbacks = callbacks
    this.document = host.ownerDocument
    this.originalOverflowY = host.style.overflowY
    this.originalPosition = host.style.position
  }

  async open(bytes: Uint8Array, lastLocator?: string | null): Promise<ReaderDocumentInfo> {
    this.resetDocument()
    this.host.style.overflowY = 'auto'
    if (this.document.defaultView?.getComputedStyle(this.host).position === 'static') {
      this.host.style.position = 'relative'
    }

    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    this.pdfjs = pdfjs
    const loadingTask = pdfjs.getDocument({
      data: Uint8Array.from(bytes),
      enableXfa: false,
      isEvalSupported: false,
      stopAtErrors: true,
      useWorkerFetch: false,
      useWasm: false,
      ownerDocument: this.document,
      maxImageSize: MAX_CANVAS_PIXELS
    })
    loadingTask.onPassword = () => {
      void loadingTask.destroy()
    }
    this.loadingTask = loadingTask

    try {
      this.pdfDocument = await loadingTask.promise
    } catch (error) {
      console.error(
        '[PDF_OPEN_FAILED]',
        error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown PDF.js error'
      )
      await loadingTask.destroy().catch(() => undefined)
      this.loadingTask = null
      throw new Error(copy('reader.pdfOpenFailed'), { cause: error })
    }

    const root = this.document.createElement('div')
    root.className = 'pdf-reader'
    root.dataset.testid = 'pdf-reader'
    const highlightStyle = this.document.createElement('style')
    highlightStyle.textContent = this.highlightStylesCss()
    this.highlightStyleElement = highlightStyle
    const toolbar = this.createToolbar()
    const documentElement = this.document.createElement('div')
    documentElement.className = 'pdf-document'
    documentElement.setAttribute('role', 'document')
    root.append(highlightStyle, toolbar, documentElement)
    this.root = root
    this.documentElement = documentElement
    this.host.replaceChildren(root)

    for (let pageNumber = 1; pageNumber <= this.pdfDocument.numPages; pageNumber += 1) {
      const page = await this.pdfDocument.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const element = this.document.createElement('section')
      element.className = 'pdf-page'
      element.dataset.pageNumber = String(pageNumber)
      element.setAttribute('aria-label', copy('reader.pdfPage', { number: pageNumber }))
      const canvas = this.document.createElement('canvas')
      canvas.className = 'pdf-page-canvas'
      const textLayerElement = this.document.createElement('div')
      textLayerElement.className = 'pdf-text-layer'
      textLayerElement.dataset.pageNumber = String(pageNumber)
      const linkLayerElement = this.document.createElement('div')
      linkLayerElement.className = 'pdf-link-layer'
      element.append(canvas, textLayerElement, linkLayerElement)
      documentElement.append(element)
      this.pages.push({
        pageNumber,
        page,
        baseWidth: viewport.width,
        baseHeight: viewport.height,
        element,
        canvas,
        textLayerElement,
        linkLayerElement,
        textLayer: null,
        renderTask: null,
        renderPromise: null,
        rendered: false,
        text: null
      })
      this.updatePageSize(this.pages[this.pages.length - 1])
    }

    this.bindObservers()
    this.document.addEventListener('selectionchange', this.handleSelectionChange)
    this.host.addEventListener('scroll', this.handleScroll, { passive: true })
    this.textPromise = this.loadAllPageText()

    const [metadata, toc] = await Promise.all([this.readMetadata(), this.readOutline()])
    const restored = lastLocator ? parsePdfAnchor(lastLocator, this.pages.length) : null
    const initialPage = restored?.pageNumber ?? 1
    await this.renderPage(initialPage)
    if (restored) {
      await this.goToWithReason(lastLocator!, 'restore')
    } else {
      this.emitRelocationForPage(initialPage, 0, 'restore')
    }

    return { metadata, toc }
  }

  destroy(): void {
    this.resetDocument()
    this.host.style.overflowY = this.originalOverflowY
    this.host.style.position = this.originalPosition
  }

  search(query: string): Promise<ReadonlyArray<ReaderSearchResult>> {
    const normalized = normalizeReaderSearchQuery(query)
    if (!normalized) return Promise.reject(new Error(copy('reader.searchInvalid')))
    const revision = ++this.searchRevision
    const run = async (): Promise<ReadonlyArray<ReaderSearchResult>> => {
      await this.textPromise
      if (revision !== this.searchRevision) return []
      if (!this.pages.some((page) => (page.text?.length ?? 0) > 0)) {
        throw new Error(copy('reader.pdfSearchUnavailable'))
      }
      const results: ReaderSearchResult[] = []
      for (const page of this.pages) {
        if (revision !== this.searchRevision) return []
        const text = page.text ?? ''
        const expression = literalSearchExpression(normalized)
        let previousUtf16 = 0
        let previousCodePoints = 0
        let match = expression.exec(text)
        while (match) {
          const start = previousCodePoints + codePointLength(text.slice(previousUtf16, match.index))
          const end = start + codePointLength(match[0])
          results.push({
            anchor: makePdfAnchor(page.pageNumber, start, end),
            excerpt: searchExcerpt(text, match.index, match.index + match[0].length),
            chapterTitle: copy('reader.pdfPage', { number: page.pageNumber })
          })
          if (results.length >= READER_SEARCH_RESULT_LIMIT) return results
          previousUtf16 = match.index
          previousCodePoints = start
          match = expression.exec(text)
        }
        if (page.pageNumber % 20 === 0) await yieldSearchWork()
      }
      return revision === this.searchRevision ? results : []
    }
    const result = this.searchQueue.then(run, run)
    this.searchQueue = result.then(() => undefined, () => undefined)
    return result
  }

  async goTo(anchor: string): Promise<void> {
    await this.goToWithReason(anchor, 'navigation')
  }

  getSelection(): SelectionContext | null {
    return this.selection
  }

  async selectAnchor(anchor: string): Promise<boolean> {
    const range = await this.rangeForAnchor(anchor)
    if (!range) throw new Error(copy('reader.pdfInvalidAnchor'))
    const hostRect = this.host.getBoundingClientRect()
    const visible = Array.from(range.getClientRects()).some((rect) => (
      rect.bottom > hostRect.top && rect.top < hostRect.bottom
    ))
    if (!visible) return false
    const nativeSelection = this.document.defaultView?.getSelection()
    if (!nativeSelection) return false
    nativeSelection.removeAllRanges()
    nativeSelection.addRange(range)
    void this.updateSelection(nativeSelection)
    return true
  }

  async highlight(anchor: string): Promise<void> {
    const range = await this.rangeForAnchor(anchor)
    if (!range) throw new Error(copy('reader.pdfInvalidAnchor'))
    this.clearTemporaryHighlight()
    const registry = this.highlightRegistry()
    const HighlightConstructor = this.highlightConstructor()
    if (registry && HighlightConstructor) {
      this.temporaryHighlightRegistry = registry
      registry.set(TEMPORARY_HIGHLIGHT_NAME, new HighlightConstructor(range))
      return
    }
    this.temporaryFallbackElements = this.spansForRange(range)
    this.temporaryFallbackElements.forEach((element) => element.classList.add('pdf-temporary-highlight'))
  }

  clearHighlight(): void {
    this.clearTemporaryHighlight()
  }

  async setHighlights(highlights: ReadonlyArray<ReaderHighlightAnchor>): Promise<void> {
    this.persistentHighlightAnchors = highlights.map((highlight) => ({ anchor: highlight.anchor }))
    await this.applyPersistentHighlights()
  }

  async setPreferences(preferences: ReadingPreferences): Promise<void> {
    // Only the native selection affordance follows the paper setting. Page
    // geometry, fonts, spacing and canvas colors remain publication-owned.
    this.preferences = { ...preferences }
    if (this.highlightStyleElement) this.highlightStyleElement.textContent = this.highlightStylesCss()
  }

  private highlightStylesCss(): string {
    return `
      .pdf-text-layer ::selection { color: transparent; background: ${readerSelectionBackground(this.preferences.paperTheme)}; }
      ::highlight(${TEMPORARY_HIGHLIGHT_NAME}) { background: rgba(246, 190, 72, .36); }
      ::highlight(${PERSISTENT_HIGHLIGHT_NAME}) { background: rgba(126, 188, 148, .36); }
      .pdf-temporary-highlight { background: rgba(246, 190, 72, .25); outline: 2px solid rgba(196, 130, 18, .45); }
      .pdf-persistent-highlight { background: rgba(126, 188, 148, .30); outline: 1px solid rgba(61, 135, 91, .55); }
    `
  }

  private createToolbar(): HTMLElement {
    const toolbar = this.document.createElement('div')
    toolbar.className = 'pdf-toolbar'
    toolbar.dataset.testid = 'pdf-toolbar'
    const zoomOut = this.toolbarButton('−', copy('reader.pdfZoomOut'), () => this.changeZoom(-ZOOM_STEP))
    const fitWidth = this.toolbarButton(copy('reader.pdfFitWidth'), copy('reader.pdfFitWidth'), () => this.setZoom(1))
    fitWidth.classList.add('pdf-fit-width')
    const zoomValue = this.document.createElement('output')
    zoomValue.className = 'pdf-zoom-value'
    zoomValue.dataset.testid = 'pdf-zoom-value'
    zoomValue.value = '100%'
    const zoomIn = this.toolbarButton('+', copy('reader.pdfZoomIn'), () => this.changeZoom(ZOOM_STEP))
    toolbar.append(zoomOut, fitWidth, zoomValue, zoomIn)
    return toolbar
  }

  private toolbarButton(label: string, ariaLabel: string, activate: () => void): HTMLButtonElement {
    const button = this.document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.setAttribute('aria-label', ariaLabel)
    button.title = ariaLabel
    button.addEventListener('click', activate)
    return button
  }

  private changeZoom(delta: number): void {
    this.setZoom(this.zoomFactor + delta)
  }

  private setZoom(value: number, force = false): void {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100))
    if (next === this.zoomFactor && !force) return
    const current = this.currentPageAndFraction()
    this.zoomFactor = next
    const output = this.root?.querySelector<HTMLOutputElement>('.pdf-zoom-value')
    if (output) output.value = `${Math.round(next * 100)}%`
    for (const page of this.pages) {
      page.renderTask?.cancel()
      page.textLayer?.cancel()
      page.renderTask = null
      page.textLayer = null
      page.renderPromise = null
      page.rendered = false
      page.canvas.width = 0
      page.canvas.height = 0
      page.textLayerElement.replaceChildren()
      page.linkLayerElement.replaceChildren()
      page.element.querySelector('.pdf-page-no-text')?.remove()
      this.updatePageSize(page)
    }
    void this.renderPage(current.pageNumber).then(() => {
      this.scrollToPageFraction(current.pageNumber, current.fraction)
      void this.applyPersistentHighlights()
    })
  }

  private fitScale(page: PdfPageState): number {
    const availableWidth = Math.max(240, this.host.clientWidth - PAGE_GUTTER)
    return availableWidth / page.baseWidth
  }

  private pageScale(page: PdfPageState): number {
    return this.fitScale(page) * this.zoomFactor
  }

  private updatePageSize(page: PdfPageState): void {
    const scale = this.pageScale(page)
    page.element.style.width = `${page.baseWidth * scale}px`
    page.element.style.height = `${page.baseHeight * scale}px`
  }

  private bindObservers(): void {
    const view = this.document.defaultView
    if (view?.IntersectionObserver) {
      this.observer = new view.IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const pageNumber = Number((entry.target as HTMLElement).dataset.pageNumber)
          if (Number.isSafeInteger(pageNumber)) void this.renderPage(pageNumber)
        }
      }, { root: this.host, rootMargin: '120% 0px' })
      this.pages.forEach((page) => this.observer?.observe(page.element))
    }
    if (view?.ResizeObserver) {
      let previousWidth = this.host.clientWidth
      this.resizeObserver = new view.ResizeObserver(() => {
        if (Math.abs(this.host.clientWidth - previousWidth) < 2) return
        previousWidth = this.host.clientWidth
        this.setZoom(this.zoomFactor, true)
      })
      this.resizeObserver.observe(this.host)
    }
  }

  private async renderPage(pageNumber: number): Promise<void> {
    const state = this.pages[pageNumber - 1]
    if (!state || state.rendered) return
    if (state.renderPromise) return state.renderPromise
    const run = async (): Promise<void> => {
      const scale = this.pageScale(state)
      const viewport = state.page.getViewport({ scale })
      this.updatePageSize(state)
      const pixelRatio = Math.max(1, this.document.defaultView?.devicePixelRatio ?? 1)
      const ratioByDimension = Math.min(
        pixelRatio,
        MAX_CANVAS_DIMENSION / Math.max(viewport.width, viewport.height)
      )
      const ratioByArea = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, viewport.width * viewport.height))
      const outputScale = Math.max(0.25, Math.min(ratioByDimension, ratioByArea))
      state.canvas.width = Math.max(1, Math.floor(viewport.width * outputScale))
      state.canvas.height = Math.max(1, Math.floor(viewport.height * outputScale))
      state.canvas.style.width = `${viewport.width}px`
      state.canvas.style.height = `${viewport.height}px`
      const renderTask = state.page.render({
        canvas: state.canvas,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        annotationMode: this.pdfjs?.AnnotationMode.DISABLE,
        background: '#ffffff'
      })
      state.renderTask = renderTask
      await renderTask.promise
      state.renderTask = null

      const textContent = await state.page.getTextContent({ disableNormalization: false })
      if (!this.pdfjs) throw new Error(copy('reader.pdfOpenFailed'))
      const textLayer = new this.pdfjs.TextLayer({
        textContentSource: textContent,
        container: state.textLayerElement,
        viewport
      })
      state.textLayer = textLayer
      await textLayer.render()
      this.markTextOffsets(state, textLayer)
      await this.renderInternalLinks(state, viewport)
      state.rendered = true
      await this.applyPersistentHighlights()
    }
    const renderPromise = run().catch((error) => {
      if (state.renderPromise === renderPromise) state.renderPromise = null
      if (error instanceof Error && error.name === 'RenderingCancelledException') return
      throw error
    })
    state.renderPromise = renderPromise
    return renderPromise
  }

  private markTextOffsets(state: PdfPageState, textLayer: TextLayer): void {
    let cursor = 0
    textLayer.textDivs.forEach((element, index) => {
      const text = textLayer.textContentItemsStr[index] ?? element.textContent ?? ''
      const length = codePointLength(text)
      element.dataset.pdfTextStart = String(cursor)
      element.dataset.pdfTextEnd = String(cursor + length)
      cursor += length
    })
    if (cursor === 0) {
      const badge = this.document.createElement('span')
      badge.className = 'pdf-page-no-text'
      badge.textContent = copy('reader.pdfPageNoText')
      state.element.append(badge)
    }
  }

  private async loadAllPageText(): Promise<void> {
    for (const state of this.pages) {
      if (state.text === null) {
        const textContent = await state.page.getTextContent({ disableNormalization: false })
        state.text = textContent.items
          .map((item) => ('str' in item ? item.str : ''))
          .join('')
      }
      if (state.pageNumber % 20 === 0) await yieldSearchWork()
    }
    if (this.pages.every((page) => (page.text?.length ?? 0) === 0) && this.root) {
      const banner = this.document.createElement('div')
      banner.className = 'pdf-capability-banner'
      banner.dataset.testid = 'pdf-no-text-banner'
      banner.setAttribute('role', 'status')
      banner.textContent = copy('reader.pdfNoText')
      this.root.insertBefore(banner, this.documentElement)
      this.capabilityBanner = banner
    }
  }

  private async renderInternalLinks(state: PdfPageState, viewport: ReturnType<PDFPageProxy['getViewport']>): Promise<void> {
    const annotations = await state.page.getAnnotations({ intent: 'display' })
    for (const annotation of annotations) {
      if (
        annotation?.subtype !== 'Link' ||
        annotation.dest == null ||
        annotation.url != null ||
        annotation.unsafeUrl != null ||
        annotation.action != null ||
        !Array.isArray(annotation.rect)
      ) continue
      const destination = annotation.dest as string | unknown[]
      const targetPageNumber = await this.pageNumberForDestination(destination)
      if (!targetPageNumber || targetPageNumber < 1 || targetPageNumber > this.pages.length) continue
      const rectangle = viewport.convertToViewportRectangle(annotation.rect as [number, number, number, number])
      const left = Math.min(rectangle[0], rectangle[2])
      const top = Math.min(rectangle[1], rectangle[3])
      const width = Math.abs(rectangle[2] - rectangle[0])
      const height = Math.abs(rectangle[3] - rectangle[1])
      const button = this.document.createElement('button')
      button.type = 'button'
      button.className = 'pdf-internal-link'
      button.style.left = `${left}px`
      button.style.top = `${top}px`
      button.style.width = `${width}px`
      button.style.height = `${height}px`
      button.dataset.targetPage = String(targetPageNumber)
      button.setAttribute('aria-label', copy('reader.pdfInternalLink'))
      button.addEventListener('click', () => {
        void this.goTo(makePdfAnchor(targetPageNumber))
      })
      state.linkLayerElement.append(button)
    }
  }

  private async pageNumberForDestination(destination: string | unknown[]): Promise<number | null> {
    if (!this.pdfDocument) return null
    const resolved = typeof destination === 'string'
      ? await this.pdfDocument.getDestination(destination)
      : destination
    const target = resolved?.[0]
    if (typeof target === 'number' && Number.isSafeInteger(target)) return target + 1
    if (target && typeof target === 'object' && 'num' in target && 'gen' in target) {
      try {
        return (await this.pdfDocument.getPageIndex(target as { num: number; gen: number })) + 1
      } catch {
        return null
      }
    }
    return null
  }

  private async readMetadata(): Promise<ReaderDocumentInfo['metadata']> {
    if (!this.pdfDocument) return { title: '', author: null }
    try {
      const { info, metadata } = await this.pdfDocument.getMetadata()
      const record = info as Record<string, unknown>
      return {
        title: safeMetadataString(record.Title) ?? safeMetadataString(metadata?.get('dc:title')) ?? '',
        author: safeMetadataString(record.Author) ?? safeMetadataString(metadata?.get('dc:creator'))
      }
    } catch {
      return { title: '', author: null }
    }
  }

  private async readOutline(): Promise<TocItem[]> {
    if (!this.pdfDocument) return []
    try {
      const outline = await this.pdfDocument.getOutline() as PdfOutlineNode[]
      const toc: TocItem[] = []
      const visit = async (items: PdfOutlineNode[], depth: number): Promise<void> => {
        for (const item of items) {
          if (!item.url && !item.unsafeUrl && item.dest) {
            const pageNumber = await this.pageNumberForDestination(item.dest)
            if (pageNumber) {
              toc.push({
                id: `pdf-toc-${toc.length + 1}`,
                label: item.title.trim() || copy('reader.pdfPage', { number: pageNumber }),
                href: makePdfAnchor(pageNumber),
                depth
              })
            }
          }
          if (item.items.length > 0) await visit(item.items, depth + 1)
        }
      }
      await visit(outline, 0)
      return toc
    } catch {
      return []
    }
  }

  private async goToWithReason(anchor: string, reason: ReaderRelocationReason): Promise<void> {
    const parsed = parsePdfAnchor(anchor, this.pages.length)
    if (!parsed) throw new Error(copy('reader.pdfInvalidAnchor'))
    await this.renderPage(parsed.pageNumber)
    const page = this.pages[parsed.pageNumber - 1]
    const pageLength = codePointLength(page.text ?? '')
    const fraction = pageLength > 0 ? parsed.start / pageLength : 0
    this.programmaticReason = reason
    this.scrollToPageFraction(parsed.pageNumber, fraction)
    this.emitRelocationForPage(parsed.pageNumber, fraction, reason)
    this.document.defaultView?.setTimeout(() => {
      this.programmaticReason = null
    }, 80)
  }

  private scrollToPageFraction(pageNumber: number, fraction: number): void {
    const page = this.pages[pageNumber - 1]
    if (!page) return
    this.host.scrollTop = Math.max(0, page.element.offsetTop + page.element.offsetHeight * fraction - 52)
  }

  private currentPageAndFraction(): { pageNumber: number; fraction: number } {
    const hostRect = this.host.getBoundingClientRect()
    const readingLine = hostRect.top + Math.min(120, hostRect.height * 0.25)
    let best = this.pages[0]
    let distance = Number.POSITIVE_INFINITY
    for (const page of this.pages) {
      const rect = page.element.getBoundingClientRect()
      if (rect.top <= readingLine && rect.bottom >= readingLine) {
        const fraction = Math.min(1, Math.max(0, (readingLine - rect.top) / Math.max(1, rect.height)))
        return { pageNumber: page.pageNumber, fraction }
      }
      const candidateDistance = Math.min(Math.abs(rect.top - readingLine), Math.abs(rect.bottom - readingLine))
      if (candidateDistance < distance) {
        best = page
        distance = candidateDistance
      }
    }
    if (!best) return { pageNumber: 1, fraction: 0 }
    const rect = best.element.getBoundingClientRect()
    return {
      pageNumber: best.pageNumber,
      fraction: Math.min(1, Math.max(0, (readingLine - rect.top) / Math.max(1, rect.height)))
    }
  }

  private readonly handleScroll = (): void => {
    if (this.relocationFrame !== null || !this.document.defaultView) return
    this.relocationFrame = this.document.defaultView.requestAnimationFrame(() => {
      this.relocationFrame = null
      const current = this.currentPageAndFraction()
      this.emitRelocationForPage(
        current.pageNumber,
        current.fraction,
        this.programmaticReason ?? 'natural'
      )
    })
  }

  private emitRelocationForPage(pageNumber: number, fraction: number, reason: ReaderRelocationReason): void {
    const state = this.pages[pageNumber - 1]
    const textLength = codePointLength(state?.text ?? '')
    const offset = Math.round(textLength * Math.min(1, Math.max(0, fraction)))
    this.emitRelocation({
      locator: makePdfAnchor(pageNumber, offset),
      progress: (pageNumber - 1 + fraction) / Math.max(1, this.pages.length),
      chapterProgress: fraction,
      chapterTitle: copy('reader.pdfPage', { number: pageNumber }),
      chapterHref: makePdfAnchor(pageNumber),
      reason
    })
  }

  private emitRelocation(relocation: ReaderRelocation): void {
    this.callbacks.onRelocated?.({
      ...relocation,
      progress: Math.min(1, Math.max(0, relocation.progress)),
      chapterProgress: Math.min(1, Math.max(0, relocation.chapterProgress))
    })
  }

  private readonly handleSelectionChange = (): void => {
    const nativeSelection = this.document.defaultView?.getSelection()
    if (!nativeSelection || nativeSelection.rangeCount === 0 || nativeSelection.isCollapsed) {
      this.setSelection(null)
      return
    }
    void this.updateSelection(nativeSelection)
  }

  private async updateSelection(nativeSelection: Selection): Promise<void> {
    const revision = ++this.selectionRevision
    const range = nativeSelection.getRangeAt(0)
    const startPageElement = this.pageElementForNode(range.startContainer)
    const endPageElement = this.pageElementForNode(range.endContainer)
    if (!startPageElement || startPageElement !== endPageElement) {
      nativeSelection.removeAllRanges()
      this.setSelection(null)
      return
    }
    const pageNumber = Number(startPageElement.dataset.pageNumber)
    const state = this.pages[pageNumber - 1]
    if (!state) {
      this.setSelection(null)
      return
    }
    await this.textPromise
    if (revision !== this.selectionRevision) return
    const start = this.offsetForDomPoint(state, range.startContainer, range.startOffset)
    const end = this.offsetForDomPoint(state, range.endContainer, range.endOffset)
    if (start === null || end === null || end <= start) {
      this.setSelection(null)
      return
    }
    const text = state.text ?? ''
    const quote = Array.from(text).slice(start, end).join('').trim()
    if (!quote) {
      this.setSelection(null)
      return
    }
    const firstPageIndex = Math.max(0, pageNumber - 2)
    const lastPageIndex = Math.min(this.pages.length - 1, pageNumber)
    const blocks: ContextBlock[] = this.pages.slice(firstPageIndex, lastPageIndex + 1).map((page) => ({
      id: `page-${page.pageNumber}`,
      text: page.text ?? '',
      anchorForSlice: (blockStart, blockEnd) => makePdfAnchor(page.pageNumber, blockStart, blockEnd)
    }))
    const focusBlock = pageNumber - 1 - firstPageIndex
    this.setSelection({
      bookId: this.callbacks.bookId,
      quote,
      anchor: makePdfAnchor(pageNumber, start, end),
      chapterTitle: copy('reader.pdfPage', { number: pageNumber }),
      passages: buildBoundedPassages(blocks, {
        startBlock: focusBlock,
        startOffset: start,
        endBlock: focusBlock,
        endOffset: end
      })
    })
  }

  private pageElementForNode(node: Node): HTMLElement | null {
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
    return element?.closest<HTMLElement>('.pdf-text-layer[data-page-number]') ?? null
  }

  private offsetForDomPoint(state: PdfPageState, node: Node, offset: number): number | null {
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
    const span = element?.closest<HTMLElement>('[data-pdf-text-start]')
    if (!span || !state.textLayerElement.contains(span)) return null
    const base = Number(span.dataset.pdfTextStart)
    if (!Number.isSafeInteger(base)) return null
    const range = this.document.createRange()
    range.selectNodeContents(span)
    try {
      range.setEnd(node, offset)
    } catch {
      return null
    }
    return base + codePointLength(range.toString())
  }

  private async rangeForAnchor(anchor: string): Promise<Range | null> {
    const basic = parsePdfAnchor(anchor, this.pages.length)
    if (!basic) return null
    await this.textPromise
    const state = this.pages[basic.pageNumber - 1]
    const parsed = parsePdfAnchor(anchor, this.pages.length, codePointLength(state.text ?? ''))
    if (!parsed || parsed.end <= parsed.start) return null
    await this.renderPage(parsed.pageNumber)
    const start = this.domPointForOffset(state, parsed.start)
    const end = this.domPointForOffset(state, parsed.end)
    if (!start || !end) return null
    const range = this.document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    return range
  }

  private domPointForOffset(state: PdfPageState, offset: number): { node: Node; offset: number } | null {
    const spans = Array.from(state.textLayerElement.querySelectorAll<HTMLElement>('[data-pdf-text-start]'))
    for (const span of spans) {
      const start = Number(span.dataset.pdfTextStart)
      const end = Number(span.dataset.pdfTextEnd)
      if (offset < start || offset > end) continue
      const node = span.firstChild
      if (!node) continue
      return { node, offset: codePointOffsetToUtf16(node.textContent ?? '', offset - start) }
    }
    return null
  }

  private spansForRange(range: Range): HTMLElement[] {
    return Array.from(this.document.querySelectorAll<HTMLElement>('.pdf-text-layer [data-pdf-text-start]'))
      .filter((span) => range.intersectsNode(span))
  }

  private async applyPersistentHighlights(): Promise<void> {
    this.clearPersistentHighlights()
    const ranges: Range[] = []
    for (const { anchor } of this.persistentHighlightAnchors) {
      const parsed = parsePdfAnchor(anchor, this.pages.length)
      if (!parsed || !this.pages[parsed.pageNumber - 1]?.rendered) continue
      const range = await this.rangeForAnchor(anchor)
      if (range) ranges.push(range)
    }
    if (ranges.length === 0) return
    const registry = this.highlightRegistry()
    const HighlightConstructor = this.highlightConstructor()
    if (registry && HighlightConstructor) {
      this.persistentHighlightRegistry = registry
      registry.set(PERSISTENT_HIGHLIGHT_NAME, new HighlightConstructor(...ranges))
      return
    }
    this.persistentFallbackElements = Array.from(new Set(ranges.flatMap((range) => this.spansForRange(range))))
    this.persistentFallbackElements.forEach((element) => element.classList.add('pdf-persistent-highlight'))
  }

  private highlightRegistry(): HighlightRegistry | null {
    const view = this.document.defaultView as (Window & { CSS?: { highlights?: HighlightRegistry } }) | null
    return view?.CSS?.highlights ?? null
  }

  private highlightConstructor(): (new (...ranges: Range[]) => unknown) | null {
    const view = this.document.defaultView as (Window & { Highlight?: new (...ranges: Range[]) => unknown }) | null
    return view?.Highlight ?? null
  }

  private clearTemporaryHighlight(): void {
    this.temporaryHighlightRegistry?.delete(TEMPORARY_HIGHLIGHT_NAME)
    this.temporaryHighlightRegistry = null
    this.temporaryFallbackElements.forEach((element) => element.classList.remove('pdf-temporary-highlight'))
    this.temporaryFallbackElements = []
  }

  private clearPersistentHighlights(): void {
    this.persistentHighlightRegistry?.delete(PERSISTENT_HIGHLIGHT_NAME)
    this.persistentHighlightRegistry = null
    this.persistentFallbackElements.forEach((element) => element.classList.remove('pdf-persistent-highlight'))
    this.persistentFallbackElements = []
  }

  private setSelection(selection: SelectionContext | null): void {
    this.selection = selection
    this.callbacks.onSelectionChanged?.(selection)
  }

  private resetDocument(): void {
    this.searchRevision += 1
    this.selectionRevision += 1
    this.document.removeEventListener('selectionchange', this.handleSelectionChange)
    this.host.removeEventListener('scroll', this.handleScroll)
    this.observer?.disconnect()
    this.resizeObserver?.disconnect()
    this.observer = null
    this.resizeObserver = null
    if (this.relocationFrame !== null && this.document.defaultView) {
      this.document.defaultView.cancelAnimationFrame(this.relocationFrame)
    }
    this.relocationFrame = null
    this.clearTemporaryHighlight()
    this.clearPersistentHighlights()
    for (const page of this.pages) {
      page.renderTask?.cancel()
      page.textLayer?.cancel()
    }
    void this.loadingTask?.destroy().catch(() => undefined)
    this.loadingTask = null
    this.pdfDocument = null
    this.pdfjs = null
    this.pages = []
    this.textPromise = null
    this.root = null
    this.documentElement = null
    this.capabilityBanner = null
    this.highlightStyleElement = null
    this.selection = null
    this.programmaticReason = null
    this.host.replaceChildren()
  }
}

interface HighlightRegistry {
  delete(name: string): void
  set(name: string, value: unknown): void
}
