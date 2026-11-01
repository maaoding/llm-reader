// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import ePub, { type Contents } from 'epubjs'
import { extractEpubDocument } from '../../src/renderer/src/readers/book-extraction'
import { sanitizeContents } from '../../src/renderer/src/readers/epub-reader'
import { paragraphSlices } from '../../src/shared/book-context'
import { previousEpubDocument } from '../performance/support/legacy-epub-extraction'
import { epubExtractionFixture } from '../performance/support/epub-extraction-fixture'

afterEach(() => vi.restoreAllMocks())

it('only generates retained CFI ranges while preserving long Unicode units, headings and note sources', async () => {
  const text = '😀𠮷 é，原文定位。'.repeat(900)
  const payload = await epubExtractionFixture([{ href: 'body.xhtml', body: '<h1>总论</h1>' +
    Array.from({ length: 100 }, (_, index) => `<p>  段落 ${index} 😀𠮷 é。  </p>`).join('') +
    `<p>${text}</p><h2>限制</h2><p>正文见<a href="#note">脚注</a>。</p><aside id="note" epub:type="footnote"><p>😀条件成立。</p></aside>` }])
  const book = ePub(Uint8Array.from(payload.bytes).buffer)
  try {
    await book.ready
    const section = book.spine.get(0)
    const cfi = vi.spyOn(Object.getPrototypeOf(section) as typeof section, 'cfiFromRange')
    const before = await previousEpubDocument(payload, new AbortController().signal)
    const beforeCalls = cfi.mock.calls.length
    cfi.mockClear()
    const after = await extractEpubDocument(payload, new AbortController().signal)
    const afterCalls = cfi.mock.calls.length
    expect(after).toEqual(before)
    const sources = after.units.reduce((sum, unit) => sum + unit.sources.length, 0)
    expect(beforeCalls).toBe(after.units.length + sources)
    expect(afterCalls).toBe(after.nodes.length + sources)
    expect(beforeCalls - afterCalls).toBe(103)
    expect(after.nodes.map((node) => node.title)).toEqual(['总论', '限制'])
    const reference = after.units.find((unit) => unit.text === '正文见脚注。')!
    expect(after.units.find((unit) => unit.id === reference.relatedIds[0])?.text).toBe('😀条件成立。')
    await section.load(book.load.bind(book))
    sanitizeContents({ content: section.contents } as Contents)
    for (const unit of after.units) {
      const parts = paragraphSlices(unit.text)
      for (const [index, source] of unit.sources.entries()) {
        expect((await book.getRange(source.anchor)).toString()).toBe(parts[index].text)
        expect(source).toMatchObject({ textStart: parts[index].start, textEnd: parts[index].end })
      }
    }
    for (const node of after.nodes) expect((await book.getRange(node.anchor)).toString()).toBe(node.title)
    console.info(`EPUB extraction retained ranges: ${beforeCalls} -> ${afterCalls} CFI calls; identical document and round-trip Unicode sources.`)
  } finally { book.destroy() }
})

it('groups a many-file TOC once without changing duplicate boundaries, ancestry or cross-file footnotes', async () => {
  const chapters = Array.from({ length: 12 }, (_, index) => ({ href: `Text/chapter-${index}.xhtml`, body:
    `<h1 id="start">章 ${index}</h1><p id="body">正文 ${index} <a href="chapter-${(index + 1) % 12}.xhtml#note">脚注</a>。</p><aside id="note" epub:type="footnote"><p>注释 ${index} 😀。</p></aside>` }))
  const navigation = chapters.map(({ href }, index) => `<li><a href="./${href}#start">章 ${index}</a><ol><li><a href="${href}#start">同位标题</a><ol><li><a href="${href}#body">子章 ${index}</a></li></ol></li></ol></li>`).join('')
  const payload = await epubExtractionFixture(chapters, navigation)
  const decode = vi.spyOn(globalThis, 'decodeURI')
  const before = await previousEpubDocument(payload, new AbortController().signal)
  const beforeCalls = decode.mock.calls.length
  decode.mockClear()
  const after = await extractEpubDocument(payload, new AbortController().signal)
  const afterCalls = decode.mock.calls.length
  expect(after).toEqual(before)
  expect(beforeCalls - afterCalls).toBe((12 - 1) * 36)
  expect(after.nodes).toHaveLength(24)
  for (let index = 0; index < 12; index++) {
    expect(after.nodes[index * 2 + 1]).toMatchObject({ title: `子章 ${index}`, parentId: after.nodes[index * 2].id })
    const reference = after.units.find((unit) => unit.text === `正文 ${index} 脚注。`)!
    expect(after.units.find((unit) => unit.id === reference.relatedIds[0])?.text).toBe(`注释 ${(index + 1) % 12} 😀。`)
  }
  console.info(`EPUB extraction TOC paths: ${beforeCalls} -> ${afterCalls} decodeURI calls; identical hierarchy and cross-file notes.`)
})

