import { test, expect, vi } from 'vitest'
import type { LlmEvent } from '../../src/shared/contracts'
import { limitText } from '../../src/shared/book-context'
import { citationExcerpt } from '../../src/renderer/src/citations'
import { parseMarkdown } from '../../src/renderer/src/answer-markdown'
import { LlmEventBuffer } from '../../src/renderer/src/llm-event-buffer'
import { PdfOutlineIndex, pdfReadingPosition, pdfSectionAt, type PdfOutlineLocation, type PdfPageBounds, type PdfPositionAnchor } from '../../src/renderer/src/readers/pdf-navigation'
import { createPdfTextModel, extractPdfRegionText, pdfTextOffset, type PdfRegionTextItem } from '../../src/renderer/src/readers/pdf-text'
import { previousPdfTextOffset, syntheticPdfTextRuns } from './support/legacy-pdf-text-mapping'
import { previousBoundedPdfSlice } from './support/legacy-pdf-text-slice'
import { previousExtractPdfRegionText } from './support/legacy-pdf-region-text'
import { previousPdfSectionAt } from './support/legacy-pdf-outline'
import { EpubSpineIndex, indexEpubChapters, normalizeEpubHref } from '../../src/renderer/src/readers/epub-navigation'
import { previousEpubChapter } from './support/legacy-epub-chapters'
import { previousEpubSpineIndex } from './support/legacy-epub-spine'
import { literalSearchExpression } from '../../src/shared/reader-search'
import { buildBoundedPassages } from '../../src/renderer/src/readers/context'
import { documentSections } from '../../src/shared/document-structure'
import { previousDocumentSections } from './support/legacy-document-sections'
import { tableDocumentFixture, type TableFixture } from './support/table-document-fixture'

// Baseline from 4294da5. Keep this small reference local to the benchmark so
// production never carries a second implementation or a performance mode.
function previousExcerpt(text: string): string {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  const characters = Array.from(normalized)
  return characters.length > 24 ? `${characters.slice(0, 24).join('')}…` : normalized
}

const passage = '  证据😀\n\t'.repeat(4_000)
expect(citationExcerpt(passage)).toBe(previousExcerpt(passage))
const options = { time: 300, iterations: 3, warmupTime: 100, warmupIterations: 1 }

const tableSections = documentSections, previousTableSections = previousDocumentSections
for (const kind of ['small', 'dense-rows', 'repeated-header', 'oversized-header', 'merged-rows', 'long-row'] as TableFixture[]) {
  test(`Structured table sections (${kind})`, async ({ bench }) => {
    const document = tableDocumentFixture(kind)
    const expected = previousTableSections(document)
    expect(tableSections(document)).toEqual(expected)
    let sink = 0
    const consume = (sections: ReturnType<typeof tableSections>): void => {
      for (const section of sections) for (const block of section.blocks) {
        sink = (sink + block.text.length + block.sources!.length + block.tableSlice!.rows.length + block.tableSlice!.cells.length) >>> 0
      }
    }
    // Includes validation, table serialization, exact cell/source ranges and section grouping.
    // Excludes document service parsing, SQLite indexing, layout, rendering and model calls.
    await bench.compare(
      bench('before: recount text and scan cell row lists', { writeResult: `output/benchmarks/renderer/table-sections-${kind}-before.json` }, () => consume(previousTableSections(document))),
      bench('after: reuse local lengths and row membership', { writeResult: `output/benchmarks/renderer/table-sections-${kind}-after.json` }, () => consume(tableSections(document))),
      { time: 700, iterations: 15, warmupTime: 200, warmupIterations: 3 }
    )
    expect(sink).toBeGreaterThan(0)
  })
}

