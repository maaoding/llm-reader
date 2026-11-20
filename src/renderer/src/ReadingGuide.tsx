import { BookOpen, Sparkles, X } from 'lucide-react'
import { copy } from '@shared/copy'

export function ReadingGuide({ onSelection, onPrepare, onDismiss }: {
  onSelection: () => void; onPrepare: (trigger: HTMLButtonElement) => void; onDismiss: () => void
}) {
  return <section className="reading-guide" data-testid="reading-guide" aria-label={copy('guide.readingTitle')}>
    <button className="icon-button guide-dismiss" data-testid="reading-guide-dismiss" type="button" aria-label={copy('guide.dismiss')} onClick={onDismiss}><X size={15} /></button>
    <Sparkles size={20} aria-hidden="true" />
    <strong>{copy('guide.readingTitle')}</strong>
    <p>{copy('guide.readingDetail')}</p>
    <div className="guide-actions">
      <button className="secondary-button" data-testid="guide-selection" type="button" onClick={onSelection}>{copy('guide.trySelection')}</button>
      <button className="text-button" data-testid="guide-prepare" type="button" onClick={(event) => onPrepare(event.currentTarget)}>{copy('guide.tryBook')}</button>
    </div>
    <small>{copy('guide.readingOptional')}</small>
  </section>
}

export function AnswerGuide({ onDismiss }: { onDismiss: () => void }) {
  return <aside className="answer-guide" data-testid="answer-guide">
    <p>{copy('guide.answerDetail')}</p>
    <button className="icon-button" type="button" data-testid="answer-guide-dismiss" aria-label={copy('guide.dismiss')} onClick={onDismiss}><X size={14} /></button>
  </aside>
}

export function QuickStart({ onReplay }: { onReplay?: () => void }) {
  return <details className="quick-start" data-testid="quick-start" open>
    <summary><BookOpen size={16} aria-hidden="true" />{copy('guide.quickStart')}</summary>
    <ol>
      <li><strong>{copy('guide.importTitle')}</strong><p>{copy('guide.importDetail')}</p></li>
      <li><strong>{copy('guide.selectionTitle')}</strong><p>{copy('guide.selectionDetail')}</p></li>
      <li><strong>{copy('guide.bookTitle')}</strong><p>{copy('guide.bookDetail')}</p></li>
    </ol>
    {onReplay && <button className="secondary-button" type="button" data-testid="guide-replay" onClick={onReplay}>{copy('guide.replay')}</button>}
  </details>
}
