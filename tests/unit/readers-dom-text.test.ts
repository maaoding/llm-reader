// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { findOrderedContainingElementIndex, findOrderedElementAtOrAfterIndex, rangeForCodePointSlice, rangesForOrderedCodePointSlices } from '../../src/renderer/src/readers/dom-text'

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren() })

it('finds authored boundaries inside, around and between leaf blocks like the original two-pass EPUB lookup', () => {
  const root = document.createElement('section')
  root.innerHTML = '<span></span><!--before--><div><h1>总论</h1><p><em>😀甲</em>乙</p><span></span><ul><li><p>条目</p></li></ul></div><div><p></p><span></span><blockquote><p>正文</p></blockquote></div><!--after--><span></span>'
  document.body.append(root)
  const elements = Array.from(root.querySelectorAll('h1,p'), (element) => ({ element }))
  const walker = document.createTreeWalker(root), targets: Node[] = [root, document, document.body, document.head]
  for (let node = walker.nextNode(); node; node = walker.nextNode()) targets.push(node)
  for (const node of targets) {
    let expected = elements.findIndex(({ element }) => element === node || element.contains(node) || node.contains(element))
    if (expected < 0) expected = elements.findIndex(({ element }) => Boolean(node.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING))
    expect(findOrderedElementAtOrAfterIndex(elements, node)).toBe(expected)
  }
  expect(findOrderedElementAtOrAfterIndex([], root)).toBe(-1)
  expect(findOrderedElementAtOrAfterIndex(elements, document.createElement('p'))).toBe(-1)
})

it('bounds boundary lookups for a TOC target near the end of 5,000 ordered paragraphs', () => {
  const root = document.createElement('section')
  const elements = Array.from({ length: 5_000 }, () => {
    const element = document.createElement('p'); element.textContent = '甲😀'; root.append(element)
    return { element }
  })
  const target = document.createElement('span'); root.insertBefore(target, elements.at(-1)!.element)
  const compare = vi.spyOn(Node.prototype, 'compareDocumentPosition')
  const contains = vi.spyOn(Node.prototype, 'contains')
  expect(elements.findIndex(({ element }) => element.contains(target) || target.contains(element))).toBe(-1)
  expect(elements.findIndex(({ element }) => Boolean(target.compareDocumentPosition(element) & 4))).toBe(4_999)
  const before = compare.mock.calls.length + contains.mock.calls.length
  compare.mockClear(); contains.mockClear()
  expect(findOrderedElementAtOrAfterIndex(elements, target)).toBe(4_999)
  const after = compare.mock.calls.length + contains.mock.calls.length
  expect(before).toBe(15_000)
  expect(after).toBeLessThanOrEqual(13)
  console.info(`EPUB authored boundary: ${before} -> ${after} DOM comparisons; identical empty-anchor position.`)
})

it('finds the same containing leaf for text, inline elements, comments, empty blocks and table cells', () => {
  const root = document.createElement('section')
  root.innerHTML = '<p><span>甲😀</span><!--note--><b>乙</b></p><ul><li><p><em>𠮷</em></p></li></ul><table><tbody><tr><td>丙</td><td><i>丁</i></td></tr></tbody></table><p></p><div><p>终点</p></div>'
  document.body.append(root)
  const elements = Array.from(root.querySelectorAll('p,td'), (element) => ({ element }))
  const targets: Node[] = [root, document, document.body]
  const walker = document.createTreeWalker(root)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) targets.push(node)
  for (const node of targets) {
    expect(findOrderedContainingElementIndex(elements, node))
      .toBe(elements.findIndex(({ element }) => element.contains(node)))
  }
})

it('rejects empty lists, detached endpoints and nodes belonging to another document', () => {
  const element = document.createElement('p'), node = document.createTextNode('甲😀')
  element.append(node); document.body.append(element)
  expect(findOrderedContainingElementIndex([], node)).toBe(-1)
  node.remove()
  expect(findOrderedContainingElementIndex([{ element }], node)).toBe(-1)
  const other = document.implementation.createHTMLDocument('Isolated fixture')
  expect(findOrderedContainingElementIndex([{ element }], other.body)).toBe(-1)
  expect(findOrderedContainingElementIndex([{ element }], element)).toBe(0)
})

it('uses fresh document order after paragraphs are moved', () => {
  const root = document.createElement('section')
  root.innerHTML = '<p>甲</p><p>乙</p><p>丙</p>'
  const last = root.lastElementChild!
  const ordered = () => Array.from(root.children, (element) => ({ element }))
  expect(findOrderedContainingElementIndex(ordered(), last.firstChild!)).toBe(2)
  root.prepend(last)
  expect(findOrderedContainingElementIndex(ordered(), last.firstChild!)).toBe(0)
})