const OutlineIndex = PdfOutlineIndex, sectionAt = pdfSectionAt, previousSectionAt = previousPdfSectionAt
const outlineLocations: PdfOutlineLocation[] = Array.from({ length: 5_000 }, (_, index) => ({
  pageNumber: index + 1, fraction: 0, label: `章 ${index}`, href: `pdfpos:${index + 1}:0`, depth: 0, order: index
}))
const outlineIndex = new OutlineIndex(outlineLocations)
const expectedOutlineSection = previousSectionAt(outlineLocations, 4_501, 0.5, 5_000, '全文')
expect(sectionAt(outlineIndex, 4_501, 0.5, 5_000, '全文')).toEqual(expectedOutlineSection)
let outlineReads = 0
const countedOutline = outlineLocations.map((location) => new Proxy(location, {
  get: (target, key, receiver) => { if (key === 'pageNumber' || key === 'fraction') outlineReads++; return Reflect.get(target, key, receiver) }
}))
const countedOutlineIndex = new OutlineIndex(countedOutline)
outlineReads = 0
expect(previousSectionAt(countedOutline, 4_501, 0.5, 5_000, '全文')).toEqual(expectedOutlineSection)
const previousOutlineReads = outlineReads
outlineReads = 0
let outlineBoundaryReads = 0
const outlinePositions = Reflect.get(countedOutlineIndex, 'maximumPositions') as number[]
Reflect.set(countedOutlineIndex, 'maximumPositions', new Proxy(outlinePositions, {
  get: (target, key, receiver) => { if (typeof key === 'string' && /^\d+$/u.test(key)) outlineBoundaryReads++; return Reflect.get(target, key, receiver) }
}))
expect(sectionAt(countedOutlineIndex, 4_501, 0.5, 5_000, '全文')).toEqual(expectedOutlineSection)
expect(outlineReads).toBe(0)
expect(outlineBoundaryReads).toBeLessThanOrEqual(26)
console.info(`PDF current section: ${previousOutlineReads} source position-field reads -> ${outlineBoundaryReads} indexed boundary reads; identical title, href and progress.`)
for (const mode of ['cold', 'repeated'] as const) {
  let outlineSink = 0
  const consume = (section: ReturnType<typeof sectionAt>): void => { outlineSink = (outlineSink + section.title.length + section.href.length + Math.round(section.progress * 100)) >>> 0 }
  test(`PDF current section across 5,000 outline entries (${mode})`, async ({ bench }) => {
    await bench.compare(
      bench('before: scan the outline twice', { writeResult: `output/benchmarks/renderer/pdf-outline-${mode}-before.json` }, () => consume(previousSectionAt(outlineLocations, 4_501, 0.5, 5_000, '全文'))),
      bench('after: find section boundaries in the index', { writeResult: `output/benchmarks/renderer/pdf-outline-${mode}-after.json` }, () => consume(sectionAt(mode === 'cold' ? new OutlineIndex(outlineLocations) : outlineIndex, 4_501, 0.5, 5_000, '全文'))),
      options
    )
    expect(outlineSink).toBeGreaterThan(0)
  })
}

const SpineIndex = EpubSpineIndex, previousSpineIndex = previousEpubSpineIndex
const spineHrefs = Array.from({ length: 5_000 }, (_, index) => `chapter-${index}.xhtml`)
const spineHrefAt = (index: number): string => spineHrefs[index]
for (const mode of ['cold-head', 'cold-deep', 'repeated-deep', 'repeated-miss'] as const) {
  const href = mode === 'cold-head' ? spineHrefs[0] : mode === 'repeated-miss' ? 'missing.xhtml' : spineHrefs.at(-1)!
  const warmIndex = new SpineIndex(spineHrefs.length, spineHrefAt)
  const expected = previousSpineIndex(spineHrefs.length, spineHrefAt, href)
  expect(warmIndex.get(href)).toBe(expected)
  if (mode === 'repeated-deep') {
    let reads = 0
    const read = (index: number): string => { reads++; return spineHrefs[index] }
    const index = new SpineIndex(spineHrefs.length, read)
    index.get(href)
    reads = 0
    expect(previousSpineIndex(spineHrefs.length, read, href)).toBe(expected)
    const previousReads = reads
    reads = 0
    expect(index.get(href)).toBe(expected)
    expect(reads).toBe(0)
    console.info(`EPUB repeated spine lookup: ${previousReads} -> ${reads} section reads; identical section index.`)
  }
  let spineSink = 0
  const consume = (index: number | null): void => { spineSink = (spineSink + (index ?? spineHrefs.length) + 1) >>> 0 }
  test(`EPUB spine href lookup across 5,000 sections (${mode})`, async ({ bench }) => {
    await bench.compare(
      bench('before: scan each href from the start', { writeResult: `output/benchmarks/renderer/epub-spine-${mode}-before.json` }, () => consume(previousSpineIndex(spineHrefs.length, spineHrefAt, href))),
      bench('after: reuse the scanned spine prefix', { writeResult: `output/benchmarks/renderer/epub-spine-${mode}-after.json` }, () => consume((mode.startsWith('cold') ? new SpineIndex(spineHrefs.length, spineHrefAt) : warmIndex).get(href))),
      options
    )
    expect(spineSink).toBeGreaterThan(0)
  })
}

