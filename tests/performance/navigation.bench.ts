import { mkdirSync, writeFileSync } from 'node:fs'
import { test, expect } from 'vitest'
import { cleanHeading, navigationalHeadingIndexes } from '../../src/renderer/src/readers/text-reader'
import { PdfReaderAdapter } from '../../src/renderer/src/readers/pdf-reader'

type Paragraph = Parameters<typeof navigationalHeadingIndexes>[0][number]
const tidyHeading = cleanHeading
const headingLookup = navigationalHeadingIndexes

// Reference behavior from 5e1d56e. Keep it out of the production bundle.
function previousHeadings(paragraphs: Paragraph[]): Set<number> {
  const headings = paragraphs.filter((p) => p.heading)
  if (headings.length < 4) return new Set(headings.map((p) => p.index))
  const dense = new Set<number>()
  let run = [headings[0]]
  for (const heading of headings.slice(1)) {
    if (heading.start - run.at(-1)!.start <= 256) run.push(heading)
    else {
      if (run.length >= 4) run.forEach((p) => dense.add(p.index))
      run = [heading]
    }
  }
  if (run.length >= 4) run.forEach((p) => dense.add(p.index))
  const end = paragraphs.at(-1)?.end ?? 0
  const spans = new Map(headings.map((p, i) => [p.index, Math.max(0, (headings[i + 1]?.start ?? end) - p.start)]))
  const normalize = (value: string): string => tidyHeading(value).normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase()
  const retained = headings.filter((heading) => !dense.has(heading.index) || !headings.some((candidate) => {
    if (candidate.index === heading.index) return false
    const left = normalize(heading.text), right = normalize(candidate.text)
    return (left === right || Math.min(left.length, right.length) >= 4 && (left.startsWith(right) || right.startsWith(left))) &&
      spans.get(candidate.index)! > spans.get(heading.index)!
  }))
  return new Set((retained.length ? retained : headings).map((p) => p.index))
}

const paragraphs: Paragraph[] = []
let cursor = 0
function paragraph(text: string, heading: boolean): void {
  paragraphs.push({ index: paragraphs.length, text, heading, start: cursor, end: cursor + text.length })
  cursor += text.length + 2
}
for (let i = 0; i < 800; i++) paragraph(`# 第${i + 1}章 概念与边界`, true)
paragraph('前言。'.repeat(200), false)
for (let i = 0; i < 800; i++) {
  paragraph(`# 第${i + 1}章 概念与边界`, true)
  paragraph('解释成立条件及适用范围。'.repeat(60), false)
}
expect(headingLookup(paragraphs)).toEqual(previousHeadings(paragraphs))

let geometryReads = 0
const pages = Array.from({ length: 10_000 }, (_, index) => ({
  pageNumber: index + 1,
  element: { getBoundingClientRect: () => {
    geometryReads++
    const top = index * 1024 - (9000 * 1024 + 400)
    return { top, bottom: top + 1000, height: 1000 }
  } }
}))
function previousPage() {
  let best = pages[0], distance = Infinity
  for (const page of pages) {
    const rect = page.element.getBoundingClientRect()
    if (rect.top <= 120 && rect.bottom >= 120) return { pageNumber: page.pageNumber, fraction: (120 - rect.top) / rect.height }
    const next = Math.min(Math.abs(rect.top - 120), Math.abs(rect.bottom - 120))
    if (next < distance) { best = page; distance = next }
  }
  const rect = best.element.getBoundingClientRect()
  return { pageNumber: best.pageNumber, fraction: Math.min(1, Math.max(0, (120 - rect.top) / rect.height)) }
}
const fixture = { pages, host: { getBoundingClientRect: () => ({ top: 0 }) }, readingLineOffset: () => 120 }
const currentLookup = PdfReaderAdapter.prototype as unknown as { currentPageAndFraction(): { pageNumber: number; fraction: number } }
const currentPage = () => currentLookup.currentPageAndFraction.call(fixture)
geometryReads = 0
const referencePage = previousPage(), previousReads = geometryReads
geometryReads = 0
expect(currentPage()).toEqual(referencePage)
const currentReads = geometryReads
const phase = process.env.LLM_READER_BENCH_PHASE ?? 'current'
const directory = 'output/benchmarks/navigation'
mkdirSync(directory, { recursive: true })
writeFileSync(`${directory}/${phase}-checks.json`, JSON.stringify({ headings: 1600, pages: pages.length, referencePage, previousReads, currentReads }, null, 2) + '\n')
const options = { time: 300, iterations: 3, warmupTime: 100, warmupIterations: 1 }

test('TXT table of contents and 800 repeated body headings', async ({ bench }) => {
  await bench.compare(
    bench('reference: scan and normalize heading pairs', { writeResult: `${directory}/${phase}-toc-reference.json` }, () => { previousHeadings(paragraphs) }),
    bench('production: find navigational headings', { writeResult: `${directory}/${phase}-toc-current.json` }, () => { headingLookup(paragraphs) }), options
  )
})

// Synthetic rectangles measure lookup CPU and geometry-call counts, not scroll FPS.
test('PDF reading position near page 9001 of 10000', async ({ bench }) => {
  await bench.compare(
    bench('reference: scan page rectangles', { writeResult: `${directory}/${phase}-pdf-reference.json` }, () => { previousPage() }),
    bench('production: find current page', { writeResult: `${directory}/${phase}-pdf-current.json` }, () => { currentPage() }), options
  )
})
