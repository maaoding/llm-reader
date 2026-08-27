export interface PdfTextContentItem {
  str: string
  hasEOL?: boolean
}

type OffsetBias = 'start' | 'end'

interface PdfTextRun {
  rawStart: number
  rawEnd: number
  readableStart: number
  readableEnd: number
  separator: boolean
}

export interface PdfTextModel {
  rawText: string
  readableText: string
  rawLength: number
  readableLength: number
  readableOffsetForRaw(rawOffset: number, bias: OffsetBias): number
  rawOffsetForReadable(readableOffset: number, bias: OffsetBias): number
  readableSliceForRaw(rawStart: number, rawEnd: number): string
}

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

export interface PdfRegionTextItem {
  text: string
  rawStart: number
  rawEnd: number
  left: number
  top: number
  right: number
  bottom: number
}

export interface PdfRegionTextResult {
  text: string
  rawStart: number
  rawEnd: number
}

const PDF_TEXT_ANCHOR_PATTERN = /^pdf:(\d+):(\d+):(\d+)$/u
const PDF_REGION_ANCHOR_PREFIX = 'pdfrect:'
const REGION_COORDINATE_PATTERN = /^(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/u
const REGION_COORDINATE_PRECISION = 6

function codePoints(value: string): string[] {
  return Array.from(value)
}

function codePointSlice(value: string, start: number, end: number): string {
  return codePoints(value).slice(start, end).join('')
}

function isWhitespace(value: string | undefined): boolean {
  return value !== undefined && /\s/u.test(value)
}

function validOffset(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum
}

export function createPdfTextModel(items: ReadonlyArray<PdfTextContentItem>): PdfTextModel {
  const rawParts: string[] = []
  const readableParts: string[] = []
  const runs: PdfTextRun[] = []
  let rawOffset = 0
  let readableOffset = 0
  let pendingLineBreak = false

  const appendSeparator = (): void => {
    readableParts.push(' ')
    runs.push({
      rawStart: rawOffset,
      rawEnd: rawOffset,
      readableStart: readableOffset,
      readableEnd: readableOffset + 1,
      separator: true
    })
    readableOffset += 1
  }

  for (const item of items) {
    const value = item.str ?? ''
    const valueCodePoints = codePoints(value)
    if (valueCodePoints.length > 0) {
      const previous = readableParts.at(-1)?.at(-1)
      const next = valueCodePoints[0]
      if (pendingLineBreak && readableOffset > 0 && !isWhitespace(previous) && !isWhitespace(next)) {
        appendSeparator()
      }
      pendingLineBreak = false

      const length = valueCodePoints.length
      rawParts.push(value)
      readableParts.push(value)
      runs.push({
        rawStart: rawOffset,
        rawEnd: rawOffset + length,
        readableStart: readableOffset,
        readableEnd: readableOffset + length,
        separator: false
      })
      rawOffset += length
      readableOffset += length
    }
    if (item.hasEOL) pendingLineBreak = true
  }

  const rawText = rawParts.join('')
  const readableText = readableParts.join('')

  const readableOffsetForRaw = (offset: number, bias: OffsetBias): number => {
    if (!validOffset(offset, rawOffset)) return bias === 'start' ? readableOffset : 0
    const candidates: number[] = []
    for (const run of runs) {
      if (offset < run.rawStart) break
      if (offset > run.rawEnd) continue
      if (run.separator) {
        candidates.push(run.readableStart, run.readableEnd)
      } else {
        candidates.push(run.readableStart + offset - run.rawStart)
      }
    }
    if (candidates.length === 0) return offset === 0 ? 0 : readableOffset
    return bias === 'start' ? Math.max(...candidates) : Math.min(...candidates)
  }

  const rawOffsetForReadable = (offset: number, bias: OffsetBias): number => {
    if (!validOffset(offset, readableOffset)) return bias === 'start' ? rawOffset : 0
    const candidates: number[] = []
    for (const run of runs) {
      if (offset < run.readableStart) break
      if (offset > run.readableEnd) continue
      if (run.separator) {
        candidates.push(run.rawStart)
      } else {
        candidates.push(run.rawStart + offset - run.readableStart)
      }
    }
    if (candidates.length === 0) return offset === 0 ? 0 : rawOffset
    return bias === 'start' ? Math.max(...candidates) : Math.min(...candidates)
  }

  return {
    rawText,
    readableText,
    rawLength: rawOffset,
    readableLength: readableOffset,
    readableOffsetForRaw,
    rawOffsetForReadable,
    readableSliceForRaw(rawStart: number, rawEnd: number): string {
      if (!validOffset(rawStart, rawOffset) || !validOffset(rawEnd, rawOffset) || rawEnd < rawStart) return ''
      const start = readableOffsetForRaw(rawStart, 'start')
      const end = readableOffsetForRaw(rawEnd, 'end')
      return codePointSlice(readableText, start, Math.max(start, end))
    }
  }
}

export function makePdfTextAnchor(pageNumber: number, start = 0, end = start): string {
  return `pdf:${pageNumber}:${start}:${end}`
}

export function parsePdfTextAnchor(anchor: string, pageCount: number, pageLength?: number): PdfTextAnchor | null {
  const match = PDF_TEXT_ANCHOR_PATTERN.exec(anchor)
  if (!match) return null
  const pageNumber = Number(match[1])
  const start = Number(match[2])
  const end = Number(match[3])
  if (
    !Number.isSafeInteger(pageNumber) ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    pageNumber < 1 ||
    pageNumber > pageCount ||
    start < 0 ||
    start > end ||
    (pageLength !== undefined && end > pageLength)
  ) {
    return null
  }
  return { pageNumber, start, end }
}

function formatCoordinate(value: number): string {
  return value.toFixed(REGION_COORDINATE_PRECISION).replace(/\.?0+$/u, '')
}

export function makePdfRegionAnchor(region: PdfRegionAnchor): string {
  return [
    'pdfrect',
    region.pageNumber,
    formatCoordinate(region.left),
    formatCoordinate(region.top),
    formatCoordinate(region.right),
    formatCoordinate(region.bottom)
  ].join(':')
}

export function parsePdfRegionAnchor(anchor: string, pageCount: number): PdfRegionAnchor | null {
  if (!anchor.startsWith(PDF_REGION_ANCHOR_PREFIX)) return null
  const parts = anchor.split(':')
  if (parts.length !== 6 || parts[0] !== 'pdfrect') return null
  if (!/^\d+$/u.test(parts[1]) || parts.slice(2).some((value) => !REGION_COORDINATE_PATTERN.test(value))) return null
  const pageNumber = Number(parts[1])
  const coordinates = parts.slice(2).map(Number)
  if (
    !Number.isSafeInteger(pageNumber) ||
    pageNumber < 1 ||
    pageNumber > pageCount ||
    coordinates.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
  ) {
    return null
  }
  const [left, top, right, bottom] = coordinates
  if (left >= right || top >= bottom) return null
  return { pageNumber, left, top, right, bottom }
}

function intersectionArea(item: PdfRegionTextItem, region: PdfRegionAnchor): number {
  const width = Math.max(0, Math.min(item.right, region.right) - Math.max(item.left, region.left))
  const height = Math.max(0, Math.min(item.bottom, region.bottom) - Math.max(item.top, region.top))
  return width * height
}

function selectedByRegion(item: PdfRegionTextItem, region: PdfRegionAnchor): boolean {
  const itemArea = Math.max(0.000001, (item.right - item.left) * (item.bottom - item.top))
  const centerX = (item.left + item.right) / 2
  const centerY = (item.top + item.bottom) / 2
  const centerInside = centerX >= region.left && centerX <= region.right && centerY >= region.top && centerY <= region.bottom
  return centerInside || intersectionArea(item, region) / itemArea >= 0.15
}

function rowText(items: ReadonlyArray<PdfRegionTextItem>): string {
  const sorted = [...items].sort((left, right) => left.left - right.left)
  let output = ''
  let previous: PdfRegionTextItem | null = null
  for (const item of sorted) {
    const value = item.text.trim()
    if (!value) continue
    if (previous && output && !/\s$/u.test(output) && !/^\s/u.test(value)) {
      const previousHeight = Math.max(0.000001, previous.bottom - previous.top)
      const currentHeight = Math.max(0.000001, item.bottom - item.top)
      const gap = item.left - previous.right
      if (gap > Math.min(previousHeight, currentHeight) * 0.18) output += ' '
    }
    output += value
    previous = item
  }
  return output.trim()
}

export function extractPdfRegionText(
  items: ReadonlyArray<PdfRegionTextItem>,
  region: PdfRegionAnchor
): PdfRegionTextResult | null {
  const selected = items.filter((item) => selectedByRegion(item, region) && item.text.trim().length > 0)
  if (selected.length === 0) return null

  const sorted = [...selected].sort((left, right) => {
    const vertical = left.top - right.top
    return Math.abs(vertical) > 0.0005 ? vertical : left.left - right.left
  })
  const rows: Array<{ center: number; height: number; items: PdfRegionTextItem[] }> = []
  for (const item of sorted) {
    const center = (item.top + item.bottom) / 2
    const height = Math.max(0.000001, item.bottom - item.top)
    let bestRow: (typeof rows)[number] | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const row of rows) {
      const distance = Math.abs(row.center - center)
      if (distance <= Math.min(row.height, height) * 0.6 && distance < bestDistance) {
        bestRow = row
        bestDistance = distance
      }
    }
    if (bestRow) {
      bestRow.items.push(item)
      bestRow.center = bestRow.items.reduce((sum, entry) => sum + (entry.top + entry.bottom) / 2, 0) / bestRow.items.length
      bestRow.height = Math.max(bestRow.height, height)
    } else {
      rows.push({ center, height, items: [item] })
    }
  }

  const text = rows
    .sort((left, right) => left.center - right.center)
    .map((row) => rowText(row.items))
    .filter(Boolean)
    .join('\n')
    .trim()
  if (!text) return null

  return {
    text,
    rawStart: Math.min(...selected.map((item) => item.rawStart)),
    rawEnd: Math.max(...selected.map((item) => item.rawEnd))
  }
}