// Capture imports outside the timed callbacks to avoid Vitest module-runner getter overhead.
const makeChapterIndex = indexEpubChapters, chapterKey = normalizeEpubHref, previousChapter = previousEpubChapter
const chapterToc = Array.from({ length: 5_000 }, (_, index) => ({ href: `chapter-${index}.xhtml`, label: `章 ${index}` }))
const chapterHref = chapterToc.at(-1)!.href
const chapterIndex = makeChapterIndex(chapterToc)
const indexedChapter = (index: typeof chapterIndex) => ({
  title: index.get(chapterKey(chapterHref))?.title,
  href: index.get(chapterKey(chapterHref))?.href ?? chapterHref
})
const expectedChapter = previousChapter(chapterToc, chapterHref)
expect(indexedChapter(chapterIndex)).toEqual(expectedChapter)
const chapterDecode = vi.spyOn(globalThis, 'decodeURIComponent')
try {
  expect(previousChapter(chapterToc, chapterHref)).toEqual(expectedChapter)
  const previousCalls = chapterDecode.mock.calls.length
  chapterDecode.mockClear()
  expect(indexedChapter(chapterIndex)).toEqual(expectedChapter)
  expect(chapterDecode.mock.calls.length).toBeLessThanOrEqual(2)
  console.info(`EPUB current chapter: ${previousCalls} -> ${chapterDecode.mock.calls.length} href decodes; identical title and chapter link.`)
} finally { chapterDecode.mockRestore() }
for (const mode of ['cold', 'repeated'] as const) {
  let chapterSink = 0
  const consume = (chapter: ReturnType<typeof indexedChapter>): void => { chapterSink = (chapterSink + (chapter.title?.length ?? 0) + chapter.href.length) >>> 0 }
  test(`EPUB current chapter across 5,000 TOC entries (${mode})`, async ({ bench }) => {
    // Cold includes index creation; repeated uses metadata from the current opened book.
    await bench.compare(
      bench('before: scan and decode the TOC', { writeResult: `output/benchmarks/renderer/epub-chapter-${mode}-before.json` }, () => consume(previousChapter(chapterToc, chapterHref))),
      bench('after: look up the current chapter', { writeResult: `output/benchmarks/renderer/epub-chapter-${mode}-after.json` }, () => consume(indexedChapter(mode === 'cold' ? makeChapterIndex(chapterToc) : chapterIndex))),
      options
    )
    expect(chapterSink).toBeGreaterThan(0)
  })
}

