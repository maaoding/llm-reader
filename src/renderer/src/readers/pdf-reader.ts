import type { BookFormat, PdfImageRegionSource, ReaderSource, SelectionContext } from '@shared/contracts'
import { pdfImageRegionAnchor } from '@shared/pdf-image-region'
import { capturePdfImageRegion } from './pdf-image-crop'
import { copy, type CopyKey } from '@shared/copy'
import { parseOcrRegionAnchor, parseOcrTextAnchor } from '@shared/ocr-reading'
import { OCR_MAX_PAGES } from '@shared/vision-ocr'
import { hitOcrWord, ocrLineRegion, positionedOcrSelection, selectedOcrWords, type OcrWordPoint, type PositionedOcrPage } from './pdf-ocr-selection'
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
  TextLayer
} from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { buildBoundedPassages, codePointLength, type ContextBlock } from './context'
import { PdfTextLayerIndex } from './pdf-dom-text'
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
  createPdfOutlineIndex,
  makePdfPositionAnchor,
  parsePdfPositionAnchor,
  pdfDestinationFraction,
  pdfFitAvailableWidth,
  pdfReadingPosition,
  pdfSectionAt,
  PdfOutlineIndex,
  PdfZoomCoordinator,
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
  ReaderSearchResult,
  ReaderTocItem
} from './types'
import { readerRelocationTitle, readerTitle, READER_SEARCH_RESULT_LIMIT } from './types'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 2.5
const ZOOM_STEP = 0.15
const MAX_CANVAS_DIMENSION = 8_192
const MAX_CANVAS_PIXELS = 36_000_000
const CANVAS_CACHE_PIXELS = 16 * 1024 * 1024
const PAGE_REQUEST_BATCH = 16
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
  textIndex: PdfTextLayerIndex | null
  renderTask: RenderTask | null
  renderPromise: Promise<void> | null
  renderRevision: number
  layerScale: number | null
  textModel: PdfTextModel | null
  textIndexRequest: Promise<void> | null
}

interface PdfRegionDrag {
  pointerId: number
  page: PdfPageState
  startX: number
  startY: number
  overlay: HTMLElement
}

interface PdfPanDrag {
  pointerId: number
  startX: number
  startY: number
  scrollLeft: number
  scrollTop: number
  active: boolean
}

interface PdfOcrDrag {
  pointerId: number
  page: PdfPageState
  ocr: PositionedOcrPage
  start: OcrWordPoint
  startX: number
  startY: number
  end?: OcrWordPoint
  leftPage?: boolean
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
  private preparedOcrRevision: string | null = null
  private readonly ocrPages = new Map<number, { page?: PositionedOcrPage }>()
  private ocrDrag: PdfOcrDrag | null = null
  private readonly toolbarLabels: Array<() => void> = []
  private highlightStyleElement: HTMLStyleElement | null = null
  private pdfjs: typeof import('pdfjs-dist') | null = null
  private loadingTask: PDFDocumentLoadingTask | null = null
  private pdfDocument: PDFDocumentProxy | null = null
  private documentRevision = 0
  private pages: PdfPageState[] = []
  private contextLengths = new WeakMap<PdfTextModel, number>()
  private pageIndexHint = 0
  private readonly nearbyPages = new Set<PdfPageState>()
  private readonly canvasCache = new Map<PdfPageState, number>()
  private cachedCanvasPixels = 0
  private observer: IntersectionObserver | null = null
  private resizeObserver: ResizeObserver | null = null
  private relocationFrame: number | null = null
  private searchRevision = 0
  private zoomFactor = 1
  private zoomMode: PdfZoomMode = 'fit-width'
  private readonly zoomCoordinator = new PdfZoomCoordinator()
  private resizeFrame: number | null = null
  private fitWidthButton: HTMLButtonElement | null = null
  private outlineIndex = new PdfOutlineIndex([])
  private programmaticReason: ReaderRelocationReason | null = null
  private programmaticScrollTop: number | null = null
  private selection: ReaderSource | null = null
  private persistentHighlightAnchors: ReaderHighlightAnchor[] = []
  private temporaryHighlightRegistry: HighlightRegistry | null = null
  private persistentHighlightRegistry: HighlightRegistry | null = null
  private temporaryFallbackElements: HTMLElement[] = []
  private persistentFallbackElements: HTMLElement[] = []
  private regionMode = false
  private imageRegionMode = false
  private regionButton: HTMLButtonElement | null = null
  private imageRegionButton: HTMLButtonElement | null = null
  private regionDrag: PdfRegionDrag | null = null
  private regionDraftRevision = 0
  private draftRegionElement: HTMLElement | null = null
  private activeRegionElement: HTMLElement | null = null
  private temporaryRegionElements: HTMLElement[] = []
  private persistentRegionElements: HTMLElement[] = []
  private panDrag: PdfPanDrag | null = null
  private panable = false

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
    const revision = this.documentRevision
    const ensureCurrent = (): void => {
      if (revision !== this.documentRevision) throw new DOMException('PDF opening cancelled', 'AbortError')
    }
    this.host.style.overflowX = 'auto'
    this.host.style.overflowY = 'auto'
    if (this.document.defaultView?.getComputedStyle(this.host).position === 'static') {
      this.host.style.position = 'relative'
    }

