import { useEffect, useId, useLayoutEffect, useRef, type FormEvent, type ReactNode, type RefObject } from 'react'
import { AlertCircle, ArrowLeft, BookOpen, Bookmark, BookmarkCheck, PenLine, RefreshCw, Sparkles } from 'lucide-react'
import { isPdfImageRegion, type BookAnalysisState, type ReaderSource, type ProviderSettings } from '@shared/contracts'
import { copy } from '@shared/copy'
import type { ConversationTab, ConversationTurn } from './conversation-session'
import { Select } from './Select'
import { AssistantComposer } from './AssistantComposer'
import { EmptyState } from './EmptyState'
import { MarkedText } from './MarkedText'
import { QuestionBubble } from './QuestionBubble'
import { AnswerText } from './AnswerText'
import { AnswerMetadata } from './AnswerMetadata'
import { EvidenceSources } from './EvidenceSources'
import { WebSources } from './WebSources'

export function AssistantContextControls({ tab, state, busy, onScope }: { tab?: ConversationTab; state?: BookAnalysisState; busy: boolean; onScope: (scope: 'selection' | 'book') => void }) {
  if (!tab) return null
  return <div className="assistant-context-bar">
    <div className="analysis-scope" role="group" aria-label={copy('analysis.scopeLabel')}>
      <button type="button" aria-pressed={tab.scope === 'selection'} disabled={busy} onClick={() => onScope('selection')}>{copy('analysis.selection')}</button>
      <button type="button" data-testid="scope-book" aria-pressed={tab.scope === 'book'} disabled={busy} onClick={() => onScope('book')}>{copy('analysis.book')}</button>
    </div>
    <small>{tab.scope === 'selection' ? copy(tab.selection ? 'assistant.selectionReady' : 'assistant.selectionPending') : copy(`preparation.document.${state?.document?.status ?? 'empty'}`)}</small>
  </div>
}

export function AssistantScopeControls({ tab, busy, onScope }: { tab: ConversationTab; busy: boolean; onScope: (scope: 'selection' | 'book') => void }) {
  const tooltipId = useId()
  const lastTurn = tab.turns.at(-1)
  const context = lastTurn?.status === 'completed' ? lastTurn.context : undefined
  const history = context?.historySummary
  const source = context?.selection && isPdfImageRegion(context.selection)
    ? copy('visual.source', { page: context.selection.pageNumber })
    : context ? copy(context.scope === 'book' ? 'analysis.book' : 'analysis.selection') : ''
  const summary = context ? copy('assistant.contextSummary', { source: context.selection && isPdfImageRegion(context.selection)
    ? source : copy('assistant.contextPassages', { count: context.passages.length }) }) : ''
  const hint = context && history ? [
    copy('assistant.contextHintTitle'),
    source,
    ...(context.selection && isPdfImageRegion(context.selection) ? [] : [copy('assistant.contextPassages', { count: context.passages.length })]),
    copy('assistant.contextHistory', { count: history.includedMessages }),
    ...(history.truncated ? [copy('assistant.contextTruncated')] : [])
  ].join(' · ') : ''
  return <div className="composer-scope-controls">
    <Select className="analysis-scope" data-testid="composer-scope" aria-label={copy('analysis.scopeLabel')} value={tab.scope} disabled={busy}
      onChange={(event) => onScope(event.target.value as 'selection' | 'book')}>
      <option value="selection">{copy('analysis.selection')}</option>
      <option value="book">{copy('analysis.book')}</option>
    </Select>
    {hint && <span className="composer-context-summary" tabIndex={0} aria-label={hint} aria-describedby={tooltipId}>
      <span className="assistant-context-hint" data-testid="assistant-context-hint">{summary}</span>
      <span id={tooltipId} className="composer-tooltip" role="tooltip">{hint}</span>
    </span>}
  </div>
}

