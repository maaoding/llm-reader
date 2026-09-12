import { BookOpen, MessageSquareText, ArrowRight, FileText, Sparkles } from 'lucide-react'
import type { BookAnalysisState, BookRecord, InsightArchiveRecord } from '@shared/contracts'
import { copy } from '@shared/copy'
import { useBookNotesIndex } from './use-book-notes'
import { MarkdownPreview, MarkdownText } from './MarkdownText'

export function BookOverview({ book, state, insights, onRead, onAsk, onPrepare, onNotes, onInsight, onArchives }: {
  book: BookRecord; state?: BookAnalysisState; insights: InsightArchiveRecord[]; onRead: () => void; onAsk: () => void;
  onPrepare: () => void; onNotes: () => void; onInsight: (insight: InsightArchiveRecord) => void; onArchives: () => void
}) {
  const { index } = useBookNotesIndex(book.id, state)
  const recent = insights.filter((item) => item.bookId === book.id).slice(0, 5)
  return <section className="book-workspace-overview" data-testid="book-overview">
    <div className="workspace-welcome"><span className="workspace-eyebrow">{copy('workspace.overview')}</span><h2>{book.title}</h2><p>{book.author || copy('common.unknownAuthor')}</p>
      <p className="workspace-progress">{copy('workspace.readingProgress', { percent: Math.round(book.progress * 100) })}</p>
      <div className="workspace-primary-actions"><button className="primary-button" data-testid="workspace-read" onClick={onRead}><BookOpen size={17} />{copy(book.lastLocator ? 'workspace.continue' : 'workspace.startReading')}</button>
        <button className="secondary-button" data-testid="workspace-ask" onClick={onAsk}><MessageSquareText size={17} />{copy('workspace.ask')}</button></div>
    </div>
    <div className="workspace-status-grid">
      <section className="workspace-status-card"><FileText size={20} /><h3>{copy('preparation.original')}</h3><p>{copy(`preparation.document.${state?.document?.status ?? 'empty'}`)}</p><button className="text-button" onClick={onPrepare}>{copy('workspace.prepare')}<ArrowRight size={14} /></button></section>
      <section className="workspace-status-card"><BookOpen size={20} /><h3>{copy('workspace.notes')}</h3><p>{state?.sections ? copy('workspace.noteCount', { completed: state.completedSections, total: state.sections }) : copy('workspace.noteEmpty')}</p><button className="text-button" onClick={onNotes}>{copy('workspace.openNotes')}<ArrowRight size={14} /></button></section>
      <section className="workspace-status-card"><Sparkles size={20} /><h3>{copy('knowledge.indexTitle')}</h3><p>{state?.semantic ? copy(`knowledge.status.${state.semantic.status}`) : copy('workspace.semanticEmpty')}</p><button className="text-button" onClick={onPrepare}>{copy('workspace.manage')}<ArrowRight size={14} /></button></section>
    </div>
    {index?.overview && <section className="workspace-summary"><h2>{copy('notes.overview')}</h2><MarkdownText text={index.overview} /></section>}
    <section className="workspace-recent"><header><h2>{copy('workspace.recent')}</h2><button className="text-button" onClick={onArchives}>{copy('workspace.allArchives')}<ArrowRight size={14} /></button></header>
      {!recent.length && <div className="workspace-empty"><h3>{copy('workspace.recentEmpty')}</h3><p>{copy('workspace.recentHint')}</p></div>}
      {recent.map((item) => <button className="workspace-recent-item" key={item.id} onClick={() => onInsight(item)}><strong>{item.question}</strong><span className="workspace-recent-answer"><MarkdownPreview text={item.answer} limit={160} /></span><ArrowRight size={16} /></button>)}
    </section>
  </section>
}