    const pdfjs = await import('pdfjs-dist')
    ensureCurrent()
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    this.pdfjs = pdfjs
    const loadingTask = pdfjs.getDocument({
      data: Uint8Array.from(bytes),
      enableXfa: false,
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
      const pdfDocument = await loadingTask.promise
      ensureCurrent()
      this.pdfDocument = pdfDocument
    } catch (error) {
      ensureCurrent()
      console.error(
        '[PDF_OPEN_FAILED]',
        error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown PDF.js error'
      )
      await loadingTask.destroy().catch(() => undefined)
      ensureCurrent()
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

    const placeholders = this.document.createDocumentFragment()
    const pdfDocument = this.pdfDocument
    // Overlap worker round trips while bounding the work left after a switch.
    for (let first = 1; first <= pdfDocument.numPages; first += PAGE_REQUEST_BATCH) {
      const length = Math.min(PAGE_REQUEST_BATCH, pdfDocument.numPages - first + 1)
      const pages = await Promise.all(Array.from({ length }, (_, index) => pdfDocument.getPage(first + index)))
      ensureCurrent()
      for (const [index, page] of pages.entries()) {
        const state = this.createPageState(page, first + index)
        this.pages.push(state)
        placeholders.append(state.element)
      }
    }

    // Build and size detached placeholders before a single insertion. This
    // avoids a document layout after every getPage round trip and size write.
    const availableWidth = this.availablePageWidth()
    for (const page of this.pages) this.updatePageSize(page, this.pageScale(page, availableWidth))
    documentElement.append(placeholders)
    // Classic scrollbars can reduce clientWidth once the pages are attached.
    const settledWidth = this.availablePageWidth()
    if (settledWidth !== availableWidth) {
      for (const page of this.pages) this.updatePageSize(page, this.pageScale(page, settledWidth))
    }

    this.bindObservers()
    this.document.addEventListener('selectionchange', this.handleSelectionChange)
    documentElement.addEventListener('pointerdown', this.handleRegionPointerDown)
    this.document.addEventListener('pointermove', this.handleRegionPointerMove)
    this.document.addEventListener('pointerup', this.handleRegionPointerUp)
    this.document.addEventListener('pointercancel', this.handleRegionPointerCancel)
    documentElement.addEventListener('pointerdown', this.handlePanPointerDown)
    this.document.addEventListener('pointermove', this.handlePanPointerMove)
    this.document.addEventListener('pointerup', this.handlePanPointerUp)
    this.document.addEventListener('pointercancel', this.handlePanPointerCancel)
    this.host.addEventListener('scroll', this.handleScroll, { passive: true })
    void this.loadAllPageText(revision).catch(() => undefined)

    const [metadata, toc] = await Promise.all([this.readMetadata(), this.readOutline()])
    ensureCurrent()
    const restored = lastLocator
      ? parsePdfTextAnchor(lastLocator, this.pages.length) ??
        parsePdfRegionAnchor(lastLocator, this.pages.length) ??
        parsePdfPositionAnchor(lastLocator, this.pages.length) ?? parseOcrTextAnchor(lastLocator, this.pages.length) ??
        parseOcrRegionAnchor(lastLocator, this.pages.length)?.[0]
      : null
    const initialPage = restored?.pageNumber ?? 1
    await this.renderPage(initialPage)
    ensureCurrent()
    if (restored) {
      await this.goToWithReason(lastLocator!, 'restore')
      ensureCurrent()
    } else {
      this.emitRelocationForPage(initialPage, 0, 'restore')
    }
    this.updatePanAvailability()

    return { metadata, toc }
  }

  destroy(): void {
    this.resetDocument()
    this.host.style.overflowX = this.originalOverflowX
    this.host.style.overflowY = this.originalOverflowY
    this.host.style.position = this.originalPosition
  }

  setPreparedOcrRevision(revision: string | null): void {
    if (revision === this.preparedOcrRevision) return
    this.preparedOcrRevision = revision
    this.ocrPages.clear()
    this.cancelOcrDrag()
    if (this.draftRegionElement?.classList.contains('pdf-ocr-selection')) this.clearRegionDraft()
    for (const page of this.pages) {
      delete page.element.dataset.ocrSelectable
      page.element.querySelector('.pdf-ocr-hit-layer')?.remove()
    }
    void this.refreshOcrHint()
    if (revision) this.loadVisibleOcrPages()
  }

  private async refreshOcrHint(): Promise<void> {
    const banner = this.capabilityBanner
    if (!banner) return
    const revision = this.preparedOcrRevision
    const response = revision ? await this.callbacks.readPreparedOcrPage?.(1).catch(() => null) : null
    if (this.capabilityBanner !== banner || this.preparedOcrRevision !== revision) return
    banner.hidden = response?.status === 'ready' && response.revision === revision
    if (!banner.parentElement) this.root?.insertBefore(banner, this.documentElement)
  }

  private loadVisibleOcrPages(): void {
    const hostRect = this.host.getBoundingClientRect()
    for (const page of this.pages) {
      if (page.layerScale === null || page.textModel?.rawLength) continue
      const rect = page.element.getBoundingClientRect()
      if (rect.top < hostRect.bottom && rect.bottom > hostRect.top) void this.loadOcrPage(page)
    }
  }

  private loadOcrPage(page: PdfPageState): void {
    const revision = this.preparedOcrRevision
    const read = this.callbacks.readPreparedOcrPage
    if (!read || !revision || page.pageNumber > OCR_MAX_PAGES || page.textModel?.rawLength ||
        this.pages[page.pageNumber - 1] !== page || this.ocrPages.has(page.pageNumber)) return
    const entry: { page?: PositionedOcrPage } = {}
    this.ocrPages.set(page.pageNumber, entry)
    void read(page.pageNumber).then((value) => {
      if (this.ocrPages.get(page.pageNumber) !== entry || value.status !== 'ready' || value.revision !== revision ||
          value.pageNumber !== page.pageNumber || !value.wordLines?.length) return
      const wordLines = value.wordLines
      const hitLayer = this.document.createElement('div')
      hitLayer.className = 'pdf-ocr-hit-layer'
      hitLayer.setAttribute('aria-hidden', 'true')
      for (const line of wordLines) {
        const hit = this.document.createElement('span')
        this.positionRegionOverlay(hit, ocrLineRegion(page.pageNumber, line))
        hitLayer.append(hit)
      }
      page.element.append(hitLayer)
      page.element.dataset.ocrSelectable = 'true'
      page.element.querySelector('.pdf-page-no-text')?.remove()
      entry.page = { ...value, wordLines }
    }).catch(() => {
      if (this.ocrPages.get(page.pageNumber) === entry) this.ocrPages.delete(page.pageNumber)
    })
  }

  private createPageState(page: PDFPageProxy, pageNumber: number): PdfPageState {
    const viewport = page.getViewport({ scale: 1 })
    const element = this.document.createElement('section')
    element.className = 'pdf-page'
    element.dataset.pageNumber = String(pageNumber)
    element.setAttribute('aria-label', copy('reader.pdfPage', { number: pageNumber }))
    const canvas = this.document.createElement('canvas')
    canvas.className = 'pdf-page-canvas'
    canvas.width = 0
    canvas.height = 0
    canvas.style.visibility = 'hidden'
    const textLayerElement = this.document.createElement('div')
    textLayerElement.className = 'pdf-text-layer'
    textLayerElement.dataset.pageNumber = String(pageNumber)
    const linkLayerElement = this.document.createElement('div')
    linkLayerElement.className = 'pdf-link-layer'
    element.append(canvas, textLayerElement, linkLayerElement)
    return {
      pageNumber,
      page,
      baseWidth: viewport.width,
      baseHeight: viewport.height,
      element,
      canvas,
      textLayerElement,
      linkLayerElement,
      textLayer: null,
      textIndex: null,
      renderTask: null,
      renderPromise: null,
      renderRevision: 0,
      layerScale: null,
      textModel: null,
      textIndexRequest: null
    }
  }

  async search(query: string): Promise<ReadonlyArray<ReaderSearchResult>> {
    const normalized = normalizeReaderSearchQuery(query)
    if (!normalized) throw new Error(copy('reader.searchInvalid'))
    const revision = ++this.searchRevision
    const results: ReaderSearchResult[] = []
    const expression = literalSearchExpression(normalized)
    let hasText = false
    for (const page of this.pages) {
      if (revision !== this.searchRevision) return []
      if (!page.textModel) {
        try {
          await this.indexPageText(page)
        } catch (error) {
          if (revision !== this.searchRevision) return []
          throw error
        }
        if (revision !== this.searchRevision) return []
      }
      const model = page.textModel
      if (model && model.rawLength > 0) {
        hasText = true
        const text = model.readableText
        expression.lastIndex = 0
        let previousUtf16 = 0
        let previousCodePoints = 0
        let match = expression.exec(text)
        while (match) {
          const readableStart = previousCodePoints + codePointLength(text.slice(previousUtf16, match.index))
          const readableEnd = readableStart + codePointLength(match[0])
          const start = model.rawOffsetForReadable(readableStart, 'start')
          const end = model.rawOffsetForReadable(readableEnd, 'end')
          results.push({
            anchor: makePdfTextAnchor(page.pageNumber, start, end),
            excerpt: searchExcerpt(text, match.index, match.index + match[0].length),
            ...this.relocationTitleAt(page.pageNumber, start / model.rawLength)
          })
          if (results.length >= READER_SEARCH_RESULT_LIMIT) return results
          previousUtf16 = match.index + match[0].length
          previousCodePoints = readableEnd
          match = expression.exec(text)
        }
      }
      if (page.pageNumber % 20 === 0) await yieldSearchWork()
    }
    if (revision !== this.searchRevision) return []
    if (!hasText) throw new Error(copy('reader.pdfSearchUnavailable'))
    return results
  }

  async goTo(anchor: string): Promise<void> {
    await this.goToWithReason(anchor, 'navigation')
  }

  getSelection(): ReaderSource | null {
    return this.selection
  }

  clearSelection(): void {
    this.cancelOcrDrag()
    if (this.draftRegionElement?.classList.contains('pdf-ocr-selection')) this.clearRegionDraft()
    if (this.regionMode) this.setRegionMode(false)
    if (this.imageRegionMode) this.setImageRegionMode(false)
    this.document.defaultView?.getSelection()?.removeAllRanges()
    this.activeRegionElement?.remove()
    this.activeRegionElement = null
    this.setSelection(null)
  }

  async selectAnchor(anchor: string): Promise<boolean> {
    // External extraction provides a page position, without a selectable text range.
    if (parsePdfPositionAnchor(anchor, this.pages.length) || parseOcrTextAnchor(anchor, this.pages.length)) return false
    const ocrRegion = parseOcrRegionAnchor(anchor, this.pages.length)?.[0]
    const region = ocrRegion ?? parsePdfRegionAnchor(anchor, this.pages.length)
    if (region) {
      await this.renderPage(region.pageNumber)
      const pageRect = this.pages[region.pageNumber - 1]?.element.getBoundingClientRect()
      const hostRect = this.host.getBoundingClientRect()
      if (ocrRegion && pageRect) {
        return pageRect.top + pageRect.height * region.top >= hostRect.top &&
          pageRect.top + pageRect.height * region.bottom <= hostRect.bottom &&
          pageRect.left + pageRect.width * region.left >= hostRect.left &&
          pageRect.left + pageRect.width * region.right <= hostRect.right
      }
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
    const position = parsePdfPositionAnchor(anchor, this.pages.length) ?? parseOcrTextAnchor(anchor, this.pages.length)
    if (position) {
      await this.renderPage(position.pageNumber)
      this.clearTemporaryHighlight()
      return
    }
    const regions = this.regionsForAnchor(anchor)
    if (regions) {
      await this.renderPage(regions[0].pageNumber)
      this.clearTemporaryHighlight()
      this.temporaryRegionElements = regions.flatMap((region) => this.createRegionOverlay(region, 'is-temporary') ?? [])
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

  refreshUiLanguage(): void {
    for (const applyLabel of this.toolbarLabels) applyLabel()
    if (this.capabilityBanner) this.capabilityBanner.textContent = copy('reader.pdfNoText')
    for (const page of this.pages) {
      page.element.setAttribute('aria-label', copy('reader.pdfPage', { number: page.pageNumber }))
      for (const link of page.linkLayerElement.children) link.setAttribute('aria-label', copy('reader.pdfInternalLink'))
      const badge = page.element.querySelector('.pdf-page-no-text')
      if (badge) badge.textContent = copy('reader.pdfPageNoText')
    }
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
    const zoomOut = this.toolbarButton('reader.pdfZoomOut', () => this.changeZoom(-ZOOM_STEP), '−')
    const fitWidth = this.toolbarButton('reader.pdfFitWidth', () => this.setZoom(1, 'fit-width', true))
    fitWidth.classList.add('pdf-fit-width', 'is-active')
    fitWidth.setAttribute('aria-pressed', 'true')
    this.fitWidthButton = fitWidth
    const zoomValue = this.document.createElement('output')
    zoomValue.className = 'pdf-zoom-value'
    zoomValue.dataset.testid = 'pdf-zoom-value'
    zoomValue.value = ''
    zoomValue.toggleAttribute('hidden', true)
    const zoomIn = this.toolbarButton('reader.pdfZoomIn', () => this.changeZoom(ZOOM_STEP), '+')
    const regionButton = this.toolbarButton('reader.pdfRegionSelect', () => this.setRegionMode(!this.regionMode))
    regionButton.dataset.testid = 'pdf-region-select'
    regionButton.setAttribute('aria-pressed', 'false')
    regionButton.classList.add('pdf-region-select')
    this.regionButton = regionButton
    const imageRegionButton = this.toolbarButton('visual.select', () => this.setImageRegionMode(!this.imageRegionMode))
    imageRegionButton.dataset.testid = 'pdf-image-region-select'
    imageRegionButton.setAttribute('aria-pressed', 'false')
    imageRegionButton.classList.add('pdf-region-select')
    this.imageRegionButton = imageRegionButton
    const paperButton = this.toolbarButton('settings.paperTheme', () => this.callbacks.onDisplaySettings?.(paperButton))
    toolbar.append(zoomOut, fitWidth, zoomValue, zoomIn, paperButton, regionButton, imageRegionButton)
    return toolbar
  }

  private toolbarButton(labelKey: Extract<CopyKey, 'reader.pdfZoomIn' | 'reader.pdfZoomOut' | 'reader.pdfFitWidth' | 'reader.pdfRegionSelect' | 'visual.select' | 'settings.paperTheme'>,
    activate: () => void, symbol?: string): HTMLButtonElement {
    const button = this.document.createElement('button')
    button.type = 'button'
    const applyLabel = (): void => {
      const label = copy(labelKey)
      button.textContent = symbol ?? label
      button.setAttribute('aria-label', label)
      button.title = label
    }
    this.toolbarLabels.push(applyLabel)
    applyLabel()
    button.addEventListener('click', activate)
    return button
  }

  private setRegionMode(enabled: boolean): void {
    if (this.regionMode === enabled) return
    if (enabled && this.imageRegionMode) this.setImageRegionMode(false)
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
    if (this.draftRegionElement) this.clearRegionDraft()
  }

  private setImageRegionMode(enabled: boolean): void {
    if (this.imageRegionMode === enabled) return
    if (enabled) { this.clearSelection(); if (this.regionMode) this.setRegionMode(false) }
    this.imageRegionMode = enabled
    this.imageRegionButton?.setAttribute('aria-pressed', String(enabled))
    this.imageRegionButton?.classList.toggle('is-active', enabled)
    this.root?.classList.toggle('is-region-selecting', enabled)
    if (enabled) { this.callbacks.onNotice?.({ message: copy('visual.hint'), tone: 'info' }); return }
    this.cancelRegionDrag()
  }

  private notice(message: string, tone: 'info' | 'error' = 'error'): void {
    this.callbacks.onNotice?.({ message, tone })
  }

  private readonly handleRegionPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.regionDrag || this.ocrDrag) return
    const target = event.target instanceof Element ? event.target : null
    const pageElement = target?.closest<HTMLElement>('.pdf-page[data-page-number]')
    const pageNumber = Number(pageElement?.dataset.pageNumber)
    const page = this.pages[pageNumber - 1]
    if (!pageElement || page?.layerScale == null || !this.canvasCache.has(page)) return
    if (!this.regionMode && !this.imageRegionMode) {
      if (target?.closest('.pdf-ocr-hit-layer')) this.startOcrDrag(event, page)
      else if (this.selection && parseOcrRegionAnchor(this.selection.anchor)) this.clearSelection()
      return
    }

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
    if (this.ocrDrag?.pointerId === event.pointerId) {
      this.drawOcrDrag(event)
      return
    }
    const drag = this.regionDrag
    if (!drag || drag.pointerId !== event.pointerId) return
    const point = this.regionPoint(event, drag.page)
    if (!point) return
    this.positionRegionOverlay(drag.overlay, this.regionFromPoints(drag.page.pageNumber, drag.startX, drag.startY, point.x, point.y))
    event.preventDefault()
  }

  private readonly handleRegionPointerUp = (event: PointerEvent): void => {
    if (this.ocrDrag?.pointerId === event.pointerId) {
      this.completeOcrDrag(event, this.ocrDrag)
      return
    }
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
    if (this.imageRegionMode && (event.clientX < pageRect.left || event.clientX > pageRect.right ||
        event.clientY < pageRect.top || event.clientY > pageRect.bottom)) {
      drag.overlay.remove()
      this.notice(copy('visual.crossPage'))
      return
    }
    const width = Math.abs(point.x - drag.startX) * pageRect.width
    const height = Math.abs(point.y - drag.startY) * pageRect.height
    if (width < MIN_REGION_DRAG_PIXELS || height < MIN_REGION_DRAG_PIXELS) {
      drag.overlay.remove()
      this.notice(copy('reader.pdfRegionTooSmall'))
      return
    }
    const region = this.regionFromPoints(drag.page.pageNumber, drag.startX, drag.startY, point.x, point.y)
    this.positionRegionOverlay(drag.overlay, region)
    void (this.imageRegionMode ? this.completeImageRegionDraft(drag.page, region, drag.overlay) : this.completeRegionDraft(drag.page, region, drag.overlay))
    event.preventDefault()
  }

  private readonly handleRegionPointerCancel = (event: PointerEvent): void => {
    if (this.ocrDrag?.pointerId === event.pointerId) this.cancelOcrDrag()
    if (!this.regionDrag || this.regionDrag.pointerId !== event.pointerId) return
    this.cancelRegionDrag()
  }

  private startOcrDrag(event: PointerEvent, page: PdfPageState): void {
    const ocr = this.ocrPages.get(page.pageNumber)?.page
    if (!ocr || event.pointerType !== 'mouse') return
    this.clearSelection()
    const start = this.ocrWordAt(event, page, ocr)
    if (!start) return
    this.clearRegionDraft(false)
    const overlay = this.document.createElement('div')
    overlay.className = 'pdf-region-overlay pdf-ocr-selection is-draft'
    overlay.dataset.testid = 'pdf-ocr-drag'
    page.element.append(overlay)
    this.ocrDrag = { pointerId: event.pointerId, page, ocr, start, startX: event.clientX, startY: event.clientY, overlay }
    page.element.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }

  private ocrWordAt(event: PointerEvent, page: PdfPageState, ocr: PositionedOcrPage): OcrWordPoint | undefined {
    const rect = page.element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    return hitOcrWord(ocr.wordLines, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height)
  }

  private drawOcrDrag(event: PointerEvent): void {
    const drag = this.ocrDrag
    if (!drag) return
    const rect = drag.page.element.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
      drag.leftPage = true
      drag.overlay.replaceChildren()
    }
    if (drag.leftPage) return
    const end = this.ocrWordAt(event, drag.page, drag.ocr)
    if (end && (end.line !== drag.end?.line || end.word !== drag.end.word)) {
      drag.end = end
      this.paintOcrSelection(drag.overlay, selectedOcrWords(drag.ocr, drag.start, end)?.regions ?? [])
    }
    event.preventDefault()
  }

  private completeOcrDrag(event: PointerEvent, drag: PdfOcrDrag): void {
    this.ocrDrag = null
    if (drag.page.element.hasPointerCapture?.(event.pointerId)) drag.page.element.releasePointerCapture(event.pointerId)
    const rect = drag.page.element.getBoundingClientRect()
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) {
      drag.overlay.remove()
      return
    }
    if (drag.leftPage || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
      drag.overlay.remove()
      this.notice(copy('ocrReading.dragWithinColumn'), 'info')
      return
    }
    const end = this.ocrWordAt(event, drag.page, drag.ocr) ?? drag.end
    const selected = end && selectedOcrWords(drag.ocr, drag.start, end)
    if (!selected) {
      drag.overlay.remove()
      this.notice(copy('ocrReading.dragWithinColumn'), 'info')
      return
    }
    let context: SelectionContext | null
    try {
      context = positionedOcrSelection(this.callbacks.bookId, drag.ocr, selected)
    } catch {
      drag.overlay.remove()
      this.notice(copy('ocrReading.selectionTooLong'))
      return
    }
    if (!context) { drag.overlay.remove(); return }
    const preview = this.ocrSelectionPreview(drag.page, selected.regions)
    if (!preview) {
      drag.overlay.remove()
      this.notice(copy('ocrReading.previewFailed'))
      return
    }
    this.paintOcrSelection(drag.overlay, selected.regions)
    this.reviewRegionSelection(context, drag.overlay, preview)
    event.preventDefault()
  }

