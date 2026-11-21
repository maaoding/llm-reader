// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { SelectionContext } from '../../src/shared/contracts'
import { PdfReaderAdapter } from '../../src/renderer/src/readers/pdf-reader'
import { createPdfTextModel, makePdfTextAnchor, type PdfTextModel } from '../../src/renderer/src/readers/pdf-text'
import { previousPdfSelectionContext } from '../performance/support/legacy-pdf-context'

const adapters: PdfReaderAdapter[] = []
afterEach(() => { adapters.splice(0).forEach((adapter) => adapter.destroy()); vi.restoreAllMocks() })

function setup(models: Array<PdfTextModel | null>) {
  const pages = models.map((textModel, index) => ({ pageNumber: index + 1, textModel, renderRevision: 0 }))
  const adapter = new PdfReaderAdapter(document.createElement('div'), { bookId: 'pdf-context-lengths' })
  adapters.push(adapter)
  Reflect.set(adapter, 'pages', pages)
  const select = (pageNumber: number, start: number, end: number, anchor = makePdfTextAnchor(pageNumber, start, end)): SelectionContext | null =>
    Reflect.get(adapter, 'selectionContextForRawRange').call(adapter, pageNumber, start, end, '所选内容', anchor)
  const previous = (pageNumber: number, start: number, end: number, anchor = makePdfTextAnchor(pageNumber, start, end)) =>
    previousPdfSelectionContext.call({ pages, callbacks: { bookId: 'pdf-context-lengths' }, sectionAt: () => ({ title: '全文' }) }, pageNumber, start, end, '所选内容', anchor)
  return { adapter, pages, select, previous }
}

it('reuses a 100,000-code-point page length without scanning its full text for every selection', () => {
  const model = createPdfTextModel([{ str: '甲😀'.repeat(50_000) }])
  const { select } = setup([model])
  const first = select(1, 0, 20)
  const points = vi.spyOn(String.prototype, 'codePointAt')
  expect(select(1, 0, 20)).toEqual(first)
  expect(points.mock.calls.length).toBeLessThanOrEqual(6_000)
})

it('preserves page IDs, raw anchors and bounded passages across Unicode and split-surrogate text items', () => {
  const joined = createPdfTextModel([{ str: '\uD83D' }, { str: '\uDE00甲' }, { str: '乙', hasEOL: true }, { str: '𠮷 é' }])
  expect(joined.readableLength).toBeGreaterThan(Array.from(joined.readableText).length)
  const models = [
    createPdfTextModel([{ str: '前😀'.repeat(2_000) }]), joined,
    createPdfTextModel([{ str: '后𠮷'.repeat(2_000) }]), null, createPdfTextModel([])
  ]
  const { adapter, select, previous } = setup(models)
  for (let page = 1; page <= models.length; page++) {
    const length = models[page - 1]?.rawLength ?? 0
    for (const [start, end] of [[0, 1], [0, length], [Math.max(0, length - 1), length]]) {
      for (const anchor of [makePdfTextAnchor(page, start, end), `pdfrect:${page}:0.1:0.2:0.8:0.9`]) {
        const expected = previous(page, start, end, anchor)
        for (let repeat = 0; repeat < 2; repeat++) {
          const actual = select(page, start, end, anchor)
          expect(actual).toEqual(expected)
          expect(actual?.passages.reduce((sum, passage) => sum + Array.from(passage.text).length, 0) ?? 0).toBeLessThanOrEqual(6_000)
        }
      }
    }
  }
  const lengths = Reflect.get(adapter, 'contextLengths') as WeakMap<PdfTextModel, number>
  expect(lengths.get(joined)).toBe(Array.from(joined.readableText).length)
})

it('does not count adjacent pages that lie outside the bounded context traversal', () => {
  const models = ['前😀', '甲😀', '后😀'].map((text) => createPdfTextModel([{ str: text.repeat(50_000) }]))
  const { select, previous } = setup(models)
  const expected = previous(2, 50_000, 50_020)
  const unused = [models[0].readableText, models[2].readableText]
  const codePointAt = String.prototype.codePointAt
  vi.spyOn(String.prototype, 'codePointAt').mockImplementation(function (this: string, position: number) {
    if (unused.includes(this.valueOf())) throw new Error('An unused neighbor page must not be counted')
    return codePointAt.call(this, position)
  })
  expect(select(2, 50_000, 50_020)).toEqual(expected)
  expect(select(2, 50_000, 50_020)).toEqual(expected)
})

it('uses new model lengths and drops cached counts when the reader resets', () => {
  const first = createPdfTextModel([{ str: '甲😀'.repeat(50_000) }])
  const { adapter, pages, select, previous } = setup([first])
  select(1, 0, 20)
  const oldLengths = Reflect.get(adapter, 'contextLengths') as WeakMap<PdfTextModel, number>
  expect(oldLengths.get(first)).toBe(100_000)
  const replacement = createPdfTextModel([{ str: '乙'.repeat(150_000) }])
  expect(replacement.readableText.length).toBe(first.readableText.length)
  pages[0].textModel = replacement
  expect(select(1, 100_000, 100_020)).toEqual(previous(1, 100_000, 100_020))
  expect(oldLengths.get(replacement)).toBe(150_000)
  adapter.destroy()
  const nextLengths = Reflect.get(adapter, 'contextLengths') as WeakMap<PdfTextModel, number>
  expect(nextLengths).not.toBe(oldLengths)
  expect(nextLengths.has(first)).toBe(false)
  expect(nextLengths.has(replacement)).toBe(false)
  Reflect.set(adapter, 'pages', pages)
  expect(select(1, 100_000, 100_020)).toEqual(previous(1, 100_000, 100_020))
  expect(nextLengths.get(replacement)).toBe(150_000)
})

it('does not scan text when the selected page or raw range is invalid', () => {
  const model = createPdfTextModel([{ str: '甲😀'.repeat(50_000) }])
  const { select, previous } = setup([model])
  const points = vi.spyOn(String.prototype, 'codePointAt')
  for (const [page, start, end] of [[0, 0, 1], [2, 0, 1], [1, -1, 2], [1, 2, 2], [1, 2, 1], [1, 0, 100_001]]) {
    expect(select(page, start, end)).toEqual(previous(page, start, end))
    expect(select(page, start, end)).toBeNull()
  }
  expect(points.mock.calls.length).toBe(0)
})
