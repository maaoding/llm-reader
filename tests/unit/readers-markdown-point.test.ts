// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { renderMarkdownDocument } from '../../src/renderer/src/readers/markdown-document'
import { previousMarkdownPoint } from '../performance/support/legacy-markdown-point'

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren() })

it('preserves native endpoints across Unicode, entities, formatting gaps, code, tables and empty blocks', () => {
  const fixtures = [
    '甲**😀乙**丙 &amp; \\*星\\* é 𠮷。',
    '前**&NotEqualTilde;**后 &fjlig; 尾\n\n[链接](https://invalid.example/) ![图片](data:text/plain,ignored)',
    '> 外层 **😀**\n> 第二行 `甲\n> 乙`\n>\n> > 内层 *𠮷*\n\n- 项目一\n  - **二**',
    '```ts\n  const x = "😀"\n\n  结尾\n```\n\n    缩进代码𠮷\n',
    '| 左 | 右 |\n| --- | --- |\n| | 😀 |\n| **甲** | &amp; |',
    '<script>literal("😀")</script>\n\n---',
    '\uD800A\uDC00 **甲** é'
  ]
  for (const source of fixtures) {
    const rendered = renderMarkdownDocument(source, document)
    document.body.append(rendered.fragment)
    for (const block of rendered.paragraphs) {
      const previous = previousMarkdownPoint(block)
      const positions = [Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY,
        ...Array.from({ length: (block.end - block.start + 4) * 2 + 1 }, (_, index) => block.start - 2 + index / 2)]
      for (const position of positions) for (const last of [false, true]) {
        const expected = previous(position, last), actual = block.point(position, last)
        expect(actual?.node).toBe(expected?.node)
        expect(actual?.offset).toBe(expected?.offset)
      }
    }
  }
})

it('bounds long-paragraph point lookup instead of checking 135,001 text lengths', () => {
  const block = renderMarkdownDocument('甲😀'.repeat(50_000), document).paragraphs[0]
  const previous = previousMarkdownPoint(block)
  const node = block.element.firstChild as Text
  const length = node.length
  const reads = vi.spyOn(node, 'length', 'get').mockReturnValue(length)
  const expected = previous(90_000)
  const before = reads.mock.calls.length
  reads.mockClear()
  const actual = block.point(90_000)
  const after = reads.mock.calls.length
  expect(before).toBe(135_001)
  expect(after).toBeLessThanOrEqual(3)
  expect(actual?.node).toBe(expected?.node)
  expect(actual?.offset).toBe(135_000)
})

it('resolves an end point across 2,000 inline runs without copying a reversed run list', () => {
  const block = renderMarkdownDocument('**甲**乙'.repeat(1_000), document).paragraphs[0]
  expect(block.element.childNodes).toHaveLength(2_000)
  const reverse = vi.spyOn(Array.prototype, 'reverse')
  const actual = block.point(3, true)
  const copies = reverse.mock.calls.length
  reverse.mockRestore()
  expect(copies).toBe(0)
  expect(actual?.node).toBe(block.element.querySelector('strong')!.firstChild)
  expect(actual?.offset).toBe(1)
})
