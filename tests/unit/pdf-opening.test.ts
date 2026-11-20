// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { PdfReaderAdapter } from '../../src/renderer/src/readers/pdf-reader'
import type { ReaderSelectionDraft } from '../../src/renderer/src/readers/types'

const pdf = vi.hoisted(() => ({ getDocument: vi.fn() }))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  AnnotationMode: { DISABLE: 0 },
  getDocument: pdf.getDocument,
  TextLayer: class {
    textDivs: HTMLElement[] = []
    textContentItemsStr: string[] = []
    constructor(private options: { container: HTMLElement; textContentSource: { items: { str: string }[] } }) {}
    async render() {
      for (const { str } of this.options.textContentSource.items) {
        const span = document.createElement('span')
        span.textContent = str
        this.options.container.append(span)
        this.textDivs.push(span)
        this.textContentItemsStr.push(str)
      }
    }
    cancel() {}
  }
}))

const adapters: PdfReaderAdapter[] = []
afterEach(() => {
  for (const adapter of adapters.splice(0)) adapter.destroy()
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function fixture(count = 3, attachedHostWidth = 600, onSelectionDraftChanged?: (draft: ReaderSelectionDraft | null) => void) {
  const sizes = [[600, 800], [800, 600], [400, 900]]
  const content = { items: [{ str: 'Opening fixture' }] }
  const pages = Array.from({ length: count }, (_, index) => {
    const [width, height] = sizes[index % sizes.length]
    return {
      getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: width * scale, height: height * scale, scale })),
      render: () => ({ promise: Promise.resolve(), cancel() {} }),
      getTextContent: vi.fn(async () => content),
      getAnnotations: async () => []
    }
  })
  const getPage = vi.fn(async (number: number) => pages[number - 1])
  const documentProxy = { numPages: count, getPage, getOutline: async () => [], getMetadata: async () => ({ info: {} }) }
  const loadingTask = { promise: Promise.resolve(documentProxy), destroy: vi.fn(async () => undefined) }
  pdf.getDocument.mockReturnValue(loadingTask)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {} } as unknown as CanvasRenderingContext2D)
  const css = document.createElement('style')
  css.textContent = '.pdf-document { padding-left: 16px; padding-right: 24px }'
  const host = document.createElement('div')
  let widthReads = 0
  Object.defineProperty(host, 'clientWidth', { get: () => {
    widthReads++
    return host.querySelector('.pdf-page') ? attachedHostWidth : 600
  } })
  document.body.append(css, host)
  const styles = vi.spyOn(window, 'getComputedStyle')
  const adapter = new PdfReaderAdapter(host, { bookId: 'opening-fixture', onSelectionDraftChanged })
  adapters.push(adapter)
  return { host, adapter, pages, sizes, content, getPage, documentProxy, loadingTask,
    widthReads: () => widthReads,
    styleReads: () => styles.mock.calls.filter(([element]) => element.classList.contains('pdf-document')).length }
}

function assertPageSizes(host: HTMLElement, sizes: number[][], availableWidth: number) {
  host.querySelectorAll<HTMLElement>('.pdf-page').forEach((page, index) => {
    const [width, height] = sizes[index % sizes.length]
    expect(Number.parseFloat(page.style.width)).toBeCloseTo(availableWidth)
    expect(Number.parseFloat(page.style.height)).toBeCloseTo(availableWidth * height / width)
    expect(page.querySelector('canvas')!.style.height).toBe(page.style.height)
  })
}

it('bounds initial layout reads for a long PDF while keeping every page aspect ratio', async () => {
  const test = fixture(200)
  await test.adapter.open(new Uint8Array([1]))
  expect(test.host.querySelectorAll('.pdf-page')).toHaveLength(200)
  expect(test.widthReads()).toBeLessThanOrEqual(6)
  expect(test.styleReads()).toBeLessThanOrEqual(4)
  assertPageSizes(test.host, test.sizes, 560)
})

it('refits every placeholder if attaching pages introduces a classic scrollbar', async () => {
  const test = fixture(30, 580)
  await test.adapter.open(new Uint8Array([1]))
  expect(test.widthReads()).toBeLessThanOrEqual(6)
  assertPageSizes(test.host, test.sizes, 540)
})

