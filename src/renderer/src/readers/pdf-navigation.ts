export interface PdfPositionAnchor {
  pageNumber: number
  fraction: number
}

export interface PdfOutlineLocation extends PdfPositionAnchor {
  label: string
  depth: number
  href: string
  order: number
}

export interface PdfSectionState {
  title: string
  href: string
  progress: number
}

export interface PdfDestinationViewport {
  height: number
  convertToViewportPoint(x: number, y: number): number[]
}

export interface PdfZoomAnchor {
  pageNumber: number
  fraction: number
}

export interface PdfZoomOperation {
  revision: number
  anchor: PdfZoomAnchor
}

const PDF_POSITION_ANCHOR_PATTERN = /^pdfpos:(\d+):(0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/u
const POSITION_PRECISION = 6
const POSITION_EPSILON = 0.000001

function clampFraction(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function formatFraction(value: number): string {
  return clampFraction(value).toFixed(POSITION_PRECISION).replace(/\.?0+$/u, '')
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function destinationType(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('name' in value)) return null
  return typeof value.name === 'string' ? value.name : null
}

export function makePdfPositionAnchor(pageNumber: number, fraction: number): string {
  return `pdfpos:${pageNumber}:${formatFraction(fraction)}`
}

export function parsePdfPositionAnchor(anchor: string, pageCount: number): PdfPositionAnchor | null {
  const match = PDF_POSITION_ANCHOR_PATTERN.exec(anchor)
  if (!match) return null
  const pageNumber = Number(match[1])
  const fraction = Number(match[2])
  if (
    !Number.isSafeInteger(pageNumber) ||
    pageNumber < 1 ||
    pageNumber > pageCount ||
    !Number.isFinite(fraction) ||
    fraction < 0 ||
    fraction > 1
  ) return null
  return { pageNumber, fraction }
}

export function pdfDestinationFraction(
  destination: ReadonlyArray<unknown>,
  viewport: PdfDestinationViewport
): number {
  const type = destinationType(destination[1])
  let x = 0
  let y: number | null = null
  if (type === 'XYZ') {
    x = finiteNumber(destination[2]) ?? 0
    y = finiteNumber(destination[3])
  } else if (type === 'FitH' || type === 'FitBH') {
    y = finiteNumber(destination[2])
  } else if (type === 'FitR') {
    x = finiteNumber(destination[2]) ?? 0
    y = finiteNumber(destination[5])
  }
  if (y === null || !Number.isFinite(viewport.height) || viewport.height <= 0) return 0
  try {
    const point = viewport.convertToViewportPoint(x, y)
    return Number.isFinite(point[1]) ? clampFraction(point[1] / viewport.height) : 0
  } catch {
    return 0
  }
}

export function sortPdfOutlineLocations(
  locations: ReadonlyArray<PdfOutlineLocation>
): PdfOutlineLocation[] {
  return [...locations].sort((left, right) => {
    const leftPosition = left.pageNumber - 1 + left.fraction
    const rightPosition = right.pageNumber - 1 + right.fraction
    if (Math.abs(leftPosition - rightPosition) > POSITION_EPSILON) return leftPosition - rightPosition
    if (left.depth !== right.depth) return left.depth - right.depth
    return left.order - right.order
  })
}

export function pdfSectionAt(
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

export function pdfFitAvailableWidth(hostWidth: number, paddingLeft: number, paddingRight: number): number {
  const safeHostWidth = Number.isFinite(hostWidth) ? hostWidth : 0
  const safeLeft = Number.isFinite(paddingLeft) ? Math.max(0, paddingLeft) : 0
  const safeRight = Number.isFinite(paddingRight) ? Math.max(0, paddingRight) : 0
  return Math.max(1, safeHostWidth - safeLeft - safeRight)
}

export class PdfZoomCoordinator {
  private revision = 0
  private anchor: PdfZoomAnchor | null = null

  begin(current: PdfZoomAnchor): PdfZoomOperation {
    this.anchor ??= { ...current }
    this.revision += 1
    return { revision: this.revision, anchor: { ...this.anchor } }
  }

  isCurrent(revision: number): boolean {
    return revision === this.revision
  }

  complete(revision: number): PdfZoomAnchor | null {
    if (revision !== this.revision || !this.anchor) return null
    const anchor = { ...this.anchor }
    this.anchor = null
    return anchor
  }

  reset(): void {
    this.revision += 1
    this.anchor = null
  }
}