export function ConversationPane({
  conversationSelection,
  turns,
  provider,
  activeRequestId,
  draft,
  canAsk,
  followupRef,
  onDraftChange,
  onNavigate,
  onSave,
  onCancel,
  onSubmit,
  scope = 'selection',
  controls,
  scopeControls,
  composerControls,
  showSave = true,
  blockedReason = '',
  onResolve,
  resolveLabel,
  searchNeedle = '',
  onRegenerate,
  onEditQuestion,
  canRegenerate = false
}: {
  conversationSelection: ReaderSource | null
  scope?: 'selection' | 'book'
  controls?: ReactNode
  scopeControls?: ReactNode
  composerControls?: ReactNode
  turns: ConversationTurn[]
  provider: ProviderSettings
  activeRequestId: string | null
  searchNeedle?: string
  onRegenerate?: (turnId: string) => void
  onEditQuestion?: (turnId: string) => void
  canRegenerate?: boolean
  draft: string
  canAsk: boolean
  followupRef: RefObject<HTMLTextAreaElement | null>
  onDraftChange: (value: string) => void
  onNavigate: (anchor: string, chapterTitle?: string) => void
  onSave?: (turn: ConversationTurn) => void
  showSave?: boolean
  blockedReason?: string
  onResolve?: (trigger: HTMLButtonElement) => void
  resolveLabel?: string
  onCancel: () => void
  onSubmit: (event: FormEvent) => void
}): ReactNode {
  const selectedPassageCount = conversationSelection && !isPdfImageRegion(conversationSelection) ? conversationSelection.passages.length : 0
  const assistantScrollRef = useRef<HTMLDivElement | null>(null)
  const assistantFollowRef = useRef(true)

  useLayoutEffect(() => {
    const container = assistantScrollRef.current
    if (!container || !assistantFollowRef.current) return
    container.scrollTop = container.scrollHeight
  }, [turns])

  // 会话搜索：把第一处匹配带入视图，只调整助手区自身的滚动位置。
  useEffect(() => {
    const container = assistantScrollRef.current
    if (!container || !searchNeedle) return
    const mark = container.querySelector('mark')
    if (!mark) return
    container.scrollTop += mark.getBoundingClientRect().top - container.getBoundingClientRect().top - 24
  }, [searchNeedle, turns])

  return (
    <>
      {controls}
      <div
        className="assistant-scroll"
        ref={assistantScrollRef}
        onScroll={(event) => {
          const container = event.currentTarget
          assistantFollowRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < 40
        }}
      >
        {!conversationSelection && turns.length === 0 && scope !== 'book' && (
          <EmptyState icon={<Sparkles size={21} />} title={copy('assistant.emptyTitle')} detail={copy('assistant.emptyDetail')} />
        )}
        {!conversationSelection && turns.length === 0 && scope === 'book' && <EmptyState icon={<BookOpen size={21} />} title={copy('assistant.bookEmptyTitle')} detail={copy('assistant.bookEmptyHint')} />}
        {conversationSelection && scope !== 'book' && (
          <div className="source-card">
            <div className="source-card-header"><span>{copy('assistant.sourceTitle')}</span><small>{isPdfImageRegion(conversationSelection) ? copy('visual.source', { page: conversationSelection.pageNumber }) : copy('assistant.sourceSummary', { chapter: conversationSelection.chapterTitle || copy('common.currentChapter'), count: selectedPassageCount })}</small></div>
            {isPdfImageRegion(conversationSelection) ? <p>{copy('visual.reviewHint')}</p> : <blockquote>“<MarkedText value={conversationSelection.quote} needle={searchNeedle} />”</blockquote>}
            <button type="button" onClick={() => onNavigate(conversationSelection.anchor, isPdfImageRegion(conversationSelection) ? undefined : conversationSelection.chapterTitle)}><ArrowLeft size={13} />{copy('assistant.backToSource')}</button>
          </div>
        )}
        <div className="conversation-list" aria-live="polite">
          {turns.map((turn, index) => {
            const isLatest = index === turns.length - 1
            const navigate = (anchor: string): void => onNavigate(anchor, turn.context?.passages.find((passage) => passage.anchor === anchor)?.chapterTitle ?? (turn.selection && !isPdfImageRegion(turn.selection) ? turn.selection.chapterTitle : undefined))
            return (
              <article className={`conversation-turn is-${turn.status}`} key={turn.id}>
                <QuestionBubble action={turn.action} label={turn.actionLabel} question={turn.question} needle={searchNeedle} />
                <div className="answer-card" data-testid={isLatest ? 'answer-current' : undefined}>
                  <div className="answer-label"><span><Sparkles size={13} /></span><strong className="answer-model" title={turn.model || provider.model || copy('assistant.modelUnavailable')}>{turn.model || provider.model || copy('assistant.modelUnavailable')}</strong></div>
                  {turn.context && !isPdfImageRegion(turn.context.selection) && <details className="answer-sources"><summary>{copy('analysis.sourceCount', { count: turn.context.passages.length })}</summary>
                    {turn.context.webSearch && <strong>{copy('webSearch.bookSourcesTitle')}</strong>}
                    {turn.context.coverage.total > 0 && <p className="field-hint">{copy('analysis.coverage', turn.context.coverage)}</p>}
                    {turn.context.rerank && <p className="field-hint" data-testid="rerank-result">{copy(turn.context.rerank.status === 'applied' ? 'rerank.applied' : turn.context.rerank.status === 'fallback' ? 'rerank.fallback' : 'rerank.skipped')}</p>}
                    <EvidenceSources passages={turn.context.passages} onNavigate={onNavigate} /></details>}
                  {turn.context?.webSearch && <WebSources context={turn.context} />}
                  {turn.answer ? <AnswerText text={turn.answer} selection={turn.selection} context={turn.context} onNavigate={navigate} highlight={searchNeedle} /> : turn.status === 'streaming' ? <div className="answer-thinking"><i /><i /><i /><span>{copy(turn.webSearchPhase === 'deciding' ? 'webSearch.deciding' : turn.webSearchPhase === 'searching' ? 'webSearch.searching' : 'assistant.thinking')}</span></div> : turn.status === 'queued' ? <div className="answer-thinking is-queued"><span>{copy('assistant.queued')}</span></div> : null}
                  {turn.status === 'streaming' && turn.answer && <span className="stream-caret" aria-label={copy('assistant.generatingAria')} />}
                  {turn.error && <div className={`turn-error ${turn.answer ? 'is-muted' : ''}`}><AlertCircle size={14} />{turn.error}</div>}
                  {turn.status === 'error' && isLatest && !activeRequestId && onRegenerate && (
                    <div className="answer-retry-actions">
                      <button data-testid="answer-regenerate" type="button" disabled={!canRegenerate} onClick={() => onRegenerate(turn.id)}><RefreshCw size={13} />{copy('assistant.regenerate')}</button>
                    </div>
                  )}
                  {turn.status === 'completed' && (
                    <footer className="answer-footer">
                      <AnswerMetadata usage={turn.usage} durationMs={turn.durationMs} />
                      {isLatest && !activeRequestId && (onRegenerate || onEditQuestion) && (
                        <span className="answer-retry-actions">
                          {onRegenerate && <button data-testid="answer-regenerate" type="button" disabled={!canRegenerate} onClick={() => onRegenerate(turn.id)}><RefreshCw size={13} />{copy('assistant.regenerate')}</button>}
                          {onEditQuestion && <button data-testid="answer-edit-question" type="button" onClick={() => onEditQuestion(turn.id)}><PenLine size={13} />{copy('assistant.editQuestion')}</button>}
                        </span>
                      )}
                      {showSave && onSave && (
                        <button data-testid={isLatest ? 'answer-save' : undefined} className={`answer-save${turn.saved ? ' is-saved' : ''}`} type="button" onClick={() => onSave(turn)} disabled={turn.saved}>
                          {turn.saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}{turn.saved ? copy('assistant.saved') : copy('assistant.save')}
                        </button>
                      )}
                    </footer>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </div>
      <AssistantComposer inputRef={followupRef} draft={draft} onDraftChange={onDraftChange}
        placeholder={scope === 'book' ? copy('analysis.bookQuestion') : conversationSelection ? (turns.length ? copy('assistant.placeholderFollowup') : copy('assistant.placeholderFirst')) : copy('assistant.placeholderNoSelection')}
        heading={scopeControls} controls={composerControls} blockedReason={blockedReason} resolveLabel={resolveLabel} onResolve={onResolve}
        canAsk={canAsk} busy={Boolean(activeRequestId)} onSubmit={onSubmit} onCancel={onCancel} />
    </>
  )
}
