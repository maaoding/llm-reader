import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { History, Search, X } from 'lucide-react'
import { RECENT_BOOK_SESSION_QUERY_LIMIT, RECENT_BOOK_SESSION_SEARCH_LIMIT, type BookSessionSearchResult, type BookSessionSummary } from '@shared/contracts'
import { copy, getCopyLocale } from '@shared/copy'
import { MarkedText } from './MarkedText'
import { normalizeNeedle } from './highlight'

export type RecentConversationOutcome = 'restored' | 'missing' | 'blocked'

interface RecentConversationsProps {
  current?: { bookId: string; conversationId: string; onList: () => Promise<BookSessionSummary[]> }
  disabled: boolean
  onRestore: (bookId: string, conversationId: string, signal: AbortSignal) => Promise<RecentConversationOutcome>
}

function sessionTitle(item: BookSessionSummary): string {
  return item.title || copy(item.scope === 'book' ? 'analysis.book' : 'analysis.selection')
}

export function RecentConversations({ current, disabled, onRestore }: RecentConversationsProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [items, setItems] = useState<BookSessionSummary[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listFailed, setListFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<BookSessionSearchResult | null>(null)
  const [searchFailed, setSearchFailed] = useState(false)
  const [searchAttempt, setSearchAttempt] = useState(0)
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState<'assistant.recentSessionMissing' | 'assistant.recentSessionBusy' | 'assistant.sessionRestoreFailed' | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const queryRef = useRef<HTMLInputElement>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const searchRevision = useRef(0)
  const panelId = useId()
  const needle = normalizeNeedle(query)

  const close = useCallback((returnFocus: boolean): void => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setIsOpen(false)
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => () => controllerRef.current?.abort(), [])

  useLayoutEffect(() => {
    if (isOpen) queryRef.current?.focus({ preventScroll: true })
  }, [isOpen])

  useEffect(() => {
    const root = rootRef.current
    if (!isOpen || !root) return
    const ownerDocument = root.ownerDocument
    const onPointerDown = (event: PointerEvent) => {
      if (!event.composedPath().includes(root)) close(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      close(true)
    }
    ownerDocument.addEventListener('pointerdown', onPointerDown)
    ownerDocument.addEventListener('keydown', onKeyDown)
    return () => {
      ownerDocument.removeEventListener('pointerdown', onPointerDown)
      ownerDocument.removeEventListener('keydown', onKeyDown)
    }
  }, [close, isOpen])

  useEffect(() => {
    const controller = controllerRef.current
    if (!isOpen || !controller || !query.trim()) return
    const revision = searchRevision.current
    const isCurrent = () => !controller.signal.aborted && revision === searchRevision.current
    const timer = window.setTimeout(() => {
      void window.readerApi.searchRecentBookSessions(query).then((matches) => {
        if (isCurrent()) setResult(matches)
      }, () => {
        if (isCurrent()) setSearchFailed(true)
      })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [isOpen, query, searchAttempt])

  const resetSearch = (): void => {
    searchRevision.current++
    setResult(null)
    setSearchFailed(false)
    setRestoreError(null)
  }

  const loadRecent = async (signal: AbortSignal): Promise<void> => {
    if (!current) return
    setListLoading(true)
    setListFailed(false)
    try {
      const chats = await current.onList()
      if (!signal.aborted) setItems(chats)
    } catch {
      if (!signal.aborted) setListFailed(true)
    } finally {
      if (!signal.aborted) setListLoading(false)
    }
  }

  const toggle = (): void => {
    if (isOpen) { close(true); return }
    const controller = new AbortController()
    controllerRef.current = controller
    setQuery('')
    setItems([])
    setListFailed(false)
    setListLoading(false)
    setRestoring(false)
    resetSearch()
    setIsOpen(true)
    void loadRecent(controller.signal)
  }

  const restore = async (bookId: string, conversationId: string): Promise<void> => {
    const signal = controllerRef.current?.signal
    if (!signal || disabled || restoring) return
    setRestoring(true)
    setRestoreError(null)
    try {
      const outcome = await onRestore(bookId, conversationId, signal)
      if (signal.aborted) return
      if (outcome === 'restored') { close(true); return }
      if (outcome === 'missing') {
        if (current?.bookId === bookId) setItems((chats) => chats.filter((item) => item.conversationId !== conversationId))
        setResult((previous) => previous && { ...previous,
          matches: previous.matches.filter((item) => item.bookId !== bookId || item.conversationId !== conversationId) })
        setRestoreError('assistant.recentSessionMissing')
      } else setRestoreError('assistant.recentSessionBusy')
    } catch {
      if (!signal.aborted) setRestoreError('assistant.sessionRestoreFailed')
    } finally {
      if (!signal.aborted) {
        setRestoring(false)
        queryRef.current?.focus({ preventScroll: true })
      }
    }
  }

  const otherItems = items.filter((item) => item.conversationId !== current?.conversationId)
  const triggerLabel = copy(current ? 'assistant.recentSessions' : 'assistant.recentSearch')
  const searchLabel = copy('assistant.recentSearch')
  return <div className="recent-conversations" ref={rootRef}>
    <button type="button" ref={triggerRef} className={current ? 'icon-button' : 'secondary-button'}
      data-testid={current ? 'recent-conversations' : 'library-recent-conversations'} disabled={disabled || restoring}
      aria-label={triggerLabel} title={triggerLabel} aria-haspopup="dialog"
      aria-controls={panelId} aria-expanded={isOpen} onClick={toggle}>
      <History size={17} aria-hidden="true" />
      {!current && copy('assistant.recentSessions')}
    </button>
    {isOpen && <div id={panelId} className="recent-conversations-popover" role="dialog" aria-label={searchLabel}>
      <div className="recent-conversations-header">
        <strong>{searchLabel}</strong>
        <button type="button" className="icon-button" aria-label={copy('window.closeAria')} onClick={() => close(true)}><X size={16} aria-hidden="true" /></button>
      </div>
      <label className="recent-conversations-query">
        <Search size={16} aria-hidden="true" />
        <input ref={queryRef} type="search" data-testid="recent-conversation-query" aria-label={searchLabel}
          placeholder={copy('assistant.recentSearchPlaceholder')} value={query} maxLength={RECENT_BOOK_SESSION_QUERY_LIMIT}
          readOnly={restoring} onChange={(event) => { resetSearch(); setQuery(event.target.value) }} />
      </label>
      <small>{copy('assistant.recentSessionsHint')}</small>
      {restoring && <p role="status">{copy('assistant.sessionLoading')}</p>}
      {restoreError && <p role="alert">{copy(restoreError)}</p>}
      {needle ? <>
        {searchFailed && <div className="recent-conversations-status" role="status">{copy('assistant.recentSearchFailed')}
          <button type="button" className="text-button" onClick={() => { resetSearch(); setSearchAttempt((attempt) => attempt + 1) }}>{copy('common.retry')}</button>
        </div>}
        {!searchFailed && !result && <p role="status">{copy('assistant.recentSearchLoading')}</p>}
        {result?.matches.length === 0 && <p role="status">{copy('assistant.recentSearchEmpty')}</p>}
        {result?.hasMore && <small role="status">{copy('assistant.recentSearchLimit', { count: RECENT_BOOK_SESSION_SEARCH_LIMIT })}</small>}
        {result && result.matches.length > 0 && <div className="recent-conversations-list">
          {result.matches.map((item) => <button type="button" data-testid="recent-conversation-result" key={`${item.bookId}:${item.conversationId}`}
            disabled={disabled || restoring} onClick={() => void restore(item.bookId, item.conversationId)}>
            <strong>{item.matchField === 'book' ? <MarkedText value={item.excerpt} needle={needle} /> : item.bookTitle}</strong>
            <span>{sessionTitle(item)}</span>
            {item.matchField !== 'book' && <span className="recent-conversation-excerpt">
              <small>{copy(item.matchField === 'question' ? 'assistant.recentSearchQuestion' : 'assistant.recentSearchAnswer')} · </small>
              <MarkedText value={item.excerpt} needle={needle} />
            </span>}
            <small><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString(getCopyLocale())}</time></small>
          </button>)}
        </div>}
      </> : current && <>
        {listLoading && <p role="status">{copy('assistant.recentSessionsLoading')}</p>}
        {listFailed && <div className="recent-conversations-status" role="status">{copy('assistant.recentSearchFailed')}
          <button type="button" className="text-button" onClick={() => {
            const signal = controllerRef.current?.signal
            if (signal) void loadRecent(signal)
          }}>{copy('common.retry')}</button>
        </div>}
        {!listLoading && !listFailed && !otherItems.length && <p>{copy('assistant.recentSessionsEmpty')}</p>}
        {otherItems.length > 0 && <div className="recent-conversations-list">
          {otherItems.map((item) => <button type="button" data-testid="recent-conversation" key={item.conversationId}
            disabled={disabled || restoring} onClick={() => void restore(current.bookId, item.conversationId)}>
            <span>{sessionTitle(item)}</span>
            <small>{copy(item.scope === 'book' ? 'analysis.book' : 'analysis.selection')} · <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString(getCopyLocale())}</time> · {copy('assistant.recentSessionTurns', { count: item.turnCount })}</small>
          </button>)}
        </div>}
      </>}
    </div>}
  </div>
}
