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
import {
  createPdfTextModel,
  extractPdfRegionText,
  makePdfRegionAnchor,
  makePdfTextAnchor,
  parsePdfRegionAnchor,
  parsePdfTextAnchor,
  type PdfRegionAnchor,
  type PdfRegionTextItem,
  type PdfTextModel
} from './pdf-text'
import {
  makePdfPositionAnchor,
  parsePdfPositionAnchor,
  pdfDestinationFraction,
  pdfFitAvailableWidth,
  pdfSectionAt,
  PdfZoomCoordinator,
  sortPdfOutlineLocations,
  type PdfOutlineLocation,
  type PdfPositionAnchor,
  type PdfZoomOperation
} from './pdf-navigation'
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
import { READER_SEARCH_RESULT_LIMIT } from './types'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 2.5
const ZOOM_STEP = 0.15
const MAX_CANVAS_DIMENSION = 8_192
const MAX_CANVAS_PIXELS = 36_000_000
const TEMPORARY_HIGHLIGHT_NAME = 'llm-reader-pdf-temporary'
const PERSISTENT_HIGHLIGHT_NAME = 'llm-reader-pdf-persistent'
const MAX_REGION_QUOTE_LENGTH = 20_000
const MIN_REGION_DRAG_PIXELS = 6

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
  textModel: PdfTextModel | null
}

interface PdfRegionDrag {
  pointerId: number
  page: PdfPageState
  startX: number
  startY: number
  overlay: HTMLElement
}

interface PdfOutlineNode {
  title: string
  dest: string | unknown[] | null
  url: string | null
  unsafeUrl?: string
  items: PdfOutlineNode[]
}