it('does not start a PDF worker after an opening reader is immediately destroyed', async () => {
  const test = fixture()
  const opening = test.adapter.open(new Uint8Array([1]))
  const aborted = expect(opening).rejects.toMatchObject({ name: 'AbortError' })
  test.adapter.destroy()
  test.host.textContent = 'Replacement reader'
  await aborted
  expect(pdf.getDocument).not.toHaveBeenCalled()
  expect(test.host.textContent).toBe('Replacement reader')
})

it('ignores a document that finishes loading after its reader was destroyed', async () => {
  const test = fixture()
  const pending = deferred<typeof test.documentProxy>()
  pdf.getDocument.mockReturnValue({ ...test.loadingTask, promise: pending.promise })
  const opening = test.adapter.open(new Uint8Array([1]))
  const aborted = expect(opening).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(pdf.getDocument).toHaveBeenCalledOnce())
  test.adapter.destroy()
  test.host.textContent = 'Replacement reader'
  pending.resolve(test.documentProxy)
  await aborted
  expect(test.getPage).not.toHaveBeenCalled()
  expect(test.host.textContent).toBe('Replacement reader')
})

it('stops preparing further pages after a reader is replaced during getPage', async () => {
  const test = fixture(34)
  const pending = deferred<(typeof test.pages)[number]>()
  test.getPage.mockImplementation(async (number) => number === 2 ? pending.promise : test.pages[number - 1])
  const opening = test.adapter.open(new Uint8Array([1]))
  const aborted = expect(opening).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(test.getPage).toHaveBeenCalledWith(16))
  const issuedBeforeReplacement = test.getPage.mock.calls.length
  expect(issuedBeforeReplacement).toBeLessThanOrEqual(16)
  test.adapter.destroy()
  test.host.textContent = 'Replacement reader'
  pending.resolve(test.pages[1])
  await aborted
  expect(test.getPage).toHaveBeenCalledTimes(issuedBeforeReplacement)
  expect(test.pages[1].getViewport).not.toHaveBeenCalled()
  expect(test.host.textContent).toBe('Replacement reader')
})

it('places pages in document order when an earlier worker reply is delayed', async () => {
  const test = fixture(4)
  const pending = deferred<(typeof test.pages)[number]>()
  test.getPage.mockImplementation(async (number) => number === 2 ? pending.promise : test.pages[number - 1])
  const opening = test.adapter.open(new Uint8Array([1]))
  try {
    await vi.waitFor(() => expect(test.getPage).toHaveBeenCalledWith(4))
  } finally {
    pending.resolve(test.pages[1])
    await opening
  }
  expect([...test.host.querySelectorAll<HTMLElement>('.pdf-page')].map((page) => page.dataset.pageNumber)).toEqual(['1', '2', '3', '4'])
  assertPageSizes(test.host, test.sizes, 560)
})

it('returns the first 200 matches while a superseded search is still waiting for a later page', async () => {
  const test = fixture(4)
  test.pages[0].getTextContent.mockResolvedValue({ items: [{ str: '😀 ' + 'Needle '.repeat(199) }] })
  test.pages[1].getTextContent.mockResolvedValue({ items: [{ str: 'Needle Needle' }] })
  const pending = deferred<typeof test.content>()
  test.pages[2].getTextContent.mockReturnValueOnce(pending.promise)
  await test.adapter.open(new Uint8Array([1]))
  await vi.waitFor(() => expect(test.pages[2].getTextContent).toHaveBeenCalledOnce())

  const superseded = test.adapter.search('later match')
  try {
    const results = await test.adapter.search('needle')
    expect(results).toHaveLength(200)
    expect(results[0].anchor).toBe('pdf:1:2:8')
    expect(results.at(-1)?.anchor).toBe('pdf:2:0:6')
    expect(test.pages[2].getTextContent).toHaveBeenCalledOnce()
    expect(test.pages[3].getTextContent).not.toHaveBeenCalled()
  } finally {
    pending.resolve({ items: [{ str: 'later match' }] })
  }
  await expect(superseded).resolves.toEqual([])
})

it('shares in-flight reads with background indexing and finds a match on the last page', async () => {
  const test = fixture(3)
  const pending = deferred<typeof test.content>()
  test.pages[1].getTextContent.mockReturnValueOnce(pending.promise)
  test.pages[2].getTextContent.mockResolvedValue({ items: [{ str: 'Late match' }] })
  await test.adapter.open(new Uint8Array([1]))
  await vi.waitFor(() => expect(test.pages[1].getTextContent).toHaveBeenCalledOnce())
  const search = test.adapter.search('late match')
  pending.resolve(test.content)
  await expect(search).resolves.toEqual([expect.objectContaining({ anchor: 'pdf:3:0:10' })])
  expect(test.pages[1].getTextContent).toHaveBeenCalledOnce()
  expect(test.pages[2].getTextContent).toHaveBeenCalledOnce()
  await expect(test.adapter.search('a term absent from the document')).resolves.toEqual([])
})

