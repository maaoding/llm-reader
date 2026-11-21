// @vitest-environment jsdom
import { afterAll, expect, test, vi } from 'vitest'
import { findOrderedContainingElementIndex, rangeForCodePointSlice } from '../../src/renderer/src/readers/dom-text'
import { buildBoundedPassages, type ContextBlock } from '../../src/renderer/src/readers/context'
import { EpubParagraphIndex, extractParagraphs } from '../../src/renderer/src/readers/epub-paragraphs'
import { PdfTextLayerIndex } from '../../src/renderer/src/readers/pdf-dom-text'
import { previousPdfDomPoint } from './support/legacy-pdf-dom-point'
import { PdfReaderAdapter } from '../../src/renderer/src/readers/pdf-reader'
import { createPdfTextModel, makePdfTextAnchor } from '../../src/renderer/src/readers/pdf-text'
import { previousPdfSelectionContext, type PdfContextFixture } from './support/legacy-pdf-context'
import { renderMarkdownDocument } from '../../src/renderer/src/readers/markdown-document'
import { markdownOffsetFixture } from './support/legacy-markdown-offset'
import { previousMarkdownPoint } from './support/legacy-markdown-point'
import { previousMarkdownSelection } from './support/legacy-markdown-selection'
import { TextReaderAdapter } from '../../src/renderer/src/readers/text-reader'
import { previousTextSearchDocument, type TextSearchFixture } from './support/legacy-text-search-offsets'
import { extractEpubDocument } from '../../src/renderer/src/readers/book-extraction'
import { previousEpubDocument } from './support/legacy-epub-extraction'
import { epubExtractionFixture } from './support/epub-extraction-fixture'
import type { NormalizedDocument } from '../../src/shared/contracts'

// Original EPUB mapping: collect all text nodes separately for both endpoints.
function previousRange(element: Element, start: number, end: number): Range {
  const position = (value: number) => {
    const nodes: Text[] = []
    const walker = element.ownerDocument.createTreeWalker(element, 4)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
    let remaining = Math.max(0, value)
    for (const node of nodes) {
      const characters = Array.from(node.data)
      if (remaining <= characters.length) return { node, offset: characters.slice(0, remaining).join('').length }
      remaining -= characters.length
    }
    const last = nodes.at(-1)!
    return { node: last, offset: last.length }
  }
  const from = position(start), to = position(end)
  const range = element.ownerDocument.createRange()
  range.setStart(from.node, from.offset)
  range.setEnd(to.node, to.offset)
  return range
}

const manyNodes = document.createElement('p')
for (let index = 0; index < 2_500; index++) {
  const span = document.createElement('span')
  span.textContent = '甲😀'
  manyNodes.append(span)
}
const longText = document.createElement('p')
longText.textContent = '甲😀'.repeat(14_000)
const boundedRange = rangeForCodePointSlice
const options = { time: 300, iterations: 3, warmupTime: 100, warmupIterations: 1 }

