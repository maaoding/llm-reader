// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { renderMarkdownDocument } from '../../src/renderer/src/readers/markdown-document'
import { TextReaderAdapter } from '../../src/renderer/src/readers/text-reader'
import { previousMarkdownSelection } from '../performance/support/legacy-markdown-selection'

const adapters: TextReaderAdapter[] = []
afterEach(() => {
  adapters.splice(0).forEach((adapter) => adapter.destroy())
  document.getSelection()?.removeAllRanges()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

it('preserves native text and element boundaries across formatting, Unicode, entities, code and tables', () => {
  const fixtures = [
    '# 标题\n\n前**甲😀**后 &amp; \\*星\\* é 𠮷。',
    '**&NotEqualTilde;** &fjlig;\n\n[链接](https://invalid.example/) ![图片](data:text/plain,ignored)',
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
      const previous = previousMarkdownSelection(block)
      const nodes: Node[] = [block.element]
      const walker = document.createTreeWalker(block.element)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node)
      for (const node of nodes) {
        const length = node.nodeType === Node.TEXT_NODE ? (node as Text).length : node.childNodes.length
        for (let position = 0; position <= length; position++) for (const last of [false, true]) {
          expect(block.sourceOffsetForPoint(node, position, last)).toBe(previous(node, position, last))
        }
      }
    }
  }
})

it('retains DOM offset coercion and errors for invalid or out-of-range text positions', () => {
  const block = renderMarkdownDocument('前**甲😀**后', document).paragraphs[0]
  const node = block.element.querySelector('strong')!.firstChild!
  const previous = previousMarkdownSelection(block)
  const outcome = (run: () => number) => {
    try { return { value: run() } }
    catch (error) { return { error: (error as Error).name } }
  }
  for (const position of [Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, -1, -0.5, 0.5, 1.5, 4, 2 ** 32 + 1]) {
    for (const last of [false, true]) {
      expect(outcome(() => block.sourceOffsetForPoint(node, position, last)))
        .toEqual(outcome(() => previous(node, position, last)))
    }
  }
})

it('keeps range fallback for element, newly inserted, foreign and detached endpoints', () => {
  const rendered = renderMarkdownDocument('前**甲😀**后\n\n**另一段**', document)
  document.body.append(rendered.fragment)
  const block = rendered.paragraphs[0], other = rendered.paragraphs[1]
  const previous = previousMarkdownSelection(block)
  const added = document.createTextNode('新节点')
  block.element.append(added)
  const detached = block.element.firstChild!
  detached.remove()
  const foreign = other.element.querySelector('strong')!.firstChild!
  for (const [node, position] of [[block.element, 1], [added, 2], [foreign, 1], [detached, 1]] as const) {
    for (const last of [false, true]) {
      expect(block.sourceOffsetForPoint(node, position, last)).toBe(previous(node, position, last))
    }
  }
})

it('maps a deep native text endpoint without stringifying a 135,000-unit paragraph prefix', () => {
  const block = renderMarkdownDocument('甲😀'.repeat(50_000), document).paragraphs[0]
  const node = block.element.firstChild!
  const previous = previousMarkdownSelection(block)
  const stringify = vi.spyOn(Range.prototype, 'toString')
  const expected = previous(node, 135_000)
  expect(stringify.mock.results[0].value).toHaveLength(135_000)
  stringify.mockClear()
  const actual = block.sourceOffsetForPoint(node, 135_000)
  const copies = stringify.mock.calls.length
  expect(actual).toBe(expected)
  expect(actual).toBe(90_000)
  expect(copies).toBe(0)
})

it('uses the mapped endpoint path in real Markdown selections while preserving quote and raw anchor', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const adapter = new TextReaderAdapter(host, { bookId: 'markdown-selection-prefix' })
  adapters.push(adapter)
  await adapter.setTextMode('markdown')
  await adapter.open(new TextEncoder().encode('甲😀'.repeat(10_000)))
  const paragraph = host.querySelector('p')!, node = paragraph.firstChild!
  const range = document.createRange()
  range.setStart(node, 27_000); range.setEnd(node, 27_030)
  const selection = document.getSelection()!
  selection.removeAllRanges(); selection.addRange(range)
  const stringify = Range.prototype.toString
  let prefixUnits = 0
  vi.spyOn(Range.prototype, 'toString').mockImplementation(function (this: Range) {
    const text = stringify.call(this)
    if (this.startContainer === paragraph) prefixUnits += text.length
    return text
  })
  document.dispatchEvent(new Event('selectionchange'))
  const selected = adapter.getSelection()
  expect(selected).toMatchObject({ quote: '甲😀'.repeat(10), anchor: 'txt:18000:18020' })
  expect(selected!.passages.reduce((count, passage) => count + Array.from(passage.text).length, 0)).toBeLessThanOrEqual(6_000)
  expect(prefixUnits).toBe(0)
})