it.each(['resolve', 'reject'] as const)('keeps only the latest region draft while a neighboring text read can %s', async (outcome) => {
  const onDraft = vi.fn<(draft: ReaderSelectionDraft | null) => void>()
  const test = fixture(6, 600, onDraft)
  const background = deferred<typeof test.content>()
  const neighbor = deferred<typeof test.content>()
  test.pages[1].getTextContent.mockReturnValueOnce(background.promise)
  test.pages[2].getTextContent.mockReturnValueOnce(neighbor.promise)
  test.pages[3].getTextContent.mockResolvedValue({ items: [{ str: 'Target page quote.' }] })
  test.pages[4].getTextContent.mockResolvedValue({ items: [{ str: 'Following page text.' }] })
  await test.adapter.open(new Uint8Array([1]), 'pdfpos:4:0')
  await vi.waitFor(() => expect(test.pages[1].getTextContent).toHaveBeenCalledOnce())
  const sheet = test.host.querySelector<HTMLElement>('.pdf-page[data-page-number="4"]')!
  const span = sheet.querySelector<HTMLElement>('.pdf-text-layer span')!
  const button = test.host.querySelector<HTMLButtonElement>('[data-testid="pdf-region-select"]')!
  vi.spyOn(sheet, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 600, 800))
  vi.spyOn(span, 'getBoundingClientRect').mockReturnValue(new DOMRect(60, 80, 200, 20))
  const draw = () => {
    sheet.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, clientX: 48, clientY: 72 }))
    sheet.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0, clientX: 272, clientY: 106 }))
  }
  const drafts = () => onDraft.mock.calls.flatMap(([draft]) => draft ? [draft] : [])

  try {
    button.click()
    draw()
    expect(test.pages[2].getTextContent).toHaveBeenCalledOnce()
    expect(drafts()).toHaveLength(0)
    test.adapter.clearSelection()
    expect(sheet.querySelector('[data-testid="pdf-region-draft"]')).toBeNull()

    button.click()
    draw()
    if (outcome === 'resolve') neighbor.resolve({ items: [{ str: 'Previous page text.' }] })
    else neighbor.reject(new Error('Neighbor text failed to load'))
    await vi.waitFor(() => expect(drafts()).toHaveLength(1))
    expect(test.pages[2].getTextContent).toHaveBeenCalledOnce()
    expect(test.pages[5].getTextContent).not.toHaveBeenCalled()
    const [draft] = drafts()
    expect(draft.quote).toBe('Target page quote.')
    draft.confirm('Corrected quote.')
    expect(sheet.querySelector('[data-testid="pdf-region-selection"]')).not.toBeNull()
    expect(test.adapter.getSelection()).toMatchObject({
      quote: 'Corrected quote.',
      anchor: expect.stringMatching(/^pdfrect:4:/u),
      passages: [
        ...(outcome === 'resolve' ? [{ id: 'page-3', text: 'Previous page text.' }] : []),
        { id: 'page-4', text: 'Target page quote.' },
        { id: 'page-5', text: 'Following page text.' }
      ]
    })
  } finally {
    test.adapter.destroy()
    neighbor.resolve(test.content)
    background.resolve(test.content)
  }
})

it.each(['resolve', 'reject'] as const)('stops text indexing when a destroyed worker later returns %s', async (outcome) => {
  const test = fixture()
  const pending = deferred<typeof test.content>()
  test.pages[1].getTextContent.mockReturnValueOnce(pending.promise)
  await test.adapter.open(new Uint8Array([1]))
  await vi.waitFor(() => expect(test.pages[1].getTextContent).toHaveBeenCalledOnce())
  const stoppedSearch = expect(test.adapter.search('missing')).resolves.toEqual([])
  test.adapter.destroy()
  test.host.textContent = 'Replacement reader'
  if (outcome === 'resolve') pending.resolve(test.content)
  else pending.reject(new Error('Worker was destroyed'))
  await stoppedSearch
  expect(test.pages[2].getTextContent).not.toHaveBeenCalled()
  expect(test.host.textContent).toBe('Replacement reader')
})
