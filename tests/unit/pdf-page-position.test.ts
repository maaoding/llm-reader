import { expect, it } from 'vitest'
import { pdfReadingPosition, type PdfPageBounds } from '../../src/renderer/src/readers/pdf-navigation'

const pages: PdfPageBounds[] = [
  { top: 0, bottom: 100, height: 100 },
  { top: 140, bottom: 200, height: 60 },
  { top: 220, bottom: 230, height: 10 }
]

it.each([
  [-10, 1, 0], [0, 1, 0], [50, 1, .5], [100, 1, 1],
  [120, 1, 1], [121, 2, 0], [140, 2, 0], [200, 2, 1],
  [210, 2, 1], [220, 3, 0], [225, 3, .5], [999, 3, 1]
])('keeps the nearest page and fraction at reading line %s', (line, pageNumber, fraction) => {
  expect(pdfReadingPosition(pages.length, line, (index) => pages[index])).toEqual({ pageNumber, fraction })
})

it('keeps the first equal-distance page when a hidden reader has collapsed bounds', () => {
  const collapsed = { top: 0, bottom: 0, height: 0 }
  expect(pdfReadingPosition(100, 120, () => collapsed)).toEqual({ pageNumber: 1, fraction: 1 })
  expect(pdfReadingPosition(100, 0, () => collapsed)).toEqual({ pageNumber: 1, fraction: 0 })
  expect(pdfReadingPosition(0, 0, () => { throw new Error('No pages') })).toBeNull()
})

it('preserves point-like pages and earlier ties in a partially collapsed layout', () => {
  const mixed = [pages[0], { top: 120, bottom: 120, height: 0 }, pages[2]]
  expect(pdfReadingPosition(3, 120, (index) => mixed[index])).toEqual({ pageNumber: 2, fraction: 0 })
  expect(pdfReadingPosition(3, 110, (index) => mixed[index])).toEqual({ pageNumber: 1, fraction: 1 })
})

it('bounds geometry reads for a late position in a ten-thousand-page PDF', () => {
  let reads = 0
  const position = pdfReadingPosition(10_000, 9000 * 1024 + 520, (index) => {
    reads++
    return { top: index * 1024, bottom: index * 1024 + 1000, height: 1000 }
  })
  expect(position).toEqual({ pageNumber: 9001, fraction: .52 })
  expect(reads).toBeLessThanOrEqual(15)
})