for (const kind of ['long-chapter', 'many-chapters', 'shared-targets', 'long-paragraph', 'toc-boundaries'] as const) {
  test(`EPUB whole-document extraction (${kind})`, async ({ bench }) => {
    const chapters = Array.from({ length: kind === 'many-chapters' ? 40 : 1 }, (_, chapter) => ({
      href: `chapter-${chapter}.xhtml`, body: '<div id="body">' + `<h1 id="start">章 ${chapter}</h1>` +
        (kind === 'toc-boundaries' ? Array.from({ length: 600 }, (_, index) => `<h2 id="p${index}">子章 ${index}</h2><p>正文 ${index} 😀。</p>`).join('') :
          kind === 'long-paragraph' ? `<p id="p0">  ${'甲😀𠮷 é，保留原文定位。'.repeat(7_000)} </p>` :
          Array.from({ length: kind === 'many-chapters' ? 3 : 600 }, (_, index) => `<p id="p${index}"> 段落 ${chapter}-${index} 😀𠮷 é，保留原文定位。 </p>`).join('')) +
        (kind === 'shared-targets' ? '<p>全部<a href="#notes">脚注</a>。</p><aside id="notes" epub:type="footnote">' + Array.from({ length: 200 }, (_, index) => `<p>脚注 ${index} 😀。</p>`).join('') + '</aside>' : '') + '</div>'
    }))
    const toc = chapters.map(({ href }, index) => `<li><a href="${href}#start">章 ${index}</a><ol>${kind === 'toc-boundaries' ? Array.from({ length: 600 }, (_, boundary) => `<li><a href="${href}#p${boundary}">子章 ${boundary}</a></li>`).join('') : `<li><a href="${href}#p0">子章 ${index}</a></li>`}</ol></li>`).join('')
    const payload = await epubExtractionFixture(chapters, toc)
    const before = () => previousEpubDocument(payload, new AbortController().signal)
    const after = () => extractEpubDocument(payload, new AbortController().signal)
    const expected = await before()
    expect(await after()).toEqual(expected)
    // With --execArgv=--expose-gc, discard prior jsdom archives outside each timed extraction.
    const collectGarbage = Reflect.get(globalThis, 'gc') as (() => void) | undefined
    const reset = { beforeEach: () => collectGarbage?.() }
    console.info(`EPUB extraction ${kind}: per-sample explicit GC ${collectGarbage ? 'enabled' : 'disabled'}.`)
    let sink = 0
    const consume = (document: NormalizedDocument): void => {
      for (const node of document.nodes) sink = (sink + node.anchor.length) >>> 0
      for (const unit of document.units) {
        sink = (sink + unit.text.length) >>> 0
        for (const source of unit.sources) sink = (sink + source.anchor.length) >>> 0
      }
    }
    // Includes opening the real synthetic archive, sanitization, CFI creation, document assembly and cleanup.
    // No visible rendition, layout, IPC, persistence, or external model service is measured.
    await bench.compare(
      bench('before: unused CFIs, TOC rescans, copied targets and repeated slice prefixes', { ...reset, writeResult: `output/benchmarks/renderer/epub-extraction-${kind}-before.json` }, async () => consume(await before())),
      bench('after: retained CFIs, grouped paths, appended notes and ordered ranges/boundaries', { ...reset, writeResult: `output/benchmarks/renderer/epub-extraction-${kind}-after.json` }, async () => consume(await after())),
      { time: kind === 'many-chapters' ? 4_000 : 1_000, iterations: kind === 'many-chapters' ? 21 : 7, warmupTime: 200, warmupIterations: 2 }
    )
    expect(sink).toBeGreaterThan(0)
  })
}

const previousSearchOffsets = previousTextSearchDocument
const searchOffsetAdapters: TextReaderAdapter[] = []
afterAll(() => searchOffsetAdapters.forEach((adapter) => adapter.destroy()))
const denseSearchQuery = '[Alpha].+😀'.repeat(10)
const denseSearchText = Array.from({ length: 205 }, (_, index) => index % 2 ? denseSearchQuery.toLowerCase() : denseSearchQuery).join('')
for (const fixture of ['plain-dense', 'markdown-dense', 'markdown-deep'] as const) {
  const adapter = new TextReaderAdapter(document.createElement('div'), { bookId: 'search-offset-benchmark' })
  searchOffsetAdapters.push(adapter)
  await adapter.setTextMode(fixture === 'plain-dense' ? 'plain' : 'markdown')
  const source = fixture === 'markdown-deep' ? `${'甲😀'.repeat(50_000)}**目标😀**末尾` : denseSearchText
  const query = fixture === 'markdown-deep' ? '目标😀' : denseSearchQuery
  await adapter.open(new TextEncoder().encode(source))
  const revision = Reflect.get(adapter, 'searchRevision') as number
  const previous = previousSearchOffsets.bind(adapter as unknown as TextSearchFixture)
  const current = Reflect.get(adapter, 'searchDocument').bind(adapter) as typeof previous
  const before = () => previous(query, revision), after = () => current(query, revision)
  const expected = await before()
  expect(await after()).toEqual(expected)
  const points = vi.spyOn(String.prototype, 'codePointAt')
  try {
    expect(await before()).toEqual(expected)
    const previousReads = points.mock.calls.length
    points.mockClear()
    expect(await after()).toEqual(expected)
    console.info(`Search offsets ${fixture}: ${previousReads} -> ${points.mock.calls.length} codePointAt calls; identical anchors, excerpts and titles.`)
  } finally { points.mockRestore() }
  let searchSink = 0
  const consume = (results: Awaited<ReturnType<typeof after>>): void => {
    for (const result of results) searchSink = (searchSink + result.anchor.length + result.excerpt.length + result.chapterTitle.length) >>> 0
  }
  test(`TXT search offset accounting (${fixture})`, async ({ bench }) => {
    // Prepared paragraphs: includes matching, excerpt creation and anchors, but not parsing, UI or the public task queue.
    await bench.compare(
      bench('before: recount prefixes and prior hits', { writeResult: `output/benchmarks/renderer/search-offset-${fixture}-before.json` }, async () => consume(await before())),
      bench('after: count only offsets needed by the active mode', { writeResult: `output/benchmarks/renderer/search-offset-${fixture}-after.json` }, async () => consume(await after())),
      options
    )
    expect(searchSink).toBeGreaterThan(0)
  })
}

