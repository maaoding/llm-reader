// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { rangeForCodePointSlice } from '../../src/renderer/src/readers/dom-text'

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren() })

// Original EPUB mapping, retained only as a compatibility reference.
function previousRange(element: Element, start: number, end: number): Range {
  const position = (value: number) => {
    const nodes: Text[] = []
    const walker = element.ownerDocument.createTreeWalker(element, 4)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
    let remaining = Math.max(0, value)
    for (const node of nodes) {
      const characters = Array.from(node.data)
      if (remaining <= characters.length) return { node, offset: characters.slice(0, remaining).join('').length }
      remaining -= characters.length
    }
    const last = nodes.at(-1)
    return last ? { node: last, offset: last.length } : null
  }
  const range = element.ownerDocument.createRange()
  const from = position(start), to = position(end)
  if (!from || !to) range.selectNodeContents(element)
  else { range.setStart(from.node, from.offset); range.setEnd(to.node, to.offset) }
  return range
}

it('preserves native endpoints across nested text, Unicode, empty nodes and boundary offsets', () => {
  const element = document.createElement('p')
  element.append(document.createTextNode(''))
  for (const [tag, text] of [['span', ' 甲😀'], ['strong', '𠮷é'], ['em', ''], ['span', '\uD800Z\uDC00']]) {
    const child = document.createElement(tag)
    child.append(document.createTextNode(text))
    element.append(child)
  }
  element.append(document.createTextNode('  '))
  const offsets = [-3, ...Array.from({ length: 27 }, (_, index) => index / 2), 20, Number.POSITIVE_INFINITY, Number.NaN]
  for (const start of offsets) for (const end of offsets) {
    const expected = previousRange(element, start, end)
    const actual = rangeForCodePointSlice(element, start, end)
    expect([actual.startContainer, actual.startOffset, actual.endContainer, actual.endOffset, actual.toString()])
      .toEqual([expected.startContainer, expected.startOffset, expected.endContainer, expected.endOffset, expected.toString()])
  }
})

it('selects the original element contents when it has no text nodes', () => {
  const element = document.createElement('p')
  element.innerHTML = '<br><span></span>'
  const range = rangeForCodePointSlice(element, 1, 10)
  expect(range.startContainer).toBe(element)
  expect(range.endContainer).toBe(element)
  expect([range.startOffset, range.endOffset]).toEqual([0, 2])
})

it('stops walking after the required fifth text node instead of collecting a 2,500-node tail', () => {
  const element = document.createElement('p')
  for (let index = 0; index < 2_500; index++) {
    const span = document.createElement('span')
    span.textContent = '甲😀'
    element.append(span)
  }
  const next = vi.spyOn(TreeWalker.prototype, 'nextNode')
  const previous = previousRange(element, 0, 10)
  expect(next).toHaveBeenCalledTimes(5_002)
  next.mockClear()
  const range = rangeForCodePointSlice(element, 0, 10)
  expect(next).toHaveBeenCalledTimes(5)
  expect(range.toString()).toBe(previous.toString())
})

it('reads only the requested prefix of a long text node without allocating its complete character array', () => {
  const element = document.createElement('p')
  const text = '😀'.repeat(100_000)
  element.textContent = text
  const iterator = String.prototype[Symbol.iterator]
  vi.spyOn(String.prototype, Symbol.iterator).mockImplementation(function (this: string) {
    if (this.valueOf() === text) throw new Error('The unused source tail must not be expanded')
    return iterator.call(this)
  })
  const points = vi.spyOn(String.prototype, 'codePointAt')
  const range = rangeForCodePointSlice(element, 0, 60)
  expect(points).toHaveBeenCalledTimes(60)
  expect(range.toString()).toBe('😀'.repeat(60))
})
