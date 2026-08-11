import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronRight,
  CircleStop,
  FileText,
  Highlighter,
  Import,
  Library,
  LoaderCircle,
  MessageSquareText,
  MoreHorizontal,
  PanelLeftClose,
  RefreshCw,
  Save,
  SearchX,
  Send,
  Settings,
  Sparkles,
  Unplug,
  X
} from 'lucide-react'
import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type {
  BookRecord,
  LlmAction,
  LlmEvent,
  LlmUsage,
  ProviderSettings,
  SavedInsight,
  SelectionContext,
  TocItem
} from '@shared/contracts'
import { createReaderAdapter, type ReaderAdapter } from './readers'

type LeftView = 'library' | 'toc'
type RightView = 'assistant' | 'insights'
type LoadState = 'idle' | 'loading' | 'ready' | 'error'
type TurnStatus = 'streaming' | 'completed' | 'error'

interface ConversationTurn {
  id: string
  requestId: string
  action: LlmAction
  question: string
  answer: string
  model: string
  status: TurnStatus
  usage?: LlmUsage
  error?: string
  saved?: boolean
}

interface ToastState {
  id: number
  tone: 'success' | 'error' | 'neutral'
  message: string
}

const ACTION_QUESTIONS: Record<Exclude<LlmAction, 'ask'>, string> = {
  explain: '请用清晰、准确的语言解释这段内容。',
  context: '请结合本章上下文说明这段内容的含义与作用。'
}

const EMPTY_PROVIDER: ProviderSettings = {
  baseUrl: 'https://api.openai.com',
  model: '',
  hasApiKey: false
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function readableError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
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

function actionLabel(action: LlmAction): string {
  if (action === 'explain') return '解释这段'
  if (action === 'context') return '联系上下文'
  return '自由提问'
}

function ProgressRing({ value }: { value: number }): ReactNode {
  const normalized = Math.max(0, Math.min(1, value || 0))
  return (
    <span
      className="progress-ring"
      style={{ '--progress': `${normalized * 360}deg` } as CSSProperties}
      aria-label={`阅读进度 ${Math.round(normalized * 100)}%`}
      title={`${Math.round(normalized * 100)}%`}
    >
      <span />
    </span>
  )
}

function EmptyState({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action?: ReactNode }): ReactNode {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">{icon}</div>
      <strong>{title}</strong>
      <p>{detail}</p>
      {action}
    </div>
  )
}

function CitationText({
  text,
  selection,
  onNavigate
}: {
  text: string
  selection: SelectionContext
  onNavigate: (anchor: string) => void
}): ReactNode {
  const passages = useMemo(() => new Map(selection.passages.map((passage) => [passage.id, passage.anchor])), [selection])
  const lines = text.split('\n')

  return (
    <div className="answer-text">
      {lines.map((line, lineIndex) => {
        const parts = line.split(/(\[P\d+\])/g)
        return (
          <p key={`${lineIndex}-${line.slice(0, 10)}`}>
            {parts.map((part, partIndex) => {
              const match = /^\[(P\d+)\]$/.exec(part)
              if (!match) return <span key={partIndex}>{part}</span>
              const passageId = match[1]
              const anchor = passages.get(passageId)
              if (!anchor) {
                return (
                  <span className="citation citation-unknown" title="该引用不在本次上下文中" key={partIndex}>
                    {part}<small>未验证</small>
                  </span>
                )
              }
              return (
                <button
                  className="citation citation-valid"
                  key={partIndex}
                  type="button"
                  title={`跳转到 ${passageId}`}
                  onClick={() => onNavigate(anchor)}
                >
                  {part}
                </button>
              )
            })}
          </p>
        )
      })}
    </div>
  )
}

