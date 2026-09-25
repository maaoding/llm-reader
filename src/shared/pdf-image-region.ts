import type { PdfImageRegionSource } from './contracts'

export const PDF_REGION_IMAGE_MAX_DATA_URL = 6_000_000
export const PDF_REGION_IMAGE_MAX_EDGE = 2560
export const PDF_REGION_IMAGE_MAX_PIXELS = 4_000_000
export const PDF_REGION_IMAGE_PATTERN = /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/u

export function pdfImageRegionAnchor(source: Pick<PdfImageRegionSource, 'pageNumber' | 'left' | 'top' | 'right' | 'bottom'>): string {
  return ['pdfrect', source.pageNumber, source.left, source.top, source.right, source.bottom]
    .map((part, index) => index > 1 ? Number(part).toFixed(6).replace(/0+$/u, '').replace(/\.$/u, '') : String(part))
    .join(':')
}

export function validPdfImageRegion(source: PdfImageRegionSource): boolean {
  const values = [source.left, source.top, source.right, source.bottom]
  return source.kind === 'pdf-image-region' && Number.isSafeInteger(source.pageNumber) && source.pageNumber >= 1 && source.pageNumber <= 600 &&
    values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1) && source.left < source.right && source.top < source.bottom &&
    source.anchor === pdfImageRegionAnchor(source)
}
