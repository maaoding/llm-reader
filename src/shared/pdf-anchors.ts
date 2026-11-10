export interface PdfTextAnchor {
  pageNumber: number
  start: number
  end: number
}

export interface PdfRegionAnchor {
  pageNumber: number
  left: number
  top: number
  right: number
  bottom: number
}

const TEXT_PATTERN = /^pdf:(\d+):(\d+):(\d+)$/u
const COORDINATE_PATTERN = /^(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/u

export function makePdfTextAnchor(pageNumber: number, start = 0, end = start): string {
  return `pdf:${pageNumber}:${start}:${end}`
}

export function parsePdfTextAnchor(anchor: string, pageCount: number, pageLength?: number): PdfTextAnchor | null {
  const match = TEXT_PATTERN.exec(anchor)
  if (!match) return null
  const [pageNumber, start, end] = match.slice(1).map(Number)
  if (!Number.isSafeInteger(pageNumber) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      pageNumber < 1 || pageNumber > pageCount || start < 0 || start > end ||
      (pageLength !== undefined && end > pageLength)) return null
  return { pageNumber, start, end }
}

export function makePdfRegionAnchor(region: PdfRegionAnchor): string {
  const format = (value: number): string => value.toFixed(6).replace(/\.?0+$/u, '')
  return ['pdfrect', region.pageNumber, format(region.left), format(region.top), format(region.right), format(region.bottom)].join(':')
}

export function parsePdfRegionAnchor(anchor: string, pageCount: number): PdfRegionAnchor | null {
  const [prefix, page, ...coordinates] = anchor.split(':')
  if (prefix !== 'pdfrect' || coordinates.length !== 4 || !/^\d+$/u.test(page) ||
      coordinates.some((value) => !COORDINATE_PATTERN.test(value))) return null
  const pageNumber = Number(page)
  const [left, top, right, bottom] = coordinates.map(Number)
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount || left >= right || top >= bottom) return null
  return { pageNumber, left, top, right, bottom }
}
