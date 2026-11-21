// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TextReaderAdapter } from '../../src/renderer/src/readers/text-reader'
import { EpubReaderAdapter } from '../../src/renderer/src/readers/epub-reader'
import { PdfReaderAdapter } from '../../src/renderer/src/readers/pdf-reader'
import { createPdfTextModel, type PdfTextContentItem } from '../../src/renderer/src/readers/pdf-text'
import { literalSearchExpression, yieldSearchWork } from '../../src/renderer/src/readers/search'

const mocks = vi.hoisted(() => ({ epub: vi.fn(), pdf: vi.fn() }))
vi.mock('epubjs', () => ({ default: mocks.epub }))
vi.mock('../../src/renderer/src/readers/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/src/readers/search')>()
  return { ...actual, literalSearchExpression: vi.fn(actual.literalSearchExpression), yieldSearchWork: vi.fn(async () => undefined) }
})
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {}, AnnotationMode: { DISABLE: 0 }, getDocument: mocks.pdf,
  TextLayer: class {
    textDivs: HTMLElement[] = []
    textContentItemsStr: string[] = []
    async render() {}
    cancel() {}
  }
}))

const adapters: Array<{ destroy(): void }> = []
beforeEach(() => {
  vi.mocked(literalSearchExpression).mockClear()
  vi.mocked(yieldSearchWork).mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  adapters.splice(0).forEach((adapter) => adapter.destroy())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function host() {
  const element = document.createElement('div')
  Object.defineProperty(element, 'clientWidth', { value: 500 })
  document.body.append(element)
  return element
}

async function textReader(paragraphs: string[], mode: 'plain' | 'markdown' = 'plain') {
  const adapter = new TextReaderAdapter(host(), { bookId: 'pattern-txt' })
  adapters.push(adapter)
  await adapter.setTextMode(mode)
  await adapter.open(new TextEncoder().encode(paragraphs.join('\n\n')))
  return adapter
}

async function pdfReader(pages: Array<string | PdfTextContentItem[]>) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  const textPages = pages.map((page) => typeof page === 'string' ? [{ str: page }] : page)
  const document = {
    numPages: pages.length, getOutline: async () => [], getMetadata: async () => ({ info: {} }),
    getPage: async (number: number) => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 500 * scale, height: 700 * scale, scale }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
      getTextContent: async () => ({ items: textPages[number - 1] }), getAnnotations: async () => []
    })
  }
  mocks.pdf.mockReturnValue({ promise: Promise.resolve(document), destroy: async () => undefined })
  const adapter = new PdfReaderAdapter(host(), { bookId: 'pattern-pdf' })
  adapters.push(adapter)
  await adapter.open(new Uint8Array([1]))
  return adapter
}

async function epubReader(chapters: string[][]) {
  const sections = chapters.map((texts, sectionIndex) => {
    const fixture = document.implementation.createHTMLDocument('Pattern fixture')
    const paragraphs = texts.map((text) => {
      const paragraph = fixture.createElement('p'); paragraph.textContent = text; fixture.body.append(paragraph); return paragraph
    })
    const anchor = (index: number, offset: number) => `epubcfi(/6/${(sectionIndex + 1) * 2}!/4/${(index + 1) * 2}/1:${offset})`
    return {
      href: `chapter-${sectionIndex}.xhtml`, document: fixture, contents: fixture.documentElement,
      load: vi.fn().mockResolvedValue(fixture.documentElement), unload: vi.fn(),
      find: vi.fn((query: string) => texts.flatMap((text, index) => {
        const position = text.toLowerCase().indexOf(query.toLowerCase())
        return position < 0 ? [] : [{ cfi: anchor(index, position), excerpt: text }]
      })),
      cfiFromRange: vi.fn((range: Range) => anchor(paragraphs.indexOf(range.startContainer.parentElement as HTMLParagraphElement), range.startOffset))
    }
  })
  const rendition = {
    hooks: { content: { register: vi.fn() } }, on: vi.fn(), off: vi.fn(), display: vi.fn().mockResolvedValue(undefined),
    annotations: { highlight: vi.fn(), remove: vi.fn() }
  }
  mocks.epub.mockReturnValue({
    ready: Promise.resolve(), load: vi.fn(), renderTo: () => rendition,
    loaded: {
      metadata: Promise.resolve({ title: '表达式样本', creator: '' }),
      navigation: Promise.resolve({ toc: sections.map((section, index) => ({ id: String(index), label: `章${index + 1}`, href: section.href })) }),
      spine: Promise.resolve(sections.map((_, index) => ({ index })))
    },
    spine: { hooks: { content: { list: () => [], deregister: vi.fn() } }, get: (index: number) => sections[index] ?? null },
    locations: { generate: async () => [] }, destroy: vi.fn()
  })
  const adapter = new EpubReaderAdapter(host(), { bookId: 'pattern-epub' })
  adapters.push(adapter)
  await adapter.open(new Uint8Array([1]))
  return { adapter, sections }
}

