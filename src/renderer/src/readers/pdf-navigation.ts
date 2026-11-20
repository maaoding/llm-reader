export interface PdfPositionAnchor {
  pageNumber: number
  fraction: number
}

export interface PdfPageBounds {
  top: number
  bottom: number
  height: number
}

/** PDF placeholders are stacked in page order. Keep the two bounds bracketing
 * the reading line while searching, so no extra layout reads are needed. */
export function locatePdfPage(count: number, readingLine: number, boundsAt: (index: number) => PdfPageBounds): PdfPositionAnchor | null {
  if (!count) return null
  const position = (index: number, bounds: PdfPageBounds): PdfPositionAnchor => ({
    pageNumber: index + 1,
    fraction: Math.min(1, Math.max(0, (readingLine - bounds.top) / Math.max(1, bounds.height)))
  })
  const distance = (bounds: PdfPageBounds): number => Math.min(Math.abs(bounds.top - readingLine), Math.abs(bounds.bottom - readingLine))
  // A hidden reader can report identical zero-size rectangles. Preserve the
  // original first-page tie breaking instead of assuming a visible layout.
  const collapsedLayout = (): PdfPositionAnchor => {
    let bestIndex = 0, bestBounds = boundsAt(0), bestDistance = Infinity
    for (let index = 0; index < count; index++) {
      const bounds = index === 0 ? bestBounds : boundsAt(index)
      if (bounds.top <= readingLine && bounds.bottom >= readingLine) return position(index, bounds)
      const candidate = distance(bounds)
      if (candidate < bestDistance) { bestIndex = index; bestBounds = bounds; bestDistance = candidate }
    }
    return position(bestIndex, bestBounds)
  }
  let low = 0, high = count
  let before: { index: number; bounds: PdfPageBounds } | undefined
  let after: { index: number; bounds: PdfPageBounds } | undefined
  while (low < high) {
    const index = low + Math.floor((high - low) / 2)
    const bounds = boundsAt(index)
    if (bounds.height <= 0) return collapsedLayout()
    if (bounds.bottom < readingLine) { before = { index, bounds }; low = index + 1 }
    else { after = { index, bounds }; high = index }
  }
  if (after && (after.bounds.top <= readingLine || !before || distance(after.bounds) < distance(before.bounds))) return position(after.index, after.bounds)
  return before ? position(before.index, before.bounds) : null
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

export interface PdfOutlineIndex {
  locations: ReadonlyArray<PdfOutlineLocation>
  prefixMaxPositions: readonly number[]
}

export function createPdfOutlineIndex(locations: ReadonlyArray<PdfOutlineLocation>): PdfOutlineIndex {
  const ordered = [...locations].sort((left, right) => {
    const leftPosition = left.pageNumber - 1 + left.fraction
    const rightPosition = right.pageNumber - 1 + right.fraction
    if (Math.abs(leftPosition - rightPosition) > POSITION_EPSILON) return leftPosition - rightPosition
    if (left.depth !== right.depth) return left.depth - right.depth
    return left.order - right.order
  })
  // Nearly equal positions are ordered by depth first. A prefix maximum
  // preserves the first position beyond a target even when that order dips.
  let maximum = -Infinity
  const prefixMaxPositions = ordered.map(({ pageNumber, fraction }) => {
    const position = pageNumber - 1 + fraction
    if (position > maximum) maximum = position
    return maximum
  })
  return { locations: ordered, prefixMaxPositions }
}

function firstPositionAfter(positions: readonly number[], target: number): number {
  let low = 0
  let high = positions.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (positions[middle] > target) high = middle
    else low = middle + 1
  }
  return low
}

export function pdfSectionAt(
  outline: PdfOutlineIndex | null,
  pageNumber: number,
  fraction: number,
  pageCount: number,
  wholeDocumentTitle: string
): PdfSectionState {
  const currentPosition = Math.min(pageCount, Math.max(0, pageNumber - 1 + clampFraction(fraction)))
  const current = outline?.locations[firstPositionAfter(outline.prefixMaxPositions, currentPosition + POSITION_EPSILON) - 1]
  if (!outline || !current) {
    return {
      title: wholeDocumentTitle,
      href: makePdfPositionAnchor(1, 0),
      progress: clampFraction(currentPosition / Math.max(1, pageCount))
    }
  }

  const start = current.pageNumber - 1 + current.fraction
  const next = outline.locations[firstPositionAfter(outline.prefixMaxPositions, start + POSITION_EPSILON)]
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
