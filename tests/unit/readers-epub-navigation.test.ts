// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { EpubReaderAdapter } from '../../src/renderer/src/readers/epub-reader'
import { EpubSpineIndex, indexEpubChapters, normalizeEpubHref } from '../../src/renderer/src/readers/epub-navigation'
import { previousEpubChapter } from '../performance/support/legacy-epub-chapters'
import { previousEpubSpineIndex } from '../performance/support/legacy-epub-spine'

const mocks = vi.hoisted(() => ({ epub: vi.fn() }))
vi.mock('epubjs', () => ({ default: mocks.epub }))
const adapters: EpubReaderAdapter[] = []
afterEach(() => {
  adapters.splice(0).forEach((adapter) => adapter.destroy())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

function mockBook(toc: Array<{ href: string; label: string }>, spineHref: string, spineHrefs: ReadonlyArray<string | undefined> = [spineHref]) {
  const handlers = new Map<string, (...values: unknown[]) => void>()
  const rendition = {
    hooks: { content: { register: vi.fn() } },
    on: vi.fn((event: string, handler: (...values: unknown[]) => void) => handlers.set(event, handler)),
    off: vi.fn(), display: vi.fn().mockResolvedValue(undefined), resize: vi.fn(), annotations: { remove: vi.fn() }
  }
  const book = {
    ready: Promise.resolve(), renderTo: () => rendition,
    loaded: {
      metadata: Promise.resolve({ title: '合成 EPUB 章节' }),
      navigation: Promise.resolve({ toc: toc.map((item, index) => ({ ...item, id: String(index) })) }),
      spine: Promise.resolve(spineHrefs.map((_, index) => ({ index })))
    },
    spine: {
      hooks: { content: { list: () => [], deregister: vi.fn() } },
      get: vi.fn((index: number) => spineHrefs[index] === undefined ? null : { href: spineHrefs[index] })
    },
    locations: { generate: async () => [] }, destroy: vi.fn()
  }
  mocks.epub.mockReturnValue(book)
  return {
    resize: rendition.resize,
    getSpineSection: book.spine.get,
    relocate: (href?: string, index = 0) => handlers.get('relocated')!({
      start: { cfi: 'epubcfi(/6/2!/4/1:0)', index, percentage: 0.5, href }
    })
  }
}

async function setup(toc: Array<{ href: string; label: string }>, spineHref: string, spineHrefs?: ReadonlyArray<string | undefined>) {
  const fixture = mockBook(toc, spineHref, spineHrefs)
  const host = document.createElement('div')
  document.body.append(host)
  const onRelocated = vi.fn()
  const adapter = new EpubReaderAdapter(host, { bookId: 'epub-chapter-fixture', onRelocated })
  adapters.push(adapter)
  await adapter.open(new Uint8Array([1]))
  return { ...fixture, host, adapter, onRelocated }
}

it('does not repeatedly decode a 5,000-entry TOC while reporting the current chapter', async () => {
  const toc = Array.from({ length: 5_000 }, (_, index) => ({ href: `chapter-${index}.xhtml`, label: `章 ${index}` }))
  const { relocate, onRelocated } = await setup(toc, toc.at(-1)!.href)
  const decode = vi.spyOn(globalThis, 'decodeURIComponent')
  relocate()
  expect(onRelocated).toHaveBeenLastCalledWith(expect.objectContaining({
    chapterTitle: '章 4999', chapterHref: 'chapter-4999.xhtml'
  }))
  expect(decode.mock.calls.length).toBeLessThanOrEqual(2)
  decode.mockClear()
  relocate()
  expect(decode.mock.calls.length).toBeLessThanOrEqual(2)
})

it('resolves a deep relocation href without rereading a 5,000-section spine', async () => {
  const toc = Array.from({ length: 5_000 }, (_, index) => ({ href: `chapter-${index}.xhtml`, label: `章 ${index}` }))
  const { adapter, relocate, getSpineSection, onRelocated } = await setup(toc, toc[0].href, toc.map((item) => item.href))
  relocate(`${toc.at(-1)!.href}#destination`)
  getSpineSection.mockClear()
  const decode = vi.spyOn(globalThis, 'decodeURIComponent')
  relocate(`${toc.at(-1)!.href}#destination`)
  expect(Reflect.get(adapter, 'currentSectionIndex')).toBe(4_999)
  expect(onRelocated).toHaveBeenLastCalledWith(expect.objectContaining({ chapterTitle: '章 4999', chapterHref: 'chapter-4999.xhtml' }))
  expect(getSpineSection.mock.calls.length).toBe(0)
  expect(decode.mock.calls.length).toBeLessThanOrEqual(3)
})

it('only scans a previously unread spine prefix, including missing and empty hrefs', () => {
  const hrefs = ['first.xhtml', undefined, '', 'middle.xhtml', 'last.xhtml']
  const read = vi.fn((index: number) => hrefs[index])
  const index = new EpubSpineIndex(hrefs.length, read)
  expect(read.mock.calls.length).toBe(0)
  expect(index.get('')).toBeNull()
  expect(read.mock.calls.length).toBe(0)
  expect(index.get('first.xhtml#one')).toBe(0)
  expect(read.mock.calls.map(([offset]) => offset)).toEqual([0])
  read.mockClear()
  expect(index.get('./first.xhtml#two')).toBe(0)
  expect(read.mock.calls.length).toBe(0)
  expect(index.get('middle.xhtml')).toBe(3)
  expect(read.mock.calls.map(([offset]) => offset)).toEqual([1, 2, 3])
  read.mockClear()
  expect(index.get('missing.xhtml')).toBeNull()
  expect(read.mock.calls.map(([offset]) => offset)).toEqual([4])
  read.mockClear()
  for (const href of ['first.xhtml', 'last.xhtml', 'missing.xhtml', 'another-missing.xhtml']) index.get(href)
  expect(read.mock.calls.length).toBe(0)
  expect(new EpubSpineIndex(0, read).get('first.xhtml')).toBeNull()
  expect(read.mock.calls.length).toBe(0)
})

it('keeps original section indices and first normalized duplicates in any query order', () => {
  const hrefs = [
    './章.xhtml#first', undefined, '', '%E7%AB%A0.xhtml', 'part%23one.xhtml#spot',
    'part%23one.xhtml', 'bad%E0%A4%A.xhtml#first', 'bad%E0%A4%A.xhtml',
    'space%2520name.xhtml', 'space%20name.xhtml', '././nested.xhtml', './nested.xhtml',
    '%2E%2Fencoded.xhtml', './encoded.xhtml', '__proto__', 'constructor'
  ]
  const queries = [...hrefs.filter((href): href is string => href !== undefined), '章.xhtml#unlisted', 'missing.xhtml', 'part#one.xhtml']
  for (const order of [queries, [...queries].reverse(), ['absent.xhtml', ...queries]]) {
    const index = new EpubSpineIndex(hrefs.length, (position) => hrefs[position])
    for (const href of order) expect(index.get(href)).toBe(previousEpubSpineIndex(hrefs.length, (position) => hrefs[position], href))
    expect(index.get('章.xhtml#later')).toBe(0)
  }
})

it('replaces the spine index on reopen and retains relocation fallback for unknown hrefs', async () => {
  const { adapter, relocate } = await setup([], 'same.xhtml', ['same.xhtml', 'old-only.xhtml'])
  relocate('same.xhtml', 1)
  expect(Reflect.get(adapter, 'currentSectionIndex')).toBe(0)
  relocate('old-only.xhtml')
  expect(Reflect.get(adapter, 'currentSectionIndex')).toBe(1)
  const next = mockBook([], 'same.xhtml', [undefined, 'new-only.xhtml', 'same.xhtml'])
  await adapter.open(new Uint8Array([2]))
  next.relocate('same.xhtml')
  expect(Reflect.get(adapter, 'currentSectionIndex')).toBe(2)
  next.relocate('old-only.xhtml', 0)
  expect(Reflect.get(adapter, 'currentSectionIndex')).toBe(0)
  next.relocate(undefined, 1)
  expect(Reflect.get(adapter, 'currentSectionIndex')).toBe(1)
  next.relocate('missing.xhtml', Number.NaN)
  expect(Reflect.get(adapter, 'currentSectionIndex')).toBe(0)
  adapter.destroy()
  expect(Reflect.get(adapter, 'spineIndex')).toBeNull()
})

it('keeps the first title while preferring the first fragment-free link for that chapter', async () => {
  const { relocate, onRelocated } = await setup([
    { href: './%E7%AB%A0.xhtml#intro', label: '先出现的小节' },
    { href: '章.xhtml#next', label: '后续小节' },
    { href: '%E7%AB%A0.xhtml', label: '无片段的章' },
    { href: './章.xhtml', label: '另一条章链接' }
  ], '章.xhtml')
  for (const href of [undefined, './%E7%AB%A0.xhtml#next', '章.xhtml']) {
    relocate(href)
    expect(onRelocated).toHaveBeenLastCalledWith(expect.objectContaining({
      chapterTitle: '先出现的小节', chapterHref: '%E7%AB%A0.xhtml'
    }))
  }
})

it('replaces chapter metadata on reopen and falls back when the next book has no matching entry', async () => {
  const { adapter, relocate, onRelocated } = await setup([
    { href: 'chapter.xhtml#first', label: '原书标题' }
  ], 'chapter.xhtml')
  relocate()
  expect(onRelocated).toHaveBeenLastCalledWith(expect.objectContaining({ chapterTitle: '原书标题', chapterHref: 'chapter.xhtml#first' }))
  const replacement = mockBook([{ href: 'chapter.xhtml', label: '新书标题' }], 'chapter.xhtml')
  await adapter.open(new Uint8Array([2]))
  replacement.relocate()
  expect(onRelocated).toHaveBeenLastCalledWith(expect.objectContaining({ chapterTitle: '新书标题', chapterHref: 'chapter.xhtml' }))
  const empty = mockBook([], 'chapter.xhtml')
  await adapter.open(new Uint8Array([3]))
  empty.relocate()
  expect(onRelocated).toHaveBeenLastCalledWith(expect.objectContaining({ chapterTitle: '第 1 节', chapterHref: 'chapter.xhtml' }))
})

it('matches the old scan for fragments, percent encoding, malformed escapes and missing chapters', () => {
  const hrefs = [
    './章.xhtml#intro', '%E7%AB%A0.xhtml#next', '章.xhtml', './%E7%AB%A0.xhtml',
    'part%23one.xhtml#spot', 'part%23one.xhtml', 'space%2520name.xhtml#first', 'space%20name.xhtml',
    'bad%E0%A4%A.xhtml#first', 'bad%E0%A4%A.xhtml', '././nested.xhtml#first', './nested.xhtml',
    '%2E%2Fencoded.xhtml#first', './encoded.xhtml', '__proto__#first', '__proto__', 'constructor'
  ]
  const toc = hrefs.map((href, index) => ({ href, label: `标题 ${index}` }))
  const original = structuredClone(toc)
  const chapters = indexEpubChapters(toc)
  for (const href of [...hrefs, '章.xhtml#unlisted', 'missing.xhtml#new', 'part#one.xhtml', '']) {
    const chapter = chapters.get(normalizeEpubHref(href))
    expect({ title: chapter?.title, href: chapter?.href ?? href }).toEqual(previousEpubChapter(toc, href))
  }
  expect(toc).toEqual(original)
  expect(indexEpubChapters([]).size).toBe(0)
})

it('coalesces host size changes and releases pending resize work when the book closes', async () => {
  const observers: Array<{ notify: () => void; disconnect: ReturnType<typeof vi.fn> }> = []
  vi.stubGlobal('ResizeObserver', class {
    disconnect = vi.fn()
    constructor(callback: () => void) { observers.push({ notify: callback, disconnect: this.disconnect }) }
    observe = vi.fn()
  })
  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.set(++frameId, callback); return frameId })
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id) })
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(0)) }
  const { adapter, host, resize } = await setup([], 'chapter.xhtml')
  let width = 480, height = 600
  Object.defineProperties(host, { clientWidth: { get: () => width }, clientHeight: { get: () => height } })
  observers[0].notify(); observers[0].notify()
  expect(frames.size).toBe(1)
  expect(resize).not.toHaveBeenCalled()
  flush()
  expect(resize).toHaveBeenCalledExactlyOnceWith('100%', '100%')
  observers[0].notify(); flush()
  expect(resize).toHaveBeenCalledTimes(1)
  width = 0; height = 0
  observers[0].notify(); flush()
  expect(resize).toHaveBeenCalledTimes(1)
  width = 620; height = 400
  observers[0].notify(); flush()
  expect(resize).toHaveBeenCalledTimes(2)
  width = 700
  observers[0].notify()
  const staleFrame = [...frames.values()][0]
  const replacement = mockBook([], 'new-chapter.xhtml')
  await adapter.open(new Uint8Array([2]))
  expect(observers[0].disconnect).toHaveBeenCalledOnce()
  expect(cancel).toHaveBeenCalled()
  expect(frames.size).toBe(0)
  width = 800
  observers[1].notify()
  staleFrame(0); observers[0].notify()
  expect(frames.size).toBe(1)
  flush()
  expect(resize).toHaveBeenCalledTimes(2)
  expect(replacement.resize).toHaveBeenCalledExactlyOnceWith('100%', '100%')
  width = 900
  observers[1].notify()
  adapter.destroy()
  expect(observers[1].disconnect).toHaveBeenCalledOnce()
  expect(frames.size).toBe(0)
})
