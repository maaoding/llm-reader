// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { PdfReaderAdapter } from '../../src/renderer/src/readers/pdf-reader'
import type { PdfSectionState } from '../../src/renderer/src/readers/pdf-navigation'

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
})

function setup() {
  const content = { items: [{ str: 'Synthetic page text' }] }
  const text = deferred<typeof content>()
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({
      width: 500 * scale, height: 700 * scale, scale,
      convertToViewportPoint: (x: number, y: number) => [x * scale, (700 - y) * scale]
    }),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
    // The first read indexes text; the second read belongs to page rendering.
    getTextContent: vi.fn().mockResolvedValue(content).mockResolvedValueOnce(content).mockReturnValueOnce(text.promise),
    getAnnotations: vi.fn().mockResolvedValue([])
  }
  const getOutline = vi.fn().mockResolvedValue([])
  pdf.getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: 1, getPage: async () => page, getOutline, getMetadata: async () => ({ info: {} }) }),
    destroy: async () => undefined
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  const host = document.createElement('div')
  Object.defineProperty(host, 'clientWidth', { value: 500 })
  document.body.append(host)
  const adapter = new PdfReaderAdapter(host, { bookId: 'render-race' })
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
  expect(section(0.25)).toEqual({ title: '全文', href: 'pdfpos:1:0', progress: 0.25 })
  adapter.destroy()
  expect(Reflect.get(adapter, 'outlineIndex').length).toBe(0)
})
