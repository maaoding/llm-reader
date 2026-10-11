import { AlertCircle, ArrowLeft, BookOpen, Check, ChevronDown, Download, Library, LoaderCircle, PenLine, Plus, RefreshCw, Search, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { MAX_WORKBENCH_BOOKS, type BookAnalysisState, type BookRecord, type PersonaSelection, type PersonaSettings, type ProviderSettings, type WorkbenchRecord } from '@shared/contracts'
import { copy } from '@shared/copy'
import { providerIsConfigured } from '@shared/request-settings'
import { AnswerText } from './AnswerText'
import { AssistantComposer } from './AssistantComposer'
import { PersonaSessionControl } from './AssistantPersonaSettings'
import { BookCover } from './BookCover'
import type { BookCoverCache } from './book-cover-cache'
import { EvidenceSources } from './EvidenceSources'
import { QuestionBubble } from './QuestionBubble'
import { WebSearchControl } from './WebSearchControl'
import { WebSources } from './WebSources'
import { defaultPersona } from './assistant-personas'
import { workbenchBusy, type useWorkbenches } from './use-workbenches'
import { readableError } from './readable-error'

type Controller = ReturnType<typeof useWorkbenches>

export function ArchiveViewSwitch({ value, onChange }: { value: 'archived' | 'workbenches'; onChange: (view: 'archived' | 'workbenches') => void }) {
  return <div className="archive-view-switch" role="group" aria-label={copy('workspace.archives')}>
    <button type="button" aria-pressed={value === 'archived'} onClick={() => onChange('archived')}>{copy('workbench.archived')}</button>
    <button type="button" data-testid="nav-workbenches" aria-pressed={value === 'workbenches'} onClick={() => onChange('workbenches')}>{copy('workbench.title')}</button>
  </div>
}

interface WorkbenchProps {
  controller: Controller
  books: BookRecord[]
  coverCache: BookCoverCache
  states: Record<string, BookAnalysisState>
  provider: ProviderSettings
  personas: PersonaSettings
  webSearchEnabled: boolean
  onPrepare: (id: string) => void
  onNavigate: (bookId: string, anchor: string, title?: string) => void
  onConfigure: (trigger: HTMLButtonElement) => void
  onSavePersonaAs: (persona: PersonaSelection) => PersonaSelection | null
  onArchiveViewChange: (view: 'archived' | 'workbenches') => void
}

function WorkbenchConversation({ record, controller, books, coverCache, states, provider, personas, webSearchEnabled, onPrepare, onNavigate, onConfigure, onSavePersonaAs, onArchiveViewChange }: WorkbenchProps & { record: WorkbenchRecord }) {
  const [query, setQuery] = useState('')
  const [pickerOpen, setPickerOpen] = useState(record.bookIds.length === 0)
  const [name, setName] = useState(record.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [editing, setEditing] = useState(false)
  const priorDraft = useRef('')
  const listRef = useRef<HTMLDivElement>(null)
  const followScroll = useRef(true)
  const questionRef = useRef<HTMLTextAreaElement>(null)
  const busy = workbenchBusy(record)
  const scopeIds = editing ? record.turns.at(-1)!.bookIds : record.bookIds
  const selected = scopeIds.flatMap((id) => books.find((book) => book.id === id) ?? [])
  const availableBookIds = books.map((book) => book.id)
  const visible = books.filter((book) => `${book.title} ${book.author ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 100)
  const ready = (ids: string[]) => ids.length > 0 && ids.every((id) => books.some((book) => book.id === id) && states[id]?.document?.status === 'ready')
  const configured = providerIsConfigured(provider)
  const blocked = !configured ? copy('workbench.modelNeeded') : !scopeIds.length ? copy('workbench.noBooks') : !ready(scopeIds) ? copy('workbench.unready') : record.turns.length >= 200 && !editing ? copy('workbench.limit') : ''
  const change = (patch: Partial<WorkbenchRecord>) => controller.update(record.id, (current) => ({ ...current, ...patch }))
  const run = async (action: () => Promise<unknown>) => {
    setError(''); setPending(true)
    try { await action() } catch (cause) { setError(readableError(cause, copy('workbench.saveFailed'))) } finally { setPending(false) }
  }
  useEffect(() => {
    if (followScroll.current && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [record.turns])

  return <div className="multi-book-workbench" data-testid="workbench-detail">
    <header className="workbench-header" data-testid="workbench-header">
      <h2 className="visually-hidden" id="assistant-dialog-title">{copy('workspace.archives')} · {record.name}</h2>
      <button className="icon-button" type="button" onClick={() => controller.activate(null)} aria-label={copy('workbench.back')} title={copy('workbench.back')}><ArrowLeft size={16} /></button>
      <form onSubmit={(event) => { event.preventDefault(); if (name.trim()) change({ name: name.trim() }) }}>
        <input aria-label={copy('workbench.name')} value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
        {name.trim() !== record.name && <button className="icon-button" type="submit" disabled={!name.trim()} aria-label={copy('workbench.rename')}><Check size={15} /></button>}
      </form>
      <div className="workbench-header-actions">
        <span className="workbench-save-status" role="status">{controller.errors[record.id] ? copy('workbench.notSaved') : controller.dirty.includes(record.id) ? copy('workbench.saving') : copy('workbench.saved')}</span>
        <button className="icon-button" type="button" disabled={pending || busy} onClick={() => void run(async () => { await controller.flush(record.id); await window.readerApi.exportWorkbench(record.id) })} aria-label={copy('workbench.export')} title={copy('workbench.export')}><Download size={16} /></button>
        <button className="icon-button" type="button" disabled={pending} onClick={() => setConfirmDelete(true)} aria-label={copy('workbench.remove')} title={copy('workbench.remove')}><Trash2 size={16} /></button>
      </div>
      <ArchiveViewSwitch value="workbenches" onChange={onArchiveViewChange} />
    </header>
    {confirmDelete && <div className="workbench-notice" role="alert">
      <span>{copy('workbench.removeConfirm')}</span>
      <button className="secondary-button" type="button" disabled={pending} onClick={() => void run(() => controller.remove(record.id))}>{copy('common.confirm')}</button>
      <button className="text-button" type="button" onClick={() => setConfirmDelete(false)}>{copy('common.back')}</button>
    </div>}
    {(error || controller.errors[record.id]) && <div className="workbench-notice is-error" role="alert">{error || controller.errors[record.id]}
      {controller.errors[record.id] && <button className="text-button" type="button" onClick={() => void run(() => controller.flush(record.id))}>{copy('common.retry')}</button>}
    </div>}
    <div className="workbench-layout">
      <aside className="workbench-books" aria-label={copy('workbench.books')}>
        <h3><Library size={16} aria-hidden="true" />{copy('workbench.books')} <small>{scopeIds.length} / {MAX_WORKBENCH_BOOKS}</small></h3>
        <details className="workbench-book-selection" open={pickerOpen} onToggle={(event) => setPickerOpen(event.currentTarget.open)}>
          <summary><Plus size={14} aria-hidden="true" /><span>{copy('workbench.selectBooks')}</span><ChevronDown size={14} aria-hidden="true" /></summary>
          <div className="insights-search"><Search size={14} aria-hidden="true" /><input type="search" aria-label={copy('workbench.searchBooks')} placeholder={copy('workbench.searchBooks')} value={query} onChange={(event) => setQuery(event.target.value)} /></div>
          <div className="workbench-book-picker">
            {visible.map((book) => <label key={book.id}>
              <input type="checkbox" checked={scopeIds.includes(book.id)} disabled={busy || editing || (!record.bookIds.includes(book.id) && record.bookIds.length >= MAX_WORKBENCH_BOOKS)}
                onChange={(event) => change({ bookIds: event.target.checked ? [...record.bookIds, book.id] : record.bookIds.filter((id) => id !== book.id) })} />
              <BookCover book={book} cache={coverCache} />
              <span className="workbench-book-label"><span title={book.title}>{book.title}</span><small title={book.author ?? undefined}>{book.author}</small></span>
            </label>)}
            {visible.length === 0 && <p className="field-hint" role="status">{copy('workspace.libraryNoResults')}</p>}
          </div>
        </details>
        {selected.map((book) => <div className="workbench-selected-book" key={book.id}>
          <BookCover book={book} cache={coverCache} />
          <div className="workbench-selected-book-info">
            <details className="workbench-book-title">
              <summary title={book.title}><strong>{book.title}</strong></summary>
            </details>
            <small data-ready={states[book.id]?.document?.status === 'ready'}>{states[book.id]?.document?.status === 'ready' && <Check size={12} aria-hidden="true" />}{copy(`preparation.document.${states[book.id]?.document?.status ?? 'empty'}`)}</small>
            {states[book.id]?.document?.status !== 'ready' && <button className="text-button" type="button" onClick={() => onPrepare(book.id)}>{copy('workbench.prepare')}</button>}
          </div>
        </div>)}
        <p className="workbench-hint">{copy('workbench.changedSources')}</p>
      </aside>
      <section className="workbench-conversation" aria-label={copy('workspace.conversation')}>
        <div className="workbench-turns" ref={listRef} onScroll={() => { const list = listRef.current; if (list) followScroll.current = list.scrollHeight - list.scrollTop - list.clientHeight < 100 }}>
          {record.turns.length === 0 && <div className="empty-state workbench-empty"><div className="empty-icon"><BookOpen size={24} /></div><strong>{copy('workbench.empty')}</strong><p>{copy('workbench.question')}</p></div>}
          <div className="conversation-list" aria-live="polite">
            {record.turns.map((turn, index) => <article className={`conversation-turn workbench-turn is-${turn.status}`} data-testid="workbench-turn" key={turn.id}>
              <QuestionBubble action="ask" label={copy('assistant.actionAsk')} question={turn.question} />
              <div className="answer-card">
                <div className="answer-label"><span><Sparkles size={13} /></span><strong className="answer-model" title={turn.model || provider.model}>{turn.model || provider.model || copy('assistant.modelUnavailable')}</strong></div>
                <small className="workbench-turn-books">{copy('workbench.sources')}: {(turn.context?.books?.map((book) => book.title) ?? turn.bookIds.map((id) => books.find((book) => book.id === id)?.title ?? copy('workbench.deletedBook'))).join(' · ')}</small>
                {!!turn.context?.passages.length && <details className="answer-sources"><summary>{copy('analysis.sourceCount', { count: turn.context.passages.length })}</summary>
                  <EvidenceSources passages={turn.context.passages} availableBookIds={availableBookIds} onNavigate={(anchor, title, bookId) => { if (bookId) onNavigate(bookId, anchor, title) }} />
                </details>}
                {turn.context?.webSearch && <WebSources context={turn.context} availableBookIds={availableBookIds} />}
                {turn.answer ? <AnswerText text={turn.answer} selection={null} context={turn.context} availableBookIds={availableBookIds}
                  onNavigate={(anchor, bookId) => { if (bookId) onNavigate(bookId, anchor, turn.context?.passages.find((passage) => passage.bookId === bookId && passage.anchor === anchor)?.chapterTitle) }} />
                  : (turn.status === 'queued' || turn.status === 'streaming') && <div className="answer-thinking" role="status"><i /><i /><i /><span>{copy('workbench.generating')}</span></div>}
                {turn.status === 'streaming' && turn.answer && <span className="stream-caret" aria-label={copy('assistant.generatingAria')} />}
                {turn.error && <div className={`turn-error ${turn.answer ? 'is-muted' : ''}`} role="alert"><AlertCircle size={14} />{turn.error}</div>}
                {(turn.usage?.totalTokens || (index === record.turns.length - 1 && !busy && !editing)) && <footer className="answer-footer">
                  {!!turn.usage?.totalTokens && <div className="answer-meta"><span className="answer-usage">{copy('assistant.tokenUsage', { count: turn.usage.totalTokens })}</span></div>}
                  {index === record.turns.length - 1 && !busy && !editing && <span className="answer-retry-actions">
                    <button type="button" disabled={!configured || !ready(turn.bookIds)} onClick={() => void controller.submit(record.id, provider.model, true)}><RefreshCw size={13} />{copy('workbench.regenerate')}</button>
                    <button type="button" onClick={() => { priorDraft.current = record.draft; setEditing(true); change({ draft: turn.question }); questionRef.current?.focus() }}><PenLine size={13} />{copy('workbench.edit')}</button>
                  </span>}
                </footer>}
              </div>
            </article>)}
          </div>
        </div>
        <AssistantComposer inputRef={questionRef} inputTestId="workbench-question" sendTestId="workbench-send" stopTestId="workbench-stop"
          draft={record.draft} onDraftChange={(draft) => change({ draft })} placeholder={copy('workbench.question')} canAsk={!blocked} busy={busy}
          onSubmit={(event) => { event.preventDefault(); if (!blocked && !busy && record.draft.trim()) { followScroll.current = true; void controller.submit(record.id, provider.model, editing, editing ? record.draft : undefined); setEditing(false) } }}
          onCancel={() => void run(() => controller.cancel(record.id))}
          heading={editing && <div className="composer-hint"><PenLine size={14} /><span>{copy('workbench.editing')}</span><button className="text-button" type="button" onClick={() => { setEditing(false); change({ draft: priorDraft.current }) }}>{copy('common.back')}</button></div>}
          blockedReason={blocked} onResolve={!configured ? onConfigure : undefined} resolveLabel={copy('settings.title')}
          controls={<>
            <WebSearchControl mode={record.webSearch} enabled={webSearchEnabled} busy={busy} onChange={(webSearch) => change({ webSearch })} />
            <PersonaSessionControl persona={record.persona} settings={personas} disabled={busy} onChange={(persona) => change({ persona })}
              onSaveAs={(persona) => { const saved = onSavePersonaAs(persona); if (saved) change({ persona: saved }) }} />
          </>} />
      </section>
    </div>
  </div>
}

export default function WorkbenchesView(props: WorkbenchProps & { refresh: (id: string) => Promise<void> }) {
  const { controller, books, refresh } = props
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const ids = [...new Set([...(controller.active?.bookIds ?? []), ...(controller.active?.turns.at(-1)?.bookIds ?? [])])].filter((id) => books.some((book) => book.id === id)).join(',')
  useEffect(() => { if (ids) void Promise.all(ids.split(',').map((id) => refresh(id))) }, [ids, refresh])
  if (controller.active && !controller.loading && !controller.loadError) return <WorkbenchConversation {...props} record={controller.active} key={controller.active.id} />
  return <>
    <header className="archives-header" data-testid="workbench-list-header">
      <h2 className="visually-hidden" id="assistant-dialog-title">{copy('workbench.title')}</h2>
      <div className="workbench-list-heading"><button className="primary-button" type="button" data-testid="workbench-new" disabled={controller.loading || Boolean(controller.loadError)} onClick={() => { setCreating(true); setName(''); setError('') }}><Plus size={16} />{copy('workbench.new')}</button></div>
      <ArchiveViewSwitch value="workbenches" onChange={props.onArchiveViewChange} />
    </header>
    {controller.loading ? <div className="workbench-empty" role="status"><LoaderCircle className="spin" />{copy('insights.loading')}</div>
      : controller.loadError ? <div className="workbench-empty" role="alert">{controller.loadError}<button className="secondary-button" type="button" onClick={() => void controller.load()}>{copy('common.retry')}</button></div>
      : <div className="workbench-list" data-testid="workbench-list">
        <p className="workbench-list-hint">{copy('workbench.hint')}</p>
        {creating && <form className="workbench-create" onSubmit={async (event) => {
          event.preventDefault(); if (!name.trim() || pending) return
          setPending(true); setError('')
          try { await controller.create(name.trim(), [], defaultPersona(props.personas)); setCreating(false) }
          catch (cause) { setError(readableError(cause, copy('workbench.saveFailed'))) }
          finally { setPending(false) }
        }}>
          <label>{copy('workbench.name')}<input autoFocus data-testid="workbench-name" value={name} maxLength={120} placeholder={copy('workbench.defaultName')} onChange={(event) => setName(event.target.value)} /></label>
          <button className="primary-button" type="submit" disabled={!name.trim() || pending}>{copy('workbench.create')}</button>
          <button className="text-button" type="button" disabled={pending} onClick={() => setCreating(false)}>{copy('common.back')}</button>
          {error && <p role="alert">{error}</p>}
        </form>}
        {!controller.records.length && !creating && <div className="empty-state workbench-empty"><div className="empty-icon"><Library size={24} /></div><strong>{copy('workbench.empty')}</strong></div>}
        <div className="workbench-cards">{controller.records.map((record) => <button className="workbench-card" type="button" key={record.id} onClick={() => controller.activate(record.id)}>
          <span className="workbench-card-icon"><Library size={20} /></span><strong>{record.name}</strong><span>{record.bookIds.map((id) => books.find((book) => book.id === id)?.title ?? copy('workbench.deletedBook')).join(' · ') || copy('workbench.noBooks')}</span>
          <small>{copy('assistant.recentSessionTurns', { count: record.turns.length })}{workbenchBusy(record) ? ` · ${copy('workbench.generating')}` : ''}</small>
        </button>)}</div>
      </div>}
  </>
}
