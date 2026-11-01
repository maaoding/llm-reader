import { expect, it } from 'vitest'
import { PdfOutlineIndex, pdfSectionAt, sortPdfOutlineLocations, type PdfOutlineLocation } from '../../src/renderer/src/readers/pdf-navigation'
import { previousPdfSectionAt } from '../performance/support/legacy-pdf-outline'

function location(position: number, depth = 0, order = 0): PdfOutlineLocation {
  const pageNumber = Math.floor(position) + 1, fraction = position - Math.floor(position)
  return { pageNumber, fraction, label: `标题 ${order}`, href: `位置 ${position}`, depth, order }
}

it('bounds chapter lookup work in a prepared 5,000-entry PDF outline', () => {
  let reads = 0
  const locations: PdfOutlineLocation[] = Array.from({ length: 5_000 }, (_, index) => new Proxy({
    pageNumber: index + 1, fraction: 0, label: `章 ${index}`, href: `pdfpos:${index + 1}:0`, depth: 0, order: index
  }, {
    get: (target, key, receiver) => { if (key === 'pageNumber' || key === 'fraction') reads++; return Reflect.get(target, key, receiver) }
  }))
  const index = new PdfOutlineIndex(locations)
  reads = 0
  let boundaryReads = 0
  const positions = Reflect.get(index, 'maximumPositions') as number[]
  Reflect.set(index, 'maximumPositions', new Proxy(positions, {
    get: (target, key, receiver) => { if (typeof key === 'string' && /^\d+$/u.test(key)) boundaryReads++; return Reflect.get(target, key, receiver) }
  }))
  expect(pdfSectionAt(index, 4_501, 0.5, 5_000, '全文')).toEqual({ title: '章 4500', href: 'pdfpos:4501:0', progress: 0.5 })
  expect(reads).toBe(0)
  expect(boundaryReads).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(locations.length)))
})

it('matches the original scan through ties, epsilon ordering, gaps and unusual positions', () => {
  const samples: PdfOutlineLocation[][] = [
    [], [location(2)],
    [location(0), location(0.25, 1, 1), location(0.25, 2, 2), location(1, 0, 3)],
    [location(0.2500008), location(0.25, 2, 1), location(0.2499992, 3, 2), location(1, 0, 3)],
    [location(0.6), location(0.1, 0, 1), location(0.8, 0, 2)],
    [{ ...location(0), fraction: Number.NaN }, location(0.25), { ...location(1), pageNumber: Number.POSITIVE_INFINITY }]
  ]
  let seed = 29
  for (let fixture = 0; fixture < 40; fixture++) {
    samples.push(Array.from({ length: 30 }, (_, index) => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      return location((seed % 8) * 0.3 + (seed % 9) * 0.0000004, seed % 4, index)
    }))
  }
  for (const sample of samples) for (const locations of [sample, sortPdfOutlineLocations(sample)]) {
    const index = new PdfOutlineIndex(locations)
    const positions = [-1, 0, 0.25, 0.5, 1, 2, 3, 5, ...locations.flatMap((item) => {
      const position = item.pageNumber - 1 + item.fraction
      return [-0.000002, -0.000001, -0.0000005, 0, 0.0000005, 0.000001, 0.000002].map((delta) => position + delta)
    })]
    for (const position of positions) {
      const page = Math.floor(position) + 1, fraction = position - Math.floor(position)
      const expected = previousPdfSectionAt(locations, page, fraction, 4, '全文')
      expect(pdfSectionAt(index, page, fraction, 4, '全文')).toEqual(expected)
      expect(pdfSectionAt(locations, page, fraction, 4, '全文')).toEqual(expected)
    }
    for (const [page, fraction] of [[1, Number.NaN], [Number.NaN, 0.5], [1, -1], [1, 2]]) {
      expect(pdfSectionAt(index, page, fraction, 4, '全文')).toEqual(previousPdfSectionAt(locations, page, fraction, 4, '全文'))
    }
  }
})

it('keeps an outline snapshot while array callers continue to observe current entries', () => {
  const locations = [location(0), location(0.5, 1, 1), location(1, 0, 2)]
  const index = new PdfOutlineIndex(locations)
  const expected = previousPdfSectionAt(locations, 1, 0.75, 3, '全文')
  locations[1].label = '改后的标题'
  locations[1].fraction = 0.9
  locations.reverse()
  expect(pdfSectionAt(index, 1, 0.75, 3, '全文')).toEqual(expected)
  expect(pdfSectionAt(locations, 1, 0.75, 3, '全文')).toEqual(previousPdfSectionAt(locations, 1, 0.75, 3, '全文'))
  expect(pdfSectionAt(new PdfOutlineIndex(locations), 1, 0.75, 3, '全文')).toEqual(previousPdfSectionAt(locations, 1, 0.75, 3, '全文'))
})

it('uses the current localized title and page count before the first outline entry', () => {
  const index = new PdfOutlineIndex([location(2)])
  expect(pdfSectionAt(index, 1, 0.5, 4, '全文')).toEqual({ title: '全文', href: 'pdfpos:1:0', progress: 0.125 })
  expect(pdfSectionAt(index, 1, 0.5, 5, 'Whole document')).toEqual({ title: 'Whole document', href: 'pdfpos:1:0', progress: 0.1 })
  expect(pdfSectionAt(new PdfOutlineIndex([]), 2, 0.5, 4, '全文')).toEqual({ title: '全文', href: 'pdfpos:1:0', progress: 0.375 })
})