it('constructs one application query pattern for 5,000 TXT paragraphs', async () => {
  const adapter = await textReader(Array.from({ length: 5_000 }, (_, index) => `普通段落😀 ${index}`))
  expect(await adapter.search('未出现.+[词]😀')).toEqual([])
  expect(literalSearchExpression).toHaveBeenCalledTimes(1)
})

it('maps deep Markdown search results without counting the unused visible-text prefix', async () => {
  const prefix = '甲😀'.repeat(50_000)
  const adapter = await textReader([`${prefix}**目标😀**末尾`], 'markdown')
  const points = vi.spyOn(String.prototype, 'codePointAt')
  const results = await adapter.search('目标😀')
  expect(results).toHaveLength(1)
  expect(results[0].anchor).toBe('txt:100002:100005')
  expect(results[0].excerpt).toContain('目标😀')
  expect(points.mock.calls.length).toBeLessThanOrEqual(200)
})

it.each(['txt', 'pdf'] as const)('counts each matched span at most once for dense Unicode search in %s', async (format) => {
  const query = '[Alpha].+😀'.repeat(10), lower = query.toLowerCase()
  const text = Array.from({ length: 205 }, (_, index) => index % 2 ? lower : query).join('')
  const adapter = format === 'txt' ? await textReader([text]) : await pdfReader([text])
  let matchedPointReads = 0
  const codePointAt = String.prototype.codePointAt
  vi.spyOn(String.prototype, 'codePointAt').mockImplementation(function (this: string, position: number) {
    const value = this.valueOf()
    if (value === query || value === lower) matchedPointReads++
    return codePointAt.call(this, position)
  })
  const results = await adapter.search(query)
  expect(results).toHaveLength(200)
  expect(results.map((result) => result.anchor)).toEqual(Array.from({ length: 200 }, (_, index) => (
    format === 'txt' ? `txt:${index * 100}:${index * 100 + 100}` : `pdf:1:${index * 100}:${index * 100 + 100}`
  )))
  expect(results.every((result) => result.excerpt.includes('[Alpha]') || result.excerpt.includes('[alpha]'))).toBe(true)
  expect(matchedPointReads).toBeLessThanOrEqual(200 * 100)
})

it('keeps raw Markdown anchors when visible matches cross formatting or decode an entity', async () => {
  const source = '甲😀 **Hi**t😀 &amp; 后'
  const adapter = await textReader([source], 'markdown')
  const cases: Array<[string, number, number]> = [
    ['Hit😀', source.indexOf('Hi'), source.indexOf('t😀') + 't😀'.length],
    ['&', source.indexOf('&amp;'), source.indexOf('&amp;') + '&amp;'.length]
  ]
  for (const [query, from, to] of cases) {
    const results = await adapter.search(query)
    const start = Array.from(source.slice(0, from)).length, end = Array.from(source.slice(0, to)).length
    expect(results).toHaveLength(1)
    expect(results[0].anchor).toBe(`txt:${start}:${end}`)
    expect(results[0].excerpt).toContain(query)
  }
})

it.each(['txt', 'pdf'] as const)('preserves offsets across adjacent matches and mixed Unicode gaps in %s', async (format) => {
  const source = '前😀Hit😀HIT😀 é𠮷 末\nHiT😀'
  const adapter = format === 'txt' ? await textReader([source]) : await pdfReader([source])
  const expected = [...source.matchAll(/hit😀/giu)].map((match) => {
    const start = Array.from(source.slice(0, match.index)).length, end = start + Array.from(match[0]).length
    return format === 'txt' ? `txt:${start}:${end}` : `pdf:1:${start}:${end}`
  })
  expect((await adapter.search('hit😀')).map((result) => result.anchor)).toEqual(expected)
})

it('retains raw PDF positions through automatic line separators and multiple text items', async () => {
  const items: PdfTextContentItem[] = [
    { str: '前😀', hasEOL: true }, { str: 'Hit😀' }, { str: ' é𠮷 ', hasEOL: true },
    { str: 'HIT😀', hasEOL: true }, { str: 'hit😀' }
  ]
  const model = createPdfTextModel(items), adapter = await pdfReader([items])
  const expected = [...model.readableText.matchAll(/hit😀/giu)].map((match) => {
    const start = Array.from(model.readableText.slice(0, match.index)).length, end = start + Array.from(match[0]).length
    return `pdf:1:${model.rawOffsetForReadable(start, 'start')}:${model.rawOffsetForReadable(end, 'end')}`
  })
  expect((await adapter.search('hit😀')).map((result) => result.anchor)).toEqual(expected)
})

