import { useEffect, useRef, useState } from 'react'
import type { BookAnalysisState, BookChapterNotesPage, BookNotePoint, BookRecord } from '@shared/contracts'
import { copy } from '@shared/copy'
import { useBookNotesIndex } from './use-book-notes'
import { EvidenceSources } from './EvidenceSources'
import { MarkdownText } from './MarkdownText'
import { readableError } from './readable-error'

function NotePoints({ title, points, onNavigate }: { title: string; points: BookNotePoint[]; onNavigate: (anchor: string, title?: string) => void }) {
  if (!points.length) return null
  return <section className="note-points"><h3>{title}</h3>{points.map((point, index) => <div className="note-point" key={index}>
    {point.term && <h4>{point.term}</h4>}
    {point.aliases?.length ? <p className="field-hint">{copy('notes.aliases', { names: point.aliases.join('、') })}</p> : null}
    <p>{point.text}</p>
    {point.sources.length > 0 && <details className="note-sources"><summary>{copy('notes.sources')}</summary><EvidenceSources passages={point.sources} onNavigate={onNavigate} /></details>}
    {point.missingSources && <p className="field-hint" data-testid="note-source-unavailable">{copy('notes.unavailableSource')}</p>}
  </div>)}</section>
}

function ChapterNotes({ bookId, chapterId, revision, completed, onNavigate }: {
  bookId: string; chapterId: string; revision: string; completed: number; onNavigate: (anchor: string, title?: string) => void
}) {
  const [page, setPage] = useState<BookChapterNotesPage>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const request = useRef(0)
  useEffect(() => {
    const sequence = ++request.current
    void window.readerApi.getBookChapterNotes({ bookId, chapterId }).then((value) => {
      if (sequence !== request.current) return
      if (value.revision !== revision) { setError(copy('notes.changed')); return }
      setPage(value); setError(''); setBusy(false)
    }).catch((reason: unknown) => { if (sequence === request.current) { setError(readableError(reason, copy('notes.failed'))); setBusy(false) } })
    return () => { request.current = sequence + 1 }
  }, [bookId, chapterId, revision, completed, retry])
  const more = async () => {
    if (!page?.nextCursor || busy) return
    const sequence = request.current
    setBusy(true)
    try {
      const next = await window.readerApi.getBookChapterNotes({ bookId, chapterId, cursor: page.nextCursor })
      if (sequence === request.current && next.revision === revision) {
        setPage((current) => current && ({ ...next, notes: [...current.notes, ...next.notes] })); setError('')
      }
    } catch (reason) { if (sequence === request.current) setError(readableError(reason, copy('notes.failed'))) }
    finally { if (sequence === request.current) setBusy(false) }
  }
  return <div className="chapter-notes" data-testid="chapter-notes">
    {error && <p role="status">{error} <button className="text-button" onClick={() => setRetry((value) => value + 1)}>{copy('common.retry')}</button></p>}
    {!page && !error && <p role="status">{copy('notes.loading')}</p>}
    {page?.summary && <section className="note-summary"><h2>{copy('notes.chapterSummary')}</h2><MarkdownText text={page.summary} /></section>}
    {page && !page.notes.length && <div className="workspace-empty"><h2>{copy('notes.chapterEmpty')}</h2><p>{copy('notes.chapterEmptyHint')}</p></div>}
    {page?.notes.map((note) => <article key={note.id} className="chapter-note" data-testid="chapter-note"><MarkdownText className="note-summary-text" text={note.summary} />
      {(['claims', 'conditions', 'exceptions', 'concepts'] as const).map((kind) => <NotePoints key={kind} title={copy(`notes.${kind}`)} points={note[kind]} onNavigate={onNavigate} />)}
    </article>)}
    {page?.nextCursor && <button className="secondary-button" data-testid="notes-load-more" disabled={busy} onClick={() => void more()}>{copy(busy ? 'notes.loading' : 'notes.more')}</button>}
  </div>
}

export function BookNotesView({ book, state, onNavigate, onPrepare }: {
  book: BookRecord; state?: BookAnalysisState; onNavigate: (anchor: string, title?: string) => void; onPrepare: () => void
}) {
  const { index, error, retry } = useBookNotesIndex(book.id, state)
  const [chosen, setChosen] = useState<string>()
  const chapterId = index?.chapters.some((chapter) => chapter.id === chosen) ? chosen : index?.chapters.find((chapter) => chapter.completed)?.id ?? index?.chapters[0]?.id
  const chapter = index?.chapters.find((item) => item.id === chapterId)
  return <section className="notes-view" data-testid="notes-view">
    <header className="workspace-section-heading"><div><h2>{copy('notes.title')}</h2><p>{copy('notes.hint')}</p></div><button className="secondary-button" onClick={onPrepare}>{copy('workspace.prepare')}</button></header>
    {error && <p role="status">{error} <button onClick={retry}>{copy('common.retry')}</button></p>}
    {!index && !error && <p role="status">{copy('notes.loading')}</p>}
    {index?.overview && <details className="book-overview-note"><summary>{copy('notes.overview')}</summary><MarkdownText text={index.overview} /></details>}
    {index && !index.chapters.length && <div className="workspace-empty"><h2>{copy('notes.empty')}</h2><p>{copy('notes.emptyHint')}</p></div>}
    {index && index.chapters.length > 0 && <div className="notes-layout">
      <nav className="notes-chapters" aria-label={copy('notes.navigation')}>{index.chapters.map((item) => <button key={item.id} data-testid="notes-chapter" type="button" aria-current={item.id === chapterId ? 'page' : undefined} onClick={() => setChosen(item.id)}>
        {item.headingPath.length > 1 && <small>{item.headingPath.slice(0, -1).join(' / ')}</small>}<span>{item.title}</span><small>{copy('workspace.noteCount', { completed: item.completed, total: item.total })}</small>
      </button>)}</nav>
      {chapter && <ChapterNotes key={`${index.revision}:${chapter.id}`} bookId={book.id} chapterId={chapter.id} revision={index.revision} completed={chapter.completed} onNavigate={onNavigate} />}
    </div>}
  </section>
}
