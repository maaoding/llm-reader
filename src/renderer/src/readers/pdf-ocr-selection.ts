import type { OcrWordBox, PreparedOcrPage, SelectionContext } from '@shared/contracts'
import { makeOcrRegionAnchor, MAX_OCR_SELECTION_LINES } from '@shared/ocr-reading'
import type { PdfRegionAnchor } from '@shared/pdf-anchors'
import { ocrSelection } from './ocr-selection'

export type PositionedOcrPage = Extract<PreparedOcrPage, { status: 'ready' }> & { wordLines: OcrWordBox[][] }
export interface OcrWordPoint { line: number; word: number }

/** Match an actual word box. Resolve overlapping boxes using the nearest center. */
export function hitOcrWord(lines: OcrWordBox[][], x: number, y: number): OcrWordPoint | undefined {
  let nearest: OcrWordPoint | undefined
  let distance = Infinity
  for (const [line, boxes] of lines.entries()) {
    for (const [word, box] of boxes.entries()) {
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue
      const dx = (x - (box.left + box.right) / 2) / (box.right - box.left)
      const dy = (y - (box.top + box.bottom) / 2) / (box.bottom - box.top)
      if (dx * dx + dy * dy >= distance) continue
      distance = dx * dx + dy * dy
      nearest = { line, word }
    }
  }
  return nearest
}

export function ocrLineRegion(pageNumber: number, boxes: OcrWordBox[]): PdfRegionAnchor {
  return { pageNumber, left: Math.min(...boxes.map((box) => box.left)), top: Math.min(...boxes.map((box) => box.top)),
    right: Math.max(...boxes.map((box) => box.right)), bottom: Math.max(...boxes.map((box) => box.bottom)) }
}

export function selectedOcrWords(page: PositionedOcrPage, from: OcrWordPoint, to: OcrWordPoint) {
  const forward = from.line < to.line || (from.line === to.line && from.word <= to.word)
  const [start, end] = forward ? [from, to] : [to, from]
  if (end.line - start.line >= MAX_OCR_SELECTION_LINES) return
  const lines = page.wordLines.slice(start.line, end.line + 1)
  if (lines.length > 1) {
    const rows = lines.map((boxes) => ocrLineRegion(page.pageNumber, boxes))
    // Disjoint horizontal spans usually mean the drag crossed columns or cells.
    if (Math.max(...rows.map((row) => row.left)) >= Math.min(...rows.map((row) => row.right))) return
  }
  const regions = lines.map((boxes, index) => ocrLineRegion(page.pageNumber,
    boxes.slice(index === 0 ? start.word : 0, index === lines.length - 1 ? end.word + 1 : undefined)))
  return { regions, start: page.wordLines[start.line][start.word].start, end: page.wordLines[end.line][end.word].end }
}

export function positionedOcrSelection(bookId: string, page: PositionedOcrPage, selection: NonNullable<ReturnType<typeof selectedOcrWords>>): SelectionContext | null {
  const context = ocrSelection(bookId, page, selection.start, selection.end)
  return context && { ...context, anchor: makeOcrRegionAnchor(selection.regions) }
}