const fullPdfRegion = { pageNumber: 1, left: 0, top: 0, right: 1, bottom: 1 }
for (const mode of ['dense-line', 'table'] as const) {
  const count = mode === 'dense-line' ? 4_000 : 2_000
  const columns = mode === 'dense-line' ? count : 50
  const items: PdfRegionTextItem[] = Array.from({ length: count }, (_, index) => ({
    text: index % 2 ? '😀' : '甲', rawStart: index, rawEnd: index + 1,
    left: (index % columns) / (columns + 1), right: (index % columns + 0.5) / (columns + 1),
    top: 0.1 + Math.floor(index / columns) * 0.02, bottom: 0.11 + Math.floor(index / columns) * 0.02
  }))
  const before = () => previousExtractPdfRegionText(items, fullPdfRegion)
  const after = () => extractPdfRegionText(items, fullPdfRegion)
  expect(after()).toEqual(before())
  if (mode === 'dense-line') {
    let reads = 0
    const counted = items.map((item) => new Proxy(item, {
      get: (target, key, receiver) => { if (key === 'top' || key === 'bottom') reads++; return Reflect.get(target, key, receiver) }
    }))
    const expected = previousExtractPdfRegionText(counted, fullPdfRegion), previousReads = reads
    reads = 0
    expect(extractPdfRegionText(counted, fullPdfRegion)).toEqual(expected)
    expect(reads).toBeLessThan(count * 20)
    console.info(`PDF region ${count} glyphs: ${previousReads} -> ${reads} vertical geometry reads; identical text and raw range.`)
  }
  let regionSink = 0
  const consume = (result: ReturnType<typeof after>): void => {
    if (!result) throw new Error('Expected synthetic PDF region text')
    regionSink = (regionSink + result.text.length + result.rawStart + result.rawEnd) >>> 0
  }
  test(`PDF region row centers (${mode})`, async ({ bench }) => {
    // Synthetic geometry only; no PDF parsing, DOM measurement, layout or painting.
    await bench.compare(
      bench('before: recount every row prefix', { writeResult: `output/benchmarks/renderer/pdf-region-${mode}-before.json` }, () => consume(before())),
      bench('after: retain the row center sum', { writeResult: `output/benchmarks/renderer/pdf-region-${mode}-after.json` }, () => consume(after())),
      options
    )
    expect(regionSink).toBeGreaterThan(0)
  })
}

const contextText = '甲😀'.repeat(50_000)
const contextBlocks = [{ id: 'P1', text: contextText, anchorForSlice: (start: number, end: number) => `txt:${start}:${end}` }]
const parsedContextBlocks = contextBlocks.map((block) => ({ ...block, codePointLength: 100_000 }))
const buildContext = buildBoundedPassages
for (const [name, startOffset, endOffset] of [['start', 0, 20], ['middle', 50_000, 50_001]] as const) {
  const focus = { startBlock: 0, startOffset, endBlock: 0, endOffset }
  const before = () => buildContext(contextBlocks, focus)
  const after = () => buildContext(parsedContextBlocks, focus)
  const points = vi.spyOn(String.prototype, 'codePointAt')
  try {
    const expected = before(), beforeReads = points.mock.calls.length
    points.mockClear()
    const actual = after(), afterReads = points.mock.calls.length
    expect(actual).toEqual(expected)
    expect(beforeReads - afterReads).toBe(100_000)
    console.info(`Reader context ${name}: ${beforeReads} -> ${afterReads} codePointAt calls; identical passages and anchors.`)
  } finally { points.mockRestore() }
  test(`reuse parsed context length in a 100,000-code-point paragraph (${name})`, async ({ bench }) => {
    await bench.compare(
      bench('before: count source lengths for each selection', { writeResult: `output/benchmarks/renderer/context-lengths-${name}-before.json` }, before),
      bench('after: reuse lengths from current parsed bounds', { writeResult: `output/benchmarks/renderer/context-lengths-${name}-after.json` }, after),
      options
    )
  })
}

const makeSearchPattern = literalSearchExpression
function scanSearchTexts(texts: string[], query: string, reuse: boolean, createPattern = makeSearchPattern): number {
  const shared = reuse ? createPattern(query) : null
  let count = 0
  for (const text of texts) {
    const expression = shared ?? createPattern(query)
    expression.lastIndex = 0
    while (expression.exec(text)) if (++count >= 200) return count
  }
  return count
}
const patternQuery = '[Alpha].+😀'
for (const hits of [false, true]) {
  const name = hits ? 'sparse-hits' : 'no-hits'
  const texts = Array.from({ length: 5_000 }, (_, index) => hits && index % 50 === 0 ? `${index} ${patternQuery}` : `普通背景 ${index}。按字面搜索正文。`)
  let before = 0, after = 0
  const expected = scanSearchTexts(texts, patternQuery, false, (query) => { before++; return makeSearchPattern(query) })
  expect(scanSearchTexts(texts, patternQuery, true, (query) => { after++; return makeSearchPattern(query) })).toBe(expected)
  expect([before, after]).toEqual([5_000, 1])
  console.info(`Search ${name}: ${before} -> ${after} query-pattern constructions; identical hit count.`)
  test(`query-pattern reuse across 5,000 text blocks (${name})`, async ({ bench }) => {
    await bench.compare(
      bench('before: construct the pattern for each block', { writeResult: `output/benchmarks/renderer/search-pattern-${name}-before.json` }, () => scanSearchTexts(texts, patternQuery, false)),
      bench('after: reset one pattern for the search job', { writeResult: `output/benchmarks/renderer/search-pattern-${name}-after.json` }, () => scanSearchTexts(texts, patternQuery, true)),
      options
    )
  })
}