type PdfZoomMode = 'fit-width' | 'custom'

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
  private readonly originalOverflowX: string
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
  private zoomMode: PdfZoomMode = 'fit-width'
  private readonly zoomCoordinator = new PdfZoomCoordinator()
  private resizeFrame: number | null = null
  private fitWidthButton: HTMLButtonElement | null = null
  private outlineLocations: PdfOutlineLocation[] = []
  private programmaticReason: ReaderRelocationReason | null = null
  private programmaticScrollTop: number | null = null
  private programmaticScrollRevision = 0
  private selection: SelectionContext | null = null
  private persistentHighlightAnchors: ReaderHighlightAnchor[] = []
  private temporaryHighlightRegistry: HighlightRegistry | null = null
  private persistentHighlightRegistry: HighlightRegistry | null = null
  private temporaryFallbackElements: HTMLElement[] = []
  private persistentFallbackElements: HTMLElement[] = []
  private regionMode = false
  private regionButton: HTMLButtonElement | null = null
  private regionDrag: PdfRegionDrag | null = null
  private regionDraftRevision = 0
  private draftRegionElement: HTMLElement | null = null
  private activeRegionElement: HTMLElement | null = null
  private temporaryRegionElements: HTMLElement[] = []
  private persistentRegionElements: HTMLElement[] = []

  constructor(host: HTMLElement, callbacks: ReaderCallbacks) {
    this.host = host
    this.callbacks = callbacks
    this.document = host.ownerDocument
    this.originalOverflowX = host.style.overflowX
    this.originalOverflowY = host.style.overflowY
    this.originalPosition = host.style.position
  }

  async open(bytes: Uint8Array, lastLocator?: string | null): Promise<ReaderDocumentInfo> {
    this.resetDocument()
    this.host.style.overflowX = 'auto'
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
      canvas.style.visibility = 'hidden'
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
        textModel: null
      })
      this.updatePageSize(this.pages[this.pages.length - 1])
    }

    this.bindObservers()
    this.document.addEventListener('selectionchange', this.handleSelectionChange)
    documentElement.addEventListener('pointerdown', this.handleRegionPointerDown)
    this.document.addEventListener('pointermove', this.handleRegionPointerMove)
    this.document.addEventListener('pointerup', this.handleRegionPointerUp)
    this.document.addEventListener('pointercancel', this.handleRegionPointerCancel)
    this.host.addEventListener('scroll', this.handleScroll, { passive: true })
    this.textPromise = this.loadAllPageText()

    const [metadata, toc] = await Promise.all([this.readMetadata(), this.readOutline()])
    const restored = lastLocator
      ? parsePdfTextAnchor(lastLocator, this.pages.length) ??
        parsePdfRegionAnchor(lastLocator, this.pages.length) ??
        parsePdfPositionAnchor(lastLocator, this.pages.length)
      : null
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
    this.host.style.overflowX = this.originalOverflowX
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
      if (!this.pages.some((page) => (page.textModel?.rawLength ?? 0) > 0)) {
        throw new Error(copy('reader.pdfSearchUnavailable'))
      }
      const results: ReaderSearchResult[] = []
      for (const page of this.pages) {
        if (revision !== this.searchRevision) return []
        const model = page.textModel
        const text = model?.readableText ?? ''
        const rawLength = model?.rawLength ?? 0
        const expression = literalSearchExpression(normalized)
        let previousUtf16 = 0
        let previousCodePoints = 0
        let match = expression.exec(text)
        while (match) {
          const readableStart = previousCodePoints + codePointLength(text.slice(previousUtf16, match.index))
          const readableEnd = readableStart + codePointLength(match[0])
          const start = model?.rawOffsetForReadable(readableStart, 'start') ?? readableStart
          const end = model?.rawOffsetForReadable(readableEnd, 'end') ?? readableEnd
          results.push({
            anchor: makePdfTextAnchor(page.pageNumber, start, end),
            excerpt: searchExcerpt(text, match.index, match.index + match[0].length),
            chapterTitle: this.sectionAt(
              page.pageNumber,
              rawLength > 0 ? start / rawLength : 0
            ).title
          })
          if (results.length >= READER_SEARCH_RESULT_LIMIT) return results
          previousUtf16 = match.index
          previousCodePoints = readableStart
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

  clearSelection(): void {
    this.selectionRevision += 1
    if (this.regionMode) this.setRegionMode(false)
    this.document.defaultView?.getSelection()?.removeAllRanges()
    this.activeRegionElement?.remove()
    this.activeRegionElement = null
    this.setSelection(null)
  }

  async selectAnchor(anchor: string): Promise<boolean> {
    const region = parsePdfRegionAnchor(anchor, this.pages.length)
    if (region) {
      await this.renderPage(region.pageNumber)
      const pageRect = this.pages[region.pageNumber - 1]?.element.getBoundingClientRect()
      const hostRect = this.host.getBoundingClientRect()
      return Boolean(pageRect && pageRect.bottom > hostRect.top && pageRect.top < hostRect.bottom)
    }
    const range = await this.rangeForAnchor(anchor)
    if (!range) throw new Error(copy('reader.pdfInvalidAnchor'))
    const hostRect = this.host.getBoundingClientRect()
    const visible = Array.from(range.getClientRects()).some((rect) => (
      rect.bottom > hostRect.top && rect.top < hostRect.bottom
    ))
    if (!visible) return false
    return true
  }

  async highlight(anchor: string): Promise<void> {
    const region = parsePdfRegionAnchor(anchor, this.pages.length)
    if (region) {
      await this.renderPage(region.pageNumber)
      this.clearTemporaryHighlight()
      const overlay = this.createRegionOverlay(region, 'is-temporary')
      if (!overlay) throw new Error(copy('reader.pdfInvalidAnchor'))
      this.temporaryRegionElements = [overlay]
      return
    }
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

  setPreferences(preferences: ReadingPreferences): Promise<void> {
    // PDF page geometry, fonts, spacing and canvas colors remain publication-owned.
    void preferences
    return Promise.resolve()
  }

  private highlightStylesCss(): string {
    return `
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
    const fitWidth = this.toolbarButton(
      copy('reader.pdfFitWidth'),
      copy('reader.pdfFitWidth'),
      () => this.setZoom(1, 'fit-width', true)
    )
    fitWidth.classList.add('pdf-fit-width', 'is-active')
    fitWidth.setAttribute('aria-pressed', 'true')
    this.fitWidthButton = fitWidth
    const zoomValue = this.document.createElement('output')
    zoomValue.className = 'pdf-zoom-value'
    zoomValue.dataset.testid = 'pdf-zoom-value'
    zoomValue.value = ''
    zoomValue.toggleAttribute('hidden', true)
    const zoomIn = this.toolbarButton('+', copy('reader.pdfZoomIn'), () => this.changeZoom(ZOOM_STEP))
    const regionButton = this.toolbarButton(
      copy('reader.pdfRegionSelect'),
      copy('reader.pdfRegionSelect'),
      () => this.setRegionMode(!this.regionMode)
    )
    regionButton.dataset.testid = 'pdf-region-select'
    regionButton.setAttribute('aria-pressed', 'false')
    regionButton.classList.add('pdf-region-select')
    this.regionButton = regionButton
    toolbar.append(zoomOut, fitWidth, zoomValue, zoomIn, regionButton)
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

  private setRegionMode(enabled: boolean): void {
    if (this.regionMode === enabled) return
    if (enabled) this.clearSelection()
    this.regionMode = enabled
    this.regionButton?.setAttribute('aria-pressed', String(enabled))
    this.regionButton?.classList.toggle('is-active', enabled)
    this.root?.classList.toggle('is-region-selecting', enabled)
    if (enabled) {
      this.callbacks.onNotice?.({ message: copy('reader.pdfRegionHint'), tone: 'info' })
      return
    }
    this.cancelRegionDrag()
  }

  private notice(message: string, tone: 'info' | 'error' = 'error'): void {
    this.callbacks.onNotice?.({ message, tone })
  }

  private readonly handleRegionPointerDown = (event: PointerEvent): void => {
    if (!this.regionMode || event.button !== 0 || this.regionDrag) return
    const target = event.target instanceof Element ? event.target : null
    const pageElement = target?.closest<HTMLElement>('.pdf-page[data-page-number]')
    const pageNumber = Number(pageElement?.dataset.pageNumber)
    const page = this.pages[pageNumber - 1]
    if (!pageElement || !page || !page.rendered) return

    this.clearRegionDraft(false)
    const point = this.regionPoint(event, page)
    if (!point) return
    const overlay = this.document.createElement('div')
    overlay.className = 'pdf-region-overlay is-draft'
    overlay.dataset.testid = 'pdf-region-draft'
    page.element.append(overlay)
    this.regionDrag = {
      pointerId: event.pointerId,
      page,
      startX: point.x,
      startY: point.y,
      overlay
    }
    this.positionRegionOverlay(overlay, {
      pageNumber,
      left: point.x,
      top: point.y,
      right: point.x,
      bottom: point.y
    })
    page.element.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }

  private readonly handleRegionPointerMove = (event: PointerEvent): void => {
    const drag = this.regionDrag
    if (!drag || drag.pointerId !== event.pointerId) return
    const point = this.regionPoint(event, drag.page)
    if (!point) return
    this.positionRegionOverlay(drag.overlay, this.regionFromPoints(drag.page.pageNumber, drag.startX, drag.startY, point.x, point.y))
    event.preventDefault()
  }

  private readonly handleRegionPointerUp = (event: PointerEvent): void => {
    const drag = this.regionDrag
    if (!drag || drag.pointerId !== event.pointerId) return
    const point = this.regionPoint(event, drag.page)
    this.regionDrag = null
    drag.page.element.releasePointerCapture?.(event.pointerId)
    if (!point) {
      drag.overlay.remove()
      return
    }
    const pageRect = drag.page.element.getBoundingClientRect()
    const width = Math.abs(point.x - drag.startX) * pageRect.width
    const height = Math.abs(point.y - drag.startY) * pageRect.height
    if (width < MIN_REGION_DRAG_PIXELS || height < MIN_REGION_DRAG_PIXELS) {
      drag.overlay.remove()
      this.notice(copy('reader.pdfRegionTooSmall'))
      return
    }
    const region = this.regionFromPoints(drag.page.pageNumber, drag.startX, drag.startY, point.x, point.y)
    this.positionRegionOverlay(drag.overlay, region)
    void this.completeRegionDraft(drag.page, region, drag.overlay)
    event.preventDefault()
  }

  private readonly handleRegionPointerCancel = (event: PointerEvent): void => {
    if (!this.regionDrag || this.regionDrag.pointerId !== event.pointerId) return
    this.cancelRegionDrag()
  }

  private regionPoint(event: PointerEvent, page: PdfPageState): { x: number; y: number } | null {
    const rect = page.element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    }
  }

  private regionFromPoints(
    pageNumber: number,
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ): PdfRegionAnchor {
    return {
      pageNumber,
      left: Math.min(startX, endX),
      top: Math.min(startY, endY),
      right: Math.max(startX, endX),
      bottom: Math.max(startY, endY)
    }
  }

  private positionRegionOverlay(element: HTMLElement, region: PdfRegionAnchor): void {
    element.style.left = `${region.left * 100}%`
    element.style.top = `${region.top * 100}%`
    element.style.width = `${(region.right - region.left) * 100}%`
    element.style.height = `${(region.bottom - region.top) * 100}%`
  }

  private cancelRegionDrag(): void {
    const drag = this.regionDrag
    this.regionDrag = null
    if (!drag) return
    drag.page.element.releasePointerCapture?.(drag.pointerId)
    drag.overlay.remove()
  }

  private clearRegionDraft(notify = true): void {
    this.regionDraftRevision += 1
    this.draftRegionElement?.remove()
    this.draftRegionElement = null
    if (notify) this.callbacks.onSelectionDraftChanged?.(null)
  }

  private regionItems(page: PdfPageState): PdfRegionTextItem[] {
    const pageRect = page.element.getBoundingClientRect()
    if (pageRect.width <= 0 || pageRect.height <= 0) return []
    return Array.from(page.textLayerElement.querySelectorAll<HTMLElement>('[data-pdf-text-start]')).flatMap((span) => {
      const rawStart = Number(span.dataset.pdfTextStart)
      const rawEnd = Number(span.dataset.pdfTextEnd)
      const rect = span.getBoundingClientRect()
      const text = span.textContent ?? ''
      if (!Number.isSafeInteger(rawStart) || !Number.isSafeInteger(rawEnd) || rawEnd < rawStart || !text.trim()) return []
      return [{
        text,
        rawStart,
        rawEnd,
        left: (rect.left - pageRect.left) / pageRect.width,
        top: (rect.top - pageRect.top) / pageRect.height,
        right: (rect.right - pageRect.left) / pageRect.width,
        bottom: (rect.bottom - pageRect.top) / pageRect.height
      }]
    })
  }

  private async completeRegionDraft(
    page: PdfPageState,
    region: PdfRegionAnchor,
    overlay: HTMLElement
  ): Promise<void> {
    await this.textPromise
    if (!overlay.isConnected || !this.regionMode) return
    const result = extractPdfRegionText(this.regionItems(page), region)
    if (!result) {
      overlay.remove()
      this.notice(copy('reader.pdfRegionEmpty'))
      return
    }
    if (codePointLength(result.text) > MAX_REGION_QUOTE_LENGTH) {
      overlay.remove()
      this.notice(copy('reader.pdfRegionTooLarge'))
      return
    }

    const context = this.selectionContextForRawRange(
      page.pageNumber,
      result.rawStart,
      result.rawEnd,
      result.text,
      makePdfRegionAnchor(region)
    )
    if (!context) {
      overlay.remove()
      this.notice(copy('reader.pdfRegionEmpty'))
      return
    }

    this.clearRegionDraft(false)
    const revision = ++this.regionDraftRevision
    this.draftRegionElement = overlay
    const cancel = (): void => {
      if (revision !== this.regionDraftRevision) return
      this.clearRegionDraft()
      this.setRegionMode(false)
    }
    const confirm = (quote: string): void => {
      if (revision !== this.regionDraftRevision) return
      const cleanQuote = quote.trim()
      if (!cleanQuote || codePointLength(cleanQuote) > MAX_REGION_QUOTE_LENGTH) return
      this.activeRegionElement?.remove()
      overlay.classList.remove('is-draft')
      overlay.classList.add('is-selection')
      overlay.dataset.testid = 'pdf-region-selection'
      this.activeRegionElement = overlay
      this.draftRegionElement = null
      this.regionDraftRevision += 1
      this.callbacks.onSelectionDraftChanged?.(null)
      this.setRegionMode(false)
      this.setSelection({ ...context, quote: cleanQuote })
    }
    if (this.callbacks.onSelectionDraftChanged) {
      this.callbacks.onSelectionDraftChanged({ quote: result.text, confirm, cancel })
    } else {
      confirm(result.text)
    }
  }

  private changeZoom(delta: number): void {
    this.setZoom(this.zoomFactor + delta, 'custom')
  }

  private setZoom(value: number, mode: PdfZoomMode, force = false): void {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100))
    if (next === this.zoomFactor && mode === this.zoomMode && !force) return
    const operation = this.zoomCoordinator.begin(this.currentPageAndFraction())
    const pendingRenders = this.pages.flatMap((page) => page.renderPromise ? [page.renderPromise] : [])
    this.zoomFactor = next
    this.zoomMode = mode
    this.updateZoomUi()
    this.clearNativeTextSelectionForRerender()
    for (const page of this.pages) {
      page.renderTask?.cancel()
      page.textLayer?.cancel()
      page.renderTask = null
      page.textLayer = null
      page.renderPromise = null
      page.rendered = false
      page.textLayerElement.replaceChildren()
      page.linkLayerElement.replaceChildren()
      page.element.querySelector('.pdf-page-no-text')?.remove()
      this.updatePageSize(page)
    }
    void this.finishZoom(operation, pendingRenders)
  }

  private async finishZoom(
    operation: PdfZoomOperation,
    pendingRenders: Promise<void>[]
  ): Promise<void> {
    await Promise.allSettled(pendingRenders)
    if (!this.zoomCoordinator.isCurrent(operation.revision)) return

    const nearbyPages = [
      operation.anchor.pageNumber - 1,
      operation.anchor.pageNumber,
      operation.anchor.pageNumber + 1
    ].filter((pageNumber) => pageNumber >= 1 && pageNumber <= this.pages.length)
    const rendering = nearbyPages.map((pageNumber) => this.renderPage(pageNumber))
    await rendering[nearbyPages.indexOf(operation.anchor.pageNumber)]
    await Promise.allSettled(rendering)

    const anchor = this.zoomCoordinator.complete(operation.revision)
    if (!anchor) return
    this.relocateProgrammatically(anchor.pageNumber, anchor.fraction, 'navigation')
    if (this.zoomMode === 'fit-width') this.host.scrollLeft = 0
    await this.applyPersistentHighlights()
  }

  private updateZoomUi(): void {
    const output = this.root?.querySelector<HTMLOutputElement>('.pdf-zoom-value')
    const isFitWidth = this.zoomMode === 'fit-width'
    if (output) {
      output.value = isFitWidth ? '' : `${Math.round(this.zoomFactor * 100)}%`
      // 适宽时激活的开关即状态指示,隐藏读数,避免“适合宽度/适宽”同义并排。
      output.toggleAttribute('hidden', isFitWidth)
    }
    this.fitWidthButton?.setAttribute('aria-pressed', String(isFitWidth))
    this.fitWidthButton?.classList.toggle('is-active', isFitWidth)
  }

  private fitScale(page: PdfPageState): number {
    const style = this.documentElement && this.document.defaultView
      ? this.document.defaultView.getComputedStyle(this.documentElement)
      : null
    const availableWidth = pdfFitAvailableWidth(
      this.host.clientWidth,
      Number.parseFloat(style?.paddingLeft ?? '0'),
      Number.parseFloat(style?.paddingRight ?? '0')
    )
    return availableWidth / page.baseWidth
  }

  private pageScale(page: PdfPageState): number {
    return this.fitScale(page) * this.zoomFactor
  }

  private updatePageSize(page: PdfPageState): void {
    const scale = this.pageScale(page)
    const width = page.baseWidth * scale
    const height = page.baseHeight * scale
    page.element.style.width = `${width}px`
    page.element.style.height = `${height}px`
    page.canvas.style.width = `${width}px`
    page.canvas.style.height = `${height}px`
  }

  private clearNativeTextSelectionForRerender(): void {
    const nativeSelection = this.document.defaultView?.getSelection()
    const range = nativeSelection?.rangeCount ? nativeSelection.getRangeAt(0) : null
    const rangeUsesTextLayer = Boolean(
      range && (
        this.pageElementForNode(range.startContainer) ||
        this.pageElementForNode(range.endContainer)
      )
    )
    const selectionUsesTextAnchor = Boolean(
      this.selection && parsePdfTextAnchor(this.selection.anchor, this.pages.length)
    )
    if (!rangeUsesTextLayer && !selectionUsesTextAnchor) return
    this.selectionRevision += 1
    nativeSelection?.removeAllRanges()
    if (selectionUsesTextAnchor) this.setSelection(null)
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
        if (this.resizeFrame !== null) view.cancelAnimationFrame(this.resizeFrame)
        this.resizeFrame = view.requestAnimationFrame(() => {
          this.resizeFrame = null
          this.setZoom(this.zoomFactor, this.zoomMode, true)
        })
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
      const renderCanvas = this.document.createElement('canvas')
      renderCanvas.width = Math.max(1, Math.floor(viewport.width * outputScale))
      renderCanvas.height = Math.max(1, Math.floor(viewport.height * outputScale))
      const renderTask = state.page.render({
        canvas: renderCanvas,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        annotationMode: this.pdfjs?.AnnotationMode.DISABLE,
        background: '#ffffff'
      })
      state.renderTask = renderTask
      await renderTask.promise
      state.renderTask = null
      state.canvas.width = renderCanvas.width
      state.canvas.height = renderCanvas.height
      state.canvas.style.width = `${viewport.width}px`
      state.canvas.style.height = `${viewport.height}px`
      const visibleContext = state.canvas.getContext('2d')
      if (!visibleContext) throw new Error(copy('reader.pdfOpenFailed'))
      visibleContext.drawImage(renderCanvas, 0, 0)
      state.canvas.style.visibility = 'visible'

      const textContent = await state.page.getTextContent({ disableNormalization: false })
      state.textModel ??= createPdfTextModel(textContent.items.flatMap((item) => (
        'str' in item ? [{ str: item.str, hasEOL: item.hasEOL }] : []
      )))
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
      if (state.textModel === null) {
        const textContent = await state.page.getTextContent({ disableNormalization: false })
        state.textModel = createPdfTextModel(textContent.items.flatMap((item) => (
          'str' in item ? [{ str: item.str, hasEOL: item.hasEOL }] : []
        )))
      }
      if (state.pageNumber % 20 === 0) await yieldSearchWork()
    }
    const hasNoText = this.pages.every((page) => (page.textModel?.rawLength ?? 0) === 0)
    if (this.regionButton) this.regionButton.disabled = hasNoText
    if (hasNoText && this.root) {
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
      const target = await this.positionForDestination(destination)
      if (!target) continue
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
      button.dataset.targetPage = String(target.pageNumber)
      button.setAttribute('aria-label', copy('reader.pdfInternalLink'))
      button.addEventListener('click', () => {
        void this.goTo(makePdfPositionAnchor(target.pageNumber, target.fraction))
      })
      state.linkLayerElement.append(button)
    }
  }

  private async positionForDestination(destination: string | unknown[]): Promise<PdfPositionAnchor | null> {
    if (!this.pdfDocument) return null
    try {
      const resolved = typeof destination === 'string'
        ? await this.pdfDocument.getDestination(destination)
        : destination
      if (!resolved) return null
      const target = resolved[0]
      let pageNumber: number | null = null
      if (typeof target === 'number' && Number.isSafeInteger(target)) pageNumber = target + 1
      if (target && typeof target === 'object' && 'num' in target && 'gen' in target) {
        pageNumber = (await this.pdfDocument.getPageIndex(target as { num: number; gen: number })) + 1
      }
      const page = pageNumber ? this.pages[pageNumber - 1] : null
      if (!page || !pageNumber) return null
      const viewport = page.page.getViewport({ scale: 1 })
      return { pageNumber, fraction: pdfDestinationFraction(resolved, viewport) }
    } catch {
      return null
    }
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
    this.outlineLocations = []
    if (!this.pdfDocument) return []
    try {
      const outline = await this.pdfDocument.getOutline() as PdfOutlineNode[]
      const toc: TocItem[] = []
      const locations: PdfOutlineLocation[] = []
      const visit = async (items: PdfOutlineNode[], depth: number): Promise<void> => {
        for (const item of items) {
          if (!item.url && !item.unsafeUrl && item.dest) {
            const position = await this.positionForDestination(item.dest)
            if (position) {
              const label = item.title.trim() || copy('reader.pdfUntitledSection')
              const href = makePdfPositionAnchor(position.pageNumber, position.fraction)
              toc.push({
                id: `pdf-toc-${toc.length + 1}`,
                label,
                href,
                depth
              })
              locations.push({ ...position, label, href, depth, order: locations.length })
            }
          }
          if (item.items.length > 0) await visit(item.items, depth + 1)
        }
      }
      await visit(outline, 0)
      this.outlineLocations = sortPdfOutlineLocations(locations)
      return toc
    } catch {
      this.outlineLocations = []
      return []
    }
  }

  private async goToWithReason(anchor: string, reason: ReaderRelocationReason): Promise<void> {
    const textAnchor = parsePdfTextAnchor(anchor, this.pages.length)
    const regionAnchor = parsePdfRegionAnchor(anchor, this.pages.length)
    const positionAnchor = parsePdfPositionAnchor(anchor, this.pages.length)
    const pageNumber = textAnchor?.pageNumber ?? regionAnchor?.pageNumber ?? positionAnchor?.pageNumber
    if (!pageNumber) throw new Error(copy('reader.pdfInvalidAnchor'))
    await this.renderPage(pageNumber)
    const page = this.pages[pageNumber - 1]
    const pageLength = page.textModel?.rawLength ?? 0
    const fraction = positionAnchor?.fraction ??
      regionAnchor?.top ??
      (pageLength > 0 ? (textAnchor?.start ?? 0) / pageLength : 0)
    this.relocateProgrammatically(pageNumber, fraction, reason)
  }

  private relocateProgrammatically(
    pageNumber: number,
    fraction: number,
    reason: ReaderRelocationReason
  ): void {
    const revision = ++this.programmaticScrollRevision
    if (this.relocationFrame !== null && this.document.defaultView) {
      this.document.defaultView.cancelAnimationFrame(this.relocationFrame)
      this.relocationFrame = null
    }
    this.programmaticReason = reason
    this.scrollToPageFraction(pageNumber, fraction)
    this.programmaticScrollTop = this.host.scrollTop
    this.emitRelocationForPage(pageNumber, fraction, reason)
    this.document.defaultView?.setTimeout(() => {
      if (revision !== this.programmaticScrollRevision) return
      this.programmaticReason = null
      this.programmaticScrollTop = null
    }, 80)
  }

  private scrollToPageFraction(pageNumber: number, fraction: number): void {
    const page = this.pages[pageNumber - 1]
    if (!page) return
    this.host.scrollTop = Math.max(
      0,
      page.element.offsetTop + page.element.offsetHeight * fraction - this.readingLineOffset()
    )
  }

  private readingLineOffset(): number {
    return Math.min(120, this.host.clientHeight * 0.25)
  }

  private currentPageAndFraction(): { pageNumber: number; fraction: number } {
    const hostRect = this.host.getBoundingClientRect()
    const readingLine = hostRect.top + this.readingLineOffset()
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
    if (
      this.programmaticReason &&
      this.programmaticScrollTop !== null &&
      Math.abs(this.host.scrollTop - this.programmaticScrollTop) < 1
    ) return
    if (this.programmaticReason) {
      this.programmaticScrollRevision += 1
      this.programmaticReason = null
      this.programmaticScrollTop = null
    }
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
    const textLength = state?.textModel?.rawLength ?? 0
    const offset = Math.round(textLength * Math.min(1, Math.max(0, fraction)))
    const section = this.sectionAt(pageNumber, fraction)
    this.emitRelocation({
      locator: makePdfTextAnchor(pageNumber, offset),
      progress: (pageNumber - 1 + fraction) / Math.max(1, this.pages.length),
      chapterProgress: section.progress,
      chapterTitle: section.title,
      chapterHref: section.href,
      reason
    })
  }

  private sectionAt(pageNumber: number, fraction: number): ReturnType<typeof pdfSectionAt> {
    return pdfSectionAt(
      this.outlineLocations,
      pageNumber,
      fraction,
      this.pages.length,
      copy('reader.pdfWholeDocument')
    )
  }

  private emitRelocation(relocation: ReaderRelocation): void {
    this.callbacks.onRelocated?.({
      ...relocation,
      progress: Math.min(1, Math.max(0, relocation.progress)),
      chapterProgress: Math.min(1, Math.max(0, relocation.chapterProgress))
    })
  }

  private readonly handleSelectionChange = (): void => {
    if (this.regionMode) return
    const nativeSelection = this.document.defaultView?.getSelection()
    if (!nativeSelection || nativeSelection.rangeCount === 0) return
    const range = nativeSelection.getRangeAt(0)
    if (!this.pageElementForNode(range.startContainer) && !this.pageElementForNode(range.endContainer)) return
    this.selectionRevision += 1
    nativeSelection.removeAllRanges()
    this.setSelection(null)
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
    const quote = state.textModel?.readableSliceForRaw(start, end).trim() ?? ''
    if (!quote) {
      this.setSelection(null)
      return
    }
    const context = this.selectionContextForRawRange(
      pageNumber,
      start,
      end,
      quote,
      makePdfTextAnchor(pageNumber, start, end)
    )
    this.setSelection(context)
  }

  private selectionContextForRawRange(
    pageNumber: number,
    start: number,
    end: number,
    quote: string,
    anchor: string
  ): SelectionContext | null {
    const state = this.pages[pageNumber - 1]
    const model = state?.textModel
    if (!state || !model || start < 0 || end <= start || end > model.rawLength || !quote.trim()) return null
    const firstPageIndex = Math.max(0, pageNumber - 2)
    const lastPageIndex = Math.min(this.pages.length - 1, pageNumber)
    const blocks: ContextBlock[] = this.pages.slice(firstPageIndex, lastPageIndex + 1).map((page) => {
      const pageModel = page.textModel
      return {
        id: `page-${page.pageNumber}`,
        text: pageModel?.readableText ?? '',
        anchorForSlice: (blockStart, blockEnd) => makePdfTextAnchor(
          page.pageNumber,
          pageModel?.rawOffsetForReadable(blockStart, 'start') ?? blockStart,
          pageModel?.rawOffsetForReadable(blockEnd, 'end') ?? blockEnd
        )
      }
    })
    const focusBlock = pageNumber - 1 - firstPageIndex
    const focusStart = model.readableOffsetForRaw(start, 'start')
    const focusEnd = model.readableOffsetForRaw(end, 'end')
    const regionAnchor = parsePdfRegionAnchor(anchor, this.pages.length)
    const fraction = regionAnchor?.top ?? (model.rawLength > 0 ? start / model.rawLength : 0)
    return {
      bookId: this.callbacks.bookId,
      quote: quote.trim(),
      anchor,
      chapterTitle: this.sectionAt(pageNumber, fraction).title,
      passages: buildBoundedPassages(blocks, {
        startBlock: focusBlock,
        startOffset: focusStart,
        endBlock: focusBlock,
        endOffset: focusEnd
      })
    }
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
    const basic = parsePdfTextAnchor(anchor, this.pages.length)
    if (!basic) return null
    await this.textPromise
    const state = this.pages[basic.pageNumber - 1]
    const parsed = parsePdfTextAnchor(anchor, this.pages.length, state.textModel?.rawLength ?? 0)
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

  private createRegionOverlay(region: PdfRegionAnchor, className: string): HTMLElement | null {
    const page = this.pages[region.pageNumber - 1]
    if (!page) return null
    const overlay = this.document.createElement('div')
    overlay.className = `pdf-region-overlay ${className}`
    overlay.dataset.regionAnchor = makePdfRegionAnchor(region)
    this.positionRegionOverlay(overlay, region)
    page.element.append(overlay)
    return overlay
  }

  private async applyPersistentHighlights(): Promise<void> {
    this.clearPersistentHighlights()
    const ranges: Range[] = []
    for (const { anchor } of this.persistentHighlightAnchors) {
      const region = parsePdfRegionAnchor(anchor, this.pages.length)
      if (region) {
        const overlay = this.createRegionOverlay(region, 'is-persistent')
        if (overlay) this.persistentRegionElements.push(overlay)
        continue
      }
      const parsed = parsePdfTextAnchor(anchor, this.pages.length)
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
    this.temporaryRegionElements.forEach((element) => element.remove())
    this.temporaryRegionElements = []
  }

  private clearPersistentHighlights(): void {
    this.persistentHighlightRegistry?.delete(PERSISTENT_HIGHLIGHT_NAME)
    this.persistentHighlightRegistry = null
    this.persistentFallbackElements.forEach((element) => element.classList.remove('pdf-persistent-highlight'))
    this.persistentFallbackElements = []
    this.persistentRegionElements.forEach((element) => element.remove())
    this.persistentRegionElements = []
  }

  private setSelection(selection: SelectionContext | null): void {
    this.selection = selection
    this.callbacks.onSelectionChanged?.(selection)
  }

  private resetDocument(): void {
    this.searchRevision += 1
    this.selectionRevision += 1
    this.document.removeEventListener('selectionchange', this.handleSelectionChange)
    this.documentElement?.removeEventListener('pointerdown', this.handleRegionPointerDown)
    this.document.removeEventListener('pointermove', this.handleRegionPointerMove)
    this.document.removeEventListener('pointerup', this.handleRegionPointerUp)
    this.document.removeEventListener('pointercancel', this.handleRegionPointerCancel)
    this.host.removeEventListener('scroll', this.handleScroll)
    this.observer?.disconnect()
    this.resizeObserver?.disconnect()
    this.observer = null
    this.resizeObserver = null
    if (this.relocationFrame !== null && this.document.defaultView) {
      this.document.defaultView.cancelAnimationFrame(this.relocationFrame)
    }
    if (this.resizeFrame !== null && this.document.defaultView) {
      this.document.defaultView.cancelAnimationFrame(this.resizeFrame)
    }
    this.relocationFrame = null
    this.resizeFrame = null
    this.zoomCoordinator.reset()
    this.cancelRegionDrag()
    this.clearRegionDraft()
    this.activeRegionElement?.remove()
    this.activeRegionElement = null
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
    this.regionMode = false
    this.regionButton = null
    this.fitWidthButton = null
    this.zoomFactor = 1
    this.zoomMode = 'fit-width'
    this.outlineLocations = []
    this.selection = null
    this.programmaticReason = null
    this.programmaticScrollTop = null
    this.programmaticScrollRevision += 1
    this.host.replaceChildren()
  }
}

interface HighlightRegistry {
  delete(name: string): void
  set(name: string, value: unknown): void
}
