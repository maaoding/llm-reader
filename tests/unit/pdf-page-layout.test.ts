// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { PdfReaderAdapter } from '../../src/renderer/src/readers/pdf-reader'

const pdf = vi.hoisted(() => ({ getDocument: vi.fn() }))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  AnnotationMode: { DISABLE: 0 },
  getDocument: pdf.getDocument,
  TextLayer: class {
    textDivs: HTMLElement[] = []
    textContentItemsStr: string[] = []
    async render() {}
    cancel() {}
  }
}))

let adapter: PdfReaderAdapter | undefined
afterEach(() => {
  adapter?.destroy()
  adapter = undefined
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

async function openPages(count: number) {
  const sizes = [[500, 700], [800, 600], [300, 900]]
  const pages = Array.from({ length: count }, (_, index) => {
    const [width, height] = sizes[index % sizes.length]
    return {
      getViewport: ({ scale }: { scale: number }) => ({ width: width * scale, height: height * scale, scale }),
      render: () => ({ promise: Promise.resolve(), cancel() {} }),
      getTextContent: async () => ({ items: [{ str: 'Layout fixture' }] }),
      getAnnotations: async () => []
    }
  })
  pdf.getDocument.mockReturnValue({
    promise: Promise.resolve({
      numPages: count, getPage: async (page: number) => pages[page - 1],
      getOutline: async () => [], getMetadata: async () => ({ info: {} })
    }),
    destroy: async () => undefined
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  let hostWidth = 600, widthReads = 0
  const host = document.createElement('div')
  Object.defineProperty(host, 'clientWidth', { get: () => { widthReads++; return hostWidth } })
  document.body.append(host)
  adapter = new PdfReaderAdapter(host, { bookId: 'page-layout' })
  await adapter.open(new Uint8Array([1]))
  const root = host.querySelector<HTMLElement>('.pdf-document')!
  root.style.padding = '0 24px'
  const styles = vi.spyOn(window, 'getComputedStyle')
  return {
    host, root, sizes,
    zoom: () => {
      widthReads = 0
      styles.mockClear()
      host.querySelector<HTMLButtonElement>('button[aria-label="放大"]')!.click()
      return { widths: widthReads, styles: styles.mock.calls.filter(([element]) => element === root).length }
    },
    resize: (width: number) => { hostWidth = width }
  }
}

it('bounds layout reads independently of page count when zooming a long PDF', async () => {
  const fixture = await openPages(200)
  expect(fixture.zoom()).toEqual({ widths: 1, styles: 1 })
})

it('keeps mixed page aspect ratios and measures new widths and padding on the next zoom', async () => {
  const fixture = await openPages(3)
  fixture.zoom()
  const assertSizes = (availableWidth: number, factor: number) => {
    fixture.host.querySelectorAll<HTMLElement>('.pdf-page').forEach((page, index) => {
      const [baseWidth, baseHeight] = fixture.sizes[index]
      expect(Number.parseFloat(page.style.width)).toBeCloseTo(availableWidth * factor)
      expect(Number.parseFloat(page.style.height)).toBeCloseTo(baseHeight / baseWidth * availableWidth * factor)
      const canvas = page.querySelector('canvas')!
      expect(canvas.style.width).toBe(page.style.width)
      expect(canvas.style.height).toBe(page.style.height)
    })
  }
  assertSizes(552, 1.15)
  fixture.resize(840)
  fixture.root.style.padding = '0 16px 0 32px'
  expect(fixture.zoom()).toEqual({ widths: 1, styles: 1 })
  assertSizes(792, 1.3)
})
