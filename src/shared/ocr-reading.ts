import { OCR_MAX_PAGE_CHARACTERS, OCR_MAX_PAGES } from './vision-ocr'

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

export function pdfPageFromLocator(locator: string | null): number {
  const match = /^pdf(?:pos|rect|ocr)?:(\d+):/u.exec(locator ?? '')
  const page = Number(match?.[1])
  return Number.isSafeInteger(page) && page >= 1 && page <= OCR_MAX_PAGES ? page : 1
}
