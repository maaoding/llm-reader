// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { PreparedOcrPage } from '../../src/shared/contracts'
import { PdfReaderAdapter } from '../../src/renderer/src/readers/pdf-reader'
import type { PdfSectionState } from '../../src/renderer/src/readers/pdf-navigation'
import type { ReaderCallbacks } from '../../src/renderer/src/readers/types'

const pdf = vi.hoisted(() => ({ getDocument: vi.fn() }))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  AnnotationMode: { DISABLE: 0 },
  getDocument: pdf.getDocument,
  TextLayer: class {
    textDivs: HTMLElement[] = []
    textContentItemsStr: string[] = []
    constructor(private options: { container: HTMLElement; viewport: { scale: number } }) {}
    async render() {
      const span = document.createElement('span')
      span.textContent = 'Synthetic page text'
      span.dataset.scale = String(this.options.viewport.scale)
      this.options.container.append(span)
      this.textDivs.push(span)
      this.textContentItemsStr.push(span.textContent)
    }
    cancel() {}
  }
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const adapters: PdfReaderAdapter[] = []
afterEach(() => {
  for (const adapter of adapters.splice(0)) adapter.destroy()
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function setup({ numPages = 1, hostWidth = 500, deferText = true, readPreparedOcrPage }: {
  numPages?: number
  hostWidth?: number
  deferText?: boolean
  readPreparedOcrPage?: ReaderCallbacks['readPreparedOcrPage']
} = {}) {
  const content = { items: [{ str: 'Synthetic page text' }] }
  const text = deferred<typeof content>()
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({
      width: 500 * scale, height: 700 * scale, scale,
      convertToViewportPoint: (x: number, y: number) => [x * scale, (700 - y) * scale]
    }),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
    getTextContent: vi.fn().mockResolvedValue(content),
    getAnnotations: vi.fn().mockResolvedValue([])
  }
  const getOutline = vi.fn().mockResolvedValue([])
  // The first read indexes text; the second read belongs to page rendering.
  if (deferText) page.getTextContent.mockResolvedValueOnce(content).mockReturnValueOnce(text.promise)
  pdf.getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages, getPage: async () => page, getOutline, getMetadata: async () => ({ info: {} }) }),
    destroy: async () => undefined
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  const host = document.createElement('div')
  Object.defineProperty(host, 'clientWidth', { value: hostWidth })
  document.body.append(host)
  const adapter = new PdfReaderAdapter(host, { bookId: 'render-race', readPreparedOcrPage })
  adapters.push(adapter)
  return { adapter, host, page, getOutline, finishText: () => text.resolve(content) }
}

it('renders the latest zoom after text from an invalidated render arrives', async () => {
  const { adapter, host, page, finishText } = setup()
  const opening = adapter.open(new Uint8Array([1]))
  await vi.waitFor(() => expect(page.getTextContent).toHaveBeenCalledTimes(2))
  host.querySelector<HTMLButtonElement>('button[aria-label="放大"]')!.click()
  finishText()
  await opening
  await vi.waitFor(() => {
    const spans = host.querySelectorAll<HTMLElement>('.pdf-text-layer [data-pdf-text-start]')
    expect(spans).toHaveLength(1)
    expect(spans[0].dataset.scale).toBe('1.15')
  })
})

it('does not append stale text after a newer zoom has already rendered', async () => {
  const { adapter, host, page, finishText } = setup()
  const opening = adapter.open(new Uint8Array([1]))
  await vi.waitFor(() => expect(page.getTextContent).toHaveBeenCalledTimes(2))
  const zoom = host.querySelector<HTMLButtonElement>('button[aria-label="放大"]')!
  zoom.click()
  zoom.click()
  await vi.waitFor(() => expect(host.querySelector('.pdf-text-layer span')?.getAttribute('data-scale')).toBe('1.3'))
  finishText()
  await opening
  const spans = host.querySelectorAll<HTMLElement>('.pdf-text-layer [data-pdf-text-start]')
  expect(spans).toHaveLength(1)
  expect(spans[0].dataset.scale).toBe('1.3')
})

