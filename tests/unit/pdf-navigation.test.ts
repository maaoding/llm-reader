import { describe, expect, it, vi } from 'vitest'
import {
  makePdfPositionAnchor,
  parsePdfPositionAnchor,
  pdfDestinationFraction,
  pdfFitAvailableWidth,
  pdfReadingPosition,
  pdfSectionAt,
  PdfZoomCoordinator,
  sortPdfOutlineLocations,
  type PdfOutlineLocation,
  type PdfPageBounds
} from '../../src/renderer/src/readers/pdf-navigation'

const viewport = {
  height: 1_000,
  convertToViewportPoint: (x: number, y: number): [number, number] => [x, 1_000 - y]
}

// Reference behavior before ordered lookup, including first-page tie breaking.
function linearReadingPosition(pages: PdfPageBounds[], line: number) {
  let best = 0, distance = Number.POSITIVE_INFINITY
  for (const [index, rect] of pages.entries()) {
    if (rect.top <= line && rect.bottom >= line) { best = index; break }
    const candidate = Math.min(Math.abs(rect.top - line), Math.abs(rect.bottom - line))
    if (candidate < distance) { best = index; distance = candidate }
  }
  const rect = pages[best]
  return { pageNumber: best + 1, fraction: Math.min(1, Math.max(0, (line - rect.top) / Math.max(1, rect.height))) }
}

describe('PDF reading-line lookup', () => {
  it('matches the previous scan across mixed heights, gaps, shared edges and zero-height pages', () => {
    let top = -80
    const pages = Array.from({ length: 180 }, (_, index) => {
      const height = index % 13 ? 60 + (index * 97) % 480 : 0
      const rect = { top, bottom: top + height, height }
      top = rect.bottom + (index % 4) * 11
      return rect
    })
    const lines = pages.flatMap((rect, index) => [rect.top, rect.bottom,
      rect.bottom + ((pages[index + 1]?.top ?? rect.bottom + 80) - rect.bottom) / 2])
    for (let line = pages[0].top - 80; line <= top + 80; line += 73.25) lines.push(line)
    for (const line of lines) for (const hint of [0, 31, pages.length - 1]) {
      expect(pdfReadingPosition(pages.length, line, (index) => pages[index], hint)).toEqual(linearReadingPosition(pages, line))
    }
  })

  it.each([-10, 0, 10])('keeps the first tie when every page has collapsed bounds at line %s', (line) => {
    const measure = () => ({ top: 0, bottom: 0, height: 0 })
    expect(pdfReadingPosition(100, line, measure, 99)).toEqual({ pageNumber: 1, fraction: line > 0 ? 1 : 0 })
  })

  it('bounds deep jumps and measures only the hinted page during continued reading', () => {
    const measure = vi.fn((index: number) => ({ top: index * 1_020, bottom: index * 1_020 + 1_000, height: 1_000 }))
    const position = pdfReadingPosition(5_000, 4_500 * 1_020 + 300, measure)
    expect(position).toEqual({ pageNumber: 4_501, fraction: 0.3 })
    expect(measure.mock.calls.length).toBeLessThanOrEqual(Math.ceil(Math.log2(5_000)) + 3)
    measure.mockClear()
    expect(pdfReadingPosition(5_000, 4_500 * 1_020 + 400, measure, position!.pageNumber - 1)).toEqual({ pageNumber: 4_501, fraction: 0.4 })
    expect(measure).toHaveBeenCalledExactlyOnceWith(4_500)
  })

  it('rereads geometry after layout changes and ignores an obsolete page hint', () => {
    let pages = [{ top: 0, bottom: 100, height: 100 }, { top: 120, bottom: 220, height: 100 }]
    const measure = (index: number) => pages[index]
    expect(pdfReadingPosition(2, 150, measure)).toEqual({ pageNumber: 2, fraction: 0.3 })
    pages = [{ top: 0, bottom: 300, height: 300 }, { top: 320, bottom: 620, height: 300 }]
    expect(pdfReadingPosition(2, 150, measure, 1)).toEqual({ pageNumber: 1, fraction: 0.5 })
  })

  it('handles empty layouts and invalid hints without reading outside the page array', () => {
    const measure = vi.fn((index: number) => {
      expect(index).toBe(0)
      return { top: 0, bottom: 100, height: 100 }
    })
    expect(pdfReadingPosition(0, 50, measure)).toBeNull()
    expect(pdfReadingPosition(1, Number.NaN, measure)).toBeNull()
    expect(measure).not.toHaveBeenCalled()
    for (const hint of [-1, 5, Number.NaN]) expect(pdfReadingPosition(1, 50, measure, hint)).toEqual({ pageNumber: 1, fraction: 0.5 })
  })
})

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