const sliceModel = createPdfTextModel([{ str: '甲😀'.repeat(50_000) }])
const currentPdfSlice = sliceModel.readableSliceForRaw
const previousPdfSlice = (start: number, end: number): string => {
  const from = sliceModel.readableOffsetForRaw(start, 'start')
  const to = sliceModel.readableOffsetForRaw(end, 'end')
  return Array.from(sliceModel.readableText).slice(from, Math.max(from, to)).join('')
}
for (const [name, start, end] of [['prefix', 0, 60], ['deep', 90_000, 90_060], ['whole-page', 0, 100_000]] as const) {
  expect(currentPdfSlice(start, end)).toBe(previousPdfSlice(start, end))
  test(`PDF excerpt from 100,000 code points (${name})`, async ({ bench }) => {
    await bench.compare(
      bench('before: allocate the complete page character array', { writeResult: `output/benchmarks/renderer/pdf-slice-${name}-before.json` }, () => previousPdfSlice(start, end)),
      bench('after: copy the requested range', { writeResult: `output/benchmarks/renderer/pdf-slice-${name}-after.json` }, () => currentPdfSlice(start, end)),
      options
    )
  })
}

const sparseSliceText = '甲😀'.repeat(50_000)
const sparseSliceModel = createPdfTextModel([{ str: sparseSliceText }])
const boundedPdfSlice = previousBoundedPdfSlice
const expectedSparseSlice = boundedPdfSlice(sparseSliceModel, 90_000, 90_060)
expect(sparseSliceModel.readableSliceForRaw(90_000, 90_060)).toBe(expectedSparseSlice)
const slicePoints = vi.spyOn(String.prototype, 'codePointAt')
try {
  boundedPdfSlice(sparseSliceModel, 90_000, 90_060)
  const before = slicePoints.mock.calls.length
  slicePoints.mockClear()
  expect(sparseSliceModel.readableSliceForRaw(90_000, 90_060)).toBe(expectedSparseSlice)
  const after = slicePoints.mock.calls.length
  expect(before).toBe(90_060)
  expect(after).toBeLessThanOrEqual(316)
  console.info(`PDF repeated deep excerpt: ${before} -> ${after} codePointAt calls; identical selected text.`)
} finally { slicePoints.mockRestore() }
for (const mode of ['cold', 'repeated'] as const) {
  const before = mode === 'cold'
    ? () => boundedPdfSlice(createPdfTextModel([{ str: sparseSliceText }]), 90_000, 90_060)
    : () => boundedPdfSlice(sparseSliceModel, 90_000, 90_060)
  const after = mode === 'cold'
    ? () => createPdfTextModel([{ str: sparseSliceText }]).readableSliceForRaw(90_000, 90_060)
    : () => sparseSliceModel.readableSliceForRaw(90_000, 90_060)
  expect(after()).toBe(before())
  test(`PDF sparse excerpt positions (${mode})`, async ({ bench }) => {
    // Cold includes model creation; repeated reuses one immutable page model.
    await bench.compare(
      bench('before: scan the bounded excerpt from the page start', { writeResult: `output/benchmarks/renderer/pdf-sparse-${mode}-before.json` }, before),
      bench('after: resume from the nearest recorded prefix', { writeResult: `output/benchmarks/renderer/pdf-sparse-${mode}-after.json` }, after),
      options
    )
  })
}

