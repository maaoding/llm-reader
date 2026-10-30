import { WindowControls } from './WindowControls'
import { BookDetailsModal } from './BookDetailsModal'
import { BookImportDialog } from './BookImportDialog'
import { PdfSelectionReviewDialog, PdfImageRegionReviewDialog } from './PdfSelectionReviewDialog'
import { ConversationPane, AssistantContextControls, AssistantScopeControls } from './ConversationPane'
import { EmptyState } from './EmptyState'
import { useAppPreferences } from './use-app-preferences'
import { useBookImport } from './use-book-import'
import { useSelectionToolbar } from './use-selection-toolbar'
import { useProviderConnection, providerStatusLabel } from './use-provider-connection'
import { useConversationRequests } from './use-conversation-requests'
import { useReaderSearch } from './use-reader-search'
import { useAppClose } from './use-app-close'
import { useConversationSessions } from './use-conversation-sessions'
import { createArchiveTab, type ConversationTab, type ConversationTurn } from './conversation-session'
import { SettingsModal, type SettingsSectionId } from './SettingsModal'
import { AssistantActionIconView } from './AssistantActionIcon'
import { isTextReadingMode, readTextReadingMode, saveTextReadingMode } from './text-reading-mode'
import { WebSearchControl } from './WebSearchControl'
import { PersonaSessionControl } from './AssistantPersonaSettings'
import { defaultPersona, MAX_PERSONAS, persistPersonaSettings, personaFromPreset, readPersonaSettings } from './assistant-personas'
import { RecentConversations } from './RecentConversations'
import { providerIsConfigured } from '@shared/request-settings'
import {
  AlertCircle,
  BookOpen,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Import,
  Info,
  Library,
  LoaderCircle,
  MessageSquareText,
  Maximize2,
  PanelLeftClose,
  PanelTop,
  RefreshCw,
  Search,
  SearchX,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  X
} from 'lucide-react'
import {
  type CSSProperties,
  type FormEvent,
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { isPdfImageRegion, type ReaderSource } from '@shared/contracts'
import type {
  BookRecord,
  HighlightRecord,
  InsightArchiveRecord,
  InsightExportScope,
  LlmAction,
  PersonaSelection,
  PersonaSettings,
  SavedInsight,
  TextReadingMode,
  TocItem
} from '@shared/contracts'
import { copy } from '@shared/copy'
import { BookAnalysisControls } from './BookAnalysisControls'
import { OcrPageReader } from './OcrPageReader'
import { pdfPageFromLocator } from '@shared/ocr-reading'
import { BookNotesView } from './BookNotesView'
import { bookTabPage, readWorkspaceState, saveWorkspaceState, type BookTabState, type WorkspacePage } from './workspace-state'
import { useBookAnalysis } from './use-book-analysis'
import { isSelectPickerOpen, useDialogFocus } from './use-dialog-focus'
import { BookCoverCache } from './book-cover-cache'
import { BookCover } from './BookCover'
import InsightsView from './InsightsView'
import WorkbenchesView, { ArchiveViewSwitch } from './WorkbenchesView'
import { useWorkbenches } from './use-workbenches'
import { readableError } from './readable-error'
import { normalizeNeedle } from './highlight'
import { assistantActionLabel } from './assistant-actions'
import {
  createReaderAdapter,
  READER_SEARCH_QUERY_MAX_LENGTH,
  READER_SEARCH_RESULT_LIMIT,
  splitSearchExcerpt,
  type ReaderAdapter,
  type ReaderSearchResult,
  type ReaderSelectionDraft,
  type ReaderImageRegionDraft
} from './readers'

type AssistantDialogView = 'conversation' | 'insights'
type LeftView = 'library' | 'toc' | 'highlights' | 'search'
type LoadState = 'idle' | 'loading' | 'ready' | 'error'

function titleFromOriginalName(originalName: string, fallback: string): string {
  const withoutExtension = originalName.replace(/\.[^./\\]+$/u, '').trim()
  return withoutExtension || fallback
}

interface ToastState {
  id: number
  tone: 'success' | 'error' | 'neutral'
  message: string
}

function tocHrefMatchesCurrent(itemHref: string, currentHref: string | null): boolean {
  return Boolean(currentHref && itemHref.trim() === currentHref.trim())
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

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

export default function App(): ReactNode {
  const {
    uiLanguage, themePreference, resolvedTheme, interfaceScale,
    readingPreferences, effectiveReadingPreferences, effectivePaperTheme, paperThemePreference, assistantActions,
    changeUiLanguage, setThemePreference, setInterfaceScale,
    setReadingPreferences, setPaperThemePreference, setAssistantActions
  } = useAppPreferences()
  const [textReadingMode, setTextReadingMode] = useState<TextReadingMode>('auto')
  const [textRendering, setTextRendering] = useState<'plain' | 'markdown'>('plain')
  const [personaSettings, setPersonaSettings] = useState<PersonaSettings>(readPersonaSettings)
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  useEffect(() => {
    let alive = true
    void window.readerApi.getKnowledgeSettings().then((settings) => { if (alive) setWebSearchEnabled(settings.webSearch.enabled) }).catch(() => undefined)
    return () => { alive = false }
  }, [])
  const [books, setBooks] = useState<BookRecord[]>([])
  const analysis = useBookAnalysis()
  const refreshAnalysis = analysis.refresh
  const [activeBook, setActiveBook] = useState<BookRecord | null>(null)
  const [bookState, setBookState] = useState<LoadState>('idle')
  const [bookError, setBookError] = useState('')
  const [libraryState, setLibraryState] = useState<'loading' | 'ready' | 'error'>('loading')
  const workbenches = useWorkbenches(books, libraryState === 'ready')
  const closeWorkbenches = workbenches.beforeClose
  const resumeWorkbenches = workbenches.resumeAfterClose
  const retryWorkbenchSaves = workbenches.retrySaves
  const [archiveView, setArchiveView] = useState<'archived' | 'workbenches'>(() => { try { return localStorage.getItem('llm-reader-archive-view') === 'workbenches' ? 'workbenches' : 'archived' } catch { return 'archived' } })
  useEffect(() => { try { localStorage.setItem('llm-reader-archive-view', archiveView) } catch { /* Keep the in-memory choice. */ } }, [archiveView])
  const [libraryError, setLibraryError] = useState('')
  const [coverCache] = useState(() => new BookCoverCache((bookId) => window.readerApi.getBookCover(bookId)))
  const [toc, setToc] = useState<TocItem[]>([])
  const [collapsedTocItems, setCollapsedTocItems] = useState<Set<string>>(() => new Set())
  const [leftView, setLeftView] = useState<LeftView>('library')
  const [page, setPage] = useState<WorkspacePage>('library')
  const [leftPanelOpen, setLeftPanelOpen] = useState(false)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [preparationBookId, setPreparationBookId] = useState<string | null>(null)
  const [pdfDisplayOpen, setPdfDisplayOpen] = useState(false)
  const [ocrReadingOpen, setOcrReadingOpen] = useState(false)
  const ocrReadingToggleRef = useRef<HTMLButtonElement>(null)
  const preparationDialogRef = useRef<HTMLElement>(null)
  const preparationReturnRef = useRef<HTMLButtonElement>(null)
  const initialWorkspace = useRef(readWorkspaceState())
  const workspaceRestored = useRef(false)
  // 首帧就要渲染标签条，与 initialWorkspace 读同一条记录。
  const [bookTabs, setBookTabs] = useState<BookTabState[]>(() => readWorkspaceState().tabs)
  const [compactWindow, setCompactWindow] = useState(() => window.innerWidth < 1180)
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null)
  const [draggingSessionTabId, setDraggingSessionTabId] = useState<string | null>(null)
  const [conversationQuery, setConversationQuery] = useState('')
  const [pendingClearSession, setPendingClearSession] = useState(false)
  const [workspaceReady, setWorkspaceReady] = useState(false)
  const [selection, setSelection] = useState<ReaderSource | null>(null)
  const [selectionDraft, setSelectionDraft] = useState<ReaderSelectionDraft | null>(null)
  const [imageRegionDraft, setImageRegionDraft] = useState<ReaderImageRegionDraft | null>(null)
  const [insights, setInsights] = useState<InsightArchiveRecord[]>([])
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [insightsError, setInsightsError] = useState('')
  const insightsRequestRef = useRef(0)
  const [exportingInsights, setExportingInsights] = useState(false)
  const [highlights, setHighlights] = useState<HighlightRecord[]>([])
  const [highlightsLoading, setHighlightsLoading] = useState(false)
  const [highlightsError, setHighlightsError] = useState('')
  const highlightsRequestRef = useRef(0)
  const [pendingDeleteHighlightId, setPendingDeleteHighlightId] = useState<string | null>(null)
  const [deletingBookId, setDeletingBookId] = useState<string | null>(null)
  const [currentLocator, setCurrentLocator] = useState<string | null>(null)
  const [naturalLocator, setNaturalLocator] = useState<string | null>(null)
  const [currentChapterProgress, setCurrentChapterProgress] = useState(0)
  const [currentChapterTitle, setCurrentChapterTitle] = useState('')
  const [currentChapterHref, setCurrentChapterHref] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsInitialService, setSettingsInitialService] = useState<'document' | 'embedding'>()
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSectionId>('appearance')
  const assistantDialogOpen = page === 'conversation' || page === 'archives'
  const assistantDialogView: AssistantDialogView = page === 'archives' ? 'insights' : 'conversation'
  const setAssistantDialogOpen = useCallback((open: boolean) => setPage(open ? 'conversation' : 'reading'), [])
  const [detailsBook, setDetailsBook] = useState<BookRecord | null>(null)
  const [pendingDeleteInsightId, setPendingDeleteInsightId] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)

  const hostRef = useRef<HTMLDivElement>(null)
  const readerSurfaceRef = useRef<HTMLElement>(null)
  const selectionToolbarRef = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<ReaderAdapter | null>(null)
  const activeBookRef = useRef<BookRecord | null>(null)
  const openSequenceRef = useRef(0)
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastProgressFlushRef = useRef(0)
  const closingRef = useRef(false)
  const deletingBooksRef = useRef(new Set<string>())
  const deletingInsightsRef = useRef(new Set<string>())
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingProgressRef = useRef<{ bookId: string; locator: string; progress: number } | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const followupRef = useRef<HTMLTextAreaElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const settingsReturnFocusRef = useRef<HTMLButtonElement>(null)
  const assistantExpandButtonRef = useRef<HTMLButtonElement>(null)
  const detailsReturnFocusRef = useRef<HTMLButtonElement>(null)
  const assistantDialogRef = useRef<HTMLElement>(null)
  const readingPreferencesRef = useRef(readingPreferences)
  const preferencesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const naturalPositionRef = useRef<{ locator: string | null; progress: number }>({ locator: null, progress: 0 })
  const naturalChapterRef = useRef<{ title: string; href: string | null; progress: number } | null>(null)
  const chapterTitleOverrideRef = useRef<string | null>(null)
  const leftViewRevisionRef = useRef(0)
  const selectLeftView = useCallback((view: LeftView): void => {
    leftViewRevisionRef.current += 1
    setLeftView(view)
    if (view === 'library') setPage('library')
    else {
      setPage('reading'); setLeftPanelOpen(true)
    }
  }, [])

  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  const openSettings = useCallback((section: SettingsSectionId, trigger: HTMLButtonElement, service?: 'document' | 'embedding'): void => {
    settingsReturnFocusRef.current = trigger
    setSettingsInitialService(service)
    setSettingsInitialSection(section)
    setSettingsOpen(true)
  }, [])
  const closePreparation = useCallback(() => setPreparationBookId(null), [])
  const closeBookDetails = useCallback(() => setDetailsBook(null), [])
  const openBookDetails = useCallback((book: BookRecord, trigger: HTMLButtonElement): void => {
    detailsReturnFocusRef.current = trigger
    setDetailsBook(book)
  }, [])
  useDialogFocus(Boolean(preparationBookId) && !settingsOpen, closePreparation, preparationDialogRef, preparationReturnRef)
  const openPreparation = useCallback((bookId: string, trigger?: HTMLButtonElement): void => {
    preparationReturnRef.current = trigger ?? document.activeElement as HTMLButtonElement
    setPreparationBookId(bookId)
  }, [])
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1179px)')
    const update = () => {
      setCompactWindow(media.matches); setLeftPanelOpen(false)
    }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (workspaceReady) saveWorkspaceState({ bookId: activeBook?.id ?? null, page, tabs: bookTabs })
  }, [activeBook?.id, bookTabs, page, workspaceReady])
  useEffect(() => {
    activeBookRef.current = activeBook
  }, [activeBook])

  const {
    searchQuery, setSearchQuery, executedSearchQuery, searchResults, searchState, searchError,
    searchInputRef, submitSearch, resetSearch, invalidateSearch
  } = useReaderSearch({ adapterRef, activeBookRef, visible: leftView === 'search' })

  const pushToast = useCallback((message: string, tone: ToastState['tone'] = 'neutral'): void => {    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ id: Date.now(), tone, message })
    toastTimerRef.current = setTimeout(() => setToast(null), 3200)
  }, [])

  // PDF 框选校对弹窗打开时撤下引导 toast,避免与弹窗说明重复。
  const dismissToast = useCallback((): void => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current)
      toastTimerRef.current = null
    }
    setToast(null)
  }, [])

  const { provider, providerOverview, providerConnection, handleProviderOverviewChange, getProviderRevision, reportProviderResult } = useProviderConnection(pushToast)

  useEffect(() => {
    readingPreferencesRef.current = effectiveReadingPreferences
    if (!adapterRef.current) return undefined
    if (preferencesTimerRef.current) clearTimeout(preferencesTimerRef.current)
    preferencesTimerRef.current = setTimeout(() => {
      preferencesTimerRef.current = null
      void adapterRef.current?.setPreferences(effectiveReadingPreferences).catch((error) => {
        pushToast(readableError(error, copy('reader.preferencesFailed')), 'error')
      })
    }, 220)
    return () => {
      if (preferencesTimerRef.current) clearTimeout(preferencesTimerRef.current)
    }
  }, [pushToast, readingPreferences, effectiveReadingPreferences])

  const refreshBooks = useCallback(async (): Promise<BookRecord[]> => {
    setLibraryState('loading')
    setLibraryError('')
    try {
      const records = await window.readerApi.listBooks()
      setBooks(records)
      setLibraryState('ready')
      return records
    } catch (error) {
      setLibraryState('error')
      setLibraryError(readableError(error, copy('library.readFailed')))
      return []
    }
  }, [])

  const refreshInsights = useCallback(async (): Promise<void> => {
    const request = ++insightsRequestRef.current
    setInsightsLoading(true)
    setInsightsError('')
    try {
      const records = await window.readerApi.listAllInsights()
      if (request !== insightsRequestRef.current || closingRef.current) return
      setInsights(records)
    } catch (error) {
      if (request !== insightsRequestRef.current || closingRef.current) return
      setInsightsError(readableError(error, copy('insights.readFailed')))
    } finally {
      if (request === insightsRequestRef.current && !closingRef.current) setInsightsLoading(false)
    }
  }, [])

  const refreshHighlights = useCallback(async (bookId: string): Promise<void> => {
    if (activeBookRef.current?.id !== bookId) return
    const request = ++highlightsRequestRef.current
    const isCurrent = (): boolean => request === highlightsRequestRef.current && activeBookRef.current?.id === bookId && !closingRef.current
    setHighlightsLoading(true)
    setHighlightsError('')
    try {
      const records = await window.readerApi.listHighlights(bookId)
      if (!isCurrent()) return
      setHighlights(records)
      const adapter = adapterRef.current
      if (adapter) {
        await adapter.setHighlights(records)
      }
    } catch (error) {
      if (!isCurrent()) return
      setHighlightsError(readableError(error, copy('highlights.readFailed')))
    } finally {
      if (isCurrent()) setHighlightsLoading(false)
    }
  }, [])

  const flushProgress = useCallback(async (): Promise<void> => {
    const pending = pendingProgressRef.current
    if (!pending) return
    pendingProgressRef.current = null
    try {
      await window.readerApi.updateBookProgress(pending.bookId, pending.locator, pending.progress)
      setBooks((current) => current.map((book) => book.id === pending.bookId ? { ...book, lastLocator: pending.locator, progress: pending.progress } : book))
      setActiveBook((current) => current?.id === pending.bookId ? { ...current, lastLocator: pending.locator, progress: pending.progress } : current)
    } catch {
      // Progress is best effort while reading; the next relocation will retry.
    }
  }, [])

  const scheduleProgress = useCallback((bookId: string, locator: string, progress: number): void => {
    if (closingRef.current) return
    pendingProgressRef.current = { bookId, locator, progress }
    if (progressTimerRef.current) return
    const elapsed = Date.now() - lastProgressFlushRef.current
    progressTimerRef.current = setTimeout(() => {
      progressTimerRef.current = null
      lastProgressFlushRef.current = Date.now()
      void flushProgress()
    }, Math.max(0, 650 - elapsed))
  }, [flushProgress])

  const destroyReader = useCallback((): void => {
    invalidateSearch()
    if (progressTimerRef.current) {
      clearTimeout(progressTimerRef.current)
      progressTimerRef.current = null
    }
    void flushProgress()
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current)
      highlightTimerRef.current = null
    }
    adapterRef.current?.destroy()
    adapterRef.current = null
    setSelectionDraft(null)
    if (hostRef.current) hostRef.current.replaceChildren()
  }, [flushProgress, invalidateSearch])

  const onSessionRestoreError = useCallback(() => pushToast(copy('assistant.sessionRestoreFailed'), 'error'), [pushToast])
  const onArchiveSaved = useCallback((updated: SavedInsight) => {
    if (deletingBooksRef.current.has(updated.bookId) || deletingInsightsRef.current.has(updated.id)) return
    setInsights((current) => current.map((insight) => insight.id === updated.id
      ? { ...insight, history: updated.history, persona: updated.persona, webSearch: updated.webSearch } : insight))
  }, [])
  const {
    conversationTabs, conversationTabsRef, activeTabId, activeTabIdRef,
    commitConversationTabs, updateConversationTab, focusConversationTab,
    ensureLiveTab, removeConversationTabsForBook, visibleSessionTabs, markArchiveOpened,
    loadedSessions, loadedSessionsRef, failedSessionLoads, retrySessionRestoration,
    sessionTabsRestoreState, sessionTabsRestoreError, retryTabRestoration,
    sessionSaves, tabSaves, archiveSaves, sessionTransitionsRef, changingSessions, setSessionChanging,
    persistLiveSession, persistSessionTabs, persistArchiveHistory, flushSessionSaves, closeConversationTab
  } = useConversationSessions({
    books, activeBookId: activeBook?.id, activeBookRef, libraryReady: libraryState === 'ready',
    workspaceReady, personaSettings, webSearchEnabled, closingRef, deletingBooksRef, deletingInsightsRef,
    onRestoreError: onSessionRestoreError, onArchiveSaved
  })

  const { hasConversationRequest, enqueueConversationRequest, cancelRequest, cancelBookRequests, cancelTabRequests, cancelAllRequests } = useConversationRequests({
    conversationTabsRef, closingRef, updateConversationTab, persistArchiveHistory, reportProviderResult
  })

  const changePersonaSettings = (settings: PersonaSettings): boolean => {
    if (!persistPersonaSettings(settings)) return false
    setPersonaSettings(settings)
    return true
  }

  // 同一会话只允许一个进行中的请求；切换书籍不会取消其他书中正在生成的回答。
  const tabHasActiveRequest = (tabId: string): boolean => {
    const tab = conversationTabsRef.current.find((item) => item.id === tabId)
    if (!tab || closingRef.current || sessionTransitionsRef.current.has(tabId) || deletingBooksRef.current.has(tab.bookId) || (tab.insightId && deletingInsightsRef.current.has(tab.insightId))) return true
    if (tab.kind === 'live' && !loadedSessionsRef.current.has(tab.bookId)) return true
    return hasConversationRequest(tabId)
  }

  // Save before replacing the selection; a failed write leaves the old conversation intact.
  const replaceSession = async (tab: ConversationTab, next: () => Promise<Partial<ConversationTab>>): Promise<boolean> => {
    if (tabHasActiveRequest(tab.id)) return false
    setSessionChanging(tab.id, true)
    try {
      await persistLiveSession(tab)
      const changes = await next()
      if (conversationTabsRef.current.find((item) => item.id === tab.id) !== tab) return false
      updateConversationTab(tab.id, (current) => ({ ...current, ...changes }))
      return true
    } catch {
      pushToast(copy('assistant.sessionSaveFailed'), 'error')
      return false
    } finally {
      setSessionChanging(tab.id, false)
    }
  }

  const openBook = useCallback(async (book: BookRecord, landingPage: WorkspacePage | null = 'reading', options: { focusLiveTab?: boolean } = {}): Promise<void> => {
    // landingPage 为 null 表示不再切换页面（后台打开书籍）。
    if (landingPage) setPage(landingPage)
    setLeftPanelOpen(false); setPreparationBookId(null); setPdfDisplayOpen(false); setOcrReadingOpen(false)
    // 打开即成为顶栏标签；已存在的标签保留原书内页面，除非本次指定了其他书内页面。
    const tabPage = landingPage ? bookTabPage(landingPage) : null
    setBookTabs((current) => {
      const index = current.findIndex((tab) => tab.bookId === book.id)
      if (index < 0) return [...current, { bookId: book.id, page: tabPage ?? 'reading' }]
      if (!tabPage || current[index].page === tabPage) return current
      return current.map((tab, position) => position === index ? { ...tab, page: tabPage } : tab)
    })
    if (activeBookRef.current?.id === book.id && adapterRef.current) return
    const sequence = ++openSequenceRef.current
    const leftViewRevision = leftViewRevisionRef.current
    destroyReader()
    const liveTabId = ensureLiveTab(book)
    // 从归档等入口后台打开书籍时，保持调用方选中的会话标签。
    if (options.focusLiveTab !== false) focusConversationTab(liveTabId)
    setActiveBook(book)
    activeBookRef.current = book
    setBookState('loading')
    setBookError('')
    setSelection(null)
    setSelectionDraft(null)
    setToc([])
    setCollapsedTocItems(new Set())
    setInsights([])
    setHighlights([])
    highlightsRequestRef.current += 1
    setHighlightsLoading(false)
    setHighlightsError('')
    setPendingDeleteHighlightId(null)
    setCurrentLocator(book.lastLocator)
    setNaturalLocator(book.lastLocator)
    naturalChapterRef.current = null
    setCurrentChapterProgress(0)
    setCurrentChapterTitle('')
    setCurrentChapterHref(null)
    resetSearch()
    naturalPositionRef.current = { locator: book.lastLocator, progress: book.progress }

    try {
      const payload = await window.readerApi.readBook(book.id)
      if (sequence !== openSequenceRef.current || !hostRef.current) return
      setActiveBook(payload.book)
      activeBookRef.current = payload.book
      setBooks((current) => current.map((item) => item.id === book.id ? payload.book : item))
      const adapter = createReaderAdapter(book.format, hostRef.current, {
        bookId: book.id,
        onRelocated: ({ locator, progress, chapterProgress, chapterTitle, chapterHref, reason }) => {
          setCurrentLocator(locator)
          if (reason === 'natural' || (reason === 'restore' && !naturalChapterRef.current)) naturalChapterRef.current = { title: chapterTitle, href: chapterHref ?? null, progress: chapterProgress }
          setCurrentChapterProgress(chapterProgress)
          if (reason === 'natural') {
            chapterTitleOverrideRef.current = null
            setCurrentChapterTitle(chapterTitle)
            setCurrentChapterHref(chapterHref ?? null)
          } else if (!chapterTitleOverrideRef.current) {
            setCurrentChapterTitle(chapterTitle)
            setCurrentChapterHref(chapterHref ?? null)
          }
          if (reason === 'natural') {
            naturalPositionRef.current = { locator, progress }
            setNaturalLocator(locator)
            scheduleProgress(book.id, locator, progress)
          } else if (reason === 'restore' && naturalPositionRef.current.locator === null) {
            naturalPositionRef.current = { locator, progress }
            setNaturalLocator(locator)
          }
        },
        onSelectionChanged: setSelection,
        onSelectionDraftChanged: (draft) => {
          if (draft) dismissToast()
          setSelectionDraft(draft)
        },
        onImageRegionDraftChanged: (draft) => {
          if (draft) dismissToast()
          setImageRegionDraft(draft)
        },
        onDisplaySettings: (trigger) => openSettings('reading', trigger),
        onInternalNavigation: () => { chapterTitleOverrideRef.current = null },
        onNotice: ({ message, tone }) => pushToast(message, tone === 'info' ? 'neutral' : 'error')
      })
      adapterRef.current = adapter
      await adapter.setPreferences(readingPreferencesRef.current)
      const textMode = readTextReadingMode(book.id)
      await adapter.setTextMode?.(textMode)
      const result = await adapter.open(payload.bytes, book.lastLocator)
      if (sequence !== openSequenceRef.current) {
        adapter.destroy()
        return
      }
      setToc(result.toc)
      setTextReadingMode(textMode)
      setTextRendering(result.textRendering ?? 'plain')
      setBookState('ready')
      if (leftViewRevision === leftViewRevisionRef.current) {
        setLeftView('toc')
      }
      void refreshInsights()
      void refreshHighlights(book.id)

      const nextTitle = result.metadata.title.trim() || titleFromOriginalName(book.originalName, book.title)
      const nextAuthor = result.metadata.author?.trim() || null
      if (nextTitle !== book.title || nextAuthor !== book.author) {
        try {
          const updated = await window.readerApi.updateBookMetadata(book.id, nextTitle, nextAuthor)
          setActiveBook(updated)
          activeBookRef.current = updated
          setBooks((current) => current.map((item) => item.id === updated.id ? updated : item))
          commitConversationTabs((current) => current.map((tab) => (
            tab.kind === 'live' && tab.bookId === updated.id ? { ...tab, title: updated.title } : tab
          )))
        } catch {
          // Metadata enrichment is optional; reading remains available.
        }
      }
    } catch (error) {
      if (sequence !== openSequenceRef.current) return
      adapterRef.current?.destroy()
      adapterRef.current = null
      if (hostRef.current) hostRef.current.replaceChildren()
      setBookState('error')
      setBookError(readableError(error, copy('reader.openFailed')))
    }
  }, [commitConversationTabs, destroyReader, dismissToast, ensureLiveTab, focusConversationTab, pushToast, refreshHighlights, refreshInsights, scheduleProgress, openSettings, resetSearch])

  const changeTextReadingMode = useCallback(async (mode: TextReadingMode): Promise<void> => {
    if (!isTextReadingMode(mode)) return
    const adapter = adapterRef.current, book = activeBookRef.current
    if (!adapter?.setTextMode || book?.format !== 'txt') return
    resetSearch(true)
    try {
      const result = await adapter.setTextMode(mode)
      if (adapterRef.current !== adapter || activeBookRef.current?.id !== book.id) return
      setTextReadingMode(mode)
      if (result) { setToc(result.toc); setTextRendering(result.textRendering ?? 'plain') }
      setSelection(null)
      resetSearch(true)
      if (!saveTextReadingMode(book.id, mode)) pushToast(copy('settings.textModeSaveFailed'), 'error')
    } catch (error) { pushToast(readableError(error, copy('reader.openFailed')), 'error') }
  }, [pushToast, resetSearch])

  useEffect(() => {
    const initialize = async (): Promise<void> => {
      if (!window.readerApi) {
        setLibraryState('error')
        setLibraryError(copy('reader.bridgeFailed'))
        return
      }
      await Promise.all([refreshBooks(), refreshInsights()])
    }
    void initialize()
    return () => {
      openSequenceRef.current += 1
      destroyReader()
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [destroyReader, refreshBooks, refreshInsights])

  useEffect(() => {
    if (libraryState !== 'ready' || workspaceRestored.current) return
    workspaceRestored.current = true
    const saved = initialWorkspace.current
    // 书已被删除的标签不再恢复；标签列表随工作区状态持久化。
    setBookTabs(saved.tabs.filter((tab) => books.some((book) => book.id === tab.bookId)))
    const target = books.find((book) => book.id === saved.bookId)
    if (target) void openBook(target).then(() => { setPage(saved.page); setWorkspaceReady(true) })
    else { if (saved.page === 'archives') setPage('archives'); setWorkspaceReady(true) }
  }, [books, libraryState, openBook])

  const changeSessionPersona = (tab: ConversationTab, persona: PersonaSelection | null): void => {
    updateConversationTab(tab.id, (current) => ({ ...current, persona }))
    if (tab.kind === 'archive' && tab.insightId) void persistArchiveHistory(tab.bookId, tab.insightId, tab.turns, persona).catch(() => undefined)
  }

  const savePersonaAs = (persona: PersonaSelection): PersonaSelection | null => {
    if (personaSettings.presets.length >= MAX_PERSONAS) return null
    const preset = { id: crypto.randomUUID(), name: persona.name, prompt: persona.prompt }
    if (!changePersonaSettings({ ...personaSettings, presets: [...personaSettings.presets, preset] })) {
      pushToast(copy('persona.saveFailed'), 'error')
      return null
    }
    pushToast(copy('persona.saved'), 'success')
    return personaFromPreset(preset)
  }

  const saveSessionPersonaAs = (tab: ConversationTab, persona: PersonaSelection): void => {
    const saved = savePersonaAs(persona)
    if (saved) changeSessionPersona(tab, saved)
  }

  // 清空会话：先取消该书排队中与进行中的请求，否则名额释放后模型仍会被调用，
  // 而对应的轮次已经被清掉，回答无处落地。
  const clearLiveSession = async (tab: ConversationTab): Promise<void> => {
    if (sessionTransitionsRef.current.has(tab.id) || closingRef.current) return
    setSessionChanging(tab.id, true)
    setPendingClearSession(false)
    try {
      await cancelTabRequests(tab.id)
      // Finish older writes before deleting, so they cannot recreate the cleared conversation.
      await sessionSaves.wait(tab.bookId).catch(() => undefined)
      await window.readerApi.deleteBookSession(tab.bookId, tab.conversationId)
      sessionSaves.forget(tab.bookId)
      updateConversationTab(tab.id, (current) => ({
        ...current,
        conversationId: crypto.randomUUID(),
        scope: 'book',
        persona: defaultPersona(personaSettings),
        webSearch: webSearchEnabled ? 'auto' : 'off',
        selection: null,
        draft: '',
        turns: []
      }))
    } catch {
      pushToast(copy('assistant.sessionSaveFailed'), 'error')
    } finally {
      setSessionChanging(tab.id, false)
    }
  }

  const sessionOperationInProgress = useCallback(() => Boolean(
    sessionTransitionsRef.current.size || deletingBooksRef.current.size || deletingInsightsRef.current.size
  ), [sessionTransitionsRef])
  const prepareClose = useCallback(async (): Promise<void> => {
    if (progressTimerRef.current) {
      clearTimeout(progressTimerRef.current)
      progressTimerRef.current = null
    }
    await cancelAllRequests()
    await flushProgress()
  }, [cancelAllRequests, flushProgress])
  const { closing, closeSaveFailed, retryingSaves, retrySessionSaves } = useAppClose({
    closingRef, isBusy: sessionOperationInProgress, prepareClose, flushSessions: flushSessionSaves,
    closeWorkbenches, resumeWorkbenches, retryWorkbenchSaves, retryTabRestoration
  })

  useEffect(() => {
    const dispose = (): void => coverCache.dispose()
    window.addEventListener('unload', dispose)
    return () => window.removeEventListener('unload', dispose)
  }, [coverCache])

  const showLibraryAfterImport = useCallback(() => selectLeftView('library'), [selectLeftView])
  const { importing, importDialogState, dropOverlay, importReturnFocusRef, importBooks, cancelBookImport, closeBookImportDialog } = useBookImport({
    refreshBooks, openBook, onShowLibrary: showLibraryAfterImport, pushToast, dismissToast
  })

  const openSearchView = useCallback((): void => {
    if (!activeBookRef.current || !adapterRef.current) return
    selectLeftView('search')
  }, [selectLeftView])

  const toggleLeftPanelView = useCallback((view: Exclude<LeftView, 'library'>): void => {
    if (leftPanelOpen && leftView === view) {
      setLeftPanelOpen(false)
      return
    }
    if (view === 'search') openSearchView()
    else selectLeftView(view)
  }, [leftPanelOpen, leftView, openSearchView, selectLeftView])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'f' &&
        bookState === 'ready' &&
        !settingsOpen &&
        !assistantDialogOpen &&
        !detailsBook
      ) {
        event.preventDefault()
        openSearchView()
        return
      }
      if (event.key === 'Escape' && !isSelectPickerOpen(event.target) && !settingsOpen && !assistantDialogOpen && !detailsBook) {
        adapterRef.current?.clearSelection()
        setSelection(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [assistantDialogOpen, bookState, detailsBook, openSearchView, settingsOpen])

  const enqueueRequest = async (action: LlmAction, question: string, tabId: string, sourceSelection?: ReaderSource, replaceTurnId?: string): Promise<void> => {
    const cleanQuestion = question.trim()
    if (!cleanQuestion) return
    let tab = conversationTabsRef.current.find((candidate) => candidate.id === tabId)
    if (!tab || closingRef.current || tabHasActiveRequest(tab.id)) return
    const scope = sourceSelection ? 'selection' : tab.scope
    const context = scope === 'book' ? null : sourceSelection ?? tab.selection
    if (scope === 'selection' && !context) return

    let imageDataUrl: string | undefined
    if (isPdfImageRegion(context)) {
      try {
        imageDataUrl = await adapterRef.current?.captureImageRegion?.(context)
        if (!imageDataUrl) throw new Error(copy('visual.renderFailed'))
      } catch { pushToast(copy('visual.renderFailed'), 'error'); return }
    }
    if (closingRef.current || tabHasActiveRequest(tab.id) || conversationTabsRef.current.find((candidate) => candidate.id === tabId) !== tab) return
    const newContext = scope !== tab.scope || (scope === 'selection' && tab.selection?.anchor !== context?.anchor)
    if (newContext) {
      if (!await replaceSession(tab, async () => ({ conversationId: crypto.randomUUID(), scope, selection: context, turns: [], draft: '', persona: defaultPersona(personaSettings), webSearch: webSearchEnabled ? 'auto' : 'off' }))) return
      tab = conversationTabsRef.current.find((candidate) => candidate.id === tabId)!
    }
    if (closingRef.current || tabHasActiveRequest(tab.id)) return
    const conversationId = tab.conversationId
    const priorTurns = newContext ? [] : tab.turns.filter((turn) => turn.id !== replaceTurnId && turn.status === 'completed' && turn.answer)
    const requestId = createId()
    const turn: ConversationTurn = {
      id: createId(),
      requestId,
      selection: context,
      action,
      actionLabel: assistantActionLabel(assistantActions, action),
      question: cleanQuestion,
      answer: '',
      model: provider.model,
      persona: tab.persona,
      status: 'queued'
    }

    updateConversationTab(tab.id, (current) => ({
      ...current,
      conversationId,
      selection: context,
      scope,
      turns: newContext ? [turn] : [...current.turns.filter((item) => item.id !== replaceTurnId), turn],
      draft: ''
    }))
    focusConversationTab(tab.id)
    adapterRef.current?.clearSelection()
    setSelection(null)
    enqueueConversationRequest(tab.id, {
      requestId,
      conversationId,
      action,
      question: cleanQuestion,
      ...(tab.persona ? { persona: tab.persona.prompt } : {}),
      webSearch: isPdfImageRegion(context) ? 'off' : tab.webSearch,
      ...(scope === 'book' ? { scope: 'book' as const, bookId: tab.bookId }
        : isPdfImageRegion(context) ? { scope: 'visual' as const, selection: context, imageDataUrl: imageDataUrl! }
          : { scope: 'selection' as const, selection: context! }),
      historyCandidateMessages: Math.min(priorTurns.length * 2, 1_000_000),
      historyCandidateTruncated: priorTurns.slice(-15).some((item) => item.answer.length > 20_000),
      history: priorTurns.slice(-15).flatMap((item) => [
        { role: 'user' as const, content: item.question },
        { role: 'assistant' as const, content: item.answer.slice(-20_000) }
      ])
    }, getProviderRevision())
  }
  // 划词工具栏跟随选区:出现时同步定位,滚动/缩放时按帧重算并直接写样式,
  // 避免经过 React 状态造成级联渲染。
  useSelectionToolbar({
    hostRef, surfaceRef: readerSurfaceRef, toolbarRef: selectionToolbarRef,
    selection, ready: bookState === 'ready', interfaceScale
  })

  const handleSelectionAction = async (action: LlmAction): Promise<void> => {
    if (compactWindow) setLeftPanelOpen(false)
    if (!selection || !activeBook) return
    const liveTabId = ensureLiveTab(activeBook)
    if (action === 'ask') {
      const liveTab = conversationTabsRef.current.find((tab) => tab.id === liveTabId)
      if (!liveTab || tabHasActiveRequest(liveTab.id)) return
      const isNew = liveTab.scope !== 'selection' || liveTab.selection?.anchor !== selection.anchor
      if (isNew && !await replaceSession(liveTab, async () => ({ conversationId: crypto.randomUUID(), selection, scope: 'selection', turns: [], draft: '', persona: defaultPersona(personaSettings), webSearch: webSearchEnabled ? 'auto' : 'off' }))) return
      focusConversationTab(liveTabId)
      adapterRef.current?.clearSelection()
      setSelection(null)
      window.setTimeout(() => followupRef.current?.focus(), 0)
      return
    }
    await enqueueRequest(action, isPdfImageRegion(selection) ? copy('assistant.pdfRegionPrompt') : assistantActions[action].prompt, liveTabId, selection)
  }

  const submitTabQuestion = (tabId: string): void => {
    const tab = conversationTabsRef.current.find((candidate) => candidate.id === tabId)
    if (!tab || tabHasActiveRequest(tab.id) || !providerIsConfigured(provider) || (tab.scope === 'book' ? analysis.states[tab.bookId]?.document?.status !== 'ready' : !tab.selection) || !tab.draft.trim()) return
    enqueueRequest('ask', tab.draft, tabId)
  }

  // 重新生成 / 改写问题只作用于最后一轮：截断到该轮之前再重新发送。
  const lastTurnIndex = (tab: ConversationTab, turnId: string): number => {
    const index = tab.turns.findIndex((turn) => turn.id === turnId)
    return index === tab.turns.length - 1 ? index : -1
  }
  const regenerateTurn = (tab: ConversationTab, turnId: string): void => {
    const index = lastTurnIndex(tab, turnId)
    if (index < 0 || tabHasActiveRequest(tab.id)) return
    const turn = tab.turns[index]
    const scope = turn.selection ? 'selection' : 'book'
    if (!providerIsConfigured(provider)) return
    if (scope === 'book' && analysis.states[tab.bookId]?.document?.status !== 'ready') return
    void enqueueRequest(turn.action, turn.question, tab.id, turn.selection ?? undefined, turnId)
  }
  const editTurnQuestion = (tab: ConversationTab, turnId: string): void => {
    const index = lastTurnIndex(tab, turnId)
    if (index < 0) return
    const turn = tab.turns[index]
    updateConversationTab(tab.id, (current) => ({
      ...current,
      turns: current.turns.filter((item) => item.id !== turnId),
      draft: turn.question
    }))
    window.setTimeout(() => followupRef.current?.focus(), 0)
  }

  const submitActiveQuestion = (event: FormEvent): void => {
    event.preventDefault()
    const tabId = activeTabIdRef.current
    if (!tabId) return
    submitTabQuestion(tabId)
  }

  const submitSidebarQuestion = (event: FormEvent): void => {
    event.preventDefault()
    const bookId = activeBookRef.current?.id
    const tab = bookId ? conversationTabsRef.current.find((candidate) => candidate.id === activeTabIdRef.current && candidate.bookId === bookId)
      ?? conversationTabsRef.current.find((candidate) => candidate.kind === 'live' && candidate.bookId === bookId) : undefined
    if (!tab) return
    submitTabQuestion(tab.id)
  }

  const navigateToAnchor = useCallback(async (anchor: string, showSelection = false, chapterTitle?: string): Promise<void> => {
    setOcrReadingOpen(false)
    setPage('reading')
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const adapter = adapterRef.current
    if (!adapter) return
    try {
      let selected = false
      if (showSelection) selected = await adapter.selectAnchor(anchor)
      if (!selected) {
        await adapter.goTo(anchor)
        if (showSelection) await adapter.selectAnchor(anchor)
      }
      await adapter.highlight(anchor)
      if (chapterTitle) {
        chapterTitleOverrideRef.current = chapterTitle
        setCurrentChapterTitle(chapterTitle)
        setCurrentLocator(anchor)
      }
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
      highlightTimerRef.current = setTimeout(() => {
        adapter.clearHighlight()
        highlightTimerRef.current = null
      }, 2_800)
    } catch (error) {
      pushToast(readableError(error, copy('reader.navigateSourceFailed')), 'error')
    }
  }, [pushToast])

  const navigateWorkbenchSource = async (bookId: string, anchor: string, chapterTitle?: string): Promise<void> => {
    const book = books.find((item) => item.id === bookId)
    if (!book) { pushToast(copy('workbench.missingSource'), 'error'); return }
    await openBook(book, 'reading', { focusLiveTab: false })
    if (activeBookRef.current?.id === bookId && adapterRef.current) {
      setPage('reading')
      await navigateToAnchor(anchor, false, chapterTitle)
    }
  }

  const navigateToSearchResult = useCallback(async (result: ReaderSearchResult): Promise<void> => {
    chapterTitleOverrideRef.current = result.chapterTitle
    await navigateToAnchor(result.anchor)
    setCurrentLocator(result.anchor)
    setCurrentChapterTitle(result.chapterTitle)
    setCurrentChapterProgress(0)
  }, [navigateToAnchor])

  const navigateOcrPage = useCallback(async (pageNumber: number): Promise<void> => {
    const adapter = adapterRef.current
    if (!adapter) return
    adapter.clearSelection(); setSelection(null)
    chapterTitleOverrideRef.current = null
    await adapter.goTo(`pdfpos:${pageNumber}:0`)
  }, [])
  const closeOcrReader = useCallback((restoreFocus = true): void => {
    adapterRef.current?.clearSelection(); setSelection(null); setOcrReadingOpen(false)
    if (restoreFocus) requestAnimationFrame(() => ocrReadingToggleRef.current?.focus({ preventScroll: true }))
  }, [])

  const openInsight = useCallback(async (insight: InsightArchiveRecord): Promise<void> => {
    const book = activeBookRef.current?.id === insight.bookId ? null : books.find((candidate) => candidate.id === insight.bookId)
    if (activeBookRef.current?.id !== insight.bookId && !book) {
      pushToast(copy('insights.bookMissing'), 'error')
      return
    }

    markArchiveOpened(insight.id)
    let tabId = conversationTabsRef.current.find((tab) => tab.kind === 'archive' && tab.insightId === insight.id)?.id
    if (!tabId) {
      const tab = createArchiveTab(insight)
      commitConversationTabs((current) => [...current, tab])
      tabId = tab.id
    }
    // 先进入对话页，目标书籍在后台打开，避免先跳到书籍页面。
    focusConversationTab(tabId)
    setPage('conversation')
    if (!book) return
    adapterRef.current?.clearSelection()
    setSelection(null)
    await openBook(book, null, { focusLiveTab: false })
    if (activeBookRef.current?.id !== insight.bookId || !adapterRef.current) {
      pushToast(copy('reader.openFailed'), 'error')
    }
  }, [books, commitConversationTabs, conversationTabsRef, focusConversationTab, markArchiveOpened, openBook, pushToast])

  const activateSessionTab = useCallback(async (tabId: string): Promise<void> => {
    const tab = conversationTabsRef.current.find((candidate) => candidate.id === tabId)
    if (!tab) return
    if (activeBookRef.current?.id !== tab.bookId) {
      const book = books.find((candidate) => candidate.id === tab.bookId)
      if (!book) {
        pushToast(copy('insights.bookMissing'), 'error')
        return
      }
      // 先切到对话页并在后台打开书籍：切换到其他书的会话时不闪回书籍页面。
      focusConversationTab(tabId)
      setPage('conversation')
      await openBook(book, null, { focusLiveTab: false })
      if (activeBookRef.current?.id !== tab.bookId || !adapterRef.current) {
        pushToast(copy('reader.openFailed'), 'error')
      }
      return
    }
    focusConversationTab(tabId)
    setPage('conversation')
  }, [books, conversationTabsRef, focusConversationTab, openBook, pushToast])
  const navigateToToc = useCallback(async (href: string, chapterTitle?: string): Promise<void> => {
    const adapter = adapterRef.current
    if (!adapter) return
    try {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current)
        highlightTimerRef.current = null
      }
      adapter.clearHighlight()
      await adapter.goTo(href)
      if (chapterTitle) {
        chapterTitleOverrideRef.current = chapterTitle
        setCurrentChapterTitle(chapterTitle)
        setCurrentChapterHref(href)
        setCurrentChapterProgress(0)
      }
    } catch (error) {
      pushToast(readableError(error, copy('reader.navigateChapterFailed')), 'error')
    }
  }, [pushToast])

  const returnToReading = useCallback(async (): Promise<void> => {
    const target = naturalPositionRef.current.locator
    const adapter = adapterRef.current
    if (!target || !adapter) return
    try {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current)
        highlightTimerRef.current = null
      }
      adapter.clearHighlight()
      const chapter = naturalChapterRef.current
      chapterTitleOverrideRef.current = chapter?.title ?? null
      await adapter.goTo(target)
      setCurrentLocator(target)
      if (chapter) { setCurrentChapterTitle(chapter.title); setCurrentChapterHref(chapter.href); setCurrentChapterProgress(chapter.progress) }
    } catch (error) {
      pushToast(readableError(error, copy('reader.navigateChapterFailed')), 'error')
    }
  }, [pushToast])

  const saveSelectionHighlight = async (): Promise<void> => {
    if (!selection || isPdfImageRegion(selection) || !activeBook) return
    const target = selection
    try {
      await window.readerApi.saveHighlight({
        bookId: target.bookId,
        quote: target.quote,
        anchor: target.anchor,
        chapterTitle: target.chapterTitle
      })
      adapterRef.current?.clearSelection()
      setSelection(null)
      await refreshHighlights(activeBook.id)
      pushToast(copy('highlights.savedToast'), 'success')
    } catch (error) {
      pushToast(readableError(error, copy('highlights.saveFailed')), 'error')
    }
  }

  const closeBookSession = async (bookId: string, options: { dropConversations?: boolean } = {}): Promise<void> => {
    if (activeBookRef.current?.id !== bookId) return
    openSequenceRef.current += 1
    await flushProgress()
    destroyReader()
    activeBookRef.current = null
    setActiveBook(null)
    setBookState('idle')
    setBookError('')
    setSelection(null)
    setPage('library')
    setPreparationBookId(null)
    setToc([])
    setCollapsedTocItems(new Set())
    setInsights([])
    setHighlights([])
    highlightsRequestRef.current += 1
    setHighlightsLoading(false)
    setHighlightsError('')
    setPendingDeleteHighlightId(null)
    setCurrentLocator(null)
    setNaturalLocator(null)
    setCurrentChapterProgress(0)
    setCurrentChapterTitle('')
    setCurrentChapterHref(null)
    resetSearch()
    naturalPositionRef.current = { locator: null, progress: 0 }
    if (detailsBook?.id === bookId) setDetailsBook(null)
    setLeftView('library')

    if (options.dropConversations) {
      // 书籍被删除时丢弃它的会话与请求；关闭标签只是回到书库，保留逐书草稿与历史。
      await cancelBookRequests(bookId)
      removeConversationTabsForBook(bookId)
    }
  }

  const removeBookTab = (bookId: string): void => {
    setBookTabs((current) => current.filter((tab) => tab.bookId !== bookId))
  }

  // 拖拽重排标签：只改变标签顺序，不改变活动书籍。
  const moveBookTab = (sourceId: string, targetId: string): void => {
    if (sourceId === targetId) return
    setBookTabs((current) => {
      const from = current.findIndex((tab) => tab.bookId === sourceId)
      const to = current.findIndex((tab) => tab.bookId === targetId)
      if (from < 0 || to < 0) return current
      const next = [...current]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  const activateBookTab = (tab: BookTabState): void => {
    const book = books.find((candidate) => candidate.id === tab.bookId)
    if (!book) {
      removeBookTab(tab.bookId)
      return
    }
    if (activeBookRef.current?.id === tab.bookId && adapterRef.current) {
      setPage(tab.page)
      return
    }
    void openBook(book, tab.page)
  }

  const closeBookTab = (bookId: string): void => {
    removeBookTab(bookId)
    if (activeBookRef.current?.id === bookId) void closeBookSession(bookId)
  }

  // 会话标签拖拽重排：顺序即会话列表顺序，live 不再固定置顶。
  const moveConversationTab = (sourceId: string, targetId: string): void => {
    if (sourceId === targetId) return
    commitConversationTabs((current) => {
      const from = current.findIndex((tab) => tab.id === sourceId)
      const to = current.findIndex((tab) => tab.id === targetId)
      if (from < 0 || to < 0) return current
      const next = [...current]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  const deleteBook = async (book: BookRecord): Promise<void> => {
    if (deletingBookId) return
    setDeletingBookId(book.id)
    deletingBooksRef.current.add(book.id)
    const archiveIds = conversationTabsRef.current.filter((tab) => tab.bookId === book.id && tab.insightId).map((tab) => tab.insightId!)
    try {
      await cancelBookRequests(book.id)
      await Promise.allSettled([sessionSaves.wait(book.id), tabSaves.wait('tabs'), ...archiveIds.map((id) => archiveSaves.wait(id))])
      const deleted = await window.readerApi.deleteBook(book.id)
      sessionSaves.forget(book.id)
      for (const id of archiveIds) archiveSaves.forget(id)
      await closeBookSession(book.id, { dropConversations: true })
      removeConversationTabsForBook(book.id)
      deletingBooksRef.current.delete(book.id)
      void persistSessionTabs().catch(() => undefined)
      coverCache.remove(book.id)
      if (detailsBook?.id === book.id) setDetailsBook(null)
      if (deleted) {
        setBooks((current) => current.filter((item) => item.id !== book.id))
        removeConversationTabsForBook(book.id)
        removeBookTab(book.id)
        await refreshInsights()
        pushToast(copy('library.deletedToast', { title: book.title }), 'success')
      } else {
        removeBookTab(book.id)
        await refreshBooks()
        pushToast(copy('library.alreadyRemoved'), 'neutral')
      }
    } catch (error) {
      pushToast(readableError(error, copy('library.deleteFailed')), 'error')
    } finally {
      deletingBooksRef.current.delete(book.id)
      setDeletingBookId(null)
    }
  }

  const deleteHighlight = async (highlightId: string): Promise<void> => {
    try {
      const deleted = await window.readerApi.deleteHighlight(highlightId)
      setPendingDeleteHighlightId(null)
      if (activeBook) await refreshHighlights(activeBook.id)
      pushToast(deleted ? copy('highlights.removed') : copy('highlights.removed'), 'neutral')
    } catch (error) {
      pushToast(readableError(error, copy('highlights.removeFailed')), 'error')
    }
  }

  const deleteInsight = async (insightId: string): Promise<void> => {
    if (deletingInsightsRef.current.has(insightId)) return
    deletingInsightsRef.current.add(insightId)
    try {
      const tab = conversationTabsRef.current.find((candidate) => candidate.insightId === insightId)
      if (tab) await cancelTabRequests(tab.id)
      await Promise.allSettled([archiveSaves.wait(insightId), tabSaves.wait('tabs')])
      const target = insights.find((insight) => insight.id === insightId)
      const deleted = await window.readerApi.deleteInsight(insightId)
      archiveSaves.forget(insightId)
      setPendingDeleteInsightId(null)
      setInsights((current) => current.filter((insight) => insight.id !== insightId))

      const removedTab = conversationTabsRef.current.find((tab) => tab.kind === 'archive' && tab.insightId === insightId)
      const remaining = commitConversationTabs((current) => {
        let next = current.filter((tab) => tab.kind !== 'archive' || tab.insightId !== insightId)
        if (target) {
          next = next.map((tab) => ({
            ...tab,
            turns: tab.turns.map((turn) => (
              turn.question === target.question && turn.answer === target.answer
                ? { ...turn, saved: false }
                : turn
            ))
          }))
        }
        return next
      })
      if (removedTab && activeTabIdRef.current === removedTab.id) {
        const activeBookId = activeBookRef.current?.id
        const fallback = remaining.find((tab) => tab.kind === 'live' && tab.bookId === activeBookId) ?? remaining[0]
        focusConversationTab(fallback?.id ?? null)
      }

      deletingInsightsRef.current.delete(insightId)
      void persistSessionTabs().catch(() => undefined)
      if (!deleted) void refreshInsights()
      pushToast(deleted ? copy('insights.removed') : copy('insights.alreadyRemoved'), 'neutral')
    } catch (error) {
      pushToast(readableError(error, copy('insights.removeFailed')), 'error')
    } finally { deletingInsightsRef.current.delete(insightId) }
  }

  const handleExportInsights = async (scope: InsightExportScope): Promise<void> => {
    if (exportingInsights) return
    setExportingInsights(true)
    try {
      const result = await window.readerApi.exportInsights(scope)
      if (!result.canceled) {
        pushToast(copy('insights.exportedToast', { fileName: result.fileName }), 'success')
      }
    } catch (error) {
      pushToast(readableError(error, copy('insights.exportFailed')), 'error')
    } finally {
      setExportingInsights(false)
    }
  }

  const saveTurn = async (tabId: string, turn: ConversationTurn): Promise<void> => {
    const tab = conversationTabsRef.current.find((candidate) => candidate.id === tabId)
    if (!tab || turn.status !== 'completed' || !turn.answer || turn.saved) return
    try {
      await window.readerApi.saveInsight({
        bookId: tab.bookId,
        conversationId: tab.conversationId,
        selection: turn.selection,
        context: turn.context,
        question: turn.question,
        answer: turn.answer,
        model: turn.model || provider.model,
        webSearch: tab.webSearch,
        ...(turn.persona ? { persona: turn.persona } : {})
      })
      updateConversationTab(tabId, (current) => ({
        ...current,
        turns: current.turns.map((item) => item.id === turn.id ? { ...item, saved: true } : item)
      }))
      await refreshInsights()
      pushToast(copy('insights.savedToast'), 'success')
    } catch (error) {
      pushToast(readableError(error, copy('insights.saveFailed')), 'error')
    }
  }

  const activeConversationTab = conversationTabs.find((tab) => tab.id === activeTabId)
  const sidebarTab = activeBook
    ? activeConversationTab?.bookId === activeBook.id ? activeConversationTab : conversationTabs.find((tab) => tab.kind === 'live' && tab.bookId === activeBook.id)
    : undefined
  useEffect(() => {
    if (activeBook?.id) void refreshAnalysis(activeBook.id)
    if (activeConversationTab?.bookId && activeConversationTab.bookId !== activeBook?.id) void refreshAnalysis(activeConversationTab.bookId)
  }, [activeBook?.id, activeConversationTab?.bookId, refreshAnalysis, settingsOpen])
  // 进行中或排队中的请求：用于禁用发送、显示停止按钮与阻止重复入队。
  const streamingRequestId = (tab: ConversationTab | undefined): string | null =>
    tab?.turns.find((turn) => turn.status === 'streaming' || turn.status === 'queued')?.requestId ?? null
  const webSearchControl = (tab: ConversationTab): ReactNode => {
    return <WebSearchControl mode={tab.webSearch} enabled={webSearchEnabled} busy={Boolean(streamingRequestId(tab))}
      imageQuestion={isPdfImageRegion(tab.selection)} changing={changingSessions.includes(tab.id)}
      onChange={(webSearch) => {
        updateConversationTab(tab.id, (current) => ({ ...current, webSearch }))
        if (tab.kind === 'archive' && tab.insightId) void persistArchiveHistory(tab.bookId, tab.insightId, tab.turns, tab.persona, webSearch).catch(() => undefined)
      }} />
  }
  const changeConversationScope = async (tab: ConversationTab, scope: 'selection' | 'book'): Promise<void> => {
    if (scope === tab.scope || tabHasActiveRequest(tab.id)) return
    // A new scope from an archived insight starts a live conversation, preserving the archive.
    const book = books.find((item) => item.id === tab.bookId)
    const target = tab.kind === 'archive' && book
      ? conversationTabsRef.current.find((item) => item.id === ensureLiveTab(book))!
      : tab
    const context = scope === 'selection' ? (selection?.bookId === tab.bookId ? selection : tab.selection) : null
    if (await replaceSession(target, async () => ({ conversationId: crypto.randomUUID(), scope, selection: context, turns: [], draft: '', persona: defaultPersona(personaSettings), webSearch: webSearchEnabled ? 'auto' : 'off' }))) focusConversationTab(target.id)
  }
  const listRecentConversations = async (tab: ConversationTab) => {
    const current = conversationTabsRef.current.find((item) => item.id === tab.id)
    if (current) await persistLiveSession(current)
    return window.readerApi.listRecentBookSessions(tab.bookId)
  }
  const restoreRecentConversation = async (tab: ConversationTab, conversationId: string): Promise<void> => {
    const restored = await replaceSession(tab, async () => {
      const record = await window.readerApi.getRecentBookSession({ bookId: tab.bookId, conversationId })
      if (!record) throw new Error(copy('assistant.sessionRestoreFailed'))
      return { conversationId: record.conversationId, scope: record.scope, selection: record.selection, draft: record.draft, persona: record.persona ?? null, webSearch: record.webSearch ?? 'off',
        turns: record.turns.map((turn) => ({ ...turn, requestId: '', selection: turn.selection ?? null, context: turn.context ?? undefined })) }
    })
    if (!restored) throw new Error(copy('assistant.sessionRestoreFailed'))
    setConversationQuery(''); setPendingClearSession(false)
    focusConversationTab(tab.id)
  }
  const conversationNeedle = normalizeNeedle(conversationQuery)
  const conversationMatches = useMemo(() => {
    if (!conversationNeedle) return 0
    return (activeConversationTab?.turns ?? []).filter((turn) => [turn.question, turn.answer, turn.selection && !isPdfImageRegion(turn.selection) ? turn.selection.quote : '']
      .some((value) => value.toLocaleLowerCase('zh-CN').includes(conversationNeedle))).length
  }, [activeConversationTab, conversationNeedle])
  const canAskTab = (tab: ConversationTab | undefined): boolean => Boolean(tab && (tab.kind !== 'live' || loadedSessions.has(tab.bookId)) &&
    providerIsConfigured(provider) && !streamingRequestId(tab) && (tab.scope === 'book' ? analysis.states[tab.bookId]?.document?.status === 'ready' : tab.selection))
  const canAskSidebar = canAskTab(sidebarTab)
  const canAskWorkbench = canAskTab(activeConversationTab)
  const blockedReason = (tab: ConversationTab | undefined): string => {
    if (tab?.kind === 'live' && !loadedSessions.has(tab.bookId)) return copy(failedSessionLoads.includes(tab.bookId) ? 'assistant.sessionRestoreFailed' : 'assistant.sessionLoading')
    if (streamingRequestId(tab)) return copy('assistant.busyHint')
    if (!providerIsConfigured(provider)) return copy('assistant.needModel')
    if (tab?.scope === 'book' && analysis.states[tab.bookId]?.document?.status !== 'ready') return copy('assistant.needDocument')
    return ''
  }
  const resolveProps = (tab: ConversationTab | undefined, showSelectionPending = false) => ({
    blockedReason: blockedReason(tab) || (showSelectionPending && tab?.scope === 'selection' && !tab.selection ? copy('assistant.selectionPending') : ''),
    ...(tab?.kind === 'live' && !loadedSessions.has(tab.bookId) ?
      failedSessionLoads.includes(tab.bookId) ? { resolveLabel: copy('common.retry') } : {} :
      !streamingRequestId(tab) && !providerIsConfigured(provider) ? {
      resolveLabel: copy('preparation.configureModel')
    } : !streamingRequestId(tab) && tab?.scope === 'book' && analysis.states[tab.bookId]?.document?.status !== 'ready' ? {
      resolveLabel: copy('workspace.prepare')
    } : {})
  })
  const resolveBlocker = (tab: ConversationTab | undefined, trigger: HTMLButtonElement): void => {
    if (tab?.kind === 'live' && failedSessionLoads.includes(tab.bookId)) {
      retrySessionRestoration(tab.bookId)
      return
    }
    if (streamingRequestId(tab)) return
    if (!providerIsConfigured(provider)) openSettings('model', trigger)
    else if (tab?.scope === 'book') openPreparation(tab.bookId, trigger)
  }
  const preparationBook = books.find((book) => book.id === preparationBookId)
  const filteredBooks = useMemo(() => {
    const query = libraryQuery.trim().toLocaleLowerCase()
    return books.filter((book) => !query || [book.title, book.author ?? ''].some((text) => text.toLocaleLowerCase().includes(query)))
      .sort((a, b) => (b.lastOpenedAt ?? b.importedAt).localeCompare(a.lastOpenedAt ?? a.importedAt))
  }, [books, libraryQuery])
  const resumeBook = useMemo(() => {
    let latest: BookRecord | null = null
    let latestOpenedAt = ''
    for (const book of books) {
      const openedAt = book.lastOpenedAt
      if (!openedAt || openedAt <= latestOpenedAt) continue
      latest = book
      latestOpenedAt = openedAt
    }
    return latest
  }, [books])
  const visibleToc = useMemo(() => {
    const ancestorIds: string[] = []
    return toc.map((item, index) => {
      ancestorIds.length = item.depth
      const hidden = ancestorIds.some((id) => collapsedTocItems.has(id))
      const hasChildren = index + 1 < toc.length && toc[index + 1].depth > item.depth
      const isCurrent = currentChapterHref
        ? tocHrefMatchesCurrent(item.href, currentChapterHref)
        : Boolean(currentChapterTitle) && item.label === currentChapterTitle
      ancestorIds[item.depth] = item.id
      return { item, index, hidden, hasChildren, isCurrent }
    }).filter((entry) => !entry.hidden)
  }, [collapsedTocItems, currentChapterHref, currentChapterTitle, toc])

  // 标签需要记住每本书上次停在哪一页，而 page 的变更分散在多个回调里；
  // 按 React 官方推荐的渲染期派生写法同步，避免 effect 里的额外渲染级联。
  const activeTabPage = bookTabPage(page)
  if (activeBook?.id && activeTabPage) {
    const activeIndex = bookTabs.findIndex((tab) => tab.bookId === activeBook.id)
    if (activeIndex >= 0 && bookTabs[activeIndex].page !== activeTabPage) {
      setBookTabs(bookTabs.map((tab, position) => position === activeIndex ? { ...tab, page: activeTabPage } : tab))
    }
  }
  const bookTabStripRef = useRef<HTMLDivElement | null>(null)
  const activeBookTabRef = useRef<HTMLDivElement | null>(null)
  // 标签条宽度不足时会横向滚动，切换书籍后需要把活动标签带回可见范围。
  // 只调整标签条自身的滚动位置：scrollIntoView 会连带滚动上层容器，影响阅读区布局。
  useEffect(() => {
    const strip = bookTabStripRef.current
    const tab = activeBookTabRef.current
    if (!strip || !tab) return
    const stripRect = strip.getBoundingClientRect()
    const tabRect = tab.getBoundingClientRect()
    if (tabRect.left < stripRect.left) strip.scrollLeft -= stripRect.left - tabRect.left
    else if (tabRect.right > stripRect.right) strip.scrollLeft += tabRect.right - stripRect.right
  }, [activeBook?.id, bookTabs.length])

  const sessionTabStripRef = useRef<HTMLDivElement | null>(null)
  const activeSessionTabRef = useRef<HTMLDivElement | null>(null)
  // 会话标签不再把当前 live 置顶，活动标签可能滚出可视区，需要带回视野。
  useEffect(() => {
    const strip = sessionTabStripRef.current
    const tab = activeSessionTabRef.current
    if (!strip || !tab) return
    const stripRect = strip.getBoundingClientRect()
    const tabRect = tab.getBoundingClientRect()
    if (tabRect.left < stripRect.left) strip.scrollLeft -= stripRect.left - tabRect.left
    else if (tabRect.right > stripRect.right) strip.scrollLeft += tabRect.right - stripRect.right
  }, [activeTabId, assistantDialogOpen])

  return (
    <>
      {closing && <div className="session-close-saving" data-interface-scale={interfaceScale} role="status" data-testid="session-close-saving"><LoaderCircle className="spin" size="1.25em" />{copy('assistant.savingBeforeClose')}</div>}
    <div
      className="app-shell workspace-shell"
      data-page={page}
      data-left-open={leftPanelOpen}
      data-pdf-display={pdfDisplayOpen}
      data-workspace-ready={workspaceReady}
      data-session-tabs-state={sessionTabsRestoreState}
      inert={closing}
      data-testid="app-shell"
      data-theme={resolvedTheme}
      data-theme-preference={themePreference}
      data-interface-scale={interfaceScale}
    >
      <header className="workspace-topbar">
        <strong className="workspace-brand">{copy('app.name')}</strong>
        <nav aria-label={copy('workspace.navigation')}>
          <button type="button" data-testid="nav-library" aria-current={page === 'library' ? 'page' : undefined} onClick={() => setPage('library')}><Library size={17} />{copy('workspace.library')}</button>
          <button type="button" data-testid="nav-archives" aria-current={page === 'archives' ? 'page' : undefined} onClick={() => setPage('archives')}><Bookmark size={17} />{copy('workspace.archives')}</button>
        </nav>
        <div className="workspace-book-tabs" role="tablist" aria-label={copy('workspace.bookTabs')} data-testid="book-tabs" ref={bookTabStripRef}>
          {bookTabs.map((tab) => {
            const book = books.find((candidate) => candidate.id === tab.bookId)
            if (!book) return null
            const isActive = activeBook?.id === tab.bookId && !['library', 'archives'].includes(page)
            return (
              <div
                className={'workspace-book-tab ' + (isActive ? 'is-active ' : '') + (draggingTabId === tab.bookId ? 'is-dragging' : '')}
                data-book-id={tab.bookId}
                key={tab.bookId}
                ref={isActive ? activeBookTabRef : undefined}
                draggable
                onDragStart={(event) => {
                  setDraggingTabId(tab.bookId)
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', tab.bookId)
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const sourceId = event.dataTransfer.getData('text/plain') || draggingTabId
                  setDraggingTabId(null)
                  if (sourceId) moveBookTab(sourceId, tab.bookId)
                }}
                onDragEnd={() => setDraggingTabId(null)}
              >
                <button
                  className="workspace-book-tab-select"
                  data-testid="book-tab"
                  data-book-id={tab.bookId}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  title={book.title}
                  onClick={() => activateBookTab(tab)}
                ><span>{book.title}</span></button>
                <button
                  className="workspace-book-tab-close"
                  data-testid="book-tab-close"
                  data-book-id={tab.bookId}
                  type="button"
                  aria-label={copy('workspace.closeBookTab', { title: book.title })}
                  title={copy('workspace.closeBookTab', { title: book.title })}
                  onClick={() => closeBookTab(tab.bookId)}
                ><X size={12} /></button>
              </div>
            )
          })}
        </div>
        <button ref={settingsButtonRef} className="workspace-settings" data-testid="settings-button" type="button" onClick={(event) => openSettings('appearance', event.currentTarget)}><Settings size={17} />{copy('settings.title')}
          <i className={'connection-status-dot is-' + providerConnection.status} data-testid="provider-connection-status" role="status" aria-label={providerStatusLabel(providerConnection.status)} title={providerConnection.message || providerStatusLabel(providerConnection.status)} />
        </button><WindowControls />
      </header>
      <div className="session-recovery-stack">
      {(sessionSaves.failed || tabSaves.failed || archiveSaves.failed || Object.values(workbenches.errors).some(Boolean) || closeSaveFailed) && <div className="session-tabs-recovery session-save-recovery" data-testid="session-save-recovery" role="alert">
        <AlertCircle size={18} />
        <span>{copy(closeSaveFailed ? 'assistant.closeSaveFailed' : 'assistant.unsavedSessions')}</span>
        <button className="secondary-button" data-testid="session-save-retry" type="button" disabled={retryingSaves || closing || changingSessions.length > 0 || Boolean(deletingBookId)} onClick={() => void retrySessionSaves()}>
          {retryingSaves ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}{copy('common.retry')}
        </button>
      </div>}
      {sessionTabsRestoreError && <div className="session-tabs-recovery" data-testid="session-tabs-recovery" role="alert">
        <AlertCircle size={18} />
        <span>{copy('assistant.tabsRestoreFailed')}</span>
        <button className="secondary-button" data-testid="session-tabs-retry" type="button" disabled={sessionTabsRestoreState === 'loading'} onClick={() => retryTabRestoration()}>
          {sessionTabsRestoreState === 'loading' ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}{copy('common.retry')}
        </button>
      </div>}
      </div>
      {activeBook && !['library', 'archives'].includes(page) && <header className="workspace-bookbar">
        <div className="workspace-book-title"><span className="format-chip">{activeBook.sourceFormat.toUpperCase()}</span><div className="workspace-book-identity"><h1 title={activeBook.title}>{activeBook.title}</h1>{page === 'reading' && <div className="workspace-reading-position reader-heading" data-testid="workspace-reading-position" aria-label={copy('reader.progressAria', { percent: Math.round(currentChapterProgress * 100) })}><span title={currentChapterTitle}>{currentChapterTitle || copy('common.currentChapter')}</span><strong>{Math.round(currentChapterProgress * 100)}%</strong><div className="workspace-reading-progress" data-testid="workspace-reading-progress" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, currentChapterProgress * 100))}%` }} /></div></div>}</div></div>
        <nav aria-label={copy('workspace.tabs')}>{(['reading', 'notes', 'conversation'] as const).map((item) => <button type="button" key={item} data-testid={'workspace-tab-' + item} aria-current={page === item ? 'page' : undefined} onClick={() => setPage(item)}>{copy(('workspace.' + item) as 'workspace.reading' | 'workspace.notes' | 'workspace.conversation')}</button>)}</nav>
        <div className="workspace-book-actions"><button className="secondary-button" type="button" data-testid="workspace-prepare" onClick={(event) => openPreparation(activeBook.id, event.currentTarget)}>{copy('workspace.prepare')}</button></div>
      </header>}
      <aside className="left-sidebar" inert={page !== 'library' && (page !== 'reading' || !leftPanelOpen)}>
        <header className="brand-row">
          <div className="brand-copy">
            <strong>{copy('app.name')}</strong>
          </div>
        </header>

        {page === 'library' && <header className="library-page-toolbar"><div><h1>{copy('workspace.library')}</h1><p>{copy('workspace.libraryCount', { count: books.length })}</p></div><label className="library-page-search"><Search size={17} /><input data-testid="library-search" type="search" aria-label={copy('workspace.librarySearch')} placeholder={copy('workspace.librarySearch')} value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} /></label>
          <button className="primary-button" data-testid="import-book" type="button" disabled={importing} onClick={(event) => void importBooks(event.currentTarget)}><Import size={17} />{copy(importing ? 'library.importing' : 'library.import')}</button></header>}
        {page === 'library' && resumeBook && (
          <div className="library-resume" data-testid="library-resume">
            <span className="library-resume-icon" aria-hidden="true"><BookOpen size={16} /></span>
            <span className="library-resume-title" title={resumeBook.title}>{copy('library.resumeTitle', { title: resumeBook.title })}</span>
            <small>{copy('workspace.readingProgress', { percent: Math.round(resumeBook.progress * 100) })}</small>
            <button className="secondary-button" data-testid="library-resume-open" type="button" onClick={() => void openBook(resumeBook, 'reading')}>{copy('workspace.continue')}</button>
          </div>
        )}
        <div className="sidebar-content">
          {page === 'library' && (
            <div className="library-list" data-testid="library-list">
              {libraryState === 'loading' && (
                <div className="sidebar-loading"><LoaderCircle className="spin" size={17} /> {copy('library.loading')}</div>
              )}
              {libraryState === 'error' && (
                <EmptyState
                  icon={<AlertCircle size={20} />}
                  title={copy('library.unavailableTitle')}
                  detail={libraryError}
                  action={<button className="text-button" type="button" onClick={() => void refreshBooks()}><RefreshCw size={14} />{copy('common.retry')}</button>}
                />
              )}
              {libraryState === 'ready' && books.length === 0 && (
                <EmptyState icon={<BookOpen size={20} />} title={copy('library.emptyTitle')} detail={copy('library.emptyDetail')} />
              )}
              {books.length > 0 && !filteredBooks.length && <EmptyState icon={<SearchX size={20} />} title={copy('workspace.libraryNoResults')} detail={copy('workspace.libraryNoResultsHint')} />}
              {filteredBooks.map((book) => (
                <div className={'book-item ' + (activeBook?.id === book.id ? 'is-active' : '')} key={book.id}>
                  <button
                    className="book-item-open"
                    data-testid="book-item"
                    data-book-id={book.id}
                    data-source-format={book.sourceFormat}
                    type="button"
                    onClick={() => void openBook(book)}
                  >
                    <BookCover book={book} cache={coverCache} />
                    <span className="book-meta">
                      <strong title={book.title}>{book.title}</strong>
                      <small title={book.author || copy('common.unknownAuthor')}>{book.author || copy('common.unknownAuthor')}</small>
                      <span className="book-meta-foot">
                        <span className="format-chip" data-testid="book-format" data-format={book.sourceFormat}>{book.sourceFormat.toUpperCase()}</span>
                        <span className="book-progress-text">{copy('workspace.readingProgress', { percent: Math.round(book.progress * 100) })}</span>
                      </span>
                    </span>
                  </button>
                  <button
                    className="book-item-info"
                    data-testid="book-info"
                    data-book-id={book.id}
                    type="button"
                    aria-label={copy('bookDetails.openAria', { title: book.title })}
                    title={copy('bookDetails.openAria', { title: book.title })}
                    onClick={(event) => openBookDetails(book, event.currentTarget)}
                  >
                    <Info size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {page === 'reading' && leftView === 'toc' && (
            <div className="toc-list" aria-label={copy('library.tocAria')}>
              {bookState === 'loading' && <div className="sidebar-loading"><LoaderCircle className="spin" size={17} /> {copy('library.tocLoading')}</div>}
              {bookState === 'ready' && toc.length === 0 && (
                <EmptyState icon={<SearchX size={20} />} title={copy('library.tocEmptyTitle')} detail={copy('library.tocEmptyDetail')} />
              )}
              {visibleToc.map(({ item, index, hasChildren, isCurrent }) => (
                <div className="toc-row" style={{ '--toc-depth': Math.min(item.depth, 3) } as CSSProperties} key={`${item.id}-${index}`}>
                  <button className={`toc-item ${isCurrent ? 'is-current' : ''}`} data-testid="toc-item" data-current={isCurrent ? 'true' : undefined} aria-current={isCurrent ? 'true' : undefined} data-toc-id={item.id} type="button" onClick={() => void navigateToToc(item.href, item.label)} title={item.label}>
                    <span>{item.label}</span>
                  </button>
                  {hasChildren && (
                    <button
                      className="toc-disclosure"
                      data-testid="toc-disclosure"
                      type="button"
                      aria-label={copy(collapsedTocItems.has(item.id) ? 'library.tocExpandAria' : 'library.tocCollapseAria', { title: item.label })}
                      aria-expanded={!collapsedTocItems.has(item.id)}
                      onClick={() => setCollapsedTocItems((current) => {
                        const next = new Set(current)
                        if (next.has(item.id)) next.delete(item.id)
                        else next.add(item.id)
                        return next
                      })}
                    >
                      {collapsedTocItems.has(item.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {page === 'reading' && leftView === 'highlights' && (
            <div className="highlight-list" data-testid="highlight-list" aria-label={copy('library.highlightsAria')}>
              <div className="highlight-list-heading">
                <h2>{copy('highlights.title')}</h2>
                <span>{copy('highlights.count', { count: highlights.length })}</span>
              </div>
              {highlightsLoading && <div className="sidebar-loading"><LoaderCircle className="spin" size={17} /> {copy('highlights.loading')}</div>}
              {highlightsError && <div className="empty-state" role="alert" data-testid="highlights-load-error">
                <div className="empty-icon" aria-hidden="true"><AlertCircle size={20} /></div>
                <strong>{highlightsError}</strong>
                <button className="text-button" data-testid="highlights-retry" type="button" onClick={() => activeBook && void refreshHighlights(activeBook.id)}><RefreshCw size={14} />{copy('common.retry')}</button>
              </div>}
              {!highlightsLoading && !activeBook && <EmptyState icon={<Bookmark size={20} />} title={copy('highlights.noBookTitle')} detail={copy('highlights.noBookDetail')} />}
              {!highlightsLoading && !highlightsError && activeBook && highlights.length === 0 && <EmptyState icon={<Bookmark size={20} />} title={copy('highlights.emptyTitle')} detail={copy('highlights.emptyDetail')} />}
              {highlights.map((highlight) => (
                <article className="highlight-item" data-testid="highlight-item" data-highlight-id={highlight.id} key={highlight.id}>
                  <button className="highlight-jump" type="button" onClick={() => void navigateToAnchor(highlight.anchor, true)}>
                    <p className="highlight-quote">{highlight.quote}</p>
                    <span className="highlight-chapter">{highlight.chapterTitle || copy('common.currentChapter')}</span>
                  </button>
                  <footer>
                    <span>{formatDate(highlight.createdAt)}</span>
                    {pendingDeleteHighlightId === highlight.id ? (
                      <span className="highlight-delete-confirmation">
                        <span>{copy('highlights.removeQuestion')}</span>
                        <button data-testid="highlight-delete-confirm" type="button" onClick={() => void deleteHighlight(highlight.id)}>{copy('common.confirm')}</button>
                        <button data-testid="highlight-delete-cancel" type="button" onClick={() => setPendingDeleteHighlightId(null)}>{copy('common.back')}</button>
                      </span>
                    ) : (
                      <button data-testid="highlight-delete" type="button" aria-label={copy('highlights.removeAria')} onClick={() => setPendingDeleteHighlightId(highlight.id)}><Trash2 size={13} /></button>
                    )}
                  </footer>
                </article>
              ))}
            </div>
          )}

          {page === 'reading' && leftView === 'search' && (
            <div className="reader-search" data-testid="reader-search" aria-label={copy('reader.searchTitle')}>
              <div className="reader-search-heading"><h2>{copy('reader.searchTitle')}</h2></div>
              <form className="reader-search-form" onSubmit={submitSearch}>
                <input
                  ref={searchInputRef}
                  data-testid="reader-search-input"
                  value={searchQuery}
                  aria-label={copy('reader.searchInputAria')}
                  placeholder={copy('reader.searchPlaceholder')}
                  onChange={(event) => {
                    const value = Array.from(event.target.value)
                      .slice(0, READER_SEARCH_QUERY_MAX_LENGTH)
                      .join('')
                    setSearchQuery(value)
                  }}
                />
                <button
                  data-testid="reader-search-submit"
                  type="submit"
                  aria-label={copy('reader.searchSubmit')}
                  title={copy('reader.searchSubmit')}
                >
                  <Search size={15} />
                </button>
              </form>
              <div className="reader-search-status" aria-live="polite">
                {searchState === 'searching' && <><LoaderCircle className="spin" size={15} />{copy('reader.searchLoading')}</>}
                {searchState === 'error' && <span role="alert">{searchError}</span>}
                {searchState === 'ready' && searchResults.length > 0 && (
                  <span>{copy(
                    searchResults.length >= READER_SEARCH_RESULT_LIMIT
                      ? 'reader.searchResultLimit'
                      : 'reader.searchResultCount',
                    { count: searchResults.length }
                  )}</span>
                )}
              </div>
              {searchState === 'ready' && searchResults.length === 0 && (
                <EmptyState
                  icon={<SearchX size={20} />}
                  title={copy('reader.searchNoResultsTitle')}
                  detail={copy('reader.searchNoResultsDetail')}
                />
              )}
              <div className="reader-search-results" data-testid="reader-search-results">
                {searchResults.map((result, index) => (
                  <button
                    className="reader-search-result"
                    data-testid="reader-search-result"
                    type="button"
                    key={`${result.anchor}-${index}`}
                    onClick={() => void navigateToSearchResult(result)}
                  >
                    <span>{result.chapterTitle || copy('common.currentChapter')}</span>
                    <p>
                      {splitSearchExcerpt(result.excerpt, executedSearchQuery).map((segment, segmentIndex) => (
                        segment.hit
                          ? <mark key={segmentIndex}>{segment.text}</mark>
                          : <Fragment key={segmentIndex}>{segment.text}</Fragment>
                      ))}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>


      </aside>

      {activeBook && page === 'reading' && <nav className="reader-rail" aria-label={copy('reader.toolsAria')}>
        <div className="reader-rail-tools">
          <button className="reader-rail-button" type="button" data-testid="reader-contents-button" aria-label={copy('reader.contentsButton')} title={copy('reader.contentsButton')} aria-pressed={leftPanelOpen && leftView === 'toc'} onClick={() => toggleLeftPanelView('toc')}><PanelLeftClose size={19} /></button>
          <button className="reader-rail-button" data-testid="highlights-tab" type="button" aria-label={copy('library.tabHighlights')} title={copy('library.tabHighlights')} aria-pressed={leftPanelOpen && leftView === 'highlights'} onClick={() => toggleLeftPanelView('highlights')}><Bookmark size={19} /></button>
          <button className="reader-rail-button" data-testid="reader-search-button" type="button" aria-label={copy('reader.searchOpen')} title={copy('reader.searchOpen')} aria-pressed={leftPanelOpen && leftView === 'search'} onClick={() => toggleLeftPanelView('search')}><Search size={19} /></button>
          {activeBook.format === 'pdf' && <button ref={ocrReadingToggleRef} className="reader-rail-button" data-testid="ocr-reading-toggle" type="button" aria-label={copy('ocrReading.title')} title={copy('ocrReading.title')} aria-pressed={ocrReadingOpen} disabled={bookState !== 'ready'}
            onClick={() => { if (ocrReadingOpen) closeOcrReader(); else { adapterRef.current?.clearSelection(); setSelection(null); setOcrReadingOpen(true) } }}><FileText size={19} /></button>}
          <button className="reader-rail-button" data-testid="reader-settings-button" type="button" aria-label={copy(activeBook.format === 'pdf' ? 'reader.displayButton' : 'reader.layoutButton')} title={copy(activeBook.format === 'pdf' ? 'reader.displayButton' : 'reader.layoutButton')} aria-expanded={activeBook.format === 'pdf' ? pdfDisplayOpen : undefined} onClick={(event) => { if (activeBook.format === 'pdf') setPdfDisplayOpen((open) => !open); else openSettings('reading', event.currentTarget) }}>{activeBook.format === 'pdf' ? <PanelTop size={19} /> : <SlidersHorizontal size={19} />}</button>
          <button className="reader-rail-button" data-testid="book-details-button" type="button" aria-label={copy('bookDetails.openAria', { title: activeBook.title })} title={copy('bookDetails.openAria', { title: activeBook.title })} onClick={(event) => openBookDetails(activeBook, event.currentTarget)}><Info size={19} /></button>
        </div>
        <button className="reader-rail-button reader-return" data-testid="reader-return-button" type="button" aria-label={copy('reader.returnToReading')} title={copy('reader.returnToReading')} hidden={bookState !== 'ready' || !naturalLocator || currentLocator === naturalLocator} onClick={() => void returnToReading()}><Undo2 size={19} /></button>
      </nav>}

      <main className="reader-column" inert={page !== 'reading'} data-current-chapter-title={currentChapterTitle}>
        <section ref={readerSurfaceRef} className={`reader-surface is-${bookState}`} data-paper-theme={effectivePaperTheme}>
          <div className="reader-host" data-testid="reader-host" ref={hostRef} inert={ocrReadingOpen && page === 'reading'} aria-hidden={ocrReadingOpen && page === 'reading'} aria-label={copy('reader.areaAria')} />
          {ocrReadingOpen && page === 'reading' && activeBook?.format === 'pdf' && bookState === 'ready' && <OcrPageReader
            key={`${activeBook.id}:${pdfPageFromLocator(currentLocator)}:${analysis.states[activeBook.id]?.document?.jobId}:${analysis.states[activeBook.id]?.document?.status}`}
            bookId={activeBook.id} pageNumber={pdfPageFromLocator(currentLocator)} onSelection={setSelection} onNavigate={navigateOcrPage} onClose={() => closeOcrReader()}
            onPrepare={() => { closeOcrReader(false); openPreparation(activeBook.id, ocrReadingToggleRef.current ?? undefined) }} />}

          {!activeBook && libraryState !== 'loading' && (
            libraryState === 'ready' && books.length === 0 ? (
              <div className="reader-overlay welcome-state is-empty" aria-label={copy('reader.emptyAria')} data-testid="welcome-state">
                <div className="welcome-symbol" aria-hidden="true"><BookOpen size={28} /></div>
                <h2>{copy('reader.welcomeTitle')}</h2>
                <p>{copy('reader.welcomeDetail')}</p>
                <button
                  className="primary-button welcome-import"
                  data-testid="welcome-import"
                  type="button"
                  onClick={(event) => void importBooks(event.currentTarget)}
                  disabled={importing}
                >
                  {importing ? <LoaderCircle className="spin" size={15} /> : <Import size={15} />}
                  {importing ? copy('library.importing') : copy('library.import')}
                </button>
              </div>
            ) : (
              <div className="reader-overlay welcome-state" aria-label={copy('reader.emptyAria')}><span className="visually-hidden">{copy('reader.emptyText')}</span></div>
            )
          )}

          {bookState === 'loading' && (
            <div className="reader-overlay loading-state">
              <LoaderCircle className="spin" size={25} />
              <strong>{copy('reader.opening', { title: activeBook?.title ?? '' })}</strong>
              <span>{copy('reader.openingDetail')}</span>
            </div>
          )}

          {bookState === 'error' && (
            <div className="reader-overlay error-state">
              <div className="empty-icon is-error"><AlertCircle size={22} /></div>
              <strong>{copy('reader.openFailedTitle')}</strong>
              <p>{bookError}</p>
              {activeBook && <button className="secondary-button" type="button" onClick={() => void openBook(activeBook)}><RefreshCw size={15} />{copy('reader.openAgain')}</button>}
            </div>
          )}

          {selection && bookState === 'ready' && (
            <div
              className="selection-toolbar"
              ref={selectionToolbarRef}
              data-testid="selection-toolbar"
              role="toolbar"
              aria-label={copy('assistant.selectionToolbarAria')}
              onMouseDown={(event) => event.preventDefault()}
            >
              <span className="selection-spark"><Sparkles size={15} /></span>
              {isPdfImageRegion(selection) ? <>
                <button data-testid="action-visual-explain" type="button" onClick={() => handleSelectionAction('explain')}><Sparkles size={15} />{copy('visual.explain')}</button>
                <button data-testid="action-visual-ask" type="button" onClick={() => handleSelectionAction('ask')}><MessageSquareText size={15} />{copy('visual.ask')}</button>
              </> : <>
                <button data-testid="action-explain" data-icon={assistantActions.explain.icon} type="button" title={assistantActions.explain.label} onClick={() => handleSelectionAction('explain')}><AssistantActionIconView icon={assistantActions.explain.icon} size={15} />{assistantActions.explain.label}</button>
                <button data-testid="action-context" data-icon={assistantActions.context.icon} type="button" title={assistantActions.context.label} onClick={() => handleSelectionAction('context')}><AssistantActionIconView icon={assistantActions.context.icon} size={15} />{assistantActions.context.label}</button>
                <button data-testid="action-ask" data-icon={assistantActions.ask.icon} type="button" title={assistantActions.ask.label} onClick={() => handleSelectionAction('ask')}><AssistantActionIconView icon={assistantActions.ask.icon} size={15} />{assistantActions.ask.label}</button>
                <button data-testid="action-save-highlight" type="button" onClick={() => void saveSelectionHighlight()}><Bookmark size={15} />{copy('assistant.actionSaveHighlight')}</button>
              </>}
              <button className="toolbar-close" type="button" onClick={() => { adapterRef.current?.clearSelection(); setSelection(null) }} aria-label={copy('assistant.selectionCloseAria')}><X size={14} /></button>
            </div>
          )}
        </section>
      </main>

      <aside className="right-sidebar" data-testid="ai-panel" inert={page !== 'reading' || Boolean(sidebarTab && changingSessions.includes(sidebarTab.id))}>
        <header className="assistant-header">
          <div className="assistant-title"><span><Sparkles size={16} /></span><strong>{copy('assistant.title')}</strong></div>
          <div className="assistant-header-actions">
            {!assistantDialogOpen && sidebarTab?.kind === 'live' && <RecentConversations
              key={`${sidebarTab.id}:${sidebarTab.conversationId}`} currentId={sidebarTab.conversationId}
              disabled={!loadedSessions.has(sidebarTab.bookId) || Boolean(streamingRequestId(sidebarTab)) || changingSessions.includes(sidebarTab.id)}
              onList={() => listRecentConversations(sidebarTab)}
              onRestore={(conversationId) => restoreRecentConversation(sidebarTab, conversationId)} />}
            <button ref={assistantExpandButtonRef} className="icon-button" data-testid="assistant-expand-button" type="button" aria-label={copy('assistant.expandDialog')} title={copy('assistant.expandDialog')} onClick={() => {
              if (sidebarTab) focusConversationTab(sidebarTab.id)
              else if (activeBook) focusConversationTab(ensureLiveTab(activeBook))
              setAssistantDialogOpen(true)
            }}><Maximize2 size={17} /></button>
          </div>
        </header>

        {!assistantDialogOpen && (
          <ConversationPane
            scope={sidebarTab?.scope}
            controls={<AssistantContextControls tab={sidebarTab} state={sidebarTab ? analysis.states[sidebarTab.bookId] : undefined} busy={Boolean(streamingRequestId(sidebarTab)) || Boolean(sidebarTab && changingSessions.includes(sidebarTab.id))} onScope={(scope) => { if (sidebarTab) void changeConversationScope(sidebarTab, scope) }} />}
            composerControls={sidebarTab && (sidebarTab.kind !== 'live' || loadedSessions.has(sidebarTab.bookId)) && <>{webSearchControl(sidebarTab)}<PersonaSessionControl key={`${sidebarTab.id}:${sidebarTab.conversationId}`} persona={sidebarTab.persona} settings={personaSettings}
              onChange={(persona) => changeSessionPersona(sidebarTab, persona)} onSaveAs={(persona) => saveSessionPersonaAs(sidebarTab, persona)} /></>}
            conversationSelection={sidebarTab?.selection ?? null}
            turns={sidebarTab?.turns ?? []}
            provider={provider}
            activeRequestId={streamingRequestId(sidebarTab)}
            draft={sidebarTab?.draft ?? ''}
            canAsk={canAskSidebar}
            {...resolveProps(sidebarTab)}
            onResolve={(trigger) => resolveBlocker(sidebarTab, trigger)}
            followupRef={followupRef}
            onDraftChange={(value) => {
              if (sidebarTab) updateConversationTab(sidebarTab.id, (tab) => ({ ...tab, draft: value }))
            }}
            onNavigate={(anchor, chapterTitle) => void navigateToAnchor(anchor, false, chapterTitle)}
            onSave={(turn) => {
              if (sidebarTab) void saveTurn(sidebarTab.id, turn)
            }}
            showSave={sidebarTab?.kind === 'live'}
            onCancel={() => void cancelRequest(streamingRequestId(sidebarTab))}
            onRegenerate={(turnId) => { if (sidebarTab) regenerateTurn(sidebarTab, turnId) }}
            onEditQuestion={(turnId) => { if (sidebarTab) editTurnQuestion(sidebarTab, turnId) }}
            canRegenerate={canAskSidebar}
            onSubmit={submitSidebarQuestion}
          />
        )}
      </aside>

      {activeBook && page === 'notes' && <BookNotesView key={activeBook.id} book={activeBook} state={analysis.states[activeBook.id]} onNavigate={(anchor, title) => void navigateToAnchor(anchor, false, title)} />}
      {preparationBook && <div className="modal-backdrop preparation-backdrop" hidden={settingsOpen} onMouseDown={(event) => { if (event.target === event.currentTarget) closePreparation() }}>
        <section ref={preparationDialogRef} className="preparation-dialog" data-testid="book-preparation-dialog" role="dialog" aria-modal="true" aria-labelledby="preparation-title">
          <header className="modal-header"><div><h2 id="preparation-title">{copy('preparation.title')}</h2><p title={preparationBook.title}>{preparationBook.title}</p></div><button className="icon-button" type="button" data-testid="preparation-close" aria-label={copy('preparation.close')} onClick={closePreparation}><X size={18} /></button></header>
          <BookAnalysisControls key={preparationBook.id} book={preparationBook} state={analysis.states[preparationBook.id]} error={analysis.errors[preparationBook.id]} profiles={providerOverview} suspended={settingsOpen}
            onStart={(profileId, rebuild) => analysis.start(preparationBook.id, profileId, rebuild)} onCancel={() => void analysis.cancel(preparationBook.id)}
            onPrepare={(rebuild) => analysis.prepare(preparationBook.id, rebuild)} onCancelPreparation={() => void analysis.cancelPreparation(preparationBook.id)} onConfigure={openSettings} />
        </section>
      </div>}
      {selectionDraft && <PdfSelectionReviewDialog draft={selectionDraft} />}
      {imageRegionDraft && <PdfImageRegionReviewDialog draft={imageRegionDraft} />}

      {assistantDialogOpen && (
        <div className="modal-backdrop assistant-dialog-backdrop" role="presentation">
          <section ref={assistantDialogRef} className="assistant-dialog" data-testid="assistant-dialog" role="region" aria-labelledby="assistant-dialog-title">
            {assistantDialogView === 'conversation' && <header className="modal-header">
              <div><h2 id="assistant-dialog-title">{copy('workspace.conversation')}</h2></div>
            </header>}
            {(assistantDialogView !== 'insights' || archiveView === 'archived') && <nav className="assistant-workspace-nav" aria-label={copy('assistant.viewsAria')}>
              <div className="assistant-session-tabs" role="tablist" aria-label={copy('assistant.viewsAria')} ref={sessionTabStripRef}>
                {visibleSessionTabs.map((tab) => {
                  const isActive = assistantDialogView === 'conversation' && activeTabId === tab.id
                  const isCurrentLive = tab.kind === 'live' && tab.bookId === activeBook?.id
                  const closable = !isCurrentLive
                  return (
                    <div
                      className={`assistant-session-tab ${isActive ? 'is-active' : ''}${draggingSessionTabId === tab.id ? ' is-dragging' : ''}`}
                      key={tab.id}
                      ref={isActive ? activeSessionTabRef : undefined}
                      draggable
                      onDragStart={(event) => {
                        setDraggingSessionTabId(tab.id)
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', tab.id)
                      }}
                      onDragOver={(event) => {
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'move'
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        const sourceId = event.dataTransfer.getData('text/plain') || draggingSessionTabId
                        setDraggingSessionTabId(null)
                        if (sourceId) moveConversationTab(sourceId, tab.id)
                      }}
                      onDragEnd={() => setDraggingSessionTabId(null)}
                    >
                      <button
                        className="assistant-session-tab-select"
                        data-testid="assistant-session-tab"
                        data-tab-id={tab.id}
                        data-tab-kind={tab.kind}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        title={isCurrentLive ? copy('assistant.tabCurrent') : tab.title}
                        onClick={() => void activateSessionTab(tab.id)}
                      >
                        <span>{isCurrentLive ? copy('assistant.tabCurrent') : tab.title}</span>
                      </button>
                      {closable && (
                        <button
                          className="assistant-session-tab-close"
                          data-testid="assistant-session-tab-close"
                          type="button"
                          aria-label={copy('assistant.closeTab')}
                          onClick={() => closeConversationTab(tab.id)}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
              {assistantDialogView === 'conversation' && (
                <label className="assistant-session-search" data-testid="conversation-search">
                  <Search size={14} />
                  <input
                    data-testid="conversation-search-input"
                    type="search"
                    value={conversationQuery}
                    onChange={(event) => setConversationQuery(event.target.value)}
                    placeholder={copy('assistant.searchConversation')}
                    aria-label={copy('assistant.searchConversation')}
                  />
                  {conversationNeedle && <small data-testid="conversation-search-count">{copy('assistant.searchTurns', { count: conversationMatches })}</small>}
                </label>
              )}
              {assistantDialogView === 'conversation' && activeConversationTab?.kind === 'live' && <RecentConversations
                key={`${activeConversationTab.id}:${activeConversationTab.conversationId}`} currentId={activeConversationTab.conversationId}
                disabled={!loadedSessions.has(activeConversationTab.bookId) || Boolean(streamingRequestId(activeConversationTab)) || changingSessions.includes(activeConversationTab.id)}
                onList={() => listRecentConversations(activeConversationTab)}
                onRestore={(conversationId) => restoreRecentConversation(activeConversationTab, conversationId)} />}
              {assistantDialogView === 'conversation' && activeConversationTab?.kind === 'live' && (activeConversationTab.turns.length > 0 || activeConversationTab.draft) && (
                pendingClearSession ? (
                  <span className="assistant-session-clear is-confirming">
                    <span>{copy('assistant.clearSessionQuestion')}</span>
                    <button data-testid="conversation-clear-confirm" type="button" disabled={changingSessions.includes(activeConversationTab.id)} onClick={() => clearLiveSession(activeConversationTab)}>{copy('common.confirm')}</button>
                    <button data-testid="conversation-clear-cancel" type="button" onClick={() => setPendingClearSession(false)}>{copy('common.back')}</button>
                  </span>
                ) : (
                  <button className="assistant-session-clear" data-testid="conversation-clear" type="button" onClick={() => setPendingClearSession(true)}>{copy('assistant.clearSession')}</button>
                )
              )}
            </nav>}
            <div className="assistant-dialog-body" inert={assistantDialogView === 'conversation' && Boolean(activeConversationTab && changingSessions.includes(activeConversationTab.id))}>
              {assistantDialogView === 'insights' ? (archiveView === 'workbenches' ? <WorkbenchesView
                controller={workbenches} books={books} coverCache={coverCache} states={analysis.states} refresh={analysis.refresh} provider={provider} personas={personaSettings} webSearchEnabled={webSearchEnabled} onSavePersonaAs={savePersonaAs} onArchiveViewChange={setArchiveView}
                onPrepare={(id) => openPreparation(id)} onNavigate={(id, anchor, title) => void navigateWorkbenchSource(id, anchor, title)} onConfigure={(trigger) => openSettings('model', trigger)} /> :
                <InsightsView
                  viewSwitch={<ArchiveViewSwitch value={archiveView} onChange={setArchiveView} />}
                  insights={insights}
                  loading={insightsLoading}
                  error={insightsError}
                  onRetry={() => void refreshInsights()}
                  activeBookId={activeBook?.id ?? null}
                  pendingDeleteInsightId={pendingDeleteInsightId}
                  exporting={exportingInsights}
                  onOpenInsight={(insight) => void openInsight(insight)}
                  onRequestDeleteInsight={(id) => setPendingDeleteInsightId(id)}
                  onDeleteInsight={(id) => void deleteInsight(id)}
                  onCancelDeleteInsight={() => setPendingDeleteInsightId(null)}
                  onExportInsights={(scope) => void handleExportInsights(scope)}
                />
              ) : activeConversationTab ? (
                <ConversationPane
                  scope={activeConversationTab.scope}
                  scopeControls={<AssistantScopeControls tab={activeConversationTab} busy={Boolean(streamingRequestId(activeConversationTab)) || changingSessions.includes(activeConversationTab.id)} onScope={(scope) => void changeConversationScope(activeConversationTab, scope)} />}
                  composerControls={<>
                    {(activeConversationTab.kind !== 'live' || loadedSessions.has(activeConversationTab.bookId)) && webSearchControl(activeConversationTab)}
                    {(activeConversationTab.kind !== 'live' || loadedSessions.has(activeConversationTab.bookId)) && <PersonaSessionControl key={`${activeConversationTab.id}:${activeConversationTab.conversationId}`} persona={activeConversationTab.persona} settings={personaSettings}
                      onChange={(persona) => changeSessionPersona(activeConversationTab, persona)} onSaveAs={(persona) => saveSessionPersonaAs(activeConversationTab, persona)} />}</>}
                  conversationSelection={activeConversationTab.selection}
                  turns={activeConversationTab.turns}
                  provider={provider}
                  activeRequestId={streamingRequestId(activeConversationTab)}
                  draft={activeConversationTab.draft}
                  canAsk={canAskWorkbench}
                  {...resolveProps(activeConversationTab, true)}
                  onResolve={(trigger) => resolveBlocker(activeConversationTab, trigger)}
                  followupRef={followupRef}
                  onDraftChange={(value) => updateConversationTab(activeConversationTab.id, (tab) => ({ ...tab, draft: value }))}
                  onNavigate={(anchor, chapterTitle) => void navigateToAnchor(anchor, false, chapterTitle)}
                  onSave={activeConversationTab.kind === 'live' ? (turn) => void saveTurn(activeConversationTab.id, turn) : undefined}
                  showSave={activeConversationTab.kind === 'live'}
                  onRegenerate={(turnId) => regenerateTurn(activeConversationTab, turnId)}
                  onEditQuestion={(turnId) => editTurnQuestion(activeConversationTab, turnId)}
                  canRegenerate={canAskWorkbench}
                  searchNeedle={conversationNeedle}
                  onCancel={() => void cancelRequest(streamingRequestId(activeConversationTab))}
                  onSubmit={submitActiveQuestion}
                />
              ) : (
                <div className="assistant-dialog-empty">
                  <EmptyState icon={<Sparkles size={21} />} title={copy('assistant.emptyTitle')} detail={copy('assistant.emptyDetail')} />
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {settingsOpen && (
        <SettingsModal
          initialOverview={providerOverview}
          initialSection={settingsInitialSection}
          initialService={settingsInitialService}
          themePreference={themePreference}
          interfaceScale={interfaceScale}
          uiLanguage={uiLanguage}
          readingPreferences={readingPreferences}
          textReading={activeBook?.format === 'txt' && bookState === 'ready' ? { mode: textReadingMode, rendering: textRendering, onChange: (mode) => void changeTextReadingMode(mode) } : undefined}
          paperThemePreference={paperThemePreference}
          assistantActions={assistantActions}
          personaSettings={personaSettings}
          onWebSearchChange={setWebSearchEnabled}
          returnFocusRef={settingsReturnFocusRef}
          onClose={closeSettings}
          onOverviewChange={handleProviderOverviewChange}
          onThemeChange={setThemePreference}
          onInterfaceScaleChange={setInterfaceScale}
          onUiLanguageChange={changeUiLanguage}
          onReadingPreferencesChange={setReadingPreferences}
          onPaperThemePreferenceChange={setPaperThemePreference}
          onAssistantActionsChange={setAssistantActions}
          onPersonaSettingsChange={changePersonaSettings}
          pushToast={pushToast}
        />
      )}

      {detailsBook && (
        <BookDetailsModal
          key={`details:${detailsBook.id}`}
          book={detailsBook}
          returnFocusRef={detailsReturnFocusRef}
          deleting={deletingBookId === detailsBook.id}
          onClose={closeBookDetails}
          onDelete={(book) => void deleteBook(book)}
        />
      )}

      {importDialogState && (
        <BookImportDialog
          state={importDialogState}
          returnFocusRef={importReturnFocusRef}
          onCancel={() => void cancelBookImport()}
          onClose={closeBookImportDialog}
        />
      )}

      {dropOverlay && (
        <div
          className={`book-drop-overlay is-${dropOverlay}`}
          data-testid="book-drop-overlay"
          role="status"
          aria-live="polite"
        >
          <div>
            {dropOverlay === 'busy' ? <LoaderCircle className="spin" size={28} /> : <Import size={28} />}
            <strong>{copy(dropOverlay === 'busy' ? 'library.dropBusyTitle' : 'library.dropTitle')}</strong>
            <p>{copy(dropOverlay === 'busy' ? 'library.dropBusyDetail' : 'library.dropDetail')}</p>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast is-${toast.tone}`} key={toast.id} role="status">
          {toast.tone === 'success' ? <Check size={16} /> : toast.tone === 'error' ? <AlertCircle size={16} /> : <Sparkles size={16} />}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
    </>
  )
}