it('bounds DOM comparisons when locating the last of 5,000 paragraphs', () => {
  const root = document.createElement('section')
  const elements = Array.from({ length: 5_000 }, () => {
    const element = document.createElement('p')
    element.textContent = '甲😀'; root.append(element)
    return { element }
  })
  const node = elements.at(-1)!.element.firstChild!
  const contains = vi.spyOn(Node.prototype, 'contains')
  const compare = vi.spyOn(Node.prototype, 'compareDocumentPosition')
  const expected = elements.findIndex(({ element }) => element.contains(node))
  expect(contains.mock.calls.length + compare.mock.calls.length).toBe(5_000)
  contains.mockClear(); compare.mockClear()
  const actual = findOrderedContainingElementIndex(elements, node)
  const comparisons = contains.mock.calls.length + compare.mock.calls.length
  expect(actual).toBe(expected)
  expect(actual).toBe(4_999)
  expect(comparisons).toBeLessThanOrEqual(14)
})

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

it('preserves ordered slice endpoints, shared node boundaries and leading whitespace across Unicode text nodes', () => {
  const root = document.createElement('p')
  root.append(document.createTextNode(''))
  for (const text of ['  ', '甲😀', '', '𠮷é', '\uD800', '\uDC00Z', '  ']) {
    const child = document.createElement('span'); child.append(document.createTextNode(text)); root.append(child)
  }
  for (const leading of [0, 1, 2]) {
    const slices = [{ start: 0, end: 0 }, { start: 0, end: 2 }, { start: 2, end: 2 }, { start: 2, end: 5 }, { start: 7, end: 10 }, { start: 20, end: 25 }]
    const actual = Array.from(rangesForOrderedCodePointSlices(root, slices, leading))
    for (const [index, slice] of slices.entries()) {
      const expected = rangeForCodePointSlice(root, leading + slice.start, leading + slice.end), range = actual[index]
      expect([range.startContainer, range.startOffset, range.endContainer, range.endOffset, range.toString()])
        .toEqual([expected.startContainer, expected.startOffset, expected.endContainer, expected.endOffset, expected.toString()])
    }
  }
})

it('preserves empty-element fallback and consumes no text tail for ordered prefix slices', () => {
  const empty = document.createElement('p'); empty.innerHTML = '<br><span></span>'
  for (const range of rangesForOrderedCodePointSlices(empty, [{ start: 0, end: 0 }, { start: 1, end: 10 }])) {
    expect([range.startContainer, range.startOffset, range.endContainer, range.endOffset]).toEqual([empty, 0, empty, 2])
  }
  const root = document.createElement('p')
  for (let index = 0; index < 2_500; index++) {
    const span = document.createElement('span'); span.textContent = '甲😀'; root.append(span)
  }
  const next = vi.spyOn(TreeWalker.prototype, 'nextNode')
  expect(Array.from(rangesForOrderedCodePointSlices(root, []))).toEqual([])
  expect(next).not.toHaveBeenCalled()
  const ranges = Array.from(rangesForOrderedCodePointSlices(root, [{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 6, end: 10 }]))
  expect(next).toHaveBeenCalledTimes(5)
  expect(ranges.map((range) => range.toString())).toEqual(['甲😀', '甲😀', '甲😀甲😀'])
})

it('scans a long paragraph once for consecutive slices instead of rescanning their prefixes', () => {
  const root = document.createElement('p'); root.textContent = '甲😀'.repeat(10_000)
  const slices = Array.from({ length: 20 }, (_, index) => ({ start: index * 1_000, end: (index + 1) * 1_000 }))
  const points = vi.spyOn(String.prototype, 'codePointAt')
  const expected = slices.map((slice) => rangeForCodePointSlice(root, slice.start, slice.end))
  const before = points.mock.calls.length
  points.mockClear()
  const actual = Array.from(rangesForOrderedCodePointSlices(root, slices))
  const after = points.mock.calls.length
  expect(before).toBe(210_000)
  expect(after).toBe(20_000)
  expect(actual.map((range) => [range.startOffset, range.endOffset, range.toString()]))
    .toEqual(expected.map((range) => [range.startOffset, range.endOffset, range.toString()]))
  console.info(`EPUB ordered source slices: ${before} -> ${after} codePointAt calls; identical native ranges.`)
})
