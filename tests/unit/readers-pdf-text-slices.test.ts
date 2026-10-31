import { afterEach, expect, it, vi } from 'vitest'
import { createPdfTextModel, type PdfTextContentItem } from '../../src/renderer/src/readers/pdf-text'

afterEach(() => vi.restoreAllMocks())

it('matches the original character-array slices across Unicode fragments, whitespace and line breaks', () => {
  const fixtures: PdfTextContentItem[][] = [
    [], [{ str: '', hasEOL: true }],
    [{ str: '甲😀\uD800Z\uDC00é', hasEOL: true }, { str: '𠮷乙' }, { str: ' \t丙', hasEOL: true }, { str: '丁' }],
    [{ str: '\uD800' }, { str: '\uDC00', hasEOL: true }, { str: '👩🏽‍💻 ', hasEOL: true }, { str: '' }, { str: 'é\uFEFF甲' }]
  ]
  for (const items of fixtures) {
    const model = createPdfTextModel(items)
    const characters = Array.from(model.readableText)
    for (let start = 0; start <= model.rawLength; start++) for (let end = start; end <= model.rawLength; end++) {
      const from = model.readableOffsetForRaw(start, 'start')
      const to = model.readableOffsetForRaw(end, 'end')
      expect(model.readableSliceForRaw(start, end)).toBe(characters.slice(from, Math.max(from, to)).join(''))
    }
  }
})

it.each([[0, 60], [90_000, 90_060]])('only copies the selected characters for a short range %s..%s', (start, end) => {
  const text = '甲😀'.repeat(50_000)
  const selected = '甲😀'.repeat(30)
  const model = createPdfTextModel([{ str: text }])
  const iterator = String.prototype[Symbol.iterator]
  const codePointAt = String.prototype.codePointAt
  let copied = 0, scanned = 0
  vi.spyOn(String.prototype, Symbol.iterator).mockImplementation(function* (this: string): Generator<string, undefined, unknown> {
    const value = this.valueOf()
    if (value === text) throw new Error('A short range must not expand the complete page')
    for (const point of iterator.call(this)) {
      if (value === selected) copied++
      yield point
    }
    return undefined
  })
  vi.spyOn(String.prototype, 'codePointAt').mockImplementation(function (this: string, offset: number) {
    if (this.valueOf() === text) {
      if (offset >= end * 1.5) throw new Error('The unused page tail must not be scanned')
      scanned++
    }
    return codePointAt.call(this, offset)
  })
  const actual = model.readableSliceForRaw(start, end)
  expect([scanned, copied]).toEqual([end, 60])
  expect(actual).toBe(selected)
})

it('returns empty ranges without scanning or expanding the page', () => {
  const text = '甲😀'.repeat(50_000)
  const model = createPdfTextModel([{ str: text }])
  vi.spyOn(String.prototype, 'codePointAt').mockImplementation(() => { throw new Error('Empty ranges must not scan text') })
  const iterator = String.prototype[Symbol.iterator]
  vi.spyOn(String.prototype, Symbol.iterator).mockImplementation(function (this: string) {
    if (this.valueOf() === text) throw new Error('Empty ranges must not expand the page')
    return iterator.call(this)
  })
  expect(model.readableSliceForRaw(50_000, 50_000)).toBe('')
})

it('copies a complete page in one character iteration without scanning it again', () => {
  const text = '甲😀'.repeat(50_000)
  const model = createPdfTextModel([{ str: text }])
  let iterations = 0
  const iterator = String.prototype[Symbol.iterator]
  vi.spyOn(String.prototype, Symbol.iterator).mockImplementation(function (this: string) {
    if (this.valueOf() === text) iterations++
    return iterator.call(this)
  })
  vi.spyOn(String.prototype, 'codePointAt').mockImplementation(() => { throw new Error('Whole pages already have known bounds') })
  expect(model.readableSliceForRaw(0, model.rawLength)).toBe(text)
  expect(iterations).toBe(1)
})

it('keeps invalid raw ranges empty', () => {
  const model = createPdfTextModel([{ str: '甲😀乙' }])
  for (const [start, end] of [[-1, 1], [0, 4], [2, 1], [0.5, 1], [0, Number.NaN], [0, Number.POSITIVE_INFINITY]]) {
    expect(model.readableSliceForRaw(start, end)).toBe('')
  }
})
