import type { PdfOutlineLocation, PdfSectionState } from '../../../src/renderer/src/readers/pdf-navigation'

const POSITION_EPSILON = 0.000001
function clampFraction(value: number): number { return Math.min(1, Math.max(0, value)) }
function makePdfPositionAnchor(pageNumber: number, fraction: number): string { return `pdfpos:${pageNumber}:${fraction}` }

// Chapter lookup from 9ff41d9, before indexing the current PDF outline.
export function previousPdfSectionAt(
  locations: ReadonlyArray<PdfOutlineLocation>,
  pageNumber: number,
  fraction: number,
  pageCount: number,
  wholeDocumentTitle: string
): PdfSectionState {
  const currentPosition = Math.min(pageCount, Math.max(0, pageNumber - 1 + clampFraction(fraction)))
  let current: PdfOutlineLocation | null = null
  for (const location of locations) {
    const position = location.pageNumber - 1 + location.fraction
    if (position > currentPosition + POSITION_EPSILON) break
    current = location
  }
  if (!current) {
    return {
      title: wholeDocumentTitle,
      href: makePdfPositionAnchor(1, 0),
      progress: clampFraction(currentPosition / Math.max(1, pageCount))
    }
  }

  const start = current.pageNumber - 1 + current.fraction
  const next = locations.find((location) => (
    location.pageNumber - 1 + location.fraction > start + POSITION_EPSILON
  ))
  const end = next ? next.pageNumber - 1 + next.fraction : pageCount
  return {
    title: current.label,
    href: current.href,
    progress: end > start ? clampFraction((currentPosition - start) / (end - start)) : 1
  }
}