const previousPdfContext = previousPdfSelectionContext
const pdfContextModels = ['甲😀', '乙😀', '丙😀'].map((text) => createPdfTextModel([{ str: text.repeat(50_000) }]))
const pdfContextAdapters: PdfReaderAdapter[] = []
afterAll(() => pdfContextAdapters.forEach((adapter) => adapter.destroy()))
for (const position of ['start', 'middle'] as const) for (const mode of ['cold', 'repeated'] as const) {
  const adapter = new PdfReaderAdapter(document.createElement('div'), { bookId: 'pdf-context-benchmark' })
  pdfContextAdapters.push(adapter)
  Reflect.set(adapter, 'pages', pdfContextModels.map((textModel, index) => ({ pageNumber: index + 1, textModel, renderRevision: 0 })))
  const page = position === 'start' ? 1 : 2, start = position === 'start' ? 0 : 50_000, end = start + 20
  const quote = (position === 'start' ? '甲😀' : '乙😀').repeat(10), anchor = makePdfTextAnchor(page, start, end)
  const previous = previousPdfContext.bind(adapter as unknown as PdfContextFixture)
  const current = Reflect.get(adapter, 'selectionContextForRawRange').bind(adapter) as typeof previous
  const before = () => previous(page, start, end, quote, anchor)
  const after = () => {
    if (mode === 'cold') Reflect.set(adapter, 'contextLengths', new WeakMap())
    return current(page, start, end, quote, anchor)
  }
  const expected = before()
  expect(after()).toEqual(expected)
  if (mode === 'repeated') {
    const points = vi.spyOn(String.prototype, 'codePointAt')
    try {
      expect(before()).toEqual(expected)
      const previousReads = points.mock.calls.length
      points.mockClear()
      expect(after()).toEqual(expected)
      const reads = points.mock.calls.length
      expect(previousReads - reads).toBe(100_000)
      console.info(`PDF context ${position}: ${previousReads} -> ${reads} codePointAt calls; identical quote, passages and raw anchors.`)
    } finally { points.mockRestore() }
  }
  let contextSink = 0
  const consume = (context: ReturnType<typeof after>): void => {
    if (!context) throw new Error('Expected synthetic PDF context')
    contextSink = (contextSink + context.quote.length + context.anchor.length) >>> 0
    for (const passage of context.passages) contextSink = (contextSink + passage.text.length + passage.anchor.length + passage.id.length) >>> 0
  }
  test(`PDF selection context lengths (${position}/${mode})`, async ({ bench }) => {
    // Prepared models only; cold includes the initial exact length count, with no PDF parsing or DOM selection.
    await bench.compare(
      bench('before: recount full readable pages', { writeResult: `output/benchmarks/renderer/pdf-context-${position}-${mode}-before.json` }, () => consume(before())),
      bench('after: reuse exact model lengths lazily', { writeResult: `output/benchmarks/renderer/pdf-context-${position}-${mode}-after.json` }, () => consume(after())),
      options
    )
    expect(contextSink).toBeGreaterThan(0)
  })
}

