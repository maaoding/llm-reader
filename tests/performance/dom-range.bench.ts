// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { rangeForCodePointSlice } from '../../src/renderer/src/readers/dom-text'
import { renderMarkdownDocument } from '../../src/renderer/src/readers/markdown-document'
import { markdownOffsetFixture } from './support/legacy-markdown-offset'
import { previousMarkdownPoint } from './support/legacy-markdown-point'
import { previousMarkdownSelection } from './support/legacy-markdown-selection'

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
