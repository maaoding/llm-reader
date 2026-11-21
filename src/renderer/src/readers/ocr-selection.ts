import type { PreparedOcrPage, SelectionContext } from '@shared/contracts'
import { copy } from '@shared/copy'
import { makeOcrTextAnchor } from '@shared/ocr-reading'
import { buildBoundedPassages } from './context'

export function ocrSelection(bookId: string, page: Extract<PreparedOcrPage, { status: 'ready' }>, start: number, end: number): SelectionContext | null {
  const characters = Array.from(page.text)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > characters.length) return null
  const raw = characters.slice(start, end).join(''), quote = raw.trim()
  if (!quote) return null
  if (quote.length > 20_000) throw new Error(copy('ocrReading.selectionTooLong'))
  start += Array.from(raw).length - Array.from(raw.trimStart()).length
  end = start + Array.from(quote).length
  const pageAnchor = `pdfpos:${page.pageNumber}:0`, chapterTitle = copy('knowledge.pdfPage', { page: page.pageNumber })
  return { bookId, quote, chapterTitle, anchor: makeOcrTextAnchor(page.pageNumber, start, end, page.revision),
    passages: buildBoundedPassages([{ id: `ocr-page-${page.pageNumber}`, text: page.text, anchorForSlice: () => pageAnchor }], {
      startBlock: 0, startOffset: start, endBlock: 0, endOffset: end
    }).map((passage) => ({ ...passage, chapterTitle, sources: [{ anchor: pageAnchor, page: page.pageNumber, precision: 'block' as const }] })) }
}
