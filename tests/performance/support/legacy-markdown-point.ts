import type { MarkdownParagraph } from '../../../src/renderer/src/readers/markdown-document'

/** Rebuild the original point maps through the independently tested visible-to-source API. */
export function previousMarkdownPoint(block: MarkdownParagraph): MarkdownParagraph['point'] {
  const runs: Array<{ node: Text; start: number[]; end: number[] }> = []
  const walker = block.element.ownerDocument.createTreeWalker(block.element, 4)
  let base = 0
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    const node = current as Text, length = node.length
    if (!length) continue
    const start = Array.from({ length }, (_, index) => block.sourceOffset(base + index))
    const end = Array.from({ length: length + 1 }, (_, index) => block.sourceOffset(base + index, index > 0))
    runs.push({ node, start, end })
    base += length
  }
  // Original linear point lookup from d446f01; never used in production.
  return (position, last = false) => {
    const candidates = last ? [...runs].reverse() : runs
    for (const run of candidates) {
      if (last) {
        for (let index = run.node.length; index > 0; index--) if (run.start[index - 1] < position) return { node: run.node, offset: index }
      } else {
        for (let index = 0; index < run.node.length; index++) if (run.end[index + 1] > position) return { node: run.node, offset: index }
      }
    }
    const run = last ? runs[0] : runs.at(-1)
    return run ? { node: run.node, offset: last ? 0 : run.node.length } : null
  }
}
