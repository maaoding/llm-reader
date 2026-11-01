import type { SelectionContext } from '../../../src/shared/contracts'
import { buildBoundedPassages, type ContextBlock } from '../../../src/renderer/src/readers/context'
import { makePdfTextAnchor, parsePdfRegionAnchor, type PdfTextModel } from '../../../src/renderer/src/readers/pdf-text'

export interface PdfContextFixture {
  pages: ReadonlyArray<{ pageNumber: number; textModel: PdfTextModel | null }>
  callbacks: { bookId: string }
  sectionAt(pageNumber: number, fraction: number): { title: string }
}

// PDF context construction before reusing the exact joined-text code point length.
export function previousPdfSelectionContext(
    this: PdfContextFixture,
    pageNumber: number,
    start: number,
    end: number,
    quote: string,
    anchor: string
  ): SelectionContext | null {
    const state = this.pages[pageNumber - 1]
    const model = state?.textModel
    if (!state || !model || start < 0 || end <= start || end > model.rawLength || !quote.trim()) return null
    const firstPageIndex = Math.max(0, pageNumber - 2)
    const lastPageIndex = Math.min(this.pages.length - 1, pageNumber)
    const blocks: ContextBlock[] = this.pages.slice(firstPageIndex, lastPageIndex + 1).map((page) => {
      const pageModel = page.textModel
      return {
        id: `page-${page.pageNumber}`,
        text: pageModel?.readableText ?? '',
        anchorForSlice: (blockStart, blockEnd) => makePdfTextAnchor(
          page.pageNumber,
          pageModel?.rawOffsetForReadable(blockStart, 'start') ?? blockStart,
          pageModel?.rawOffsetForReadable(blockEnd, 'end') ?? blockEnd
        )
      }
    })
    const focusBlock = pageNumber - 1 - firstPageIndex
    const focusStart = model.readableOffsetForRaw(start, 'start')
    const focusEnd = model.readableOffsetForRaw(end, 'end')
    const regionAnchor = parsePdfRegionAnchor(anchor, this.pages.length)
    const fraction = regionAnchor?.top ?? (model.rawLength > 0 ? start / model.rawLength : 0)
    return {
      bookId: this.callbacks.bookId,
      quote: quote.trim(),
      anchor,
      chapterTitle: this.sectionAt(pageNumber, fraction).title,
      passages: buildBoundedPassages(blocks, {
        startBlock: focusBlock,
        startOffset: focusStart,
        endBlock: focusBlock,
        endOffset: focusEnd
      })
    }
  }