for (const kind of ['many-spans', 'long-node'] as const) {
  const root = document.createElement('div')
  const count = kind === 'many-spans' ? 5_000 : 1
  const text = kind === 'many-spans' ? '甲😀'.repeat(50) : '甲😀'.repeat(50_000)
  const length = kind === 'many-spans' ? 100 : 100_000
  for (let i = 0; i < count; i++) {
    const span = document.createElement('span')
    span.dataset.pdfTextStart = String(i * length); span.dataset.pdfTextEnd = String((i + 1) * length)
    span.textContent = text; root.append(span)
  }
  const index = new PdfTextLayerIndex(root)
  const start = kind === 'many-spans' ? 450_050 : 0, end = start + 40
  const before = () => [previousPdfDomPoint(root, start), previousPdfDomPoint(root, end)]
  const after = () => [index.point(start), index.point(end)]
  const expected = before(), actual = after()
  for (let i = 0; i < 2; i++) {
    expect(actual[i]?.node).toBe(expected[i]?.node)
    expect(actual[i]?.offset).toBe(expected[i]?.offset)
  }
  let endpointSink = 0
  const consume = (points: ReturnType<typeof after>): void => {
    for (const point of points) {
      if (!point) throw new Error('Expected a synthetic PDF text endpoint')
      endpointSink = (endpointSink + point.offset + point.node.nodeType) >>> 0
    }
  }
  test(`PDF indexed DOM endpoints (${kind})`, async ({ bench }) => {
    // Index construction, PDF parsing, layout and painting are outside the measured lookups.
    await bench.compare(
      bench('before: query and scan spans, then expand node characters', { writeResult: `output/benchmarks/renderer/pdf-dom-${kind}-before.json` }, () => consume(before())),
      bench('after: reuse ordered spans and scan only needed node prefixes', { writeResult: `output/benchmarks/renderer/pdf-dom-${kind}-after.json` }, () => consume(after())),
      options
    )
    expect(endpointSink).toBeGreaterThan(0)
  })
}

const contextRoot = document.createElement('section')
for (let index = 0; index < 5_000; index++) {
  const paragraph = document.createElement('p')
  paragraph.textContent = index % 50 === 0 ? ' \n ' : `  ${index} ${'甲😀'.repeat(500)} `
  contextRoot.append(paragraph)
}
const contents = { content: contextRoot }, paragraphIndex = new EpubParagraphIndex()
afterAll(() => paragraphIndex.clear())
const focus = { startBlock: 2_500, startOffset: 500, endBlock: 2_500, endOffset: 501 }
const previousEpubContext = () => buildBoundedPassages(extractParagraphs(contents).map((paragraph, index) => ({
  id: `P${index + 1}`, text: paragraph.text,
  anchorForSlice: (start: number, end: number) => `${paragraph.index}:${start}:${end}`
})), focus)
const indexedEpubContext = () => {
  const paragraphs = paragraphIndex.get(contents)
  return buildBoundedPassages({
    length: paragraphs.length,
    at: (index): ContextBlock | undefined => {
      const paragraph = paragraphs[index]
      return paragraph ? {
        id: `P${index + 1}`, text: (paragraph.element.textContent ?? '').trim(),
        anchorForSlice: (start, end) => `${paragraph.index}:${start}:${end}`
      } : undefined
    }
  }, focus)
}
// Prime the chapter index: this comparison covers subsequent selections only.
const expectedEpubContext = previousEpubContext()
expect(indexedEpubContext()).toEqual(expectedEpubContext)
const paragraphText = vi.spyOn(Node.prototype, 'textContent', 'get')
try {
  previousEpubContext()
  const before = paragraphText.mock.calls.length
  paragraphText.mockClear()
  expect(indexedEpubContext()).toEqual(expectedEpubContext)
  const after = paragraphText.mock.calls.length
  expect(before).toBe(5_000)
  expect(after).toBeLessThanOrEqual(13)
  console.info(`EPUB repeated selection: ${before} -> ${after} paragraph text reads; identical passage IDs, text and slice offsets.`)
} finally { paragraphText.mockRestore() }
test('EPUB repeated selection context across 5,000 paragraphs', async ({ bench }) => {
  // Synthetic jsdom preparation and bounded copying; excludes CFI, layout and painting.
  await bench.compare(
    bench('before: extract and wrap every paragraph', { writeResult: 'output/benchmarks/renderer/epub-context-before.json' }, previousEpubContext),
    bench('after: reuse the index and read the context window', { writeResult: 'output/benchmarks/renderer/epub-context-after.json' }, indexedEpubContext),
    options
  )
})

