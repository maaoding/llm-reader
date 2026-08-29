import { describe, expect, it } from 'vitest'
import {
  makePdfPositionAnchor,
  parsePdfPositionAnchor,
  pdfDestinationFraction,
  pdfFitAvailableWidth,
  pdfSectionAt,
  PdfZoomCoordinator,
  sortPdfOutlineLocations,
  type PdfOutlineLocation
} from '../../src/renderer/src/readers/pdf-navigation'

const viewport = {
  height: 1_000,
  convertToViewportPoint: (x: number, y: number): [number, number] => [x, 1_000 - y]
}

describe('PDF position navigation', () => {
  it('creates and strictly validates normalized position anchors', () => {
    expect(makePdfPositionAnchor(4, 0.375)).toBe('pdfpos:4:0.375')
    expect(parsePdfPositionAnchor('pdfpos:4:0.375', 8)).toEqual({ pageNumber: 4, fraction: 0.375 })
    expect(parsePdfPositionAnchor('pdfpos:0:0.2', 8)).toBeNull()
    expect(parsePdfPositionAnchor('pdfpos:9:0.2', 8)).toBeNull()
    expect(parsePdfPositionAnchor('pdfpos:4:-0.2', 8)).toBeNull()
    expect(parsePdfPositionAnchor('pdfpos:4:1.1', 8)).toBeNull()
    expect(parsePdfPositionAnchor('pdfpos:4:1e-1', 8)).toBeNull()
    expect(parsePdfPositionAnchor('pdfpos:4:NaN', 8)).toBeNull()
  })

  it('maps supported PDF destination types to viewport fractions', () => {
    expect(pdfDestinationFraction([0, { name: 'XYZ' }, 20, 750, null], viewport)).toBe(0.25)
    expect(pdfDestinationFraction([0, { name: 'FitH' }, 600], viewport)).toBe(0.4)
    expect(pdfDestinationFraction([0, { name: 'FitBH' }, 500], viewport)).toBe(0.5)
    expect(pdfDestinationFraction([0, { name: 'FitR' }, 10, 20, 200, 250], viewport)).toBe(0.75)
    expect(pdfDestinationFraction([0, { name: 'Fit' }], viewport)).toBe(0)
    expect(pdfDestinationFraction([0, { name: 'XYZ' }, null, Number.POSITIVE_INFINITY], viewport)).toBe(0)
  })

  it('selects the deepest current outline section and computes section progress', () => {
    const locations = sortPdfOutlineLocations([
      location('第一章', 0, 1, 0, 0),
      location('1.1 同页小节', 1, 1, 0.25, 1),
      location('1.1.1 最细小节', 2, 1, 0.25, 2),
      location('第二章', 0, 2, 0, 3)
    ])
    expect(pdfSectionAt(locations, 1, 0.1, 3, '全文')).toMatchObject({ title: '第一章', progress: 0.4 })
    expect(pdfSectionAt(locations, 1, 0.25, 3, '全文')).toMatchObject({ title: '1.1.1 最细小节', progress: 0 })
    expect(pdfSectionAt(locations, 1, 0.625, 3, '全文')).toMatchObject({ title: '1.1.1 最细小节', progress: 0.5 })
    expect(pdfSectionAt(locations, 3, 1, 3, '全文')).toMatchObject({ title: '第二章', progress: 1 })
  })

  it('uses whole-document progress before the first outline entry and without an outline', () => {
    const locations = [location('第一章', 0, 2, 0, 0)]
    expect(pdfSectionAt(locations, 1, 0.5, 4, '全文')).toEqual({
      title: '全文',
      href: 'pdfpos:1:0',
      progress: 0.125
    })
    expect(pdfSectionAt([], 2, 0, 4, '全文')).toEqual({
      title: '全文',
      href: 'pdfpos:1:0',
      progress: 0.25
    })
  })
})

describe('PDF fit-width coordination', () => {
  it('uses actual document padding without imposing an overflowing minimum width', () => {
    expect(pdfFitAvailableWidth(833, 24, 24)).toBe(785)
    expect(pdfFitAvailableWidth(40, 24, 24)).toBe(1)
    expect(pdfFitAvailableWidth(500, Number.NaN, 20)).toBe(480)
  })

  it('reuses the first stable anchor and ignores stale zoom completions', () => {
    const coordinator = new PdfZoomCoordinator()
    const first = coordinator.begin({ pageNumber: 40, fraction: 0.42 })
    const second = coordinator.begin({ pageNumber: 1, fraction: 0 })
    const latest = coordinator.begin({ pageNumber: 2, fraction: 0.8 })

    expect(second.anchor).toEqual(first.anchor)
    expect(latest.anchor).toEqual(first.anchor)
    expect(coordinator.isCurrent(first.revision)).toBe(false)
    expect(coordinator.isCurrent(latest.revision)).toBe(true)
    expect(coordinator.complete(first.revision)).toBeNull()
    expect(coordinator.complete(latest.revision)).toEqual({ pageNumber: 40, fraction: 0.42 })
  })
})

function location(
  label: string,
  depth: number,
  pageNumber: number,
  fraction: number,
  order: number
): PdfOutlineLocation {
  return {
    label,
    depth,
    pageNumber,
    fraction,
    order,
    href: makePdfPositionAnchor(pageNumber, fraction)
  }
}