const textRuns = syntheticPdfTextRuns(5_001)
const mapPdfOffset = pdfTextOffset
const previousTextOffset = previousPdfTextOffset
for (const source of ['raw', 'readable'] as const) {
  const offset = textRuns[9_000][source === 'raw' ? 'rawStart' : 'readableStart'] + 1
  expect(mapPdfOffset(textRuns, offset, source, 'start')).toBe(previousTextOffset(textRuns, offset, source, 'start'))
  let reads = 0
  const measuredRuns = textRuns.map((run) => new Proxy(run, {
    get: (target, property, receiver) => { reads++; return Reflect.get(target, property, receiver) }
  }))
  const expected = previousTextOffset(measuredRuns, offset, source, 'start')
  const before = reads
  reads = 0
  expect(mapPdfOffset(measuredRuns, offset, source, 'start')).toBe(expected)
  console.info(`PDF text ${source}: ${before} -> ${reads} run-field reads; identical offset.`)
  test(`PDF text mapping across 10,001 runs (${source})`, async ({ bench }) => {
    await bench.compare(
      bench('before: scan text runs from the beginning', { writeResult: `output/benchmarks/renderer/pdf-text-${source}-before.json` }, () => { previousTextOffset(textRuns, offset, source, 'start') }),
      bench('after: locate the ordered range and shared boundaries', { writeResult: `output/benchmarks/renderer/pdf-text-${source}-after.json` }, () => { mapPdfOffset(textRuns, offset, source, 'start') }),
      options
    )
  })
}

// Reading-line baseline from d446f01; synthetic bounds exclude browser layout cost.
function previousPdfReadingPosition(count: number, line: number, measure: (index: number) => PdfPageBounds): PdfPositionAnchor {
  let best = 0, distance = Number.POSITIVE_INFINITY
  for (let index = 0; index < count; index++) {
    const rect = measure(index)
    if (rect.top <= line && rect.bottom >= line) {
      return { pageNumber: index + 1, fraction: Math.min(1, Math.max(0, (line - rect.top) / Math.max(1, rect.height))) }
    }
    const candidate = Math.min(Math.abs(rect.top - line), Math.abs(rect.bottom - line))
    if (candidate < distance) { best = index; distance = candidate }
  }
  const rect = measure(best)
  return { pageNumber: best + 1, fraction: Math.min(1, Math.max(0, (line - rect.top) / Math.max(1, rect.height))) }
}

const pdfBounds = Array.from({ length: 5_000 }, (_, index) => ({ top: index * 1_020, bottom: index * 1_020 + 1_000, height: 1_000 }))
const pdfReadingLine = 4_500 * 1_020 + 300
// Capture the module-runner export once, outside the measured hot loop.
const lookupPdfPosition = pdfReadingPosition
for (const [mode, hint] of [['jump', 0], ['hinted', 4_500]] as const) {
  let beforeReads = 0, afterReads = 0
  const oldPosition = previousPdfReadingPosition(pdfBounds.length, pdfReadingLine, (index) => { beforeReads++; return pdfBounds[index] })
  const newPosition = pdfReadingPosition(pdfBounds.length, pdfReadingLine, (index) => { afterReads++; return pdfBounds[index] }, hint)
  expect(newPosition).toEqual(oldPosition)
  expect(afterReads).toBeLessThanOrEqual(mode === 'hinted' ? 1 : Math.ceil(Math.log2(pdfBounds.length)) + 3)
  console.info(`PDF ${mode}: ${beforeReads} -> ${afterReads} page-bound reads; identical position.`)
  test(`PDF reading position across 5,000 synthetic pages (${mode})`, async ({ bench }) => {
    await bench.compare(
      bench('before: scan page bounds from the beginning', { writeResult: `output/benchmarks/renderer/pdf-reading-${mode}-before.json` }, () => { previousPdfReadingPosition(pdfBounds.length, pdfReadingLine, (index) => pdfBounds[index]) }),
      bench('after: use the current hint and ordered lookup', { writeResult: `output/benchmarks/renderer/pdf-reading-${mode}-after.json` }, () => { lookupPdfPosition(pdfBounds.length, pdfReadingLine, (index) => pdfBounds[index], hint) }),
      options
    )
  })
}

