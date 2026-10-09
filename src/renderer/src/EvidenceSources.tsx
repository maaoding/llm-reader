import type { Passage } from '@shared/contracts'
import { copy } from '@shared/copy'

export function EvidenceSources({ passages, onNavigate, availableBookIds }: {
  passages: Passage[]
  onNavigate: (anchor: string, title?: string, bookId?: string) => void
  availableBookIds?: string[]
}) {
  return passages.map((passage) => {
    const unavailable = Boolean(passage.bookId && availableBookIds && !availableBookIds.includes(passage.bookId))
    const navigate = (anchor: string) => passage.bookId
      ? onNavigate(anchor, passage.chapterTitle, passage.bookId)
      : onNavigate(anchor, passage.chapterTitle)
    const pages = [...new Map(passage.sources?.filter((source) => source.page).map((source) => [source.page!, source]) ?? []).values()]
    const wholeTable = passage.sources?.some((source) => source.precision === 'table')
    return <div key={passage.id} className="answer-source-item">
      <button type="button" disabled={unavailable} onClick={() => navigate(passage.anchor)}>{passage.bookTitle && <strong className="answer-source-book">{passage.bookTitle} · </strong>}{passage.headingPath?.length ? `${passage.headingPath.join(' / ')}：` : passage.chapterTitle ? `${passage.chapterTitle}：` : ''}{Array.from(passage.text).slice(0, 60).join('')}</button>
      {unavailable && <small className="field-hint">{copy('workbench.missingSource')}</small>}
      {pages.length > 0 && <div className="answer-source-pages">
        {wholeTable && <small>{copy('sources.wholeTable')}</small>}
        {pages.map((source) => <button key={source.page} type="button" disabled={unavailable} onClick={() => navigate(source.anchor)}>{copy('knowledge.pdfPage', { page: source.page! })}</button>)}
      </div>}
    </div>
  })
}
