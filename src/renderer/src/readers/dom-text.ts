interface TextPosition { node: Text; offset: number }

/** First ordered, non-overlapping block containing, contained by, or following the node. */
export function findOrderedElementAtOrAfterIndex(elements: ReadonlyArray<{ element: Element }>, node: Node): number {
  let low = 0, high = elements.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    const position = elements[middle].element.compareDocumentPosition(node)
    if (position & Node.DOCUMENT_POSITION_DISCONNECTED) return -1
    if (position & Node.DOCUMENT_POSITION_FOLLOWING && !(position & Node.DOCUMENT_POSITION_CONTAINED_BY)) low = middle + 1
    else high = middle
  }
  return low < elements.length ? low : -1
}

/** Elements follow document order and do not contain one another. */
export function findOrderedContainingElementIndex(elements: ReadonlyArray<{ element: Element }>, node: Node): number {
  let low = 0, high = elements.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2), element = elements[middle].element
    if (element === node) return middle
    const position = element.compareDocumentPosition(node)
    if (position & Node.DOCUMENT_POSITION_DISCONNECTED) return -1
    if (position & Node.DOCUMENT_POSITION_CONTAINED_BY) return middle
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) low = middle + 1
    else high = middle
  }
  return -1
}

/** Convert code point offsets to a native range without collecting the unused text tail. */
export function rangeForCodePointSlice(element: Element, start: number, end: number): Range {
  const range = element.ownerDocument.createRange()
  const walker = element.ownerDocument.createTreeWalker(element, 4)
  const remaining = [Math.max(0, start), Math.max(0, end)]
  const positions: Array<TextPosition | null> = [null, null]
  let last: Text | null = null
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    const node = current as Text
    last = node
    for (let index = 0; index < 2; index++) {
      if (!positions[index] && remaining[index] === 0) positions[index] = { node, offset: 0 }
    }
    if (positions[0] && positions[1]) break
    const text = node.data
    let offset = 0
    while (offset < text.length) {
      for (let index = 0; index < 2; index++) {
        if (!positions[index] && remaining[index] < 1) positions[index] = { node, offset }
      }
      if (positions[0] && positions[1]) break
      offset += text.codePointAt(offset)! > 0xffff ? 2 : 1
      for (let index = 0; index < 2; index++) {
        if (!positions[index]) {
          remaining[index]--
          if (remaining[index] === 0) positions[index] = { node, offset }
        }
      }
    }
    if (positions[0] && positions[1]) break
  }
  if (!last) range.selectNodeContents(element)
  else {
    const fallback = { node: last, offset: last.length }
    const from = positions[0] ?? fallback, to = positions[1] ?? fallback
    range.setStart(from.node, from.offset)
    range.setEnd(to.node, to.offset)
  }
  return range
}

/** Nonnegative integer endpoints must be nondecreasing; keep the DOM stable while iterating. */
export function* rangesForOrderedCodePointSlices(element: Element, slices: ReadonlyArray<{ start: number; end: number }>, leadingCharacters = 0): Generator<Range, void> {
  if (!slices.length) return
  const walker = element.ownerDocument.createTreeWalker(element, 4)
  let node = walker.nextNode() as Text | null
  let text = node?.data ?? '', utf16 = 0, characters = 0
  const point = (target: number): TextPosition | null => {
    if (!node) return null
    while (characters < target) {
      if (utf16 < text.length) {
        utf16 += text.codePointAt(utf16)! > 0xffff ? 2 : 1
        characters++
      } else {
        const next = walker.nextNode() as Text | null
        if (!next) break
        node = next; text = node.data; utf16 = 0
      }
    }
    return { node, offset: utf16 }
  }
  for (const slice of slices) {
    const from = point(leadingCharacters + slice.start), to = point(leadingCharacters + slice.end)
    const range = element.ownerDocument.createRange()
    if (!from || !to) range.selectNodeContents(element)
    else { range.setStart(from.node, from.offset); range.setEnd(to.node, to.offset) }
    yield range
  }
}
