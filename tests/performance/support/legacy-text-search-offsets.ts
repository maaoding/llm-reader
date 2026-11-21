import type { ReaderSearchResult } from '../../../src/shared/reader-search'
import { literalSearchExpression, searchExcerpt, yieldSearchWork, READER_SEARCH_RESULT_LIMIT } from '../../../src/shared/reader-search'
import { copy } from '../../../src/shared/copy'
import { codePointLength } from '../../../src/renderer/src/readers/context'
import { makeTextAnchor } from '../../../src/renderer/src/readers/text-reader'
import { markdownAnchor, type MarkdownParagraph } from '../../../src/renderer/src/readers/markdown-document'

export interface TextSearchFixture {
  paragraphs: ReadonlyArray<{ text: string; start: number; chapterIndex: number; markdown?: MarkdownParagraph }>
  chapters: ReadonlyArray<{ title: string }>
  searchRevision: number
}

// Original task-local TXT/Markdown scanning before skipping unused and already-counted offsets.
export async function previousTextSearchDocument(
    this: TextSearchFixture,
    query: string,
    revision: number
  ): Promise<ReadonlyArray<ReaderSearchResult>> {
    const results: ReaderSearchResult[] = []
    const expression = literalSearchExpression(query)
    for (let paragraphIndex = 0; paragraphIndex < this.paragraphs.length; paragraphIndex += 1) {
      if (revision !== this.searchRevision) return []
      const paragraph = this.paragraphs[paragraphIndex]
      const searchText = paragraph.markdown?.visibleText ?? paragraph.text
      expression.lastIndex = 0
      let previousUtf16 = 0
      let previousCodePoints = 0
      let match = expression.exec(searchText)
      while (match) {
        const localStart = previousCodePoints + codePointLength(
          searchText.slice(previousUtf16, match.index)
        )
        const localEnd = localStart + codePointLength(match[0])
        results.push({
          anchor: paragraph.markdown ? markdownAnchor(paragraph.markdown, match.index, match.index + match[0].length) : makeTextAnchor(paragraph.start + localStart, paragraph.start + localEnd),
          excerpt: searchExcerpt(searchText, match.index, match.index + match[0].length),
          chapterTitle: this.chapters[paragraph.chapterIndex]?.title ?? copy('reader.txtFullText')
        })
        if (results.length >= READER_SEARCH_RESULT_LIMIT) return results
        previousUtf16 = match.index
        previousCodePoints = localStart
        match = expression.exec(searchText)
      }
      if (paragraphIndex > 0 && paragraphIndex % 120 === 0) {
        await yieldSearchWork()
      }
    }
    return revision === this.searchRevision ? results : []
  }
