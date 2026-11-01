// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { PdfTextLayerIndex } from '../../src/renderer/src/readers/pdf-dom-text'
import { previousPdfDomPoint } from '../performance/support/legacy-pdf-dom-point'

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren() })

function layer(items: Array<[number, number, string]>) {
  const root = document.createElement('div')
  const spans = items.map(([start, end, text], index) => {
    const span = document.createElement('span')
    span.dataset.pdfTextStart = String(start); span.dataset.pdfTextEnd = String(end)
    span.textContent = text
    const parent = index % 2 ? document.createElement('div') : root
    if (parent !== root) root.append(parent)
    parent.append(span)
    return span
  })
  document.body.append(root)
  return { root, spans }
}

it('preserves original native endpoints across Unicode, empty spans, gaps and shared boundaries', () => {
  const fixtures: Array<Array<[number, number, string]>> = [
    [], [[0, 2, '甲😀'], [2, 2, ''], [2, 4, '𠮷乙'], [4, 7, 'é尾']],
    [[0, 2, '\uD800A'], [5, 7, '\uDC00乙']],
    [[0, 0, ''], [0, 3, '甲😀乙'], [3, 3, ''], [3, 4, '终']],
    [[0, 4, '甲😀乙丙'], [2, 6, '重叠边界']]
  ]
  for (const items of fixtures) {
    const { root } = layer(items), index = new PdfTextLayerIndex(root)
    for (const offset of [-1, ...Array.from({ length: 20 }, (_, i) => i / 2), Number.NaN, Number.POSITIVE_INFINITY]) {
      const expected = previousPdfDomPoint(root, offset), actual = index.point(offset)
      expect(actual?.node).toBe(expected?.node)
      expect(actual?.offset).toBe(expected?.offset)
    }
  }
})

it('keeps DOM-first matching when a text layer has unordered or nested ranges', () => {
  for (const items of [
    [[5, 7, '后😀'], [0, 2, '前😀'], [2, 5, 'é中']],
    [[0, 10, '长段落甲😀乙丙丁戊己'], [2, 5, '内部段'], [5, 12, '尾部范围甲乙丙']]
  ] as Array<Array<[number, number, string]>>) {
    const { root } = layer(items), index = new PdfTextLayerIndex(root)
    for (let offset = 0; offset < 14; offset++) {
      const expected = previousPdfDomPoint(root, offset), actual = index.point(offset)
      expect(actual?.node).toBe(expected?.node)
      expect(actual?.offset).toBe(expected?.offset)
    }
  }
})

it('skips missing or removed nodes and rebuilds against a replaced text layer', () => {
  const { root, spans } = layer([[0, 0, ''], [0, 2, '甲😀'], [2, 4, '𠮷乙']])
  const index = new PdfTextLayerIndex(root)
  spans[1].remove()
  expect(index.point(1)).toBeNull()
  expect(index.point(2)?.node).toBe(spans[2].firstChild)
  spans[2].replaceChildren()
  expect(index.point(3)).toBeNull()
  root.replaceChildren()
  const replacement = document.createElement('span')
  replacement.dataset.pdfTextStart = '0'; replacement.dataset.pdfTextEnd = '2'
  replacement.textContent = '新😀'; root.append(replacement)
  expect(index.point(1)).toBeNull()
  expect(new PdfTextLayerIndex(root).point(1)).toEqual({ node: replacement.firstChild, offset: 1 })
})

it('bounds ordered lookup work across 5,000 spans without repeating DOM queries', () => {
  const { root, spans } = layer(Array.from({ length: 5_000 }, (_, index): [number, number, string] => [index * 100, (index + 1) * 100, '甲😀'.repeat(50)]))
  const index = new PdfTextLayerIndex(root)
  const entries = Reflect.get(index, 'spans') as Array<{ element: HTMLElement; start: number; end: number }>
  let reads = 0
  entries.forEach((entry, i) => { entries[i] = new Proxy(entry, {
    get: (target, key, receiver) => { if (key === 'start' || key === 'end') reads++; return Reflect.get(target, key, receiver) }
  }) })
  const query = vi.spyOn(root, 'querySelectorAll')
  for (const offset of [0, 450_050, 500_000, 500_001]) {
    query.mockClear()
    const expected = previousPdfDomPoint(root, offset)
    expect(query).toHaveBeenCalledOnce()
    query.mockClear(); reads = 0
    const actual = index.point(offset)
    expect(actual?.node).toBe(expected?.node)
    expect(actual?.offset).toBe(expected?.offset)
    expect(query).not.toHaveBeenCalled()
    expect(reads).toBeLessThanOrEqual(20)
  }
  expect(index.point(450_050)).toEqual({ node: spans[4_500].firstChild, offset: 75 })
})

it('converts only the needed Unicode prefix without expanding a 100,000-code-point node', () => {
  const text = '甲😀'.repeat(50_000)
  const { root, spans } = layer([[0, 100_000, text]])
  const index = new PdfTextLayerIndex(root)
  const iterator = String.prototype[Symbol.iterator]
  vi.spyOn(String.prototype, Symbol.iterator).mockImplementation(function (this: string) {
    if (this.valueOf() === text) throw new Error('The full text node must not be expanded')
    return iterator.call(this)
  })
  const point = vi.spyOn(String.prototype, 'codePointAt')
  expect(index.point(40)).toEqual({ node: spans[0].firstChild, offset: 60 })
  expect(point).toHaveBeenCalledTimes(40)
})
