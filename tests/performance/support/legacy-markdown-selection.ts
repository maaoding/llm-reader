import type { MarkdownParagraph } from '../../../src/renderer/src/readers/markdown-document'

/** Selection mapping before the native-text-point path; never used in production. */
export function previousMarkdownSelection(block: MarkdownParagraph) {
  return (node: Node, offset: number, last = false): number => {
    const range = block.element.ownerDocument.createRange()
    range.selectNodeContents(block.element)
    range.setEnd(node, offset)
    return block.sourceOffset(range.toString().length, last)
  }
}
