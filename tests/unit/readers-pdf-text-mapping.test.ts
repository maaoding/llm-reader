import { describe, expect, it } from 'vitest'
import { createPdfTextModel, pdfTextOffset, type PdfTextRun } from '../../src/renderer/src/readers/pdf-text'
import { previousPdfTextOffset, syntheticPdfTextRuns } from '../performance/support/legacy-pdf-text-mapping'

describe('ordered PDF text offsets', () => {
  it.each(['raw', 'readable'] as const)('matches the original scan at all %s boundaries and invalid offsets', (source) => {
    for (const runs of [[], syntheticPdfTextRuns(1), syntheticPdfTextRuns(41)]) {
      const maximum = runs.at(-1)?.[source === 'raw' ? 'rawEnd' : 'readableEnd'] ?? 0
      const offsets = [-1, ...Array.from({ length: maximum * 2 + 3 }, (_, index) => index / 2), Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]
      for (const offset of offsets) for (const bias of ['start', 'end'] as const) {
        expect(pdfTextOffset(runs, offset, source, bias)).toBe(previousPdfTextOffset(runs, offset, source, bias))
      }
    }
  })

  it('keeps Unicode raw anchors and readable slices across explicit whitespace, empty items and inserted line breaks', () => {
    const model = createPdfTextModel([
      { str: '', hasEOL: true }, { str: '甲😀', hasEOL: true }, { str: '', hasEOL: true },
      { str: '𠮷é' }, { str: ' 乙', hasEOL: true }, { str: '\t丙', hasEOL: true }, { str: '丁', hasEOL: true }
    ])
    const runs: PdfTextRun[] = [
      { rawStart: 0, rawEnd: 2, readableStart: 0, readableEnd: 2, separator: false },
      { rawStart: 2, rawEnd: 2, readableStart: 2, readableEnd: 3, separator: true },
      { rawStart: 2, rawEnd: 5, readableStart: 3, readableEnd: 6, separator: false },
      { rawStart: 5, rawEnd: 7, readableStart: 6, readableEnd: 8, separator: false },
      { rawStart: 7, rawEnd: 9, readableStart: 8, readableEnd: 10, separator: false },
      { rawStart: 9, rawEnd: 9, readableStart: 10, readableEnd: 11, separator: true },
      { rawStart: 9, rawEnd: 10, readableStart: 11, readableEnd: 12, separator: false }
    ]
    expect(model.rawText).toBe('甲😀𠮷é 乙\t丙丁')
    expect(model.readableText).toBe('甲😀 𠮷é 乙\t丙 丁')
    for (const bias of ['start', 'end'] as const) {
      for (let offset = 0; offset <= model.rawLength; offset++) expect(model.readableOffsetForRaw(offset, bias)).toBe(previousPdfTextOffset(runs, offset, 'raw', bias))
      for (let offset = 0; offset <= model.readableLength; offset++) expect(model.rawOffsetForReadable(offset, bias)).toBe(previousPdfTextOffset(runs, offset, 'readable', bias))
    }
    for (let start = 0; start <= model.rawLength; start++) for (let end = start; end <= model.rawLength; end++) {
      const from = previousPdfTextOffset(runs, start, 'raw', 'start')
      const to = previousPdfTextOffset(runs, end, 'raw', 'end')
      expect(model.readableSliceForRaw(start, end)).toBe(Array.from(model.readableText).slice(from, Math.max(from, to)).join(''))
    }
    expect(model.readableSliceForRaw(-1, 2)).toBe('')
    expect(model.readableSliceForRaw(3, 2)).toBe('')
  })

  it.each(['raw', 'readable'] as const)('bounds %s lookup work near the end of 10,001 runs', (source) => {
    let reads = 0
    const runs = syntheticPdfTextRuns(5_001).map((run) => new Proxy(run, {
      get: (target, property, receiver) => { reads++; return Reflect.get(target, property, receiver) }
    }))
    const offset = runs[9_000][source === 'raw' ? 'rawStart' : 'readableStart'] + 1
    for (const bias of ['start', 'end'] as const) {
      reads = 0
      const expected = previousPdfTextOffset(runs, offset, source, bias)
      const before = reads
      reads = 0
      expect(pdfTextOffset(runs, offset, source, bias)).toBe(expected)
      const after = reads
      expect(before).toBeGreaterThan(18_000)
      expect(after).toBeLessThanOrEqual(Math.ceil(Math.log2(runs.length)) + 10)
      console.info(`PDF text ${source}/${bias}: ${before} -> ${after} run-field reads; identical offset.`)
    }
  })
})
