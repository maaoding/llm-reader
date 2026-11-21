// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { markdownAnchor, renderMarkdownDocument } from '../../src/renderer/src/readers/markdown-document'
import { markdownOffsetFixture } from '../performance/support/legacy-markdown-offset'

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren() })

it('preserves visible-to-source boundaries across formatting, surrogate pairs, entities, escapes and code', () => {
  const fixtures = [
    { source: '前**甲😀**后', visible: '前甲😀后', start: [0, 3, 4, 4, 7, 8], end: [0, 1, 4, 5, 5, 8] },
    { source: '前&NotEqualTilde;后', visible: '前≂̸后', start: [0, 1, 1, 16, 17], end: [0, 1, 16, 16, 17] },
    { source: '**&fjlig;**', visible: 'fj', start: [2, 2, 9], end: [2, 9, 9] },
    { source: '前\\*星\\* **末**', visible: '前*星* 末', start: [0, 2, 3, 5, 6, 9, 10], end: [0, 1, 3, 4, 6, 7, 10] },
    { source: '`甲\n乙` **丙**', visible: '甲\n乙 丙', start: [1, 2, 3, 5, 8, 9], end: [1, 2, 3, 4, 6, 9] }
  ]
  for (const fixture of fixtures) {
    const block = renderMarkdownDocument(fixture.source, document).paragraphs[0]
    expect(block.visibleText).toBe(fixture.visible)
    for (let index = 0; index <= fixture.visible.length; index++) {
      expect(block.sourceOffset(index)).toBe(fixture.start[index])
      expect(block.sourceOffset(index, true)).toBe(fixture.end[index])
    }
  }
  const block = renderMarkdownDocument('前**甲😀**后', document).paragraphs[0]
  expect(markdownAnchor(block, 1, 4)).toBe('txt:3:5')
})

it('matches the original lookup for every inline boundary, fractional offset and invalid position', () => {
  const { block, previous } = markdownOffsetFixture(12, document)
  const positions = [Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY,
    ...Array.from({ length: (block.visibleText.length + 4) * 2 + 1 }, (_, index) => -2 + index / 2)]
  for (const position of positions) for (const last of [false, true]) {
    expect(block.sourceOffset(position, last)).toBe(previous(position, last))
  }
})

it('retains empty-block and paragraph-edge fallback coordinates', () => {
  const empty = renderMarkdownDocument('---', document).paragraphs[0]
  expect(empty.visibleText).toBe('')
  for (const last of [false, true]) {
    for (const position of [-1, 0, 0.5, 1, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
      expect(empty.sourceOffset(position, last)).toBe(0)
    }
    expect(empty.sourceOffset(Number.NaN, last)).toBe(last ? 3 : 0)
  }
  const block = renderMarkdownDocument('**甲**', document).paragraphs[0]
  expect(block.sourceOffset(-1)).toBe(2)
  expect(block.sourceOffset(2, true)).toBe(3)
  expect(block.sourceOffset(Number.NaN)).toBe(2)
  expect(block.sourceOffset(Number.NaN, true)).toBe(3)
})

it('bounds visible-to-source lookup across 2,000 inline runs', () => {
  const { block, nodes, previous } = markdownOffsetFixture(1_000, document)
  const reads = nodes.map((node) => {
    const length = node.length
    return vi.spyOn(node, 'length', 'get').mockReturnValue(length)
  })
  const expected = previous(3_999)
  const before = reads.reduce((total, read) => total + read.mock.calls.length, 0)
  reads.forEach((read) => read.mockClear())
  const actual = block.sourceOffset(3_999)
  const after = reads.reduce((total, read) => total + read.mock.calls.length, 0)
  expect(before).toBe(2_000)
  expect(after).toBeLessThanOrEqual(12)
  expect(actual).toBe(expected)
  expect(actual).toBe(6_999)
})

it('resolves end-biased inline boundaries without copying a reversed run list', () => {
  const { block } = markdownOffsetFixture(1_000, document)
  const reverse = vi.spyOn(Array.prototype, 'reverse')
  const actual = block.sourceOffset(1, true)
  const copies = reverse.mock.calls.length
  reverse.mockRestore()
  expect(copies).toBe(0)
  expect(actual).toBe(3)
})