  private paintOcrSelection(overlay: HTMLElement, regions: PdfRegionAnchor[]): void {
    overlay.replaceChildren(...regions.map((region) => {
      const line = this.document.createElement('span')
      this.positionRegionOverlay(line, region)
      return line
    }))
  }

  private ocrSelectionPreview(page: PdfPageState, regions: PdfRegionAnchor[]): string | undefined {
    const { canvas } = page
    const left = Math.max(0, Math.floor(Math.min(...regions.map((region) => region.left)) * canvas.width) - 3)
    const top = Math.max(0, Math.floor(Math.min(...regions.map((region) => region.top)) * canvas.height) - 3)
    const right = Math.min(canvas.width, Math.ceil(Math.max(...regions.map((region) => region.right)) * canvas.width) + 3)
    const bottom = Math.min(canvas.height, Math.ceil(Math.max(...regions.map((region) => region.bottom)) * canvas.height) + 3)
    const width = right - left, height = bottom - top
    if (width <= 0 || height <= 0) return
    const scale = Math.min(1, 960 / Math.max(width, height))
    const preview = this.document.createElement('canvas')
    preview.width = Math.max(1, Math.ceil(width * scale))
    preview.height = Math.max(1, Math.ceil(height * scale))
    try {
      const context = preview.getContext('2d')
      if (!context) return
      context.drawImage(canvas, left, top, width, height, 0, 0, preview.width, preview.height)
      return preview.toDataURL('image/jpeg', 0.9)
    } catch {
      return undefined
    } finally {
      preview.width = 0
      preview.height = 0
    }
  }

