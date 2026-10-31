interface TextPosition { node: Text; offset: number }

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
