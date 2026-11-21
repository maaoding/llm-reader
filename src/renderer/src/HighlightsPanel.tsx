import { AlertCircle, Bookmark, Download, ListChecks, LoaderCircle, PenLine, RefreshCw, SearchX, Trash2 } from 'lucide-react'
import type { HighlightRecord } from '@shared/contracts'
import { copy, getCopyLanguage } from '@shared/copy'
import { EmptyState } from './EmptyState'
import { Select } from './Select'
import { useHighlightOrganizer } from './use-highlight-organizer'

interface HighlightsPanelProps {
  bookId?: string
  records: readonly HighlightRecord[]
  loading: boolean
  error: string
  pendingDeleteId: string | null
  onRetry: () => void
  onNavigate: (anchor: string) => void
  onEdit: (record: HighlightRecord, trigger: HTMLElement) => void
  onDelete: (id: string) => void
  onConfirmDelete: (id: string | null) => void
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat(getCopyLanguage() === 'en' ? 'en' : 'zh-CN', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date)
}

export function HighlightsPanel({
  bookId, records, loading, error, pendingDeleteId, onRetry, onNavigate, onEdit, onDelete, onConfirmDelete
}: HighlightsPanelProps) {
  const organizer = useHighlightOrganizer(bookId, records)
  const { query, activeTag, tags, visible, filtering, selection, selectedCount, feedback, exporting } = organizer
  const allSelected = visible.length > 0 && selectedCount === visible.length
  const controlsDisabled = loading || Boolean(error) || exporting

  return <div className="highlight-list" data-testid="highlight-list" aria-label={copy('library.highlightsAria')}>
    <div className="highlight-list-heading">
      <h2>{copy('highlights.title')}</h2>
      <span data-testid="highlight-result-count">{copy(filtering ? 'highlights.filteredCount' : 'highlights.count', { count: visible.length })}</span>
    </div>
    {bookId && records.length > 0 && <div className="highlight-controls">
      <input className="highlight-filter-text" type="search" data-testid="highlight-filter-text"
        aria-label={copy('highlights.filterText')} placeholder={copy('highlights.filterText')} maxLength={200}
        value={query} disabled={controlsDisabled} onChange={(event) => organizer.changeQuery(event.target.value)} />
      <div className="highlight-filter-actions">
        <Select aria-label={copy('highlights.filterTag')} data-testid="highlight-filter-tag"
          value={activeTag} disabled={controlsDisabled} onChange={(event) => organizer.changeTag(event.target.value)}>
          <option value="">{copy('highlights.allTags')}</option>
          {[...tags].map(([key, label]) => <option value={key} key={key}>{label}</option>)}
        </Select>
        <button className="secondary-button" type="button" aria-pressed={selection !== null} data-testid="highlight-select-mode"
          disabled={controlsDisabled} onClick={organizer.toggleMode}><ListChecks size={15} />{copy('highlights.selectMode')}</button>
      </div>
      {selection !== null && <div className="highlight-selection-tools">
        <div className="highlight-selection-summary">
          <label>
            <input type="checkbox" data-testid="highlight-select-all" checked={allSelected} disabled={controlsDisabled || visible.length === 0}
              ref={(element) => { if (element) element.indeterminate = selectedCount > 0 && !allSelected }}
              onChange={(event) => organizer.selectAll(event.target.checked)} />
            {copy('highlights.selectAll')}
          </label>
          <span data-testid="highlight-selected-count" aria-live="polite">{copy('highlights.selectedCount', { count: selectedCount })}</span>
        </div>
        <button className="secondary-button" type="button" data-testid="highlight-export"
          disabled={controlsDisabled || selectedCount === 0} onClick={() => void organizer.exportSelected()}>
          <Download size={15} />{copy('highlights.exportSelected')}
        </button>
      </div>}
      {(feedback || exporting) && <p className={'highlight-export-feedback' + (feedback?.error ? ' is-error' : '')}
        role={feedback?.error ? 'alert' : 'status'} data-testid="highlight-export-feedback">
        {exporting ? copy('highlights.exporting') : feedback?.message}
      </p>}
    </div>}
    {loading && <div className="sidebar-loading"><LoaderCircle className="spin" size={17} /> {copy('highlights.loading')}</div>}
    {error && <div className="empty-state" role="alert" data-testid="highlights-load-error">
      <div className="empty-icon" aria-hidden="true"><AlertCircle size={20} /></div>
      <strong>{error}</strong>
      <button className="text-button" data-testid="highlights-retry" type="button" onClick={onRetry}><RefreshCw size={14} />{copy('common.retry')}</button>
    </div>}
    {!loading && !bookId && <EmptyState icon={<Bookmark size={20} />} title={copy('highlights.noBookTitle')} detail={copy('highlights.noBookDetail')} />}
    {!loading && !error && bookId && records.length === 0 && <EmptyState icon={<Bookmark size={20} />} title={copy('highlights.emptyTitle')} detail={copy('highlights.emptyDetail')} />}
    {!loading && !error && records.length > 0 && visible.length === 0 &&
      <EmptyState icon={<SearchX size={20} />} title={copy('highlights.noMatches')} detail={copy('highlights.noMatchesHint')} />}
    {visible.map((record) => (
      <article className="highlight-item" data-testid="highlight-item" data-highlight-id={record.id} key={record.id}>
        <button className="highlight-jump" type="button" onClick={() => onNavigate(record.anchor)}>
          <p className="highlight-quote">{record.quote}</p>
          <span className="highlight-chapter">{record.chapterTitle || copy('common.currentChapter')}</span>
        </button>
        {(record.note.trim() || record.tags.length > 0) && <div className="highlight-details">
          {record.note.trim() && <p className="highlight-note-preview" aria-label={copy('highlights.note')}>{record.note}</p>}
          {record.tags.length > 0 && <ul className="highlight-tags" aria-label={copy('highlights.tags')}>
            {record.tags.map((tag) => <li key={tag} title={tag}>{tag}</li>)}
          </ul>}
        </div>}
        <footer>
          <span className="highlight-item-meta">
            {selection !== null && <input type="checkbox" aria-label={copy('highlights.selectExtract')} data-testid="highlight-select-item"
              checked={selection.has(record.id)} disabled={controlsDisabled} onChange={() => organizer.toggleOne(record.id)} />}
            <time dateTime={record.createdAt}>{formatDate(record.createdAt)}</time>
          </span>
          {pendingDeleteId === record.id ? (
            <span className="highlight-delete-confirmation">
              <span>{copy('highlights.removeQuestion')}</span>
              <button data-testid="highlight-delete-confirm" type="button" onClick={() => onDelete(record.id)}>{copy('common.confirm')}</button>
              <button data-testid="highlight-delete-cancel" type="button" onClick={() => onConfirmDelete(null)}>{copy('common.back')}</button>
            </span>
          ) : (
            <span className="highlight-item-actions">
              <button data-testid="highlight-edit" type="button" aria-label={copy('highlights.edit')} title={copy('highlights.edit')}
                onClick={(event) => onEdit(record, event.currentTarget)}><PenLine size={14} /></button>
              <button data-testid="highlight-delete" type="button" aria-label={copy('highlights.removeAria')}
                onClick={() => onConfirmDelete(record.id)}><Trash2 size={13} /></button>
            </span>
          )}
        </footer>
      </article>
    ))}
  </div>
}