it('rebuilds cleared text when the old render finishes fetching annotations after zoom', async () => {
  const { adapter, host, page, finishText } = setup()
  const annotations = deferred<never[]>()
  page.getAnnotations.mockReturnValueOnce(annotations.promise)
  finishText()
  const opening = adapter.open(new Uint8Array([1]))
  await vi.waitFor(() => expect(page.getAnnotations).toHaveBeenCalledOnce())
  host.querySelector<HTMLButtonElement>('button[aria-label="放大"]')!.click()
  expect(host.querySelectorAll('.pdf-text-layer span')).toHaveLength(0)
  annotations.resolve([])
  await opening
  await vi.waitFor(() => {
    const spans = host.querySelectorAll<HTMLElement>('.pdf-text-layer [data-pdf-text-start]')
    expect(spans).toHaveLength(1)
    expect(spans[0].dataset.scale).toBe('1.15')
    expect(host.querySelector('.pdf-page')?.getAttribute('aria-busy')).toBe('false')
  })
})

it('reuses text anchor positions and rebuilds them against the zoomed text layer', async () => {
  const { adapter, host, finishText } = setup()
  finishText()
  await adapter.open(new Uint8Array([1]))
  const layer = host.querySelector<HTMLElement>('.pdf-text-layer')!
  await adapter.highlight('pdf:1:1:5')
  const oldSpan = layer.querySelector<HTMLElement>('[data-pdf-text-start]')!
  const query = vi.spyOn(layer, 'querySelectorAll')
  await adapter.highlight('pdf:1:2:6')
  expect(query).not.toHaveBeenCalled()
  host.querySelector<HTMLButtonElement>('button[aria-label="放大"]')!.click()
  await vi.waitFor(() => expect(layer.querySelector('span')?.getAttribute('data-scale')).toBe('1.15'))
  await adapter.highlight('pdf:1:1:5')
  const current = layer.querySelector<HTMLElement>('[data-pdf-text-start]')!
  expect(current).not.toBe(oldSpan)
  expect(oldSpan.isConnected).toBe(false)
  expect(current.classList.contains('pdf-temporary-highlight')).toBe(true)
})

it('replaces prepared outline metadata on reopen and clears it after outline failure or close', async () => {
  const { adapter, getOutline, finishText } = setup()
  const outline = (title: string) => [{ title, dest: [0, { name: 'FitH' }, 700], items: [
    { title: `${title} 小节`, dest: [0, { name: 'FitH' }, 525], items: [] }
  ] }]
  const section = (fraction: number): PdfSectionState => Reflect.get(adapter, 'sectionAt').call(adapter, 1, fraction)
  finishText()
  getOutline.mockResolvedValue(outline('原书'))
  await adapter.open(new Uint8Array([1]))
  expect(section(0.1)).toEqual({ title: '原书', href: 'pdfpos:1:0', progress: 0.4 })
  expect(section(0.25)).toEqual({ title: '原书 小节', href: 'pdfpos:1:0.25', progress: 0 })
  getOutline.mockResolvedValue(outline('新书'))
  await adapter.open(new Uint8Array([2]))
  expect(section(0.25)).toEqual({ title: '新书 小节', href: 'pdfpos:1:0.25', progress: 0 })
  getOutline.mockRejectedValueOnce(new Error('Synthetic unreadable outline'))
  await adapter.open(new Uint8Array([3]))
  expect(section(0.25)).toEqual({ title: '全文', titleCopy: { key: 'reader.pdfWholeDocument' }, href: 'pdfpos:1:0', progress: 0.25 })
  adapter.destroy()
  expect(Reflect.get(adapter, 'outlineIndex').length).toBe(0)
})

