/** PDF text-layer lookup from 9ff41d9: query and scan every preceding span per endpoint. */
export function previousPdfDomPoint(root: HTMLElement, offset: number): { node: Node; offset: number } | null {
  const spans = Array.from(root.querySelectorAll<HTMLElement>('[data-pdf-text-start]'))
  for (const span of spans) {
    const start = Number(span.dataset.pdfTextStart), end = Number(span.dataset.pdfTextEnd)
    if (offset < start || offset > end) continue
    const node = span.firstChild
    if (!node) continue
    return { node, offset: Array.from(node.textContent ?? '').slice(0, offset - start).join('').length }
  }
  return null
}
