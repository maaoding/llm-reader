// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { EpubReaderAdapter } from '../../src/renderer/src/readers/epub-reader'
import { buildBoundedPassages } from '../../src/renderer/src/readers/context'

const mocks = vi.hoisted(() => ({ epub: vi.fn() }))
vi.mock('epubjs', () => ({ default: mocks.epub }))
const adapters: EpubReaderAdapter[] = []
afterEach(() => {
  adapters.splice(0).forEach((adapter) => adapter.destroy())
  document.getSelection()?.removeAllRanges()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

async function setup(texts: string[]) {
  const host = document.createElement('div'), content = document.createElement('section')
  document.body.append(host, content)
  const paragraphs = texts.map((text) => {
    const element = document.createElement('p'); element.textContent = text; content.append(element)
    return element
  })
  const handlers = new Map<string, (...values: unknown[]) => void>()
  const cfiFromRange = vi.fn((range: Range) => `epubcfi(/6/2!/4/2,/1:${range.startOffset},/1:${range.endOffset})`)
  const rendition = {
    hooks: { content: { register: vi.fn() } },
    on: vi.fn((event: string, handler: (...values: unknown[]) => void) => handlers.set(event, handler)),
    off: vi.fn(), display: vi.fn().mockResolvedValue(undefined), annotations: { highlight: vi.fn(), remove: vi.fn() }
  }
  mocks.epub.mockReturnValue({
    ready: Promise.resolve(), renderTo: () => rendition,
    loaded: {
      metadata: Promise.resolve({ title: '合成 EPUB 端点', creator: '' }),
      navigation: Promise.resolve({ toc: [{ id: 'chapter', label: '本章', href: 'chapter.xhtml' }] }),
      spine: Promise.resolve([{ index: 0 }])
    },
    spine: { hooks: { content: { list: () => [], deregister: vi.fn() } }, get: () => ({ href: 'chapter.xhtml' }) },
    locations: { generate: async () => [] }, destroy: vi.fn()
  })
  const adapter = new EpubReaderAdapter(host, { bookId: 'epub-selection-fixture' })
  adapters.push(adapter)
  await adapter.open(new Uint8Array([1]))
  return {
    adapter, content, paragraphs, cfiFromRange,
    select: (range: Range) => {
      const selection = document.getSelection()!
      selection.removeAllRanges(); selection.addRange(range)
      handlers.get('selected')!('epubcfi(/6/2!/4/2/1:0,/1:0,/1:1)', { content, window, sectionIndex: 0, cfiFromRange })
    }
  }
}

it('locates native endpoints deep in a 5,000-paragraph chapter without scanning every paragraph', async () => {
  const { adapter, paragraphs, select } = await setup(Array<string>(5_000).fill('甲😀'.repeat(500)))
  const node = paragraphs.at(-1)!.firstChild!, range = document.createRange()
  range.setStart(node, 750); range.setEnd(node, 751)
  const contains = vi.spyOn(Node.prototype, 'contains'), compare = vi.spyOn(Node.prototype, 'compareDocumentPosition')
  select(range)
  const checks = contains.mock.calls.filter(([target]) => target === node).length + compare.mock.calls.filter(([target]) => target === node).length
  const selected = adapter.getSelection()!
  expect(selected.quote).toBe('甲')
  expect(selected.passages.at(-1)!.id).toBe('P5000')
  expect(selected.passages.reduce((sum, passage) => sum + Array.from(passage.text).length, 0)).toBeLessThanOrEqual(6_000)
  expect(checks).toBeLessThanOrEqual(32)
})

it('retains range-intersection fallback when both endpoints belong to the chapter container', async () => {
  const texts = Array.from({ length: 8 }, (_, index) => `${index} ${'甲😀'.repeat(500)}`)
  const { adapter, content, select } = await setup(texts)
  const range = document.createRange()
  range.setStart(content, 4); range.setEnd(content, 6)
  const quote = range.toString().trim()
  select(range)
  const expected = buildBoundedPassages(texts.map((text, index) => ({
    id: `P${index + 1}`, text, anchorForSlice: () => ''
  })), { startBlock: 4, startOffset: 0, endBlock: 5, endOffset: Array.from(texts[5]).length })
  expect(adapter.getSelection()!.quote).toBe(quote)
  expect(adapter.getSelection()!.passages.map(({ id, text }) => ({ id, text })))
    .toEqual(expected.map(({ id, text }) => ({ id, text })))
})

it('preserves filtered passage IDs and Unicode endpoints when empty paragraphs are skipped', async () => {
  const { adapter, paragraphs, cfiFromRange, select } = await setup([' \n ', '甲😀', '', '𠮷乙'])
  const node = paragraphs[3].firstChild!, range = document.createRange()
  range.setStart(node, 0); range.setEnd(node, 2)
  select(range)
  const selected = adapter.getSelection()!
  expect(selected.quote).toBe('𠮷')
  expect(selected.passages.map(({ id, text }) => ({ id, text }))).toEqual([{ id: 'P1', text: '甲😀' }, { id: 'P2', text: '𠮷乙' }])
  const ranges = cfiFromRange.mock.calls.map(([native]) => native as unknown as Range)
  expect(ranges.map((native) => native.toString())).toEqual(['甲😀', '𠮷乙'])
})