it('loads OCR word positions when revisiting a page rendered before OCR finished', async () => {
  const readPreparedOcrPage = vi.fn(async (pageNumber: number): Promise<PreparedOcrPage> => ({
    status: 'ready', pageNumber, pageCount: 2, revision: 'ocr-ready', text: 'Scan',
    wordLines: [[{ start: 0, end: 4, left: 0.1, right: 0.3, top: 0.1, bottom: 0.2 }]]
  }))
  const { adapter, host, page } = setup({ numPages: 2, deferText: false, readPreparedOcrPage })
  page.getTextContent.mockResolvedValue({ items: [] })
  await adapter.open(new Uint8Array([1]))
  await adapter.goTo('pdfpos:2:0')
  const secondPage = host.querySelector('.pdf-page[data-page-number="2"]')!
  expect(secondPage.hasAttribute('data-ocr-selectable')).toBe(false)
  adapter.setPreparedOcrRevision('ocr-ready')
  expect(readPreparedOcrPage).not.toHaveBeenCalledWith(2)

  await adapter.goTo('pdfpos:2:0')
  expect(readPreparedOcrPage).toHaveBeenCalledWith(2)
  expect(secondPage.getAttribute('data-ocr-selectable')).toBe('true')
  expect(page.render).toHaveBeenCalledTimes(2)
})

it('reclaims distant canvas pixels and repaints them without rebuilding text or links', async () => {
  let deliver!: (entries: Pick<IntersectionObserverEntry, 'target' | 'isIntersecting'>[]) => void
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof deliver) { deliver = callback }
    observe() {}
    disconnect() {}
  })
  const { adapter, host, page } = setup({ numPages: 3, hostWidth: 2048, deferText: false })
  await adapter.open(new Uint8Array([1]))
  const sheets = [...host.querySelectorAll<HTMLElement>('.pdf-page')]
  const canvases = sheets.map((sheet) => sheet.querySelector('canvas')!)
  const intersect = (...entries: [number, boolean][]) => {
    deliver(entries.map(([index, isIntersecting]) => ({ target: sheets[index], isIntersecting })))
  }
  intersect([0, true], [1, true], [2, true])
  await vi.waitFor(() => {
    expect(canvases.map((canvas) => canvas.width)).toEqual([2048, 2048, 2048])
    expect(sheets.every((sheet) => sheet.getAttribute('aria-busy') === 'false')).toBe(true)
  })
  const secondText = sheets[1].querySelector('.pdf-text-layer span')
  expect(secondText).not.toBeNull()
  const secondHeight = sheets[1].style.height
  const dimensions = [canvases[1].width, canvases[1].height]

  // Three nearby bitmaps exceed the budget. Reclaim the page that left.
  intersect([1, false])
  expect(canvases.map((canvas) => canvas.width)).toEqual([2048, 0, 2048])
  expect(canvases[1].height).toBe(0)
  expect(sheets[1].style.height).toBe(secondHeight)
  await adapter.setHighlights([{ anchor: 'pdf:2:0:9' }])
  expect(secondText?.classList.contains('pdf-persistent-highlight')).toBe(true)
  expect(canvases[1].width).toBe(0)
  expect(page.render).toHaveBeenCalledTimes(3)

  // Explicit navigation also repaints a destination before it enters view.
  intersect([0, false], [2, false])
  await adapter.goTo('pdfpos:2:0.25')
  expect([canvases[1].width, canvases[1].height]).toEqual(dimensions)
  expect(sheets[1].querySelector('.pdf-text-layer span')).toBe(secondText)
  expect(secondText?.classList.contains('pdf-persistent-highlight')).toBe(true)
  expect(page.render).toHaveBeenCalledTimes(4)
  expect(page.getAnnotations).toHaveBeenCalledTimes(3)
  expect(page.getTextContent).toHaveBeenCalledTimes(6)

  adapter.destroy()
  expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true)
})