it('preserves encoded paths, empty authored anchors, invalid fragments and sections without TOC entries', async () => {
  const payload = await epubExtractionFixture([
    { href: 'Text/%E7%AB%A0.xhtml', body: '<span id="标题"></span><p>😀没有标题的正文。</p><p id="sub">同一文件的后半部分。</p>' },
    { href: 'untitled.xhtml', body: '<p>未列入目录的文字。</p><h3>正文标题</h3><p>补充。</p>' }
  ], '<li><a href="Text/章.xhtml#%E6%A0%87%E9%A2%98">总论</a><ol><li><a href="Text/%E7%AB%A0.xhtml#sub">子章</a></li><li><a href="Text/章.xhtml#missing">缺失锚点</a></li><li><a href="Text/章.xhtml#%ZZ">无效转义</a></li></ol></li>')
  const before = await previousEpubDocument(payload, new AbortController().signal)
  const after = await extractEpubDocument(payload, new AbortController().signal)
  expect(after).toEqual(before)
  expect(after.nodes.map((node) => node.title)).toEqual(['总论', '子章', '文本分节 2', '正文标题'])
  expect(after.nodes[1].parentId).toBe(after.nodes[0].id)
  expect(after.units.map((unit) => unit.text)).toEqual(['😀没有标题的正文。', '同一文件的后半部分。', '未列入目录的文字。', '正文标题', '补充。'])
})

it('indexes only note targets and appends shared-ancestor notes without copying earlier entries', async () => {
  const payload = await epubExtractionFixture([{ href: 'body.xhtml', body:
    '<div id="body"><h1>总论</h1><p>引用<a href="#body">全部脚注</a>与<a href="#notes">注释组</a>。</p>' +
    Array.from({ length: 200 }, (_, index) => `<p id="p${index}">普通正文 ${index}。</p>`).join('') +
    '<aside id="notes" epub:type="footnote">' + Array.from({ length: 100 }, (_, index) => `<p>脚注 ${index} 😀。</p>`).join('') + '</aside></div>' }])
  const originalSet = Map.prototype.set
  let indexedSlots = 0, noteGroup: unknown[] | undefined
  vi.spyOn(Map.prototype, 'set').mockImplementation(function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
    if (key === '/body.xhtml#body' || key === '/body.xhtml#notes') {
      indexedSlots += (value as unknown[]).length
      if (key === '/body.xhtml#notes') noteGroup = value as unknown[]
    }
    return originalSet.call(this, key, value)
  })
  const before = await previousEpubDocument(payload, new AbortController().signal)
  const beforeSlots = indexedSlots
  indexedSlots = 0
  noteGroup = undefined
  const after = await extractEpubDocument(payload, new AbortController().signal)
  expect(after).toEqual(before)
  expect(beforeSlots).toBe(302 * 303 / 2 + 100 * 101 / 2)
  expect(indexedSlots).toBe(2)
  expect(noteGroup).toHaveLength(100)
  const notes = after.units.filter((unit) => unit.kind === 'note')
  const reference = after.units.find((unit) => unit.text === '引用全部脚注与注释组。')!
  expect(reference.relatedIds).toEqual(notes.map((unit) => unit.id))
  expect(notes.every((unit) => unit.relatedIds.length === 1 && unit.relatedIds[0] === reference.id)).toBe(true)
  expect(after.diagnostics.some((diagnostic) => diagnostic.code === 'unlinked-note')).toBe(false)
  console.info(`EPUB shared target accumulation: ${beforeSlots} -> ${indexedSlots} initial indexed slots; ordinary body targets omitted, note groups appended in place.`)
})