test('long citation excerpt (28,000 source code points)', async ({ bench }) => {
  await bench.compare(
    bench('before: normalize and allocate the whole passage', { writeResult: 'output/benchmarks/renderer/citation-before.json' }, () => { previousExcerpt(passage) }),
    bench('after: stop at the visible excerpt boundary', { writeResult: 'output/benchmarks/renderer/citation-after.json' }, () => { citationExcerpt(passage) }),
    options
  )
})

function previousSourcePreview(text: string): string {
  return Array.from(text).slice(0, 60).join('')
}
expect(limitText(passage, 60)).toBe(previousSourcePreview(passage))
test('source preview from 28,000 source code points', async ({ bench }) => {
  await bench.compare(
    bench('before: allocate all source code points', { writeResult: 'output/benchmarks/renderer/source-preview-before.json' }, () => { previousSourcePreview(passage) }),
    bench('after: copy only the first 60 code points', { writeResult: 'output/benchmarks/renderer/source-preview-after.json' }, () => { limitText(passage, 60) }),
    options
  )
})

const fragments = Array.from({ length: 1_000 }, (_, index) => index % 5 ? '解释 **证据** [P1]。' : '\n\n')
function consumeBurst(buffered: boolean): { answer: string; updates: number } {
  let answer = '', updates = 0
  const render = (event: LlmEvent): void => {
    if (event.type !== 'delta') return
    answer += event.delta
    parseMarkdown(answer)
    updates += 1
  }
  const buffer = new LlmEventBuffer()
  for (const delta of fragments) {
    const event: LlmEvent = { type: 'delta', requestId: 'benchmark', delta }
    if (buffered) buffer.push(event, render)
    else render(event)
  }
  buffer.flush()
  buffer.dispose()
  return { answer, updates }
}

const before = consumeBurst(false), after = consumeBurst(true)
expect(after.answer).toBe(before.answer)
expect(before.updates).toBe(1_000)
expect(after.updates).toBe(2)

// Synchronous synthetic burst, including the real Markdown parser, not an
// end-to-end latency or FPS measurement. IPC, network and painting are excluded.
test('1,000-fragment burst with Markdown parsing', async ({ bench }) => {
  await bench.compare(
    bench('before: publish and parse every fragment', { writeResult: 'output/benchmarks/renderer/stream-before.json' }, () => { consumeBurst(false) }),
    bench('after: publish the first and coalesced remainder', { writeResult: 'output/benchmarks/renderer/stream-after.json' }, () => { consumeBurst(true) }),
    options
  )
})

function consumeCadence(buffered: boolean, intervalMs: number): { answer: string; updates: number } {
  // Fake only delivery timers. The benchmark clock and CPU measurements remain real.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const buffer = new LlmEventBuffer()
  let answer = '', updates = 0
  const render = (event: LlmEvent): void => {
    if (event.type !== 'delta') return
    answer += event.delta
    parseMarkdown(answer)
    updates++
  }
  try {
    for (const [index, delta] of fragments.entries()) {
      if (index) vi.advanceTimersByTime(intervalMs)
      const event: LlmEvent = { type: 'delta', requestId: 'cadence', delta }
      if (buffered) buffer.push(event, render)
      else render(event)
    }
    buffer.flush()
    return { answer, updates }
  } finally {
    buffer.dispose()
    vi.useRealTimers()
  }
}

for (const [intervalMs, expectedUpdates] of [[10, 500], [50, 1_000]]) {
  const unbuffered = consumeCadence(false, intervalMs), buffered = consumeCadence(true, intervalMs)
  expect(buffered.answer).toBe(unbuffered.answer)
  expect(buffered.updates).toBe(expectedUpdates)
  console.info(`Cadence ${intervalMs} ms: ${unbuffered.updates} -> ${buffered.updates} publications; identical final text.`)
  test(`1,000 fragments delivered every ${intervalMs} ms with Markdown parsing`, async ({ bench }) => {
    await bench.compare(
      bench('before: publish every timed fragment', { writeResult: `output/benchmarks/renderer/cadence-${intervalMs}-before.json` }, () => { consumeCadence(false, intervalMs) }),
      bench('after: coalesce timed fragments', { writeResult: `output/benchmarks/renderer/cadence-${intervalMs}-after.json` }, () => { consumeCadence(true, intervalMs) }),
      options
    )
  })
}