  private cancelOcrDrag(): void {
    const drag = this.ocrDrag
    this.ocrDrag = null
    if (!drag) return
    if (drag.page.element.hasPointerCapture?.(drag.pointerId)) drag.page.element.releasePointerCapture(drag.pointerId)
    drag.overlay.remove()
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

  // 放大后横向溢出时允许按住拖拽平移;区域框选优先,普通点击(链接/按钮)不受影响。
  private updatePanAvailability(): void {
    const panable = this.host.scrollWidth > this.host.clientWidth + 1
    if (panable === this.panable) return
    this.panable = panable
    this.root?.classList.toggle('is-pannable', panable)
    if (!panable && this.panDrag?.active) {
      this.root?.classList.remove('is-panning')
      this.panDrag = null
    }
  }

  private readonly handlePanPointerDown = (event: PointerEvent): void => {
    if (this.regionMode || this.imageRegionMode || this.ocrDrag || !this.panable || event.button !== 0 || this.panDrag) return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('button, a, input, select, textarea')) return
    this.panDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: this.host.scrollLeft,
      scrollTop: this.host.scrollTop,
      active: false
    }
  }

  private readonly handlePanPointerMove = (event: PointerEvent): void => {
    const pan = this.panDrag
    if (!pan || pan.pointerId !== event.pointerId) return
    const deltaX = event.clientX - pan.startX
    const deltaY = event.clientY - pan.startY
    if (!pan.active) {
      if (Math.hypot(deltaX, deltaY) < 5) return
      pan.active = true
      this.host.setPointerCapture?.(event.pointerId)
      this.root?.classList.add('is-panning')
    }
    this.host.scrollLeft = pan.scrollLeft - deltaX
    this.host.scrollTop = pan.scrollTop - deltaY
    event.preventDefault()
  }

  private readonly handlePanPointerUp = (event: PointerEvent): void => {
    if (this.panDrag?.pointerId !== event.pointerId) return
    this.finishPanDrag()
  }

  private readonly handlePanPointerCancel = (event: PointerEvent): void => {
    if (this.panDrag?.pointerId !== event.pointerId) return
    this.finishPanDrag()
  }

  private finishPanDrag(): void {
    const pan = this.panDrag
    this.panDrag = null
    if (!pan?.active) return
    if (this.host.hasPointerCapture?.(pan.pointerId)) {
      this.host.releasePointerCapture(pan.pointerId)
    }
    this.root?.classList.remove('is-panning')
  }

  private clearRegionDraft(notify = true): void {
    this.regionDraftRevision += 1
    this.draftRegionElement?.remove()
    this.draftRegionElement = null
    if (notify) this.callbacks.onSelectionDraftChanged?.(null)
    if (notify) this.callbacks.onImageRegionDraftChanged?.(null)
  }

  async captureImageRegion(source: PdfImageRegionSource, signal?: AbortSignal): Promise<string> {
    if (!this.pdfDocument || source.bookId !== this.callbacks.bookId || source.pageNumber > this.pages.length ||
        source.anchor !== pdfImageRegionAnchor(source)) throw new Error(copy('visual.renderFailed'))
    return capturePdfImageRegion(this.pages[source.pageNumber - 1].page, source, signal)
  }

  private async completeImageRegionDraft(page: PdfPageState, region: PdfRegionAnchor, overlay: HTMLElement): Promise<void> {
    this.clearRegionDraft(false)
    const revision = ++this.regionDraftRevision
    this.draftRegionElement = overlay
    const source: PdfImageRegionSource = { kind: 'pdf-image-region', bookId: this.callbacks.bookId,
      ...region, anchor: pdfImageRegionAnchor(region) }
    try {
      const imageDataUrl = await this.captureImageRegion(source)
      if (revision !== this.regionDraftRevision || !overlay.isConnected || !this.imageRegionMode) return
      const cancel = (): void => { if (revision === this.regionDraftRevision) { this.clearRegionDraft(); this.setImageRegionMode(false) } }
      const confirm = (): void => {
        if (revision !== this.regionDraftRevision) return
        overlay.classList.remove('is-draft'); overlay.classList.add('is-selection')
        overlay.dataset.testid = 'pdf-image-region-selection'
        this.activeRegionElement?.remove(); this.activeRegionElement = overlay
        this.draftRegionElement = null; this.regionDraftRevision += 1
        this.callbacks.onImageRegionDraftChanged?.(null)
        this.setImageRegionMode(false)
        this.setSelection(source)
      }
      this.callbacks.onImageRegionDraftChanged?.({ source, imageDataUrl, confirm, cancel })
    } catch {
      if (revision === this.regionDraftRevision) { this.clearRegionDraft(); this.notice(copy('visual.renderFailed')); this.setImageRegionMode(false) }
    }
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

    const revision = this.regionDraftRevision
    this.draftRegionElement = overlay
    const contextPages = this.pages.slice(Math.max(0, page.pageNumber - 2), page.pageNumber + 1)
    const missingText = contextPages.filter((candidate) => candidate.textModel === null)
    if (missingText.length > 0) {
      // Neighboring text is optional. A failed read can leave it out of the
      // context while the rendered selection remains available.
      await Promise.allSettled(missingText.map((candidate) => this.indexPageText(candidate)))
    }
    if (revision !== this.regionDraftRevision || !overlay.isConnected || !this.regionMode) return

    const context = this.selectionContextForRawRange(
      page.pageNumber,
      result.rawStart,
      result.rawEnd,
      result.text,
      makePdfRegionAnchor(region)
    )
    if (!context) {
      this.clearRegionDraft(false)
      this.notice(copy('reader.pdfRegionEmpty'))
      return
    }

    this.reviewRegionSelection(context, overlay)
  }

  private reviewRegionSelection(context: SelectionContext, overlay: HTMLElement, ocrPreview?: string): void {
    if (this.draftRegionElement !== overlay) this.clearRegionDraft(false)
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
      this.callbacks.onSelectionDraftChanged({ quote: context.quote, ocrPreview, confirm, cancel })
    } else {
      confirm(context.quote)
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
    // Read once before mutating page sizes. Re-reading inside this loop forces
    // the browser to lay out the whole document after each page's writes.
    const availableWidth = this.availablePageWidth()
    this.updateZoomUi()
    this.cancelOcrDrag()
    this.clearNativeTextSelectionForRerender()
    for (const page of this.pages) {
      page.renderRevision += 1
      page.renderTask?.cancel()
      page.textLayer?.cancel()
      page.renderTask = null
      page.textLayer = null
      page.textIndex = null
      page.renderPromise = null
      page.layerScale = null
      page.element.setAttribute('aria-busy', 'true')
      page.textLayerElement.replaceChildren()
      page.linkLayerElement.replaceChildren()
      page.element.querySelector('.pdf-page-no-text')?.remove()
      this.updatePageSize(page, this.pageScale(page, availableWidth))
    }
    // Page geometry is final here. Restore the anchor before rendering so a
    // subsequent reader scroll is not rolled back when the render completes.
    this.relocateProgrammatically(operation.anchor.pageNumber, operation.anchor.fraction, 'navigation')
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

    if (!this.zoomCoordinator.complete(operation.revision)) return
    if (this.zoomMode === 'fit-width') this.host.scrollLeft = 0
    // 布局落定后再判定平移可用性,updateZoomUi 时的 scrollWidth 还是旧布局。
    this.updatePanAvailability()
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

  private availablePageWidth(): number {
    const style = this.documentElement && this.document.defaultView
      ? this.document.defaultView.getComputedStyle(this.documentElement)
      : null
    return pdfFitAvailableWidth(
      this.host.clientWidth,
      Number.parseFloat(style?.paddingLeft ?? '0'),
      Number.parseFloat(style?.paddingRight ?? '0')
    )
  }

  private pageScale(page: PdfPageState, availableWidth = this.availablePageWidth()): number {
    return availableWidth / page.baseWidth * this.zoomFactor
  }

  private updatePageSize(page: PdfPageState, scale = this.pageScale(page)): void {
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
    nativeSelection?.removeAllRanges()
    if (selectionUsesTextAnchor) this.setSelection(null)
  }

  private bindObservers(): void {
    const view = this.document.defaultView
    if (view?.IntersectionObserver) {
      const observer = new view.IntersectionObserver((entries) => {
        if (this.observer !== observer) return
        for (const entry of entries) {
          const pageNumber = Number((entry.target as HTMLElement).dataset.pageNumber)
          const page = this.pages[pageNumber - 1]
          if (!page || page.element !== entry.target) continue
          if (entry.isIntersecting) {
            this.nearbyPages.add(page)
            void this.renderPage(pageNumber).catch(() => undefined)
          } else {
            this.nearbyPages.delete(page)
          }
        }
        this.trimCanvasCache()
      }, { root: this.host, rootMargin: '120% 0px' })
      this.observer = observer
      this.pages.forEach((page) => observer.observe(page.element))
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

  private rememberCanvas(page: PdfPageState): void {
    const pixels = page.canvas.width * page.canvas.height
    this.cachedCanvasPixels += pixels - (this.canvasCache.get(page) ?? 0)
    // Map order tracks recency without sorting pages at each scroll.
    this.canvasCache.delete(page)
    this.canvasCache.set(page, pixels)
  }

  private releaseCanvas(page: PdfPageState): void {
    this.cachedCanvasPixels -= this.canvasCache.get(page) ?? 0
    this.canvasCache.delete(page)
    page.canvas.style.visibility = 'hidden'
    page.canvas.width = 0
    page.canvas.height = 0
  }

  private trimCanvasCache(keep?: PdfPageState): void {
    if (this.cachedCanvasPixels <= CANVAS_CACHE_PIXELS) return
    for (const page of this.canvasCache.keys()) {
      // An explicit jump paints its destination before moving the viewport.
      if (page === keep || page.renderPromise || this.nearbyPages.has(page)) continue
      this.releaseCanvas(page)
      if (this.cachedCanvasPixels <= CANVAS_CACHE_PIXELS) break
    }
  }

  private async renderPage(pageNumber: number): Promise<void> {
    const state = this.pages[pageNumber - 1]
    if (!state) return
    if (state.layerScale !== null) {
      this.loadOcrPage(state)
      if (this.canvasCache.has(state)) {
        this.rememberCanvas(state)
        return
      }
    }
    if (state.renderPromise) return state.renderPromise
    const revision = state.renderRevision
    // Cancelling the canvas/TextLayer cannot cancel getTextContent or annotations.
    // Every async stage must still belong to this page and zoom before committing.
    const isCurrent = (): boolean => state.renderRevision === revision && this.pages[pageNumber - 1] === state
    state.element.setAttribute('aria-busy', 'true')
    const run = async (): Promise<void> => {
      // A bitmap-only repaint uses the scale of the existing text and links.
      // Resizing or zooming invalidates that scale along with those layers.
      const layerScale = state.layerScale
      const scale = layerScale ?? this.pageScale(state)
      const viewport = state.page.getViewport({ scale })
      if (layerScale === null) this.updatePageSize(state, scale)
      await this.paintPageCanvas(state, viewport, isCurrent)
      if (!isCurrent()) return
      if (layerScale !== null) {
        state.element.setAttribute('aria-busy', 'false')
        return
      }

      const textContent = await state.page.getTextContent({ disableNormalization: false })
      if (!isCurrent()) return
      state.textModel ??= createPdfTextModel(textContent.items.filter((item) => 'str' in item))
      if (!this.pdfjs) throw new Error(copy('reader.pdfOpenFailed'))
      const textLayer = new this.pdfjs.TextLayer({
        textContentSource: textContent,
        container: state.textLayerElement,
        viewport
      })
      state.textLayer = textLayer
      await textLayer.render()
      if (!isCurrent()) return
      this.markTextOffsets(state, textLayer)
      await this.renderInternalLinks(state, viewport, isCurrent)
      if (!isCurrent()) return
      state.layerScale = scale
      this.loadOcrPage(state)
      state.element.setAttribute('aria-busy', 'false')
      await this.applyPersistentHighlights()
    }
    const renderPromise = run().catch((error) => {
      if (!isCurrent()) return
      if (error instanceof Error && error.name === 'RenderingCancelledException') return
      throw error
    }).finally(() => {
      if (!isCurrent()) return
      state.renderPromise = null
      state.renderTask = null
      this.trimCanvasCache(state)
    })
    state.renderPromise = renderPromise
    return renderPromise
  }

  private async paintPageCanvas(
    state: PdfPageState,
    viewport: ReturnType<PDFPageProxy['getViewport']>,
    isCurrent: () => boolean
  ): Promise<void> {
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
    try {
      const renderTask = state.page.render({
        canvas: renderCanvas,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        annotationMode: this.pdfjs?.AnnotationMode.DISABLE,
        background: '#ffffff'
      })
      state.renderTask = renderTask
      await renderTask.promise
      if (!isCurrent()) return
      state.renderTask = null
      state.canvas.width = renderCanvas.width
      state.canvas.height = renderCanvas.height
      state.canvas.style.width = `${viewport.width}px`
      state.canvas.style.height = `${viewport.height}px`
      const visibleContext = state.canvas.getContext('2d')
      if (!visibleContext) throw new Error(copy('reader.pdfOpenFailed'))
      visibleContext.drawImage(renderCanvas, 0, 0)
      state.canvas.style.visibility = 'visible'
      this.rememberCanvas(state)
      this.trimCanvasCache(state)
    } finally {
      renderCanvas.width = 0
      renderCanvas.height = 0
    }
  }

  private markTextOffsets(state: PdfPageState, textLayer: TextLayer): void {
    state.textIndex = null
    let cursor = 0
    textLayer.textDivs.forEach((element, index) => {
      const text = textLayer.textContentItemsStr[index] ?? element.textContent ?? ''
      const length = codePointLength(text)
      element.dataset.pdfTextStart = String(cursor)
      element.dataset.pdfTextEnd = String(cursor + length)
      cursor += length
    })
    if (cursor === 0 && !state.element.dataset.ocrSelectable) {
      const badge = this.document.createElement('span')
      badge.className = 'pdf-page-no-text'
      badge.textContent = copy('reader.pdfPageNoText')
      state.element.append(badge)
    }
  }

  private indexPageText(state: PdfPageState): Promise<void> {
    if (state.textIndexRequest) return state.textIndexRequest
    // Search and selection can join a pending background read. Text-layer
    // renders use separate requests so a newer zoom can replace a stalled render.
    const request = state.page.getTextContent({ disableNormalization: false }).then((content) => {
      if (this.pages[state.pageNumber - 1] === state) {
        state.textModel ??= createPdfTextModel(content.items.filter((item) => 'str' in item))
      }
    }).finally(() => {
      state.textIndexRequest = null
    })
    state.textIndexRequest = request
    return request
  }

  private async loadAllPageText(revision: number): Promise<void> {
    for (const state of this.pages) {
      if (revision !== this.documentRevision) return
      if (state.textModel === null) {
        try {
          await this.indexPageText(state)
        } catch (error) {
          if (revision !== this.documentRevision) return
          throw error
        }
      }
      if (state.pageNumber % 20 === 0) await yieldSearchWork()
    }
    if (revision !== this.documentRevision) return
    const hasNoText = this.pages.every((page) => (page.textModel?.rawLength ?? 0) === 0)
    if (this.regionButton) this.regionButton.disabled = hasNoText
    if (hasNoText && this.root) {
      const banner = this.document.createElement('div')
      banner.className = 'pdf-capability-banner'
      banner.dataset.testid = 'pdf-no-text-banner'
      banner.setAttribute('role', 'status')
      banner.textContent = copy('reader.pdfNoText')
      this.capabilityBanner = banner
      void this.refreshOcrHint()
    }
  }

  private async renderInternalLinks(
    state: PdfPageState,
    viewport: ReturnType<PDFPageProxy['getViewport']>,
    isCurrent: () => boolean
  ): Promise<void> {
    const annotations = await state.page.getAnnotations({ intent: 'display' })
    if (!isCurrent()) return
    for (const annotation of annotations) {
      if (
        annotation?.subtype !== 'Link' ||
        annotation.dest == null ||
        annotation.url != null ||
        annotation.unsafeUrl != null ||
        annotation.action != null ||
        !Array.isArray(annotation.rect) ||
        annotation.rect.length !== 4 ||
        !annotation.rect.every(Number.isFinite)
      ) continue
      const destination = annotation.dest as string | unknown[]
      const target = await this.positionForDestination(destination)
      if (!isCurrent()) return
      if (!target) continue
      const rectangle = [
        ...viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1]),
        ...viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3])
      ]
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
        this.callbacks.onInternalNavigation?.()
        void this.goTo(makePdfPositionAnchor(target.pageNumber, target.fraction))
      })
      state.linkLayerElement.append(button)
    }
  }

  private async positionForDestination(destination: string | unknown[]): Promise<PdfPositionAnchor | null> {
    const pdfDocument = this.pdfDocument
    if (!pdfDocument) return null
    try {
      const resolved = typeof destination === 'string'
        ? await pdfDocument.getDestination(destination)
        : destination
      if (!resolved || this.pdfDocument !== pdfDocument) return null
      const target = resolved[0]
      let pageNumber: number | null = null
      if (typeof target === 'number' && Number.isSafeInteger(target)) pageNumber = target + 1
      if (target && typeof target === 'object' && 'num' in target && 'gen' in target) {
        pageNumber = (await pdfDocument.getPageIndex(target as { num: number; gen: number })) + 1
      }
      if (this.pdfDocument !== pdfDocument) return null
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

  private async readOutline(): Promise<ReaderTocItem[]> {
    const pdfDocument = this.pdfDocument
    if (!pdfDocument) return []
    try {
      const outline = await pdfDocument.getOutline() as PdfOutlineNode[]
      const toc: ReaderTocItem[] = []
      const locations: PdfOutlineLocation[] = []
      const visit = async (items: PdfOutlineNode[], depth: number): Promise<void> => {
        for (const item of items) {
          if (this.pdfDocument !== pdfDocument) return
          if (!item.url && !item.unsafeUrl && item.dest) {
            const position = await this.positionForDestination(item.dest)
            if (position) {
              const title = item.title.trim()
              const label = title || copy('reader.pdfUntitledSection')
              const labelCopy = title ? undefined : { key: 'reader.pdfUntitledSection' as const }
              const href = makePdfPositionAnchor(position.pageNumber, position.fraction)
              toc.push({
                id: `pdf-toc-${toc.length + 1}`,
                label,
                labelCopy,
                href,
                depth
              })
              locations.push({ ...position, label, labelCopy, href, depth, order: locations.length })
            }
          }
          if (item.items.length > 0) await visit(item.items, depth + 1)
        }
      }
      await visit(outline, 0)
      if (this.pdfDocument !== pdfDocument) return []
      this.outlineIndex = createPdfOutlineIndex(locations)
      return toc
    } catch {
      if (this.pdfDocument === pdfDocument) this.outlineIndex = new PdfOutlineIndex([])
      return []
    }
  }

  private async goToWithReason(anchor: string, reason: ReaderRelocationReason): Promise<void> {
    const textAnchor = parsePdfTextAnchor(anchor, this.pages.length)
    const ocrRegion = parseOcrRegionAnchor(anchor, this.pages.length)?.[0]
    const regionAnchor = ocrRegion ?? parsePdfRegionAnchor(anchor, this.pages.length)
    const positionAnchor = parsePdfPositionAnchor(anchor, this.pages.length)
    const ocrAnchor = parseOcrTextAnchor(anchor, this.pages.length)
    const pageNumber = textAnchor?.pageNumber ?? regionAnchor?.pageNumber ?? positionAnchor?.pageNumber ?? ocrAnchor?.pageNumber
    if (!pageNumber) throw new Error(copy('reader.pdfInvalidAnchor'))
    await this.renderPage(pageNumber)
    const page = this.pages[pageNumber - 1]
    const pageLength = page.textModel?.rawLength ?? 0
    const fraction = positionAnchor?.fraction ??
      regionAnchor?.top ??
      (pageLength > 0 ? (textAnchor?.start ?? 0) / pageLength : 0)
    this.relocateProgrammatically(pageNumber, fraction, reason)
    if (ocrRegion && this.panable) {
      const host = this.host.getBoundingClientRect()
      const pageRect = page.element.getBoundingClientRect()
      const left = pageRect.left + ocrRegion.left * pageRect.width
      const right = pageRect.left + ocrRegion.right * pageRect.width
      if (left < host.left || right > host.right) this.host.scrollLeft += left - host.left - 24
    }
  }

  private relocateProgrammatically(
    pageNumber: number,
    fraction: number,
    reason: ReaderRelocationReason
  ): void {
    if (this.relocationFrame !== null && this.document.defaultView) {
      this.document.defaultView.cancelAnimationFrame(this.relocationFrame)
      this.relocationFrame = null
    }
    this.programmaticReason = reason
    this.scrollToPageFraction(pageNumber, fraction)
    this.programmaticScrollTop = this.host.scrollTop
    this.emitRelocationForPage(pageNumber, fraction, reason)
    // Delayed scroll events at this position still belong to navigation. The
    // next actual position change in handleScroll resumes natural reading.
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
    const position = pdfReadingPosition(this.pages.length, readingLine,
      (index) => this.pages[index].element.getBoundingClientRect(), this.pageIndexHint)
    if (!position) return { pageNumber: 1, fraction: 0 }
    this.pageIndexHint = position.pageNumber - 1
    return position
  }

  private readonly handleScroll = (): void => {
    if (
      this.programmaticReason &&
      this.programmaticScrollTop !== null &&
      Math.abs(this.host.scrollTop - this.programmaticScrollTop) < 1
    ) return
    if (this.programmaticReason) {
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
      ...readerRelocationTitle(section.titleCopy ?? section.title),
      chapterHref: section.href,
      reason
    })
  }

  private sectionAt(pageNumber: number, fraction: number): ReturnType<typeof pdfSectionAt> {
    const titleCopy = { key: 'reader.pdfWholeDocument' as const }
    const section = pdfSectionAt(
      this.outlineIndex,
      pageNumber,
      fraction,
      this.pages.length,
      readerTitle(titleCopy),
      titleCopy
    )
    if (section.titleCopy) section.title = readerTitle(section.titleCopy)
    return section
  }

  private relocationTitleAt(pageNumber: number, fraction: number): Pick<ReaderRelocation, 'chapterTitle' | 'chapterTitleCopy'> {
    const section = this.sectionAt(pageNumber, fraction)
    return readerRelocationTitle(section.titleCopy ?? section.title)
  }

  private emitRelocation(relocation: ReaderRelocation): void {
    this.callbacks.onRelocated?.({
      ...relocation,
      progress: Math.min(1, Math.max(0, relocation.progress)),
      chapterProgress: Math.min(1, Math.max(0, relocation.chapterProgress))
    })
  }

  private readonly handleSelectionChange = (): void => {
    if (this.regionMode || this.imageRegionMode) return
    const nativeSelection = this.document.defaultView?.getSelection()
    if (!nativeSelection || nativeSelection.rangeCount === 0) return
    const range = nativeSelection.getRangeAt(0)
    if (!this.pageElementForNode(range.startContainer) && !this.pageElementForNode(range.endContainer)) return
    nativeSelection.removeAllRanges()
    this.setSelection(null)
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
    const contextLengths = this.contextLengths
    const blocks: ContextBlock[] = this.pages.slice(firstPageIndex, lastPageIndex + 1).map((page) => {
      const pageModel = page.textModel
      return {
        id: `page-${page.pageNumber}`,
        text: pageModel?.readableText ?? '',
        get codePointLength() {
          if (!pageModel) return 0
          const known = contextLengths.get(pageModel)
          if (known !== undefined) return known
          // Count the joined text: surrogate pairs may cross PDF text-item boundaries.
          const length = codePointLength(pageModel.readableText)
          contextLengths.set(pageModel, length)
          return length
        },
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

  private async rangeForAnchor(anchor: string): Promise<Range | null> {
    const parsed = parsePdfTextAnchor(anchor, this.pages.length)
    if (!parsed || parsed.end <= parsed.start) return null
    const state = this.pages[parsed.pageNumber - 1]
    if (!state || (state.textModel && parsed.end > state.textModel.rawLength)) return null
    if (state.layerScale === null) await this.renderPage(parsed.pageNumber)
    if (state.layerScale === null || this.pages[parsed.pageNumber - 1] !== state) return null
    if (parsed.end > (state.textModel?.rawLength ?? 0)) return null
    const start = this.domPointForOffset(state, parsed.start)
    const end = this.domPointForOffset(state, parsed.end)
    if (!start || !end) return null
    const range = this.document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    return range
  }

  private domPointForOffset(state: PdfPageState, offset: number): { node: Node; offset: number } | null {
    return (state.textIndex ??= new PdfTextLayerIndex(state.textLayerElement)).point(offset)
  }

  private spansForRange(range: Range): HTMLElement[] {
    return Array.from(this.document.querySelectorAll<HTMLElement>('.pdf-text-layer [data-pdf-text-start]'))
      .filter((span) => range.intersectsNode(span))
  }

  private regionsForAnchor(anchor: string): PdfRegionAnchor[] | null {
    const region = parsePdfRegionAnchor(anchor, this.pages.length)
    return region ? [region] : parseOcrRegionAnchor(anchor, this.pages.length)
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
      const regions = this.regionsForAnchor(anchor)
      if (regions) {
        this.persistentRegionElements.push(...regions.flatMap((region) => this.createRegionOverlay(region, 'is-persistent') ?? []))
        continue
      }
      const parsed = parsePdfTextAnchor(anchor, this.pages.length)
      if (!parsed || this.pages[parsed.pageNumber - 1]?.layerScale == null) continue
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

  private setSelection(selection: ReaderSource | null): void {
    this.selection = selection
    this.callbacks.onSelectionChanged?.(selection)
  }

  private resetDocument(): void {
    this.documentRevision += 1
    this.searchRevision += 1
    this.document.removeEventListener('selectionchange', this.handleSelectionChange)
    this.documentElement?.removeEventListener('pointerdown', this.handleRegionPointerDown)
    this.document.removeEventListener('pointermove', this.handleRegionPointerMove)
    this.document.removeEventListener('pointerup', this.handleRegionPointerUp)
    this.document.removeEventListener('pointercancel', this.handleRegionPointerCancel)
    this.documentElement?.removeEventListener('pointerdown', this.handlePanPointerDown)
    this.document.removeEventListener('pointermove', this.handlePanPointerMove)
    this.document.removeEventListener('pointerup', this.handlePanPointerUp)
    this.document.removeEventListener('pointercancel', this.handlePanPointerCancel)
    this.panDrag = null
    this.panable = false
    this.host.removeEventListener('scroll', this.handleScroll)
    this.observer?.disconnect()
    this.resizeObserver?.disconnect()
    this.observer = null
    this.resizeObserver = null
    this.nearbyPages.clear()
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
    this.cancelOcrDrag()
    this.ocrPages.clear()
    this.preparedOcrRevision = null
    this.toolbarLabels.length = 0
    this.clearRegionDraft()
    this.activeRegionElement?.remove()
    this.activeRegionElement = null
    this.clearTemporaryHighlight()
    this.clearPersistentHighlights()
    for (const page of this.pages) {
      page.renderRevision += 1
      page.renderTask?.cancel()
      page.textLayer?.cancel()
      page.textIndex = null
    }
    for (const page of this.canvasCache.keys()) this.releaseCanvas(page)
    void this.loadingTask?.destroy().catch(() => undefined)
    this.loadingTask = null
    this.pdfDocument = null
    this.pdfjs = null
    this.pages = []
    this.contextLengths = new WeakMap()
    this.pageIndexHint = 0
    this.root = null
    this.documentElement = null
    this.capabilityBanner = null
    this.highlightStyleElement = null
    this.regionMode = false
    this.imageRegionMode = false
    this.regionButton = null
    this.imageRegionButton = null
    this.fitWidthButton = null
    this.zoomFactor = 1
    this.zoomMode = 'fit-width'
    this.outlineIndex = new PdfOutlineIndex([])
    this.selection = null
    this.programmaticReason = null
    this.programmaticScrollTop = null
    this.host.replaceChildren()
  }
}

interface HighlightRegistry {
  delete(name: string): void
  set(name: string, value: unknown): void
}
