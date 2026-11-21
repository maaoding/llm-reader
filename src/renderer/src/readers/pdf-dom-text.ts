interface TextSpan {
  element: HTMLElement
  start: number
  end: number
}

/** A snapshot of one committed text layer; rebuild it when that layer is rendered again. */
export class PdfTextLayerIndex {
  private readonly spans: TextSpan[]
  private readonly ordered: boolean

  constructor(private readonly root: HTMLElement) {
    this.spans = Array.from(root.querySelectorAll<HTMLElement>('[data-pdf-text-start]'), (element) => ({
      element, start: Number(element.dataset.pdfTextStart), end: Number(element.dataset.pdfTextEnd)
    }))
    this.ordered = this.spans.every((span, index) => Number.isSafeInteger(span.start) &&
      Number.isSafeInteger(span.end) && span.start >= 0 && span.end >= span.start &&
      (index === 0 || this.spans[index - 1].start <= span.start && this.spans[index - 1].end <= span.end))
  }

  point(offset: number): { node: Node; offset: number } | null {
    let low = 0, high = this.spans.length
    if (this.ordered) {
      while (low < high) {
        const middle = low + Math.floor((high - low) / 2)
        if (this.spans[middle].end < offset) low = middle + 1
        else high = middle
      }
    }
    // The first inclusive match wins at a shared edge, just like the original DOM scan.
    for (let index = low; index < this.spans.length; index++) {
      const { element, start, end } = this.spans[index]
      if (this.ordered && start > offset) break
      if (offset < start || offset > end || !this.root.contains(element)) continue
      const node = element.firstChild
      if (!node) continue
      const text = node.textContent ?? ''
      let remaining = Math.trunc(offset - start) || 0, utf16 = 0
      while (remaining-- > 0 && utf16 < text.length) utf16 += text.codePointAt(utf16)! > 0xffff ? 2 : 1
      return { node, offset: utf16 }
    }
    return null
  }
}
