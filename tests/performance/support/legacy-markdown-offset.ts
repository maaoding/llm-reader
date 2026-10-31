import { renderMarkdownDocument } from '../../../src/renderer/src/readers/markdown-document'

/** Known literal spans, independent of sourceOffset and point, for the original lookup. */
export function markdownOffsetFixture(repetitions: number, document: Document) {
  const block = renderMarkdownDocument('**甲😀**乙'.repeat(repetitions), document).paragraphs[0]
  const nodes: Text[] = []
  const walker = document.createTreeWalker(block.element, 4)
  for (let current = walker.nextNode(); current; current = walker.nextNode()) nodes.push(current as Text)
  if (nodes.length !== repetitions * 2) throw new Error('Unexpected Markdown fixture runs')
  const runs = nodes.map((node, index) => {
    const strong = index % 2 === 0, base = Math.floor(index / 2) * 7
    if (node.data !== (strong ? '甲😀' : '乙')) throw new Error('Unexpected Markdown fixture text')
    return {
      node, offset: Math.floor(index / 2) * 4 + (strong ? 0 : 3),
      start: strong ? [base + 2, base + 3, base + 3, base + 4] : [base + 6, base + 7],
      end: strong ? [base + 2, base + 3, base + 4, base + 4] : [base + 6, base + 7]
    }
  })
  // Original linear visible-to-source lookup from d446f01; never used in production.
  const previous = (position: number, last = false): number => {
    const value = Math.max(0, Math.min(repetitions * 4, position))
    if (value === 0) return runs[0].start[0]
    if (value === repetitions * 4) return runs.at(-1)!.end.at(-1)!
    const run = (last ? [...runs].reverse() : runs).find((item) => last
      ? value > item.offset && value <= item.offset + item.node.length
      : value >= item.offset && value < item.offset + item.node.length)
    if (run) return (last ? run.end : run.start)[value - run.offset]
    return last ? runs.at(-1)!.end.at(-1)! : runs[0].start[0]
  }
  return { block, nodes, previous }
}
