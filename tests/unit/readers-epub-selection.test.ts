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
  vi.unstubAllGlobals()
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
    select: (range: Range, chapterContent = content) => {
      const selection = document.getSelection()!
      selection.removeAllRanges(); selection.addRange(range)
      handlers.get('selected')!('epubcfi(/6/2!/4/2/1:0,/1:0,/1:1)', { content: chapterContent, window, sectionIndex: 0, cfiFromRange })
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

  const readText = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')!.get!
  let textReads = 0
  for (const element of paragraphs) {
    Object.defineProperty(element, 'textContent', { configurable: true, get: () => { textReads++; return readText.call(element) } })
  }
  try {
    // Appearance changes do not change source text, order or passage IDs.
    paragraphs[0].className = 'changed-paper-theme'
    select(range)
    expect(adapter.getSelection()).toEqual(selected)
    expect(textReads).toBeLessThanOrEqual(13)
  } finally {
    for (const element of paragraphs) Reflect.deleteProperty(element, 'textContent')
  }
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

it('refreshes empty paragraphs and Unicode whitespace after synchronous character edits', async () => {
  const { adapter, paragraphs, cfiFromRange, select } = await setup([' \n ', '甲😀', '𠮷乙'])
  const node = paragraphs[2].firstChild as Text
  const range = document.createRange()
  range.setStart(node, 0); range.setEnd(node, 2)
  select(range)
  expect(adapter.getSelection()!.passages.map(({ id }) => id)).toEqual(['P1', 'P2'])

  ;(paragraphs[0].firstChild as Text).data = ' 首😀 '
  node.data = ' \u3000𠮷乙 '
  range.setStart(node, 2); range.setEnd(node, 4)
  cfiFromRange.mockClear()
  // No await: the source must refresh before MutationObserver delivers its callback.
  select(range)
  expect(adapter.getSelection()!.quote).toBe('𠮷')
  expect(adapter.getSelection()!.passages.map(({ id, text }) => ({ id, text }))).toEqual([
    { id: 'P1', text: '首😀' }, { id: 'P2', text: '甲😀' }, { id: 'P3', text: '𠮷乙' }
  ])
  expect(cfiFromRange.mock.calls.map(([native]) => native.toString())).toEqual(['首😀', '甲😀', '𠮷乙'])

  ;(paragraphs[0].firstChild as Text).data = ' \t '
  select(range)
  expect(adapter.getSelection()!.passages.map(({ id, text }) => ({ id, text }))).toEqual([
    { id: 'P1', text: '甲😀' }, { id: 'P2', text: '𠮷乙' }
  ])
})

it('uses current document order after paragraph insertions, removals and moves', async () => {
  const { adapter, content, paragraphs, select } = await setup(['甲😀', '𠮷乙', '终点'])
  const node = paragraphs[1].firstChild!, range = document.createRange()
  range.setStart(node, 0); range.setEnd(node, 2)
  select(range)
  const inserted = document.createElement('p')
  inserted.textContent = '新段'
  content.prepend(paragraphs[2])
  content.insertBefore(inserted, paragraphs[1])
  paragraphs[0].remove()
  select(range)
  expect(adapter.getSelection()!.passages.map(({ id, text }) => ({ id, text }))).toEqual([
    { id: 'P1', text: '终点' }, { id: 'P2', text: '新段' }, { id: 'P3', text: '𠮷乙' }
  ])
  expect(adapter.getSelection()!.quote).toBe('𠮷')
})

it('refreshes after an observer callback has already delivered a text mutation', async () => {
  const { adapter, paragraphs, select } = await setup(['甲😀', '𠮷乙'])
  const node = paragraphs[1].firstChild!, range = document.createRange()
  range.setStart(node, 0); range.setEnd(node, 2)
  select(range)
  paragraphs[0].textContent = '异步更新😀'
  await Promise.resolve()
  select(range)
  expect(adapter.getSelection()!.passages[0]).toMatchObject({ id: 'P1', text: '异步更新😀' })
})

it('releases chapter observers when switching roots, reopening or destroying the reader', async () => {
  const { adapter, content, paragraphs, select } = await setup(['甲😀'])
  const range = document.createRange()
  range.selectNodeContents(paragraphs[0])
  const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect')
  select(range)
  const other = document.createElement('section')
  other.innerHTML = '<p>另一章😀</p>'
  document.body.append(other)
  const second = document.createRange()
  second.selectNodeContents(other.firstChild!)
  select(second, other)
  expect(adapter.getSelection()!.passages[0]).toMatchObject({ id: 'P1', text: '另一章😀' })
  expect(disconnect).toHaveBeenCalledTimes(1)
  select(range, content)
  expect(adapter.getSelection()!.passages[0]).toMatchObject({ id: 'P1', text: '甲😀' })
  expect(disconnect).toHaveBeenCalledTimes(2)
  await adapter.open(new Uint8Array([2]))
  expect(disconnect).toHaveBeenCalledTimes(3)
  select(range)
  adapter.destroy()
  expect(disconnect).toHaveBeenCalledTimes(4)
})

it('keeps current passage IDs when document observers are unavailable', async () => {
  vi.stubGlobal('MutationObserver', undefined)
  const { adapter, paragraphs, select } = await setup([' ', '甲😀'])
  const range = document.createRange()
  range.selectNodeContents(paragraphs[1])
  select(range)
  paragraphs[0].textContent = '新段'
  select(range)
  expect(adapter.getSelection()!.passages.map(({ id, text }) => ({ id, text }))).toEqual([
    { id: 'P1', text: '新段' }, { id: 'P2', text: '甲😀' }
  ])
})