function SettingsModal({
  initial,
  onClose,
  onSaved,
  pushToast
}: {
  initial: ProviderSettings
  onClose: () => void
  onSaved: (settings: ProviderSettings) => void
  pushToast: (message: string, tone?: ToastState['tone']) => void
}): ReactNode {
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl)
  const [model, setModel] = useState(initial.model)
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const keyRef = useRef<HTMLInputElement>(null)

  const persist = async (): Promise<ProviderSettings> => {
    const key = keyRef.current?.value.trim()
    const saved = await window.readerApi.saveProviderSettings({
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      ...(key ? { apiKey: key } : {})
    })
    if (keyRef.current) keyRef.current.value = ''
    onSaved(saved)
    return saved
  }

  const handleSave = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy('save')
    setStatus(null)
    try {
      await persist()
      pushToast('模型设置已安全保存', 'success')
      onClose()
    } catch (error) {
      setStatus({ ok: false, message: readableError(error, '保存失败，请检查输入。') })
    } finally {
      setBusy(null)
    }
  }

  const handleTest = async (): Promise<void> => {
    setBusy('test')
    setStatus(null)
    try {
      await persist()
      const result = await window.readerApi.testProvider()
      setStatus(result)
      if (result.ok) pushToast('模型连接正常', 'success')
    } catch (error) {
      setStatus({ ok: false, message: readableError(error, '连接失败，请检查地址、模型与密钥。') })
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings-modal" data-testid="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="modal-header">
          <div>
            <span className="eyebrow">模型连接</span>
            <h2 id="settings-title">设置你的 AI 服务</h2>
          </div>
          <button className="icon-button" data-testid="settings-close" type="button" onClick={onClose} aria-label="关闭设置">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSave}>
          <label className="field-label" htmlFor="provider-base-url">Base URL</label>
          <input
            id="provider-base-url"
            data-testid="provider-base-url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.openai.com"
            spellCheck={false}
            required
          />
          <p className="field-hint">应用会请求此地址下的 <code>/v1/chat/completions</code>。</p>

          <label className="field-label" htmlFor="provider-model">Model</label>
          <input
            id="provider-model"
            data-testid="provider-model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="例如 gpt-5-mini"
            spellCheck={false}
            required
          />

          <div className="label-row">
            <label className="field-label" htmlFor="provider-api-key">API Key</label>
            {initial.hasApiKey && <span className="saved-key"><Check size={12} /> 已安全保存</span>}
          </div>
          <input
            id="provider-api-key"
            data-testid="provider-api-key"
            ref={keyRef}
            type="password"
            autoComplete="off"
            placeholder={initial.hasApiKey ? '留空以继续使用已保存的密钥' : '输入 API Key'}
          />
          <p className="field-hint">密钥只交给主进程加密保存，不写入书库数据库。</p>

          {status && (
            <div className={`provider-status ${status.ok ? 'is-success' : 'is-error'}`} data-testid="provider-status" role="status">
              {status.ok ? <Check size={16} /> : <AlertCircle size={16} />}
              <span>{status.message}</span>
            </div>
          )}

          <footer className="modal-actions">
            <button
              className="secondary-button"
              data-testid="provider-test"
              type="button"
              disabled={busy !== null || !baseUrl.trim() || !model.trim()}
              onClick={handleTest}
            >
              {busy === 'test' ? <LoaderCircle className="spin" size={16} /> : <Unplug size={16} />}
              测试连接
            </button>
            <button
              className="primary-button"
              data-testid="provider-save"
              type="submit"
              disabled={busy !== null || !baseUrl.trim() || !model.trim()}
            >
              {busy === 'save' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
              保存设置
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}

export default function App(): ReactNode {
  const [books, setBooks] = useState<BookRecord[]>([])
  const [activeBook, setActiveBook] = useState<BookRecord | null>(null)
  const [bookState, setBookState] = useState<LoadState>('idle')
  const [bookError, setBookError] = useState('')
  const [libraryState, setLibraryState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [libraryError, setLibraryError] = useState('')
  const [importing, setImporting] = useState(false)
  const [toc, setToc] = useState<TocItem[]>([])
  const [leftView, setLeftView] = useState<LeftView>('library')
  const [rightView, setRightView] = useState<RightView>('assistant')
  const [selection, setSelection] = useState<SelectionContext | null>(null)
  const [conversationSelection, setConversationSelection] = useState<SelectionContext | null>(null)
  const [turns, setTurns] = useState<ConversationTurn[]>([])
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [insights, setInsights] = useState<SavedInsight[]>([])
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [provider, setProvider] = useState<ProviderSettings>(EMPTY_PROVIDER)
  const [toast, setToast] = useState<ToastState | null>(null)

  const hostRef = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<ReaderAdapter | null>(null)
  const activeBookRef = useRef<BookRecord | null>(null)
  const activeRequestRef = useRef<string | null>(null)
  const openSequenceRef = useRef(0)
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastProgressFlushRef = useRef(0)
  const closingRef = useRef(false)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingProgressRef = useRef<{ bookId: string; locator: string; progress: number } | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const followupRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    activeBookRef.current = activeBook
  }, [activeBook])

  useEffect(() => {
    activeRequestRef.current = activeRequestId
  }, [activeRequestId])

  const pushToast = useCallback((message: string, tone: ToastState['tone'] = 'neutral'): void => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ id: Date.now(), tone, message })
    toastTimerRef.current = setTimeout(() => setToast(null), 3200)
  }, [])

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
      setLibraryError(readableError(error, '无法读取本地书库。'))
      return []
    }
  }, [])

  const refreshInsights = useCallback(async (bookId: string): Promise<void> => {
    setInsightsLoading(true)
    try {
      const records = await window.readerApi.listInsights(bookId)
      if (activeBookRef.current?.id === bookId) setInsights(records)
    } catch (error) {
      pushToast(readableError(error, '无法读取收藏。'), 'error')
    } finally {
      setInsightsLoading(false)
    }
  }, [pushToast])

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
    if (hostRef.current) hostRef.current.replaceChildren()
  }, [flushProgress])

  const openBook = useCallback(async (book: BookRecord): Promise<void> => {
    const sequence = ++openSequenceRef.current
    const previousRequest = activeRequestRef.current
    if (previousRequest) {
      activeRequestRef.current = null
      void window.readerApi.cancelLlm(previousRequest).catch(() => undefined)
    }
    destroyReader()
    setActiveBook(book)
    activeBookRef.current = book
    setBookState('loading')
    setBookError('')
    setSelection(null)
    setConversationSelection(null)
    setTurns([])
    setActiveRequestId(null)
    activeRequestRef.current = null
    setToc([])
    setInsights([])

    try {
      const payload = await window.readerApi.readBook(book.id)
      if (sequence !== openSequenceRef.current || !hostRef.current) return
      const adapter = createReaderAdapter(book.format, hostRef.current, {
        bookId: book.id,
        onRelocated: ({ locator, progress }) => scheduleProgress(book.id, locator, progress),
        onSelectionChanged: setSelection
      })
      adapterRef.current = adapter
      const result = await adapter.open(payload.bytes, book.lastLocator)
      if (sequence !== openSequenceRef.current) {
        adapter.destroy()
        return
      }
      setToc(result.toc)
      setBookState('ready')
      setLeftView('toc')
      void refreshInsights(book.id)

      const nextTitle = result.metadata.title.trim() || book.title
      const nextAuthor = result.metadata.author?.trim() || null
      if (nextTitle !== book.title || nextAuthor !== book.author) {
        try {
          const updated = await window.readerApi.updateBookMetadata(book.id, nextTitle, nextAuthor)
          setActiveBook(updated)
          activeBookRef.current = updated
          setBooks((current) => current.map((item) => item.id === updated.id ? updated : item))
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
      setBookError(readableError(error, '无法打开这本书。文件可能已损坏或包含 DRM。'))
    }
  }, [destroyReader, refreshInsights, scheduleProgress])

  useEffect(() => {
    let alive = true
    const initialize = async (): Promise<void> => {
      if (!window.readerApi) {
        setLibraryState('error')
        setLibraryError('应用安全桥接未能加载。请重新启动 LLM Reader。')
        return
      }
      const [, settings] = await Promise.all([
        refreshBooks(),
        window.readerApi.getProviderSettings().catch(() => EMPTY_PROVIDER)
      ])
      if (!alive) return
      setProvider(settings)
    }
    void initialize()
    return () => {
      alive = false
      openSequenceRef.current += 1
      const requestId = activeRequestRef.current
      if (requestId) void window.readerApi.cancelLlm(requestId).catch(() => undefined)
      destroyReader()
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [destroyReader, refreshBooks])

  useEffect(() => {
    if (!window.readerApi) return undefined
    return window.readerApi.onLlmEvent((event: LlmEvent) => {
      setTurns((current) => current.map((turn) => {
        if (turn.requestId !== event.requestId) return turn
        if (event.type === 'delta') return { ...turn, answer: turn.answer + event.delta }
        if (event.type === 'usage') return { ...turn, usage: event.usage }
        if (event.type === 'completed') return { ...turn, model: event.model, status: 'completed' }
        return { ...turn, status: 'error', error: event.message }
      }))
      if (event.type === 'completed' || event.type === 'error') {
        if (activeRequestRef.current === event.requestId) {
          activeRequestRef.current = null
          setActiveRequestId(null)
        }
      }
    })
  }, [])

  useEffect(() => {
    if (!window.readerApi) return undefined
    return window.readerApi.onBeforeClose(async () => {
      closingRef.current = true
      if (progressTimerRef.current) {
        clearTimeout(progressTimerRef.current)
        progressTimerRef.current = null
      }
      await flushProgress()
    })
  }, [flushProgress])

  const importBook = useCallback(async (): Promise<void> => {
    if (importing) return
    setImporting(true)
    try {
      const result = await window.readerApi.importBook()
      if (!result) return
      await refreshBooks()
      pushToast(result.duplicate ? '这本书已在书库中，已为你打开。' : '书籍已导入本地书库。', result.duplicate ? 'neutral' : 'success')
      await openBook(result.book)
    } catch (error) {
      pushToast(readableError(error, '导入失败。仅支持无 DRM 的 EPUB 与 UTF-8 TXT。'), 'error')
    } finally {
      setImporting(false)
    }
  }, [importing, openBook, pushToast, refreshBooks])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        void importBook()
      }
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault()
        setSettingsOpen(true)
      }
      if (event.key === 'Escape' && !settingsOpen) setSelection(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [importBook, settingsOpen])

  const startRequest = useCallback(async (action: LlmAction, question: string, sourceSelection?: SelectionContext): Promise<void> => {
    const context = sourceSelection ?? conversationSelection ?? selection
    const cleanQuestion = question.trim()
    if (!context || !cleanQuestion || activeRequestRef.current) return

    const newContext = !conversationSelection || conversationSelection.anchor !== context.anchor
    const priorTurns = newContext ? [] : turns.filter((turn) => turn.status === 'completed' && turn.answer)
    const requestId = createId()
    const turn: ConversationTurn = {
      id: createId(),
      requestId,
      action,
      question: cleanQuestion,
      answer: '',
      model: '',
      status: 'streaming'
    }

    setConversationSelection(context)
    setTurns(newContext ? [turn] : [...turns, turn])
    setSelection(null)
    setDraft('')
    setRightView('assistant')
    setActiveRequestId(requestId)
    activeRequestRef.current = requestId

    try {
      await window.readerApi.startLlm({
        requestId,
        action,
        question: cleanQuestion,
        selection: context,
        history: priorTurns.flatMap((item) => [
          { role: 'user' as const, content: item.question },
          { role: 'assistant' as const, content: item.answer }
        ])
      })
    } catch (error) {
      const message = readableError(error, '请求未能启动，请检查模型设置。')
      setTurns((current) => current.map((item) => item.requestId === requestId ? { ...item, status: 'error', error: message } : item))
      activeRequestRef.current = null
      setActiveRequestId(null)
    }
  }, [conversationSelection, selection, turns])

  const handleSelectionAction = (action: LlmAction): void => {
    if (!selection) return
    if (action === 'ask') {
      const isNew = !conversationSelection || conversationSelection.anchor !== selection.anchor
      setConversationSelection(selection)
      if (isNew) setTurns([])
      setRightView('assistant')
      setSelection(null)
      window.setTimeout(() => followupRef.current?.focus(), 0)
      return
    }
    void startRequest(action, ACTION_QUESTIONS[action], selection)
  }

  const cancelRequest = async (): Promise<void> => {
    const requestId = activeRequestRef.current
    if (!requestId) return
    try {
      await window.readerApi.cancelLlm(requestId)
    } finally {
      setTurns((current) => current.map((turn) => turn.requestId === requestId ? {
        ...turn,
        status: 'error',
        error: turn.answer ? '已停止生成' : '请求已取消'
      } : turn))
      activeRequestRef.current = null
      setActiveRequestId(null)
    }
  }

  const submitQuestion = (event: FormEvent): void => {
    event.preventDefault()
    if (!conversationSelection || !draft.trim()) return
    void startRequest('ask', draft)
  }

  const handleComposerKey = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  const navigateToAnchor = useCallback(async (anchor: string): Promise<void> => {
    const adapter = adapterRef.current
    if (!adapter) return
    try {
      await adapter.goTo(anchor)
      await adapter.highlight(anchor)
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
      highlightTimerRef.current = setTimeout(() => {
        adapter.clearHighlight()
        highlightTimerRef.current = null
      }, 2_800)
    } catch (error) {
      pushToast(readableError(error, '无法跳转到这处原文。'), 'error')
    }
  }, [pushToast])

  const saveTurn = async (turn: ConversationTurn): Promise<void> => {
    if (!activeBook || !conversationSelection || turn.status !== 'completed' || !turn.answer || turn.saved) return
    try {
      await window.readerApi.saveInsight({
        bookId: activeBook.id,
        selection: conversationSelection,
        question: turn.question,
        answer: turn.answer,
        model: turn.model || provider.model
      })
      setTurns((current) => current.map((item) => item.id === turn.id ? { ...item, saved: true } : item))
      await refreshInsights(activeBook.id)
      pushToast('已收藏，并保留原文位置。', 'success')
    } catch (error) {
      pushToast(readableError(error, '收藏失败。'), 'error')
    }
  }

  const canAsk = Boolean(conversationSelection && !activeRequestId)
  const selectedPassageCount = conversationSelection?.passages.length ?? 0

  return (
    <div className="app-shell" data-testid="app-shell">
      <aside className="left-sidebar">
        <header className="brand-row">
          <div className="brand-mark"><BookOpen size={19} strokeWidth={2.2} /></div>
          <div className="brand-copy">
            <strong>LLM Reader</strong>
            <span>专注理解，不离开原文</span>
          </div>
        </header>

        <button className="import-button" data-testid="import-book" type="button" onClick={() => void importBook()} disabled={importing}>
          {importing ? <LoaderCircle className="spin" size={17} /> : <Import size={17} />}
          {importing ? '正在导入…' : '导入 EPUB / TXT'}
          <kbd>Ctrl O</kbd>
        </button>

        <nav className="sidebar-tabs" aria-label="书籍导航">
          <button className={leftView === 'library' ? 'is-active' : ''} type="button" onClick={() => setLeftView('library')}>
            <Library size={15} />书库<span>{books.length}</span>
          </button>
          <button className={leftView === 'toc' ? 'is-active' : ''} type="button" onClick={() => setLeftView('toc')} disabled={!activeBook}>
            <PanelLeftClose size={15} />目录
          </button>
        </nav>

        <div className="sidebar-content">
          {leftView === 'library' && (
            <div className="library-list" data-testid="library-list">
              {libraryState === 'loading' && (
                <div className="sidebar-loading"><LoaderCircle className="spin" size={17} /> 正在读取书库</div>
              )}
              {libraryState === 'error' && (
                <EmptyState
                  icon={<AlertCircle size={20} />}
                  title="书库暂不可用"
                  detail={libraryError}
                  action={<button className="text-button" type="button" onClick={() => void refreshBooks()}><RefreshCw size={14} />重试</button>}
                />
              )}
              {libraryState === 'ready' && books.length === 0 && (
                <EmptyState icon={<BookOpen size={20} />} title="从一本书开始" detail="导入无 DRM 的 EPUB 或 UTF-8 TXT，书籍只保存在本机。" />
              )}
              {books.map((book) => (
                <button
                  className={`book-item ${activeBook?.id === book.id ? 'is-active' : ''}`}
                  data-testid="book-item"
                  data-book-id={book.id}
                  key={book.id}
                  type="button"
                  onClick={() => void openBook(book)}
                >
                  <span className={`book-cover is-${book.format}`}>
                    {book.format === 'epub' ? <BookOpen size={17} /> : <FileText size={17} />}
                  </span>
                  <span className="book-meta">
                    <strong title={book.title}>{book.title}</strong>
                    <small>{book.author || (book.format === 'epub' ? 'EPUB 电子书' : 'TXT 文档')}</small>
                  </span>
                  <ProgressRing value={book.progress} />
                </button>
              ))}
            </div>
          )}

          {leftView === 'toc' && (
            <div className="toc-list" aria-label="本书目录">
              <div className="section-caption">本书目录</div>
              {bookState === 'loading' && <div className="sidebar-loading"><LoaderCircle className="spin" size={17} /> 正在解析目录</div>}
              {bookState === 'ready' && toc.length === 0 && (
                <EmptyState icon={<SearchX size={20} />} title="没有可用目录" detail="你仍可连续滚动阅读全文。" />
              )}
              {toc.map((item, index) => (
                <button
                  className="toc-item"
                  data-testid="toc-item"
                  data-toc-id={item.id}
                  style={{ '--toc-depth': Math.min(item.depth, 3) } as CSSProperties}
                  key={`${item.id}-${index}`}
                  type="button"
                  onClick={() => void navigateToAnchor(item.href)}
                  title={item.label}
                >
                  <span>{item.label}</span><ChevronRight size={13} />
                </button>
              ))}
            </div>
          )}
        </div>

        <footer className="sidebar-footer">
          <button className="settings-entry" data-testid="settings-button" type="button" onClick={() => setSettingsOpen(true)}>
            <Settings size={16} />
            <span>模型设置</span>
            <i className={provider.hasApiKey && provider.model ? 'is-ready' : ''} />
          </button>
        </footer>
      </aside>

      <main className="reader-column">
        <header className="reader-header">
          {activeBook ? (
            <>
              <div className="reader-heading">
                <span className="format-chip">{activeBook.format.toUpperCase()}</span>
                <div>
                  <h1>{activeBook.title}</h1>
                  <p>{activeBook.author || '未知作者'}</p>
                </div>
              </div>
              <div className="reading-progress">
                <span>阅读进度</span>
                <strong>{Math.round(activeBook.progress * 100)}%</strong>
                <div><i style={{ width: `${Math.max(0, Math.min(100, activeBook.progress * 100))}%` }} /></div>
              </div>
            </>
          ) : (
            <div className="reader-heading is-empty"><span>阅读空间</span></div>
          )}
        </header>

        <section className={`reader-surface is-${bookState}`}>
          <div className="reader-host" data-testid="reader-host" ref={hostRef} aria-label="正文阅读区" />

          {!activeBook && libraryState !== 'loading' && (
            <div className="reader-overlay welcome-state">
              <div className="welcome-symbol"><BookOpen size={32} /></div>
              <span className="eyebrow">LOCAL-FIRST READING</span>
              <h2>把难读的内容，留在原文里读懂</h2>
              <p>导入一本书，选中任意段落即可解释、联系上下文或继续追问。</p>
              <button className="primary-button" type="button" onClick={() => void importBook()}>
                <Import size={16} />导入第一本书
              </button>
              <div className="privacy-note"><Check size={14} />书籍与收藏默认只保存在这台电脑</div>
            </div>
          )}

          {bookState === 'loading' && (
            <div className="reader-overlay loading-state">
              <LoaderCircle className="spin" size={25} />
              <strong>正在打开《{activeBook?.title}》</strong>
              <span>解析内容与上次阅读位置…</span>
            </div>
          )}

          {bookState === 'error' && (
            <div className="reader-overlay error-state">
              <div className="empty-icon is-error"><AlertCircle size={22} /></div>
              <strong>这本书暂时打不开</strong>
              <p>{bookError}</p>
              {activeBook && <button className="secondary-button" type="button" onClick={() => void openBook(activeBook)}><RefreshCw size={15} />重新打开</button>}
            </div>
          )}

          {selection && bookState === 'ready' && (
            <div
              className="selection-toolbar"
              data-testid="selection-toolbar"
              role="toolbar"
              aria-label="选区操作"
              onMouseDown={(event) => event.preventDefault()}
            >
              <span className="selection-spark"><Sparkles size={15} /></span>
              <button data-testid="action-explain" type="button" onClick={() => handleSelectionAction('explain')}><Highlighter size={15} />解释这段</button>
              <button data-testid="action-context" type="button" onClick={() => handleSelectionAction('context')}><BookOpen size={15} />联系上下文</button>
              <button data-testid="action-ask" type="button" onClick={() => handleSelectionAction('ask')}><MessageSquareText size={15} />自由提问</button>
              <button className="toolbar-close" type="button" onClick={() => setSelection(null)} aria-label="关闭选区工具"><X size={14} /></button>
            </div>
          )}
        </section>
      </main>

      <aside className="right-sidebar" data-testid="ai-panel">
        <header className="assistant-header">
          <div className="assistant-title"><span><Sparkles size={16} /></span><strong>阅读助手</strong></div>
          <button className="icon-button" type="button" aria-label="更多选项" title="模型设置" onClick={() => setSettingsOpen(true)}><MoreHorizontal size={18} /></button>
        </header>

        <nav className="assistant-tabs" aria-label="阅读助手视图">
          <button className={rightView === 'assistant' ? 'is-active' : ''} type="button" onClick={() => setRightView('assistant')}>对话</button>
          <button className={rightView === 'insights' ? 'is-active' : ''} data-testid="insights-tab" type="button" onClick={() => setRightView('insights')}>
            收藏{insights.length > 0 && <span>{insights.length}</span>}
          </button>
        </nav>

        {rightView === 'assistant' && (
          <>
            <div className="assistant-scroll">
              {!conversationSelection && turns.length === 0 && (
                <EmptyState
                  icon={<Sparkles size={21} />}
                  title="选中原文，开始理解"
                  detail="我只会使用你选中的内容和附近段落回答，并把引用带回原文。"
                />
              )}

              {conversationSelection && (
                <div className="source-card">
                  <div className="source-card-header">
                    <span>当前原文</span>
                    <small>{conversationSelection.chapterTitle || '当前章节'} · {selectedPassageCount} 段上下文</small>
                  </div>
                  <blockquote>“{conversationSelection.quote}”</blockquote>
                  <button type="button" onClick={() => void navigateToAnchor(conversationSelection.anchor)}><ArrowLeft size={13} />回到原文</button>
                </div>
              )}

              <div className="conversation-list" aria-live="polite">
                {turns.map((turn, index) => {
                  const isLatest = index === turns.length - 1
                  return (
                    <article className={`conversation-turn is-${turn.status}`} key={turn.id}>
                      <div className="question-bubble">
                        <span>{actionLabel(turn.action)}</span>
                        <p>{turn.question}</p>
                      </div>
                      <div className="answer-card" data-testid={isLatest ? 'answer-current' : undefined}>
                        <div className="answer-label"><span><Sparkles size={13} /></span>阅读助手</div>
                        {turn.answer && conversationSelection ? (
                          <CitationText text={turn.answer} selection={conversationSelection} onNavigate={(anchor) => void navigateToAnchor(anchor)} />
                        ) : turn.status === 'streaming' ? (
                          <div className="answer-thinking"><i /><i /><i /><span>正在结合原文思考</span></div>
                        ) : null}
                        {turn.status === 'streaming' && turn.answer && <span className="stream-caret" aria-label="正在生成" />}
                        {turn.error && <div className={`turn-error ${turn.answer ? 'is-muted' : ''}`}><AlertCircle size={14} />{turn.error}</div>}
                        {turn.status === 'completed' && (
                          <footer className="answer-footer">
                            <span>{turn.model || provider.model || '已完成'}{turn.usage?.totalTokens ? ` · ${turn.usage.totalTokens} tokens` : ''}</span>
                            <button
                              data-testid={isLatest ? 'answer-save' : undefined}
                              className={turn.saved ? 'is-saved' : ''}
                              type="button"
                              onClick={() => void saveTurn(turn)}
                              disabled={turn.saved}
                            >
                              {turn.saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                              {turn.saved ? '已收藏' : '收藏'}
                            </button>
                          </footer>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            </div>

            <div className="assistant-composer">
              {activeRequestId && (
                <button className="cancel-generation" data-testid="cancel-request" type="button" onClick={() => void cancelRequest()}>
                  <CircleStop size={14} />停止生成
                </button>
              )}
              <form onSubmit={submitQuestion}>
                <textarea
                  data-testid="followup-input"
                  ref={followupRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleComposerKey}
                  placeholder={conversationSelection ? (turns.length ? '继续追问这段原文…' : '针对这段原文提问…') : '先在正文中选中一段内容'}
                  disabled={!canAsk}
                  rows={2}
                  maxLength={2000}
                />
                <button type="submit" aria-label="发送问题" disabled={!canAsk || !draft.trim()}><Send size={16} /></button>
              </form>
              <p>Enter 发送 · Shift + Enter 换行</p>
            </div>
          </>
        )}

        {rightView === 'insights' && (
          <div className="insights-view">
            <div className="insights-heading">
              <div><span className="eyebrow">SAVED INSIGHTS</span><h2>收藏</h2></div>
              <span>{insights.length} 条</span>
            </div>
            {insightsLoading && <div className="sidebar-loading"><LoaderCircle className="spin" size={17} /> 正在读取收藏</div>}
            {!insightsLoading && !activeBook && <EmptyState icon={<Bookmark size={20} />} title="还没有打开书籍" detail="打开一本书后，这里会显示与它相关的收藏。" />}
            {!insightsLoading && activeBook && insights.length === 0 && <EmptyState icon={<Bookmark size={20} />} title="还没有收藏" detail="在回答下方点击“收藏”，即可保留答案和原文位置。" />}
            <div className="insight-list">
              {insights.map((insight) => (
                <button
                  className="insight-item"
                  data-testid="insight-item"
                  data-insight-id={insight.id}
                  key={insight.id}
                  type="button"
                  onClick={() => void navigateToAnchor(insight.selection.anchor)}
                >
                  <span className="insight-quote">“{insight.selection.quote}”</span>
                  <strong>{insight.question}</strong>
                  <p>{insight.answer}</p>
                  <footer><span>{formatDate(insight.createdAt)}</span><span>回到原文 <ChevronRight size={12} /></span></footer>
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>

      {settingsOpen && (
        <SettingsModal
          initial={provider}
          onClose={() => setSettingsOpen(false)}
          onSaved={setProvider}
          pushToast={pushToast}
        />
      )}

      {toast && (
        <div className={`toast is-${toast.tone}`} key={toast.id} role="status">
          {toast.tone === 'success' ? <Check size={16} /> : toast.tone === 'error' ? <AlertCircle size={16} /> : <Sparkles size={16} />}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  )
}
