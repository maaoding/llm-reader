import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { BookRecord, PersonaSelection, PersonaSettings, ReaderApi, SavedInsight, SaveBookSessionInput, SessionTabsState } from '@shared/contracts'
import { defaultPersona } from './assistant-personas'
import { createArchiveTab, createLiveTab, historyFromTurns, sessionPayload, type ConversationTab, type ConversationTurn } from './conversation-session'
import { PendingSaves } from './pending-saves'

type LoadState = 'idle' | 'loading' | 'ready' | 'error'
const MAX_SESSION_TABS = 20

interface SessionOptions {
  books: BookRecord[]
  activeBookId: string | undefined
  activeBookRef: RefObject<BookRecord | null>
  libraryReady: boolean
  workspaceReady: boolean
  personaSettings: PersonaSettings
  webSearchEnabled: boolean
  closingRef: RefObject<boolean>
  deletingBooksRef: RefObject<Set<string>>
  deletingInsightsRef: RefObject<Set<string>>
  onRestoreError: () => void
  onArchiveSaved: (insight: SavedInsight) => void
}

/** Owns the in-memory conversations and their restoration/write ordering.
 * The app coordinates book deletion and requests; it waits/forgets the relevant
 * save queues when deleting, without duplicating the persistence rules. */
export function useConversationSessions({
  books, activeBookId, activeBookRef, libraryReady, workspaceReady, personaSettings,
  webSearchEnabled, closingRef, deletingBooksRef, deletingInsightsRef, onRestoreError, onArchiveSaved
}: SessionOptions) {
  const [sessionTabsRestoreState, setSessionTabsRestoreState] = useState<LoadState>('idle')
  const [sessionTabsRestoreError, setSessionTabsRestoreError] = useState(false)
  const [sessionTabsRestoreAttempt, setSessionTabsRestoreAttempt] = useState(0)
  const restoredSessionTabsRef = useRef(false)
  const restoredSessionTabIdsRef = useRef(new Set<string>())
  const [restoredSessionTabIds, setRestoredSessionTabIds] = useState<ReadonlySet<string>>(new Set())
  const editedArchiveDraftsRef = useRef(new Set<string>())
  const closedSessionTabsDuringRestoreRef = useRef(new Set<string>())
  const [conversationTabs, setConversationTabs] = useState<ConversationTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const conversationTabsRef = useRef<ConversationTab[]>([])
  const activeTabIdRef = useRef<string | null>(null)
  const commitConversationTabs = useCallback(
    (updater: (current: ConversationTab[]) => ConversationTab[]): ConversationTab[] => {
      const next = updater(conversationTabsRef.current)
      conversationTabsRef.current = next
      setConversationTabs(next)
      return next
    },
    []
  )

  const updateConversationTab = useCallback((tabId: string, updater: (tab: ConversationTab) => ConversationTab): void => {
    commitConversationTabs((current) => current.map((tab) => {
      if (tab.id !== tabId) return tab
      const next = updater(tab)
      if (!restoredSessionTabsRef.current && tab.kind === 'archive' && next.draft !== tab.draft) editedArchiveDraftsRef.current.add(tab.id)
      return next
    }))
  }, [commitConversationTabs])

  const ensureLiveTab = useCallback((book: BookRecord): string => {
    closedSessionTabsDuringRestoreRef.current.delete(`live-${book.id}`)
    const existing = conversationTabsRef.current.find((tab) => tab.kind === 'live' && tab.bookId === book.id)
    if (existing) return existing.id
    const tab = createLiveTab(book, defaultPersona(personaSettings), webSearchEnabled ? 'auto' : 'off')
    commitConversationTabs((current) => [...current, tab])
    return tab.id
  }, [commitConversationTabs, personaSettings, webSearchEnabled])

  const focusConversationTab = useCallback((tabId: string | null): void => {
    activeTabIdRef.current = tabId
    setActiveTabId(tabId)
  }, [setActiveTabId])

  const removeConversationTabsForBook = useCallback((bookId: string): void => {
    const removedActiveId = activeTabIdRef.current
      ? conversationTabsRef.current.find((tab) => tab.id === activeTabIdRef.current && tab.bookId === bookId)?.id
      : undefined
    const remaining = commitConversationTabs((current) => current.filter((tab) => tab.bookId !== bookId))
    if (removedActiveId) {
      const fallback = remaining[0]
      focusConversationTab(fallback?.id ?? null)
    }
  }, [commitConversationTabs, focusConversationTab])

  const visibleSessionTabs = useMemo(() => conversationTabs.filter((tab) => (
    tab.kind === 'archive' ||
    restoredSessionTabIds.has(tab.id) ||
    tab.bookId === activeBookId ||
    tab.turns.length > 0 ||
    Boolean(tab.selection) ||
    Boolean(tab.draft)
  )), [activeBookId, conversationTabs, restoredSessionTabIds])

  // 打开的会话标签（含归档标签草稿）整体落库；live 草稿由 book_sessions 负责，避免两份来源。
  const sessionTabsState = useCallback((): SessionTabsState => {
    // Use committed refs so closing immediately after restoration sees the restored tabs too.
    const source = conversationTabsRef.current.filter((tab) => (
      tab.kind === 'archive' || restoredSessionTabIdsRef.current.has(tab.id) || tab.bookId === activeBookRef.current?.id || tab.turns.length > 0 || Boolean(tab.selection) || Boolean(tab.draft)
    )).filter((tab) => tab.kind === 'live' || Boolean(tab.insightId))
    const window = source.slice(-MAX_SESSION_TABS)
    const active = source.find((tab) => tab.id === activeTabIdRef.current)
    // 超过上限时也保留当前激活标签：必要时挤掉窗口里最旧的一个。
    const kept = active && !window.includes(active) ? [...window.slice(1), active] : window
    const activeIndex = kept.findIndex((tab) => tab.id === activeTabIdRef.current)
    return {
      activeIndex: activeIndex >= 0 ? activeIndex : null,
      tabs: kept.map((tab) => ({
        kind: tab.kind,
        bookId: tab.bookId,
        insightId: tab.kind === 'archive' ? tab.insightId ?? null : null,
        draft: tab.kind === 'archive' ? tab.draft.slice(0, 2_000) : '',
        webSearch: tab.webSearch
      }))
    }
  }, [activeBookRef])

  // 打开书籍时恢复该书的最后一个临时会话（草稿 + 未归档轮次），并复用原会话标识。
  const restoredSessionsRef = useRef(new Set<string>())
  const loadedSessionsRef = useRef(new Set<string>())
  const [loadedSessions, setLoadedSessions] = useState<ReadonlySet<string>>(new Set())
  const [failedSessionLoads, setFailedSessionLoads] = useState<string[]>([])
  useEffect(() => {
    const selectedTab = conversationTabs.find((tab) => tab.id === activeTabId && tab.kind === 'live')
    for (const bookId of new Set([activeBookId, selectedTab?.bookId])) {
      if (!bookId || restoredSessionsRef.current.has(bookId) || failedSessionLoads.includes(bookId)) continue
      restoredSessionsRef.current.add(bookId)
      void window.readerApi.getBookSession(bookId).then(async (record) => {
        const freshMode = !record ? (await window.readerApi.getKnowledgeSettings()).webSearch.enabled ? 'auto' as const : 'off' as const : undefined
        loadedSessionsRef.current.add(bookId)
        setLoadedSessions(new Set(loadedSessionsRef.current))
        const tab = conversationTabsRef.current.find((candidate) => candidate.kind === 'live' && candidate.bookId === bookId)
        if (!tab) return
        if (!record) { updateConversationTab(tab.id, (current) => ({ ...current, webSearch: freshMode ?? 'off' })); return }
        if (tab.turns.length > 0 || tab.selection || sessionTransitionsRef.current.has(tab.id)) return
        updateConversationTab(tab.id, (current) => ({
          ...current,
          conversationId: record.conversationId,
          persona: record.persona ?? null,
          webSearch: record.webSearch ?? 'off',
          scope: record.scope,
          selection: record.selection,
          draft: current.draft || record.draft,
          turns: record.turns.map((turn) => ({ ...turn, requestId: '', selection: turn.selection ?? null, context: turn.context ?? undefined }))
        }))
      }).catch(() => {
        restoredSessionsRef.current.delete(bookId)
        setFailedSessionLoads((current) => current.includes(bookId) ? current : [...current, bookId])
        onRestoreError()
      })
    }
  }, [activeBookId, activeTabId, conversationTabs, failedSessionLoads, onRestoreError, updateConversationTab])

  // Only acknowledged snapshots are saved. Failed payloads remain available for retry.
  const [, setSaveRevision] = useState(0)
  const [sessionSaves] = useState(() => new PendingSaves<SaveBookSessionInput>(
    (_key, payload) => window.readerApi.saveBookSession(payload),
    () => setSaveRevision((version) => version + 1)
  ))
  const [tabSaves] = useState(() => new PendingSaves<SessionTabsState>(
    (_key, payload) => window.readerApi.saveSessionTabs(payload),
    () => setSaveRevision((version) => version + 1)
  ))
  const [archiveSaves] = useState(() => new PendingSaves<Parameters<ReaderApi['updateInsightHistory']>[0]>(
    async (_key, payload) => onArchiveSaved(await window.readerApi.updateInsightHistory(payload)),
    () => setSaveRevision((version) => version + 1)
  ))
  const sessionTransitionsRef = useRef(new Set<string>())
  const [changingSessions, setChangingSessions] = useState<string[]>([])
  const setSessionChanging = useCallback((tabId: string, changing: boolean): void => {
    if (changing) sessionTransitionsRef.current.add(tabId)
    else sessionTransitionsRef.current.delete(tabId)
    setChangingSessions([...sessionTransitionsRef.current])
  }, [])
  const persistLiveSession = useCallback(async (tab: ConversationTab): Promise<void> => {
    if (tab.kind !== 'live' || deletingBooksRef.current.has(tab.bookId)) return
    if (!loadedSessionsRef.current.has(tab.bookId)) {
      if (tab.draft || tab.turns.length) throw new Error('Session restoration must finish before saving new content')
      return
    }
    const current = conversationTabsRef.current.find((candidate) => candidate.id === tab.id)
    if (!current || current.conversationId !== tab.conversationId) return
    await sessionSaves.save(tab.bookId, sessionPayload(current))
  }, [deletingBooksRef, sessionSaves])
  const persistSessionTabs = useCallback(async (): Promise<void> => {
    if (!restoredSessionTabsRef.current) {
      if (editedArchiveDraftsRef.current.size) throw new Error('Restore saved tabs before saving edited archive drafts')
      return
    }
    if (deletingBooksRef.current.size || deletingInsightsRef.current.size) return
    await tabSaves.save('tabs', sessionTabsState())
  }, [deletingBooksRef, deletingInsightsRef, sessionTabsState, tabSaves])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (closingRef.current) return
      for (const tab of conversationTabsRef.current) {
        if (sessionTransitionsRef.current.has(tab.id)) continue
        void persistLiveSession(tab).catch(() => undefined)
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [changingSessions, closingRef, conversationTabs, persistLiveSession])

  const persistArchiveHistory = useCallback(async (bookId: string, insightId: string, sessionTurns: ConversationTurn[], persona: PersonaSelection | null, webSearch?: 'off' | 'auto'): Promise<void> => {
    if (deletingBooksRef.current.has(bookId) || deletingInsightsRef.current.has(insightId)) return
    const history = historyFromTurns(sessionTurns)
    if (history.length < 2) return
    await archiveSaves.save(insightId, { bookId, id: insightId, history, persona, ...(webSearch ? { webSearch } : {}) })
  }, [archiveSaves, deletingBooksRef, deletingInsightsRef])

  const flushSessionSaves = useCallback(async (): Promise<boolean> => {
    const writes: Promise<unknown>[] = []
    for (const tab of conversationTabsRef.current) {
      if (tab.kind === 'live') writes.push(persistLiveSession(tab))
      else if (tab.insightId) writes.push(persistArchiveHistory(tab.bookId, tab.insightId, tab.turns, tab.persona, tab.webSearch))
    }
    writes.push(persistSessionTabs())
    const results = await Promise.allSettled(writes)
    return results.every((result) => result.status === 'fulfilled')
  }, [persistArchiveHistory, persistLiveSession, persistSessionTabs])

  const closeConversationTab = async (tabId: string): Promise<void> => {
    const tab = conversationTabsRef.current.find((candidate) => candidate.id === tabId)
    if (!tab || sessionTransitionsRef.current.has(tab.id) || closingRef.current || (tab.kind === 'live' && tab.bookId === activeBookRef.current?.id)) return
    setSessionChanging(tab.id, true)
    try {
      if (tab.kind === 'live') await persistLiveSession(tab)
      else if (tab.insightId) await persistArchiveHistory(tab.bookId, tab.insightId, tab.turns, tab.persona, tab.webSearch)
      if (conversationTabsRef.current.find((candidate) => candidate.id === tab.id) !== tab) return
      if (!restoredSessionTabsRef.current) closedSessionTabsDuringRestoreRef.current.add(tab.id)
      editedArchiveDraftsRef.current.delete(tab.id)
      const remaining = commitConversationTabs((current) => current.filter((candidate) => candidate.id !== tabId))
      if (activeTabIdRef.current === tabId) {
        const activeBookId = activeBookRef.current?.id
        const fallback = remaining.find((candidate) => candidate.kind === 'live' && candidate.bookId === activeBookId) ?? remaining[0]
        focusConversationTab(fallback?.id ?? null)
      }
    } catch {
      // Keep the tab and its latest draft available until its save can be retried.
    } finally {
      setSessionChanging(tab.id, false)
    }
  }

  // 启动时恢复标签列表：顺序、激活项与归档草稿都还原，已删书籍/归档的条目跳过。
  useEffect(() => {
    if (restoredSessionTabsRef.current || !libraryReady || !workspaceReady || closingRef.current) return
    let cancelled = false
    setSessionTabsRestoreState('loading')
    void (async () => {
      try {
        const state = await window.readerApi.listSessionTabs()
        if (cancelled || closingRef.current) return
        // An unavailable archive list cannot establish that saved archive tabs were deleted.
        const allInsights = state.tabs.some((tab) => tab.kind === 'archive') ? await window.readerApi.listAllInsights() : []
        if (cancelled || closingRef.current) return
        const restored = state.tabs.flatMap((record, index) => {
          const tabId = record.kind === 'live' ? `live-${record.bookId}` : `archive-${record.insightId}`
          if (closedSessionTabsDuringRestoreRef.current.has(tabId)) return []
          const book = books.find((candidate) => candidate.id === record.bookId)
          if (!book) return []
          if (record.kind === 'live') {
            const existing = conversationTabsRef.current.find((tab) => tab.kind === 'live' && tab.bookId === book.id)
            return [{ index, tab: existing ?? createLiveTab(book, defaultPersona(personaSettings), record.webSearch ?? 'off') }]
          }
          const insight = allInsights.find((candidate) => candidate.id === record.insightId)
          if (!insight) return []
          const existing = conversationTabsRef.current.find((tab) => tab.kind === 'archive' && tab.insightId === insight.id)
          return [{ index, tab: existing
            ? { ...existing, draft: editedArchiveDraftsRef.current.has(existing.id) ? existing.draft : record.draft }
            : { ...createArchiveTab(insight), draft: record.draft, webSearch: record.webSearch ?? 'off' } }]
        })
        const restoredIds = new Set(restored.map(({ tab }) => tab.id))
        restoredSessionTabIdsRef.current = restoredIds
        setRestoredSessionTabIds(restoredIds)
        if (restored.length > 0) commitConversationTabs((current) => [...restored.map(({ tab }) => tab), ...current.filter((tab) => !restoredIds.has(tab.id))])
        const activeEntry = restored.find((entry) => entry.index === state.activeIndex)
        if (activeEntry) focusConversationTab(activeEntry.tab.id)
        restoredSessionTabsRef.current = true
        editedArchiveDraftsRef.current.clear()
        closedSessionTabsDuringRestoreRef.current.clear()
        setSessionTabsRestoreError(false)
        setSessionTabsRestoreState('ready')
      } catch {
        if (cancelled || closingRef.current) return
        setSessionTabsRestoreError(true)
        setSessionTabsRestoreState('error')
      }
    })()
    return () => { cancelled = true }
  }, [books, commitConversationTabs, focusConversationTab, libraryReady, personaSettings, sessionTabsRestoreAttempt, workspaceReady, closingRef])

  // 去抖保存标签列表；只有读取并应用成功后才写，失败及关闭过程中均保留原有记录。
  useEffect(() => {
    if (!workspaceReady || sessionTabsRestoreState !== 'ready' || !restoredSessionTabsRef.current || closingRef.current) return undefined
    const timer = window.setTimeout(() => {
      if (!closingRef.current && restoredSessionTabsRef.current) {
        void persistSessionTabs().catch(() => undefined)
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [activeTabId, persistSessionTabs, sessionTabsRestoreState, visibleSessionTabs, workspaceReady, closingRef])
  const retryTabRestoration = useCallback(() => setSessionTabsRestoreAttempt((attempt) => attempt + 1), [])
  const retrySessionRestoration = (bookId: string): void => setFailedSessionLoads((current) => current.filter((id) => id !== bookId))
  const markArchiveOpened = useCallback((insightId: string) => { closedSessionTabsDuringRestoreRef.current.delete(`archive-${insightId}`) }, [])

  return {
    conversationTabs, conversationTabsRef, activeTabId, activeTabIdRef,
    commitConversationTabs, updateConversationTab, focusConversationTab,
    ensureLiveTab, removeConversationTabsForBook, visibleSessionTabs, markArchiveOpened,
    loadedSessions, loadedSessionsRef, failedSessionLoads, retrySessionRestoration,
    sessionTabsRestoreState, sessionTabsRestoreError, retryTabRestoration,
    sessionSaves, tabSaves, archiveSaves, sessionTransitionsRef, changingSessions, setSessionChanging,
    persistLiveSession, persistSessionTabs, persistArchiveHistory, flushSessionSaves, closeConversationTab
  }
}
