import { memo } from 'react'
import type { ContextSnapshot, Passage } from '@shared/contracts'
import { copy, type UiLanguage } from '@shared/copy'
import { limitText } from '@shared/book-context'
import { PassagePreview } from './PassagePreview'
import { evidencePages } from './passage-locations'

export const EvidenceSources = memo(function EvidenceSources({ passages, onNavigate, availableBookIds, context, bookTitle }: {
  passages: Passage[]
  onNavigate: (anchor: string, title?: string, bookId?: string) => void
  availableBookIds?: string[]
  context?: ContextSnapshot
  bookTitle?: string
  /** Refresh translated labels when otherwise stable sources are reused. */
  uiLanguage?: UiLanguage
}) {
  return passages.map((passage) => {
    const excerpt = <>{passage.bookTitle && <strong className="answer-source-book">{passage.bookTitle} · </strong>}{passage.headingPath?.length ? `${passage.headingPath.join(' / ')}：` : passage.chapterTitle ? `${passage.chapterTitle}：` : ''}{limitText(passage.text, 60)}</>
    if (context) return <div key={passage.id} className="answer-source-item">
      <PassagePreview passage={passage} context={context} bookTitle={bookTitle} availableBookIds={availableBookIds}
        onNavigate={(anchor, bookId, title) => onNavigate(anchor, title, bookId)} testId="source-preview-trigger">{excerpt}</PassagePreview>
    </div>

    const unavailable = Boolean(passage.bookId && availableBookIds && !availableBookIds.includes(passage.bookId))
    const navigate = (anchor: string) => passage.bookId
      ? onNavigate(anchor, passage.chapterTitle, passage.bookId)
      : onNavigate(anchor, passage.chapterTitle)
    const pages = evidencePages(passage)
    const wholeTable = passage.sources?.some((source) => source.precision === 'table')
    return <div key={passage.id} className="answer-source-item">
      <button type="button" disabled={unavailable} onClick={() => navigate(passage.anchor)}>{excerpt}</button>
      {unavailable && <small className="field-hint">{copy('workbench.missingSource')}</small>}
      {pages.length > 0 && <div className="answer-source-pages">
        {wholeTable && <small>{copy('sources.wholeTable')}</small>}
        {pages.map((source) => <button key={source.page} type="button" disabled={unavailable} onClick={() => navigate(source.anchor)}>{copy('knowledge.pdfPage', { page: source.page })}</button>)}
      </div>}
    </div>
  })
})
