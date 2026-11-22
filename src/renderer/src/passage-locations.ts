import { isPdfImageRegion, type Passage, type ReaderSource, type SourceRange } from '@shared/contracts'
import { parsePdfRegionAnchor, parsePdfTextAnchor } from '@shared/pdf-anchors'
import { parseOcrRegionAnchor, parseOcrTextAnchor } from '@shared/ocr-reading'
import { parsePdfPositionAnchor } from './readers/pdf-navigation'

export function evidencePages(passage: Passage): Array<SourceRange & { page: number }> {
  const pages = new Map<number, SourceRange & { page: number }>()
  for (const source of passage.sources ?? []) {
    const page = source.page
    if (page !== undefined && Number.isSafeInteger(page) && page > 0) pages.set(page, { ...source, page })
  }
  return [...pages.values()]
}

export function passagePage(anchor: string): number | undefined {
  return (parsePdfTextAnchor(anchor, Number.MAX_SAFE_INTEGER) ??
    parsePdfRegionAnchor(anchor, Number.MAX_SAFE_INTEGER) ??
    parsePdfPositionAnchor(anchor, Number.MAX_SAFE_INTEGER) ??
    parseOcrTextAnchor(anchor) ?? parseOcrRegionAnchor(anchor)?.[0])?.pageNumber
}

export function passageChapter(passage: Passage, bookId: string | undefined, selection: ReaderSource | null): string | undefined {
  if (passage.chapterTitle) return passage.chapterTitle
  if (!selection || isPdfImageRegion(selection) || selection.bookId !== bookId || !passage.anchor) return undefined
  if (selection.anchor === passage.anchor) return selection.chapterTitle
  // Nearby EPUB passages are captured from the same chapter document as the selection.
  if (passage.anchor.startsWith('epubcfi(') && selection.passages.some(({ anchor }) => anchor === passage.anchor)) {
    return selection.chapterTitle
  }
  return undefined
}
