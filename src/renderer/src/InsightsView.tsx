import { Bookmark, Download, LoaderCircle, Search, SearchX, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { InsightArchiveRecord, InsightExportScope } from '@shared/contracts'
import { copy } from '@shared/copy'
import { MarkedText } from './MarkedText'
import { normalizeNeedle } from './highlight'
import { AnswerText } from './AnswerText'

type InsightScope = 'all' | 'book'

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

function EmptyState({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }): ReactNode {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">{icon}</div>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  )
}

export default function InsightsView({
  insights,
  loading,
  activeBookId,
  pendingDeleteInsightId,
  exporting,
  onOpenInsight,
  onRequestDeleteInsight,
  onDeleteInsight,
  onCancelDeleteInsight,
  onExportInsights
}: {
  insights: InsightArchiveRecord[]
  loading: boolean
  activeBookId: string | null
  pendingDeleteInsightId: string | null
  exporting: boolean
  onOpenInsight: (insight: InsightArchiveRecord) => void
  onRequestDeleteInsight: (insightId: string) => void
  onDeleteInsight: (insightId: string) => void
  onCancelDeleteInsight: () => void
  onExportInsights: (scope: InsightExportScope) => void
}): ReactNode {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<InsightScope>('all')
  const needle = normalizeNeedle(query)
  const listRef = useRef<HTMLDivElement>(null)

  const scopeRecords = useMemo(
    () => (scope === 'all' || !activeBookId ? insights : insights.filter((insight) => insight.bookId === activeBookId)),
    [activeBookId, insights, scope]
  )
  const visibleRecords = useMemo(() => {
    if (!needle) return scopeRecords
    return scopeRecords.filter((insight) => [
      insight.book.title,
      insight.book.author ?? '',
      insight.selection.chapterTitle,
      insight.selection.quote,
      insight.question,
      insight.answer
    ].some((value) => value.toLocaleLowerCase('zh-CN').includes(needle)))
  }, [needle, scopeRecords])

  useEffect(() => {
    const list = listRef.current
    if (!list) return undefined
    const update = (): void => {
      for (const answer of list.querySelectorAll<HTMLElement>('.insight-content .answer-text')) {
        answer.classList.toggle('is-clamped', answer.scrollHeight > answer.clientHeight + 1)
      }
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(list)
    return () => observer.disconnect()
  }, [visibleRecords, needle, loading])

  const exportScope = (): InsightExportScope | null => {
    if (scope === 'all') return { kind: 'all' }
    return activeBookId ? { kind: 'book', bookId: activeBookId } : null
  }
  const currentExportScope = exportScope()
  const canExportScope = currentExportScope !== null && scopeRecords.length > 0 && !exporting

  return (
    <div className="insights-view insights-workspace" data-testid="insights-view">
      <div className="insights-toolbar">
        <label className="insights-search" data-testid="insights-search">
          <Search size={14} />
          <input
            data-testid="insights-search-input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy('insights.searchPlaceholder')}
            aria-label={copy('insights.searchAria')}
          />
        </label>
        <div className="insights-toolbar-actions">
          <div className="insights-scope" role="group" aria-label={copy('insights.scopeAria')}>
            <button
              data-testid="insights-scope-all"
              type="button"
              className={scope === 'all' ? 'is-active' : ''}
              aria-pressed={scope === 'all'}
              onClick={() => setScope('all')}
            >
              {copy('insights.scopeAll')}
            </button>
            <button
              data-testid="insights-scope-book"
              type="button"
              className={scope === 'book' ? 'is-active' : ''}
              aria-pressed={scope === 'book'}
              disabled={!activeBookId}
              onClick={() => setScope('book')}
            >
              {copy('insights.scopeBook')}
            </button>
          </div>
          <button
            className="insights-export-button"
            data-testid="insights-export-scope"
            type="button"
            disabled={!canExportScope}
            onClick={() => currentExportScope && onExportInsights(currentExportScope)}
          >
            {exporting ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}
            {scope === 'all' ? copy('insights.exportAll') : copy('insights.exportBook')}
          </button>
        </div>
      </div>

      {loading && <div className="sidebar-loading"><LoaderCircle className="spin" size={17} /> {copy('insights.loading')}</div>}

      {!loading && insights.length === 0 && (
        <EmptyState icon={<Bookmark size={20} />} title={copy('insights.emptyTitle')} detail={copy('insights.emptyDetail')} />
      )}

      {!loading && insights.length > 0 && scope === 'book' && !activeBookId && (
        <EmptyState icon={<Bookmark size={20} />} title={copy('insights.noBookTitle')} detail={copy('insights.noBookDetail')} />
      )}

      {!loading && insights.length > 0 && visibleRecords.length === 0 && (
        <EmptyState icon={<SearchX size={20} />} title={copy('insights.noSearchResultsTitle')} detail={copy('insights.noSearchResultsDetail')} />
      )}

      {!loading && visibleRecords.length > 0 && (
        <div className="insight-list" ref={listRef}>
          {visibleRecords.map((insight) => {
            return (
              <article
                className="insight-item"
                data-testid="insight-item"
                data-insight-id={insight.id}
                data-book-id={insight.book.id}
                key={insight.id}
              >
                <div
                  className="insight-content"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenInsight(insight)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onOpenInsight(insight)
                    }
                  }}
                >
                  <span className="insight-book">
                    <MarkedText value={insight.book.title} needle={needle} />
                    {insight.book.author ? <> · <MarkedText value={insight.book.author} needle={needle} /></> : null}
                  </span>
                  <span className="insight-quote">“<MarkedText value={insight.selection.quote} needle={needle} />”</span>
                  <strong className="insight-question"><MarkedText value={insight.question} needle={needle} /></strong>
                  <AnswerText text={insight.answer} selection={insight.selection} readOnly highlight={needle} />
                </div>
              <footer>
                <span>{insight.selection.chapterTitle || copy('common.currentChapter')} · {formatDate(insight.createdAt)}</span>
                {pendingDeleteInsightId === insight.id ? (
                  <span className="insight-delete-confirmation">
                    <span>{copy('insights.removeQuestion')}</span>
                    <button data-testid="insight-delete-confirm" type="button" onClick={() => onDeleteInsight(insight.id)}>{copy('common.confirm')}</button>
                    <button data-testid="insight-delete-cancel" type="button" onClick={onCancelDeleteInsight}>{copy('common.back')}</button>
                  </span>
                ) : (
                  <span className="insight-actions">
                    <button
                      data-testid="insight-export"
                      type="button"
                      aria-label={copy('insights.exportOneAria')}
                      title={copy('insights.exportOneAria')}
                      disabled={exporting}
                      onClick={() => onExportInsights({ kind: 'insight', insightId: insight.id })}
                    >
                      <Download size={13} />
                    </button>
                    <button data-testid="insight-delete" type="button" aria-label={copy('insights.removeAria')} onClick={() => onRequestDeleteInsight(insight.id)}><Trash2 size={13} /></button>
                  </span>
                )}
              </footer>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
