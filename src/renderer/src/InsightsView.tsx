import { AlertCircle, Bookmark, Download, LoaderCircle, RefreshCw, Search, SearchX, Trash2 } from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { isPdfImageRegion, type InsightArchivePreview, type InsightExportScope } from '@shared/contracts'
import { copy, copyIn, getCopyLanguage, getCopyLocale, type UiLanguage } from '@shared/copy'
import { MarkedText } from './MarkedText'
import { normalizeNeedle } from './highlight'
import { AnswerText } from './AnswerText'
import { WebSources } from './WebSources'
import { observeNearby } from './viewport-observer'

type InsightScope = 'all' | 'book'

const archiveDateFormats = new Map<string, Intl.DateTimeFormat>()

function formatDate(iso: string): string {
  try {
    const locale = getCopyLocale()
    let formatter = archiveDateFormats.get(locale)
    if (!formatter) {
      formatter = new Intl.DateTimeFormat(locale, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      })
      archiveDateFormats.set(locale, formatter)
    }
    return formatter.format(new Date(iso))
  } catch {
    return ''
  }
}

const InsightAnswerPreview = memo(function InsightAnswerPreview({
  insight, needle, uiLanguage
}: { insight: InsightArchivePreview; needle: string; uiLanguage: UiLanguage }): ReactNode {
  const hostRef = useRef<HTMLDivElement>(null)
  const [nearby, setNearby] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    return observeNearby(host, host.closest('.insights-view'), () => setNearby(true))
  }, [])

  useLayoutEffect(() => {
    if (!nearby) return
    const answer = hostRef.current?.querySelector<HTMLElement>('.answer-text')
    if (!answer) return
    const update = (): void => {
      answer.classList.toggle('is-clamped', answer.scrollHeight > answer.clientHeight + 1)
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(answer)
    return () => observer?.disconnect()
  }, [nearby, insight, needle, uiLanguage])

  return <div className="insight-answer-preview" ref={hostRef}>
    {nearby
      ? <AnswerText text={insight.answer} selection={insight.selection} context={insight.context} readOnly highlight={needle} uiLanguage={uiLanguage} />
      : <div className="insight-answer-placeholder" aria-hidden="true" />}
  </div>
})

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
  viewSwitch,
  insights,
  loading,
  error,
  onRetry,
  activeBookId,
  pendingDeleteInsightId,
  exporting,
  onOpenInsight,
  onRequestDeleteInsight,
  onDeleteInsight,
  onCancelDeleteInsight,
  onExportInsights
}: {
  viewSwitch?: ReactNode
  insights: InsightArchivePreview[]
  loading: boolean
  error: string
  onRetry: () => void
  activeBookId: string | null
  pendingDeleteInsightId: string | null
  exporting: boolean
  onOpenInsight: (insight: InsightArchivePreview, signal: AbortSignal) => Promise<void>
  onRequestDeleteInsight: (insightId: string) => void
  onDeleteInsight: (insightId: string) => void
  onCancelDeleteInsight: () => void
  onExportInsights: (scope: InsightExportScope) => void
}): ReactNode {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<InsightScope>('all')
  const openRequestRef = useRef<{ id: string; controller: AbortController; trigger: HTMLElement } | null>(null)
  const needle = normalizeNeedle(query)
  const uiLanguage = getCopyLanguage()

  useLayoutEffect(() => () => openRequestRef.current?.controller.abort(), [])

  const cancelOpening = (): void => {
    openRequestRef.current?.controller.abort()
    openRequestRef.current?.trigger.removeAttribute('aria-busy')
    openRequestRef.current = null
  }

  const open = (insight: InsightArchivePreview, trigger: HTMLElement): void => {
    if (openRequestRef.current?.id === insight.id) return
    cancelOpening()
    const request = { id: insight.id, controller: new AbortController(), trigger }
    openRequestRef.current = request
    trigger.setAttribute('aria-busy', 'true')
    void onOpenInsight(insight, request.controller.signal).finally(() => {
      if (openRequestRef.current !== request) return
      openRequestRef.current = null
      trigger.removeAttribute('aria-busy')
    })
  }

  const scopeRecords = useMemo(
    () => (scope === 'all' || !activeBookId ? insights : insights.filter((insight) => insight.bookId === activeBookId)),
    [activeBookId, insights, scope]
  )
  const visibleRecords = useMemo(() => {
    if (!needle) return scopeRecords
    return scopeRecords.filter((insight) => [
      insight.book.title,
      insight.book.author ?? '',
      isPdfImageRegion(insight.selection) ? copyIn(uiLanguage, 'visual.source', { page: insight.selection.pageNumber }) : insight.selection?.chapterTitle ?? copyIn(uiLanguage, 'analysis.bookSource'),
      insight.selection && !isPdfImageRegion(insight.selection) ? insight.selection.quote : '',
      insight.question,
      insight.answer
    ].some((value) => value.toLocaleLowerCase('zh-CN').includes(needle)))
  }, [needle, scopeRecords, uiLanguage])

  const exportScope = (): InsightExportScope | null => {
    if (scope === 'all') return { kind: 'all' }
    return activeBookId ? { kind: 'book', bookId: activeBookId } : null
  }
  const currentExportScope = exportScope()
  const canExportScope = currentExportScope !== null && scopeRecords.length > 0 && !exporting

  return (
    <>
      <header className="archives-header" data-testid="archives-header">
        <h2 className="visually-hidden" id="assistant-dialog-title">{copy('workspace.archives')}</h2>
        <div className="insights-toolbar">
          <label className="insights-search" data-testid="insights-search">
            <Search size={14} />
            <input
              data-testid="insights-search-input"
              type="search"
              value={query}
              onChange={(event) => {
                cancelOpening()
                setQuery(event.target.value)
              }}
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
                onClick={() => {
                  cancelOpening()
                  setScope('all')
                }}
              >
                {copy('insights.scopeAll')}
              </button>
              <button
                data-testid="insights-scope-book"
                type="button"
                className={scope === 'book' ? 'is-active' : ''}
                aria-pressed={scope === 'book'}
                disabled={!activeBookId}
                onClick={() => {
                  cancelOpening()
                  setScope('book')
                }}
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
        {viewSwitch}
      </header>

      <div className="insights-view insights-workspace" data-testid="insights-view">
        {loading && <div className="sidebar-loading"><LoaderCircle className="spin" size={17} /> {copy('insights.loading')}</div>}
        {error && <div className="empty-state" role="alert" data-testid="insights-load-error">
          <div className="empty-icon" aria-hidden="true"><AlertCircle size={20} /></div>
          <strong>{error}</strong>
          <button className="text-button" data-testid="insights-retry" type="button" onClick={onRetry}><RefreshCw size={14} />{copy('common.retry')}</button>
        </div>}

        {!loading && !error && insights.length === 0 && (
          <EmptyState icon={<Bookmark size={20} />} title={copy('insights.emptyTitle')} detail={copy('insights.emptyDetail')} />
        )}

        {!loading && !error && insights.length > 0 && scope === 'book' && !activeBookId && (
          <EmptyState icon={<Bookmark size={20} />} title={copy('insights.noBookTitle')} detail={copy('insights.noBookDetail')} />
        )}

        {!loading && !error && insights.length > 0 && visibleRecords.length === 0 && (
          <EmptyState icon={<SearchX size={20} />} title={copy('insights.noSearchResultsTitle')} detail={copy('insights.noSearchResultsDetail')} />
        )}

        {!loading && visibleRecords.length > 0 && (
          <div className="insight-list">
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
                    onClick={(event) => { if (!(event.target as HTMLElement).closest('button, details')) open(insight, event.currentTarget) }}
                    onKeyDown={(event) => {
                      if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault()
                        open(insight, event.currentTarget)
                      }
                    }}
                  >
                    <span className="insight-book">
                      <MarkedText value={insight.book.title} needle={needle} />
                      {insight.book.author ? <> · <MarkedText value={insight.book.author} needle={needle} /></> : null}
                    </span>
                    <span className="insight-quote">{isPdfImageRegion(insight.selection) ? copy('visual.source', { page: insight.selection.pageNumber }) : insight.selection ? <>“<MarkedText value={insight.selection.quote} needle={needle} />”</> : copy('analysis.bookSource')}</span>
                    <strong className="insight-question"><MarkedText value={insight.question} needle={needle} /></strong>
                    <InsightAnswerPreview insight={insight} needle={needle} uiLanguage={uiLanguage} />
                    {insight.context?.webSearch && <WebSources context={insight.context} uiLanguage={uiLanguage} />}
                  </div>
                <footer>
                  <span>{isPdfImageRegion(insight.selection) ? copy('visual.source', { page: insight.selection.pageNumber }) : insight.selection?.chapterTitle || (insight.selection ? copy('common.currentChapter') : copy('analysis.bookSource'))} · {formatDate(insight.createdAt)}</span>
                  {pendingDeleteInsightId === insight.id ? (
                    <span className="insight-delete-confirmation">
                      <span>{copy('insights.removeQuestion')}</span>
                      <button data-testid="insight-delete-confirm" type="button" onClick={() => {
                        if (openRequestRef.current?.id === insight.id) cancelOpening()
                        onDeleteInsight(insight.id)
                      }}>{copy('common.confirm')}</button>
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
    </>
  )
}