const orderedRoot = document.createElement('section')
const orderedParagraphs = Array.from({ length: 5_000 }, () => {
  const element = document.createElement('p')
  element.innerHTML = '<span>甲😀</span><strong>乙𠮷</strong>'
  orderedRoot.append(element)
  return { element }
})
const findContaining = findOrderedContainingElementIndex
for (const [name, node] of [
  ['text', orderedParagraphs.at(-1)!.element.firstChild!.firstChild!],
  ['element', orderedParagraphs.at(-1)!.element]
] as const) {
  const before = () => orderedParagraphs.findIndex(({ element }) => element.contains(node))
  const after = () => findContaining(orderedParagraphs, node)
  const contains = vi.spyOn(Node.prototype, 'contains'), compare = vi.spyOn(Node.prototype, 'compareDocumentPosition')
  try {
    const expected = before(), beforeChecks = contains.mock.calls.length + compare.mock.calls.length
    contains.mockClear(); compare.mockClear()
    const actual = after(), afterChecks = contains.mock.calls.length + compare.mock.calls.length
    expect(actual).toBe(expected)
    expect(afterChecks).toBeLessThanOrEqual(14)
    console.info(`EPUB containing paragraph ${name}: ${beforeChecks} -> ${afterChecks} DOM comparisons; identical paragraph index.`)
  } finally { contains.mockRestore(); compare.mockRestore() }
  test(`EPUB endpoint lookup across 5,000 ordered paragraphs (${name})`, async ({ bench }) => {
    await bench.compare(
      bench('before: check every preceding paragraph', { writeResult: `output/benchmarks/renderer/epub-containing-${name}-before.json` }, before),
      bench('after: search document order', { writeResult: `output/benchmarks/renderer/epub-containing-${name}-after.json` }, after),
      options
    )
  })
}

const markdownBlock = renderMarkdownDocument('甲😀'.repeat(50_000), document).paragraphs[0]
const previousMarkdownLookup = previousMarkdownPoint(markdownBlock)
const currentMarkdownLookup = markdownBlock.point
const markdownNode = markdownBlock.element.firstChild as Text
const originalLength = Object.getOwnPropertyDescriptor(markdownNode, 'length')
const markdownLength = markdownNode.length
let lengthReads = 0
Object.defineProperty(markdownNode, 'length', { configurable: true, get: () => { lengthReads++; return markdownLength } })
try {
  const expected = previousMarkdownLookup(90_000)
  const before = lengthReads
  lengthReads = 0
  const actual = currentMarkdownLookup(90_000)
  expect(actual?.node).toBe(expected?.node)
  expect(actual?.offset).toBe(expected?.offset)
  expect(lengthReads).toBeLessThanOrEqual(3)
  console.info(`Markdown point: ${before} -> ${lengthReads} Text.length reads; identical native endpoint.`)
} finally {
  if (originalLength) Object.defineProperty(markdownNode, 'length', originalLength)
  else Reflect.deleteProperty(markdownNode, 'length')
}
for (const [name, position, last] of [['start-near-end', 90_000, false], ['end-near-start', 60, true]] as const) {
  const expected = previousMarkdownLookup(position, last), actual = currentMarkdownLookup(position, last)
  expect(actual?.node).toBe(expected?.node)
  expect(actual?.offset).toBe(expected?.offset)
  test(`Markdown raw anchor across 100,000 source code points (${name})`, async ({ bench }) => {
    await bench.compare(
      bench('before: scan source maps character by character', { writeResult: `output/benchmarks/renderer/markdown-point-${name}-before.json` }, () => previousMarkdownLookup(position, last)),
      bench('after: locate the ordered run and character boundary', { writeResult: `output/benchmarks/renderer/markdown-point-${name}-after.json` }, () => currentMarkdownLookup(position, last)),
      options
    )
  })
}