it.each(['txt', 'pdf'] as const)('keeps literal, case-insensitive results in %s reading order and isolates consecutive queries', async (format) => {
  const query = '[Alpha].+😀'
  const texts = Array.from({ length: 37 }, (_, index) => index % 10 === 0 ? `${query.toUpperCase()} 第${index}` : `普通段落 ${index}`)
  const adapter = format === 'txt' ? await textReader(texts) : await pdfReader(texts)
  const results = await adapter.search(query)
  expect(results.map((result) => result.excerpt)).toEqual([0, 10, 20, 30].map((index) => texts[index]))
  if (format === 'pdf') expect(results.map((result) => result.anchor)).toEqual([1, 11, 21, 31].map((page) => `pdf:${page}:0:${Array.from(query).length}`))
  expect(literalSearchExpression).toHaveBeenCalledTimes(1)
  expect(await adapter.search('不存在')).toEqual([])
  expect(literalSearchExpression).toHaveBeenCalledTimes(2)
})

it('resets the EPUB pattern between chapter scans and compacted excerpts', async () => {
  const query = '[Alpha].+😀'
  const { adapter, sections } = await epubReader([
    ['前'.repeat(140) + query + '后'.repeat(140)],
    ['左'.repeat(100) + query.toUpperCase() + '右'.repeat(100)]
  ])
  const results = await adapter.search(query)
  expect(results.map((result) => result.chapterTitle)).toEqual(['章1', '章2'])
  expect(results[0].excerpt).toContain(query)
  expect(results[1].excerpt).toContain(query.toUpperCase())
  expect(results.every((result) => Array.from(result.excerpt).length <= 82)).toBe(true)
  expect(literalSearchExpression).toHaveBeenCalledTimes(1)
  expect(sections.every((section) => section.unload.mock.calls.length === 1)).toBe(true)
})

it('starts the bounded EPUB scan from the first hit after a count scan reaches the cap', async () => {
  const query = '[Alpha].+😀'
  const { adapter, sections } = await epubReader([Array.from({ length: 250 }, (_, index) => `${index} ${query}`)])
  const results = await adapter.search(query)
  expect(results).toHaveLength(200)
  expect(results[0].anchor).toBe('epubcfi(/6/2!/4/2/1:2)')
  expect(results.at(-1)?.anchor).toBe('epubcfi(/6/2!/4/400/1:4)')
  expect(sections[0].find).not.toHaveBeenCalled()
  expect(literalSearchExpression).toHaveBeenCalledTimes(1)
})

it.each(['txt', 'pdf'] as const)('caps %s matches at 200 and starts the next query with a fresh pattern', async (format) => {
  const query = '[Alpha].+😀'
  const texts = Array.from({ length: 37 }, (_, index) => `${(query + ' ').repeat(10)}${index === 36 ? '最终目标' : ''}`)
  const adapter = format === 'txt' ? await textReader(texts) : await pdfReader(texts)
  expect(await adapter.search(query)).toHaveLength(200)
  expect(literalSearchExpression).toHaveBeenCalledTimes(1)
  expect(await adapter.search('最终目标')).toHaveLength(1)
  expect(literalSearchExpression).toHaveBeenCalledTimes(2)
})

it.each(['txt', 'pdf'] as const)('discards a superseded %s scan after a controlled yield without reusing its pattern', async (format) => {
  const texts = Array.from({ length: 250 }, (_, index) => index === 249 ? '旧目标 新目标' : `普通段落 ${index}`)
  const adapter = format === 'txt' ? await textReader(texts) : await pdfReader(texts)
  await adapter.search('初始化索引')
  vi.mocked(literalSearchExpression).mockClear()
  let reached!: () => void, release!: () => void
  const yielded = new Promise<void>((resolve) => { reached = resolve })
  const blocked = new Promise<void>((resolve) => { release = resolve })
  vi.mocked(yieldSearchWork).mockImplementationOnce(() => { reached(); return blocked })
  const stale = adapter.search('旧目标')
  await yielded
  const latest = adapter.search('新目标')
  release()
  expect(await stale).toEqual([])
  expect(await latest).toEqual([expect.objectContaining({ excerpt: '旧目标 新目标' })])
  expect(literalSearchExpression).toHaveBeenCalledTimes(2)
})
