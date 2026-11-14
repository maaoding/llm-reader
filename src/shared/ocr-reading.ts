import { OCR_MAX_PAGE_CHARACTERS, OCR_MAX_PAGES } from './vision-ocr'
import { makePdfRegionAnchor, parsePdfRegionAnchor, type PdfRegionAnchor } from './pdf-anchors'

export interface OcrTextAnchor { pageNumber: number; start: number; end: number; revision: string }

/** OCR character offsets belong to the transcription, never to the PDF's native text layer. */
export function makeOcrTextAnchor(pageNumber: number, start: number, end: number, revision: string): string {
  return `pdfocr:${pageNumber}:${start}:${end}:${revision}`
}

export function parseOcrTextAnchor(anchor: string, pageCount = OCR_MAX_PAGES): OcrTextAnchor | null {
  const match = /^pdfocr:(\d+):(\d+):(\d+):([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})$/u.exec(anchor)
  if (!match) return null
  const [pageNumber, start, end] = match.slice(1, 4).map(Number)
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount ||
      !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > OCR_MAX_PAGE_CHARACTERS) return null
  return { pageNumber, start, end, revision: match[4] }
}

export const MAX_OCR_SELECTION_LINES = 80

/** Keep the actual selected line regions with the quotation across OCR rebuilds. */
export function makeOcrRegionAnchor(regions: readonly PdfRegionAnchor[]): string {
  return `pdfocrrect:${regions[0].pageNumber}:${regions.map((region) => makePdfRegionAnchor(region).split(':').slice(2).join(':')).join(';')}`
}

export function parseOcrRegionAnchor(anchor: string, pageCount = OCR_MAX_PAGES): PdfRegionAnchor[] | null {
  const match = /^pdfocrrect:(\d+):(.+)$/u.exec(anchor)
  if (!match) return null
  const groups = match[2].split(';')
  if (groups.length > MAX_OCR_SELECTION_LINES) return null
  const regions: PdfRegionAnchor[] = []
  for (const group of groups) {
    const region = parsePdfRegionAnchor(`pdfrect:${match[1]}:${group}`, pageCount)
    if (!region) return null
    regions.push(region)
  }
  return regions
}

export function pdfPageFromLocator(locator: string | null): number {
  const match = /^pdf(?:pos|rect|ocr|ocrrect)?:(\d+):/u.exec(locator ?? '')
  const page = Number(match?.[1])
  return Number.isSafeInteger(page) && page >= 1 && page <= OCR_MAX_PAGES ? page : 1
}