const markdownOffsets = markdownOffsetFixture(1_000, document)
const previousOffsetLookup = markdownOffsets.previous
const currentOffsetLookup = markdownOffsets.block.sourceOffset
const originalLengths = markdownOffsets.nodes.map((node) => Object.getOwnPropertyDescriptor(node, 'length'))
const nodeLengths = markdownOffsets.nodes.map((node) => node.length)
let offsetReads = 0
markdownOffsets.nodes.forEach((node, index) => {
  Object.defineProperty(node, 'length', { configurable: true, get: () => { offsetReads++; return nodeLengths[index] } })
})
try {
  const expected = previousOffsetLookup(3_999)
  const before = offsetReads
  offsetReads = 0
  expect(currentOffsetLookup(3_999)).toBe(expected)
  expect(offsetReads).toBeLessThanOrEqual(12)
  console.info(`Markdown source offset: ${before} -> ${offsetReads} Text.length reads; identical raw anchor.`)
} finally {
  markdownOffsets.nodes.forEach((node, index) => {
    const descriptor = originalLengths[index]
    if (descriptor) Object.defineProperty(node, 'length', descriptor)
    else Reflect.deleteProperty(node, 'length')
  })
}
for (const [name, position, last] of [['start-near-end', 3_999, false], ['end-near-start', 1, true]] as const) {
  expect(currentOffsetLookup(position, last)).toBe(previousOffsetLookup(position, last))
  test(`Markdown visible offset across 2,000 inline runs (${name})`, async ({ bench }) => {
    await bench.compare(
      bench('before: scan or reverse the inline run list', { writeResult: `output/benchmarks/renderer/markdown-offset-${name}-before.json` }, () => previousOffsetLookup(position, last)),
      bench('after: locate the ordered run boundary', { writeResult: `output/benchmarks/renderer/markdown-offset-${name}-after.json` }, () => currentOffsetLookup(position, last)),
      options
    )
  })
}

for (const [name, block, node, start, end] of [
  ['long-text', markdownBlock, markdownNode, 135_000, 135_030],
  ['many-nodes', markdownOffsets.block, markdownOffsets.nodes.at(-1)!, 0, 1]
] as const) {
  const previousSelection = previousMarkdownSelection(block)
  const currentSelection = block.sourceOffsetForPoint
  const before = () => [previousSelection(node, start), previousSelection(node, end, true)]
  const after = () => [currentSelection(node, start), currentSelection(node, end, true)]
  const stringify = Range.prototype.toString
  let prefixUnits = 0
  Range.prototype.toString = function () {
    const text = stringify.call(this)
    prefixUnits += text.length
    return text
  }
  try {
    const expected = before(), copied = prefixUnits
    prefixUnits = 0
    expect(after()).toEqual(expected)
    expect(prefixUnits).toBe(0)
    console.info(`Markdown selection ${name}: ${copied} -> ${prefixUnits} prefix UTF-16 units; identical raw endpoints.`)
  } finally { Range.prototype.toString = stringify }
  test(`Markdown native selection mapping (${name})`, async ({ bench }) => {
    await bench.compare(
      bench('before: stringify each paragraph prefix', { writeResult: `output/benchmarks/renderer/markdown-selection-${name}-before.json` }, before),
      bench('after: use the rendered text-node mapping', { writeResult: `output/benchmarks/renderer/markdown-selection-${name}-after.json` }, after),
      options
    )
  })
}

for (const [name, element, end] of [['many-nodes', manyNodes, 10], ['long-text', longText, 60]] as const) {
  const before = previousRange(element, 0, end), after = boundedRange(element, 0, end)
  expect([after.startContainer, after.startOffset, after.endContainer, after.endOffset, after.toString()])
    .toEqual([before.startContainer, before.startOffset, before.endContainer, before.endOffset, before.toString()])
  test(`DOM text range bounded lookup (${name})`, async ({ bench }) => {
    await bench.compare(
      bench('before: collect all text nodes and character arrays', { writeResult: `output/benchmarks/renderer/dom-range-${name}-before.json` }, () => { previousRange(element, 0, end) }),
      bench('after: stop once both endpoints are found', { writeResult: `output/benchmarks/renderer/dom-range-${name}-after.json` }, () => { boundedRange(element, 0, end) }),
      options
    )
  })
}
