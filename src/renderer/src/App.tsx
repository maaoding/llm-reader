import {
  AlertCircle,
  ArrowLeft,
  BookMarked,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  Cpu,
  FileText,
  Highlighter,
  Import,
  Info,
  Library,
  Lightbulb,
  LoaderCircle,
  MessageSquareText,
  Maximize2,
  Minimize2,
  Minus,
  PanelLeftClose,
  Palette,
  PenLine,
  Quote,
  RefreshCw,
  Save,
  Search,
  SearchX,
  Send,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Unplug,
  X,
  type LucideIcon
} from 'lucide-react'
import {
  type CSSProperties,
  type FormEvent,
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type {
  ArchivedChatMessage,
  BookCoverPayload,
  BookDetails,
  BookRecord,
  HighlightRecord,
  LlmAction,
  LlmEvent,
  LlmUsage,
  ProviderSettings,
  ProviderTestResult,
  SavedInsight,
  SelectionContext,
  TocItem
} from '@shared/contracts'
import appIcon from '../../../resources/icon.png'
import { copy } from '@shared/copy'
import { AnswerText } from './AnswerText'
import {
  assistantActionLabel,
  createDefaultAssistantActionSettings,
  MAX_ASSISTANT_ACTION_LABEL_LENGTH,
  MAX_ASSISTANT_ACTION_PROMPT_LENGTH,
  normalizeAssistantActionSettings,
  persistAssistantActionSettings,
  readAssistantActionSettings,
  type AssistantActionIcon,
  type AssistantActionSettings
} from './assistant-actions'
import {
  createReaderAdapter,
  DEFAULT_READING_PREFERENCES,
  normalizeReadingPreferences,
  READER_SEARCH_QUERY_MAX_LENGTH,
  READER_SEARCH_RESULT_LIMIT,
  splitSearchExcerpt,
  type ReaderAdapter,
  type ReaderSearchResult,
  type ReaderSelectionDraft,
  type ReadingPaperTheme,
  type ReadingPreferences
} from './readers'

type LeftView = 'library' | 'toc' | 'highlights' | 'search'
type RightView = 'assistant' | 'insights'
type LoadState = 'idle' | 'loading' | 'ready' | 'error'
type SearchState = 'idle' | 'searching' | 'ready' | 'error'
type TurnStatus = 'streaming' | 'completed' | 'error'
type ThemePreference = 'light' | 'system' | 'dark'
type ResolvedTheme = Exclude<ThemePreference, 'system'>
type InterfaceScale = 90 | 100 | 110 | 125
type SettingsSectionId = 'appearance' | 'reading' | 'assistant' | 'model' | 'about'
type ProviderConnectionStatus = 'not-configured' | 'checking' | 'connected' | 'disconnected'

interface ProviderConnectionState {
  status: ProviderConnectionStatus
  message: string
}

interface ProviderCheckOutcome extends ProviderTestResult {
  current: boolean
}

interface ConversationTurn {
  id: string
  requestId: string
  selection: SelectionContext
  action: LlmAction
  actionLabel: string
  question: string
  answer: string
  model: string
  status: TurnStatus
  usage?: LlmUsage
  error?: string
  saved?: boolean
}

type AssistantSession = 'conversation' | 'archive'
type AssistantDialogSource = AssistantSession

interface ArchiveSessionState {
  insightId: string
  selection: SelectionContext
  turns: ConversationTurn[]
}

function turnsFromInsight(insight: SavedInsight): ConversationTurn[] {
  const history = insight.history.length >= 2
    ? insight.history
    : [
        { role: 'user' as const, content: insight.question },
        { role: 'assistant' as const, content: insight.answer, model: insight.model }
      ]
  const turns: ConversationTurn[] = []
  for (let index = 0; index < history.length; index += 1) {
    const message = history[index]
    if (message.role !== 'user') continue
    const answer = history[index + 1]?.role === 'assistant' ? history[index + 1] : null
    if (!answer) continue
    turns.push({
      id: `insight-${insight.id}-${turns.length}`,
      requestId: `insight-${insight.id}-${turns.length}`,
      selection: insight.selection,
      action: 'ask',
      actionLabel: turns.length === 0 ? copy('assistant.insightLabel') : copy('assistant.insightFollowupLabel'),
      question: message.content,
      answer: answer.content,
      model: answer.model || insight.model,
      status: 'completed',
      saved: true
    })
    index += 1
  }
  return turns
}

function historyFromTurns(turns: ConversationTurn[]): ArchivedChatMessage[] {
  return turns
    .filter((turn) => turn.status === 'completed' && turn.answer)
    .flatMap((turn) => [
      { role: 'user' as const, content: turn.question },
      { role: 'assistant' as const, content: turn.answer, model: turn.model || undefined }
    ])
}

interface ToastState {
  id: number
  tone: 'success' | 'error' | 'neutral'
  message: string
}

const EMPTY_PROVIDER: ProviderSettings = {
  baseUrl: 'https://api.openai.com',
  model: '',
  hasApiKey: false
}

const THEME_STORAGE_KEY = 'llm-reader.theme'
const INTERFACE_SCALE_STORAGE_KEY = 'llm-reader.interface-scale'
const READING_PREFERENCES_STORAGE_KEY = 'llm-reader.reading-preferences'

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; ariaLabel: string }> = [
  { value: 'light', label: copy('settings.themeLight'), ariaLabel: copy('settings.themeLightAria') },
  { value: 'system', label: copy('settings.themeSystem'), ariaLabel: copy('settings.themeSystemAria') },
  { value: 'dark', label: copy('settings.themeDark'), ariaLabel: copy('settings.themeDarkAria') }
]

const ASSISTANT_ACTION_ICON_VIEWS: Readonly<Record<AssistantActionIcon, LucideIcon>> = {
  'highlighter': Highlighter,
  'book-open': BookOpen,
  'message-square-text': MessageSquareText,
  'search': Search,
  'lightbulb': Lightbulb,
  'pen-line': PenLine,
  'quote': Quote,
  'book-marked': BookMarked
}

const ASSISTANT_ACTION_ICON_OPTIONS: ReadonlyArray<{ value: AssistantActionIcon; label: string }> = [
  { value: 'highlighter', label: copy('settings.assistantIconHighlighter') },
  { value: 'book-open', label: copy('settings.assistantIconBookOpen') },
  { value: 'message-square-text', label: copy('settings.assistantIconMessageSquareText') },
  { value: 'search', label: copy('settings.assistantIconSearch') },
  { value: 'lightbulb', label: copy('settings.assistantIconLightbulb') },
  { value: 'pen-line', label: copy('settings.assistantIconPenLine') },
  { value: 'quote', label: copy('settings.assistantIconQuote') },
  { value: 'book-marked', label: copy('settings.assistantIconBookMarked') }
]

function AssistantActionIconView({ icon, size = 15 }: { icon: AssistantActionIcon; size?: number }): ReactNode {
  const Icon = ASSISTANT_ACTION_ICON_VIEWS[icon]
  return <Icon size={size} />
}

function AssistantActionIconPicker({
  id,
  value,
  onChange
}: {
  id: string
  value: AssistantActionIcon
  onChange: (icon: AssistantActionIcon) => void
}): ReactNode {
  return (
    <div className="assistant-icon-select">
      <label htmlFor={id}><AssistantActionIconView icon={value} size={14} /><span>{copy('settings.assistantIconLabel')}</span></label>
      <select id={id} data-testid={id} value={value} onChange={(event) => onChange(event.target.value as AssistantActionIcon)}>
        {ASSISTANT_ACTION_ICON_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  )
}

/**
 * Localized family names, in display order, for the fonts that are pinned to the
 * top of the reading font picker. Installed fonts are matched against this list.
 */
const COMMON_READING_FONTS = [
  '微软雅黑',
  'Microsoft YaHei',
  '宋体',
  'SimSun',
  '新宋体',
  'NSimSun',
  '黑体',
  'SimHei',
  '楷体',
  'KaiTi',
  '仿宋',
  'FangSong',
  '等线',
  'DengXian',
  '隶书',
  'LiSu',
  '幼圆',
  'YouYuan'
] as const

interface FontGroups {
  common: string[]
  others: string[]
}

function groupReadingFonts(fonts: ReadonlyArray<string>): FontGroups {
  const available = new Set(fonts)
  const common = COMMON_READING_FONTS.filter((name) => available.has(name))
  const commonSet = new Set<string>(common)
  const others = fonts
    .filter((name) => !commonSet.has(name))
    .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
  return { common, others }
}

function WindowControls(): ReactNode {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!window.readerApi) return undefined
    let alive = true

    void window.readerApi.isWindowMaximized().then((value) => {
      if (alive) setMaximized(value)
    })
    const unsubscribe = window.readerApi.onWindowMaximizedChange(setMaximized)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  return (
    <div className="window-controls" role="group" aria-label={copy('window.controlsAria')}>
      <button
        data-testid="window-minimize"
        type="button"
        aria-label={copy('window.minimizeAria')}
        title={copy('window.minimizeAria')}
        onClick={() => void window.readerApi.minimizeWindow()}
      >
        <Minus size={14} />
      </button>
      <button
        data-testid="window-toggle-maximize"
        type="button"
        aria-label={copy(maximized ? 'window.restoreAria' : 'window.maximizeAria')}
        title={copy(maximized ? 'window.restoreAria' : 'window.maximizeAria')}
        onClick={() => void window.readerApi.toggleMaximizeWindow()}
      >
        {maximized ? <Minimize2 size={13} /> : <Square size={12} />}
      </button>
      <button
        className="is-close"
        data-testid="window-close"
        type="button"
        aria-label={copy('window.closeAria')}
        title={copy('window.closeAria')}
        onClick={() => void window.readerApi.closeWindow()}
      >
        <X size={15} />
      </button>
    </div>
  )
}

function tocHrefMatchesCurrent(itemHref: string, currentHref: string | null): boolean {
  return Boolean(currentHref && itemHref.trim() === currentHref.trim())
}

function providerIsConfigured(provider: ProviderSettings): boolean {
  return Boolean(provider.baseUrl.trim() && provider.model.trim() && provider.hasApiKey)
}

function providerStatusLabel(status: ProviderConnectionStatus): string {
  if (status === 'checking') return copy('provider.statusChecking')
  if (status === 'connected') return copy('provider.statusConnected')
  if (status === 'disconnected') return copy('provider.statusDisconnected')
  return copy('provider.statusNotConfigured')
}

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'system' || value === 'dark'
}

function readThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system'
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

function readSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? readSystemTheme() : preference
}

function readInterfaceScale(): InterfaceScale {
  try {
    const value = Number(window.localStorage.getItem(INTERFACE_SCALE_STORAGE_KEY))
    return value === 90 || value === 110 || value === 125 ? value : 100
  } catch {
    return 100
  }
}

function readReadingPreferences(): ReadingPreferences {
  try {
    const stored = JSON.parse(window.localStorage.getItem(READING_PREFERENCES_STORAGE_KEY) ?? '{}') as unknown
    const value = stored && typeof stored === 'object' ? stored : {}
    return normalizeReadingPreferences(value as ReadingPreferences)
  } catch {
    return { ...DEFAULT_READING_PREFERENCES }
  }
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function useDialogFocus(open: boolean, onClose: () => void, dialogRef: RefObject<HTMLElement | null>, returnRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return undefined
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : returnRef.current
    const returnTarget = previous ?? returnRef.current
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const activeElement = document.activeElement
      if (!dialogRef.current.contains(activeElement)) {
        event.preventDefault()
        const boundaryTarget = event.shiftKey ? last : first
        boundaryTarget.focus()
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      returnTarget?.focus()
    }
  }, [dialogRef, onClose, open, returnRef])
}

function PdfSelectionReviewDialog({ draft }: { draft: ReaderSelectionDraft }): ReactNode {
  const [value, setValue] = useState(draft.quote)
  const dialogRef = useRef<HTMLElement>(null)
  const returnRef = useRef<HTMLElement>(null)
  const close = useCallback(() => draft.cancel(), [draft])
  useDialogFocus(true, close, dialogRef, returnRef)

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const quote = value.trim()
    if (!quote) return
    draft.confirm(quote)
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section
        ref={dialogRef}
        className="pdf-selection-review-modal"
        data-testid="pdf-selection-review"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-selection-review-title"
      >
        <header className="modal-header">
          <h2 id="pdf-selection-review-title">{copy('reader.pdfRegionReviewTitle')}</h2>
          <button className="icon-button" type="button" onClick={close} aria-label={copy('reader.pdfRegionCancel')}><X size={16} /></button>
        </header>
        <form onSubmit={submit}>
          <div className="pdf-selection-review-body">
            <p>{copy('reader.pdfRegionReviewDetail')}</p>
            <textarea
              data-testid="pdf-selection-review-input"
              aria-label={copy('reader.pdfRegionReviewInputAria')}
              value={value}
              maxLength={20_000}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          <footer className="modal-actions">
            <button ref={returnRef as RefObject<HTMLButtonElement>} className="secondary-button" data-testid="pdf-selection-review-cancel" type="button" onClick={close}>{copy('reader.pdfRegionCancel')}</button>
            <button className="primary-button" data-testid="pdf-selection-review-confirm" type="submit" disabled={!value.trim()}>{copy('reader.pdfRegionConfirm')}</button>
          </footer>
        </form>
      </section>
    </div>
  )
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

interface SelectionAnchorRect {
  top: number
  bottom: number
  centerX: number
}

function rectFromNativeSelection(selection: Selection | null): DOMRect | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const rect = selection.getRangeAt(0).getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  return rect
}

/**
 * 找到当前活跃选区的视口矩形:TXT 在主文档,EPUB 在同源 iframe 内,
 * PDF 区域框选则是确认后的 .pdf-region-overlay.is-selection 元素。
 */
function findSelectionAnchorRect(host: HTMLElement | null): SelectionAnchorRect | null {
  const own = rectFromNativeSelection(window.getSelection())
  if (own) return { top: own.top, bottom: own.bottom, centerX: own.left + own.width / 2 }
  if (!host) return null
  for (const frame of Array.from(host.querySelectorAll('iframe'))) {
    try {
      const rect = rectFromNativeSelection(frame.contentWindow?.getSelection() ?? null)
      if (!rect) continue
      const frameRect = frame.getBoundingClientRect()
      return {
        top: frameRect.top + rect.top,
        bottom: frameRect.top + rect.bottom,
        centerX: frameRect.left + rect.left + rect.width / 2
      }
    } catch {
      continue
    }
  }
  const region = host.querySelector('.pdf-region-overlay.is-selection')
  if (region) {
    const rect = region.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, centerX: rect.left + rect.width / 2 }
  }
  return null
}

function useBookCoverUrl(book: BookRecord): string | null {
  const [loaded, setLoaded] = useState<{ bookId: string; url: string } | null>(null)

  useEffect(() => {
    let alive = true
    let objectUrl: string | null = null
    if (book.format !== 'epub' || !window.readerApi) return undefined

    void window.readerApi
      .getBookCover(book.id)
      .then((cover) => {
        if (!alive || !cover) return
        try {
          const blob = new Blob([cover.bytes as BlobPart], { type: cover.mimeType })
          objectUrl = URL.createObjectURL(blob)
          if (alive) setLoaded({ bookId: book.id, url: objectUrl })
        } catch {
          // Keep the format placeholder when the cover cannot be rendered.
        }
      })
      .catch(() => undefined)

    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [book.format, book.id])

  return loaded?.bookId === book.id ? loaded.url : null
}

function useCoverPayloadUrl(cover: BookCoverPayload | null | undefined): string | null {
  const [loaded, setLoaded] = useState<{ cover: BookCoverPayload; url: string } | null>(null)

  useEffect(() => {
    let alive = true
    let objectUrl: string | null = null
    if (!cover) return undefined

    void Promise.resolve().then(() => {
      if (!alive) return
      try {
        const blob = new Blob([cover.bytes as BlobPart], { type: cover.mimeType })
        objectUrl = URL.createObjectURL(blob)
        setLoaded({ cover, url: objectUrl })
      } catch {
        // The details modal falls back to the placeholder below.
      }
    })

    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [cover])

  return loaded !== null && loaded.cover === cover ? loaded.url : null
}

function BookCoverView({
  url,
  book,
  size
}: {
  url: string | null
  book: BookRecord
  size: 'small' | 'large'
}): ReactNode {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  const failed = Boolean(url && failedUrl === url)
  const showImage = Boolean(url && !failed)
  const iconSize = size === 'large' ? 24 : 17
  const alt = size === 'large' ? copy('bookDetails.coverAlt', { title: book.title }) : ''

  return (
    <span
      className={'book-cover is-' + book.format + ' is-' + size}
      data-testid="book-cover"
      data-has-cover={showImage ? 'true' : 'false'}
    >
      {showImage && url ? (
        <img src={url} alt={alt} onError={() => setFailedUrl(url)} />
      ) : book.format === 'epub' ? (
        <BookOpen size={iconSize} />
      ) : (
        <FileText size={iconSize} />
      )}
    </span>
  )
}

function BookCover({ book, size = 'small' }: { book: BookRecord; size?: 'small' | 'large' }): ReactNode {
  const url = useBookCoverUrl(book)
  return <BookCoverView url={url} book={book} size={size} />
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB'] as const
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const text = unit === 0 ? String(value) : value >= 100 ? String(Math.round(value)) : value.toFixed(1)
  return text + ' ' + units[unit]
}

function sourceFormatLabel(book: BookRecord): string {
  if (book.sourceFormat === 'mobi') return copy('bookDetails.formatMobi')
  if (book.sourceFormat === 'azw3') return copy('bookDetails.formatAzw3')
  if (book.sourceFormat === 'pdf') return copy('bookDetails.formatPdf')
  return book.sourceFormat === 'epub' ? copy('bookDetails.formatEpub') : copy('bookDetails.formatTxt')
}

function bookFallbackDescription(book: BookRecord): string {
  if (book.sourceFormat === 'mobi' || book.sourceFormat === 'azw3') {
    return copy('library.convertedDescription', { format: book.sourceFormat.toUpperCase() })
  }
  if (book.format === 'epub') return copy('library.epubDescription')
  return book.format === 'pdf' ? copy('library.pdfDescription') : copy('library.txtDescription')
}

function formatFullDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function BookDetailRow({
  label,
  value,
  wide = false
}: {
  label: string
  value: string
  wide?: boolean
}): ReactNode {
  return (
    <div className={wide ? 'book-details-row is-wide' : 'book-details-row'}>
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
  )
}

function BookProgressRow({ progress }: { progress: number }): ReactNode {
  const percent = Math.round(Math.max(0, Math.min(1, progress || 0)) * 100)
  return (
    <div className="book-details-row is-progress">
      <dt>{copy('bookDetails.progressLabel')}</dt>
      <dd>
        <span className="book-details-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={copy('reader.progressAria', { percent })}>
          <i style={{ width: percent + '%' }} />
        </span>
        <strong>{percent}%</strong>
      </dd>
    </div>
  )
}

function BookDetailsModal({
  book,
  returnFocusRef,
  onClose
}: {
  book: BookRecord
  returnFocusRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
}): ReactNode {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [details, setDetails] = useState<BookDetails | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const dialogRef = useRef<HTMLElement>(null)
  const coverUrl = useCoverPayloadUrl(details?.cover ?? null)

  useDialogFocus(true, onClose, dialogRef, returnFocusRef)

  useEffect(() => {
    let alive = true

    void window.readerApi
      .getBookDetails(book.id)
      .then((result) => {
        if (alive) {
          setDetails(result)
          setState('ready')
        }
      })
      .catch((cause) => {
        if (alive) {
          setError(readableError(cause, copy('bookDetails.readFailed')))
          setState('error')
        }
      })

    return () => {
      alive = false
    }
  }, [attempt, book.id])

  const retry = (): void => {
    setState('loading')
    setError('')
    setDetails(null)
    setAttempt((current) => current + 1)
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="book-details-modal" data-testid="book-details-modal" role="dialog" aria-modal="true" aria-labelledby="book-details-title">
        <header className="modal-header">
          <div><h2 id="book-details-title">{copy('bookDetails.title')}</h2></div>
          <button className="icon-button" data-testid="book-details-close" type="button" onClick={onClose} aria-label={copy('bookDetails.closeAria')}><X size={18} /></button>
        </header>

        {state === 'loading' && (
          <div className="book-details-state"><LoaderCircle className="spin" size={22} />{copy('bookDetails.loading')}</div>
        )}

        {state === 'error' && (
          <div className="book-details-state is-error">
            <AlertCircle size={20} />
            <span>{error}</span>
            <button className="text-button" type="button" onClick={retry}><RefreshCw size={14} />{copy('common.retry')}</button>
          </div>
        )}

        {state === 'ready' && details && (
          <div className="book-details-body">
            <div className="book-details-cover" data-testid="book-details-cover">
              <BookCoverView url={coverUrl} book={details.book} size="large" />
              {!coverUrl && <small>{copy('bookDetails.coverMissing')}</small>}
            </div>
            <div className="book-details-panel">
              <div className="book-details-heading">
                <h3>{details.book.title}</h3>
                <p>{details.book.author || copy('common.unknownAuthor')}</p>
              </div>
              <dl className="book-details-list">
                <BookDetailRow label={copy('bookDetails.titleLabel')} value={details.book.title} />
                <BookDetailRow label={copy('bookDetails.authorLabel')} value={details.book.author || copy('common.unknownAuthor')} />
                <BookDetailRow label={copy('bookDetails.formatLabel')} value={sourceFormatLabel(details.book)} />
                <BookDetailRow label={copy('bookDetails.originalNameLabel')} value={details.book.originalName} />
                <BookDetailRow label={copy('bookDetails.fileSizeLabel')} value={formatFileSize(details.fileSizeBytes)} />
                <BookDetailRow label={copy('bookDetails.languageLabel')} value={details.metadata.language || copy('bookDetails.notProvided')} />
                <BookDetailRow label={copy('bookDetails.publisherLabel')} value={details.metadata.publisher || copy('bookDetails.notProvided')} />
                <BookDetailRow label={copy('bookDetails.publishedAtLabel')} value={details.metadata.publishedAt || copy('bookDetails.notProvided')} />
                <BookDetailRow label={copy('bookDetails.identifierLabel')} value={details.metadata.identifier || copy('bookDetails.notProvided')} />
                <BookDetailRow label={copy('bookDetails.importedAtLabel')} value={formatFullDate(details.book.importedAt)} />
                <BookDetailRow label={copy('bookDetails.lastOpenedAtLabel')} value={details.book.lastOpenedAt ? formatFullDate(details.book.lastOpenedAt) : copy('bookDetails.neverOpened')} />
                <BookProgressRow progress={details.book.progress} />
                <BookDetailRow label={copy('bookDetails.descriptionLabel')} value={details.metadata.description || copy('bookDetails.notProvided')} wide />
              </dl>
            </div>
          </div>
        )}
      </section>
    </div>
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

function ConversationPane({
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
  onComposerKey,
  showSave = true
}: {
  conversationSelection: SelectionContext | null
  turns: ConversationTurn[]
  provider: ProviderSettings
  activeRequestId: string | null
  draft: string
  canAsk: boolean
  followupRef: RefObject<HTMLTextAreaElement | null>
  onDraftChange: (value: string) => void
  onNavigate: (anchor: string) => void
  onSave?: (turn: ConversationTurn) => void
  showSave?: boolean
  onCancel: () => void
  onSubmit: (event: FormEvent) => void
  onComposerKey: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void
}): ReactNode {
  const selectedPassageCount = conversationSelection?.passages.length ?? 0
  const assistantScrollRef = useRef<HTMLDivElement | null>(null)
  const assistantFollowRef = useRef(true)

  useLayoutEffect(() => {
    const container = assistantScrollRef.current
    if (!container || !assistantFollowRef.current) return
    container.scrollTop = container.scrollHeight
  }, [turns])

  return (
    <>
      <div
        className="assistant-scroll"
        ref={assistantScrollRef}
        onScroll={(event) => {
          const container = event.currentTarget
          assistantFollowRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < 40
        }}
      >
        {!conversationSelection && turns.length === 0 && (
          <EmptyState icon={<Sparkles size={21} />} title={copy('assistant.emptyTitle')} detail={copy('assistant.emptyDetail')} />
        )}
        {conversationSelection && (
          <div className="source-card">
            <div className="source-card-header"><span>{copy('assistant.sourceTitle')}</span><small>{copy('assistant.sourceSummary', { chapter: conversationSelection.chapterTitle || copy('common.currentChapter'), count: selectedPassageCount })}</small></div>
            <blockquote>“{conversationSelection.quote}”</blockquote>
            <button type="button" onClick={() => onNavigate(conversationSelection.anchor)}><ArrowLeft size={13} />{copy('assistant.backToSource')}</button>
          </div>
        )}
        <div className="conversation-list" aria-live="polite">
          {turns.map((turn, index) => {
            const isLatest = index === turns.length - 1
            return (
              <article className={`conversation-turn is-${turn.status}`} key={turn.id}>
                <div className="question-bubble"><span>{turn.actionLabel}</span><p>{turn.question}</p></div>
                <div className="answer-card" data-testid={isLatest ? 'answer-current' : undefined}>
                  <div className="answer-label"><span><Sparkles size={13} /></span><strong className="answer-model" title={turn.model || provider.model || copy('assistant.modelUnavailable')}>{turn.model || provider.model || copy('assistant.modelUnavailable')}</strong></div>
                  {turn.answer ? <AnswerText text={turn.answer} selection={turn.selection} onNavigate={onNavigate} /> : turn.status === 'streaming' ? <div className="answer-thinking"><i /><i /><i /><span>{copy('assistant.thinking')}</span></div> : null}
                  {turn.status === 'streaming' && turn.answer && <span className="stream-caret" aria-label={copy('assistant.generatingAria')} />}
                  {turn.error && <div className={`turn-error ${turn.answer ? 'is-muted' : ''}`}><AlertCircle size={14} />{turn.error}</div>}
                  {turn.status === 'completed' && (
                    <footer className="answer-footer">
                      <span>{turn.usage?.totalTokens ? copy('assistant.tokenUsage', { count: turn.usage.totalTokens }) : ''}</span>
                      {showSave && onSave && (
                        <button data-testid={isLatest ? 'answer-save' : undefined} className={turn.saved ? 'is-saved' : ''} type="button" onClick={() => onSave(turn)} disabled={turn.saved}>
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
      <div className="assistant-composer">
        {activeRequestId && <button className="cancel-generation" data-testid="cancel-request" type="button" onClick={onCancel}><CircleStop size={14} />{copy('assistant.stop')}</button>}
        <form onSubmit={onSubmit}>
          <textarea data-testid="followup-input" ref={followupRef} value={draft} onChange={(event) => onDraftChange(event.target.value)} onKeyDown={onComposerKey} placeholder={conversationSelection ? (turns.length ? copy('assistant.placeholderFollowup') : copy('assistant.placeholderFirst')) : copy('assistant.placeholderNoSelection')} disabled={!canAsk} rows={2} maxLength={2000} />
          <button type="submit" aria-label={copy('assistant.sendAria')} disabled={!canAsk || !draft.trim()}><Send size={16} /></button>
        </form>
      </div>
    </>
  )
}

function AssistantActionFields({
  settings,
  onChange
}: {
  settings: AssistantActionSettings
  onChange: (settings: AssistantActionSettings) => void
}): ReactNode {
  const defaults = useMemo(() => createDefaultAssistantActionSettings(), [])
  return (
    <>
      <p className="settings-section-hint">{copy('settings.assistantHint')}</p>
      <div className="assistant-action-fields">
        <div className="assistant-action-card">
          <AssistantActionIconPicker
            id="assistant-explain-icon"
            value={settings.explain.icon}
            onChange={(icon) => onChange({ ...settings, explain: { ...settings.explain, icon } })}
          />
          <label className="field-label" htmlFor="assistant-explain-label">{copy('settings.assistantExplainName')}</label>
          <input
            id="assistant-explain-label"
            data-testid="assistant-explain-label"
            value={settings.explain.label}
            maxLength={MAX_ASSISTANT_ACTION_LABEL_LENGTH}
            spellCheck={false}
            required
            onChange={(event) => onChange({ ...settings, explain: { ...settings.explain, label: event.target.value } })}
            onBlur={(event) => {
              const label = event.target.value.trim()
              onChange({ ...settings, explain: { ...settings.explain, label: label || defaults.explain.label } })
            }}
          />
          <label className="field-label" htmlFor="assistant-explain-prompt">{copy('settings.assistantExplainPrompt')}</label>
          <textarea
            id="assistant-explain-prompt"
            data-testid="assistant-explain-prompt"
            value={settings.explain.prompt}
            maxLength={MAX_ASSISTANT_ACTION_PROMPT_LENGTH}
            rows={3}
            spellCheck={false}
            required
            onChange={(event) => onChange({ ...settings, explain: { ...settings.explain, prompt: event.target.value } })}
            onBlur={(event) => {
              const prompt = event.target.value.trim()
              onChange({ ...settings, explain: { ...settings.explain, prompt: prompt || defaults.explain.prompt } })
            }}
          />
        </div>

        <div className="assistant-action-card">
          <AssistantActionIconPicker
            id="assistant-context-icon"
            value={settings.context.icon}
            onChange={(icon) => onChange({ ...settings, context: { ...settings.context, icon } })}
          />
          <label className="field-label" htmlFor="assistant-context-label">{copy('settings.assistantContextName')}</label>
          <input
            id="assistant-context-label"
            data-testid="assistant-context-label"
            value={settings.context.label}
            maxLength={MAX_ASSISTANT_ACTION_LABEL_LENGTH}
            spellCheck={false}
            required
            onChange={(event) => onChange({ ...settings, context: { ...settings.context, label: event.target.value } })}
            onBlur={(event) => {
              const label = event.target.value.trim()
              onChange({ ...settings, context: { ...settings.context, label: label || defaults.context.label } })
            }}
          />
          <label className="field-label" htmlFor="assistant-context-prompt">{copy('settings.assistantContextPrompt')}</label>
          <textarea
            id="assistant-context-prompt"
            data-testid="assistant-context-prompt"
            value={settings.context.prompt}
            maxLength={MAX_ASSISTANT_ACTION_PROMPT_LENGTH}
            rows={3}
            spellCheck={false}
            required
            onChange={(event) => onChange({ ...settings, context: { ...settings.context, prompt: event.target.value } })}
            onBlur={(event) => {
              const prompt = event.target.value.trim()
              onChange({ ...settings, context: { ...settings.context, prompt: prompt || defaults.context.prompt } })
            }}
          />
        </div>

        <div className="assistant-action-card">
          <AssistantActionIconPicker
            id="assistant-ask-icon"
            value={settings.ask.icon}
            onChange={(icon) => onChange({ ...settings, ask: { ...settings.ask, icon } })}
          />
          <label className="field-label" htmlFor="assistant-ask-label">{copy('settings.assistantAskName')}</label>
          <input
            id="assistant-ask-label"
            data-testid="assistant-ask-label"
            value={settings.ask.label}
            maxLength={MAX_ASSISTANT_ACTION_LABEL_LENGTH}
            spellCheck={false}
            required
            onChange={(event) => onChange({ ...settings, ask: { ...settings.ask, label: event.target.value } })}
            onBlur={(event) => {
              const label = event.target.value.trim()
              onChange({ ...settings, ask: { ...settings.ask, label: label || defaults.ask.label } })
            }}
          />
          <p className="field-hint">{copy('settings.assistantAskHint')}</p>
        </div>
      </div>
    </>
  )
}

const ABOUT_THIRD_PARTY_NOTICE_KEYS = [
  'about.noticeElectron',
  'about.noticeEpubjs',
  'about.noticeJszip',
  'about.noticeLocalforage',
  'about.noticePdfjs',
  'about.noticeLucide',
  'about.noticeReact',
  'about.noticeZod'
] as const

function AboutPanel(): ReactNode {
  const [version, setVersion] = useState('')

  useEffect(() => {
    if (!window.readerApi) return undefined
    let alive = true
    void window.readerApi
      .getAppInfo()
      .then((info) => {
        if (alive) setVersion(info.version)
      })
      .catch(() => {
        if (alive) setVersion(copy('about.versionUnknown'))
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <section className="settings-section about-panel" id="settings-panel-about" role="tabpanel" aria-labelledby="settings-tab-about">
      <div className="about-brand" aria-hidden="true"><img src={appIcon} alt="" draggable={false} /></div>
      <h3 id="about-settings-title">{copy('app.name')}</h3>
      <p className="about-copyright">{copy('about.copyright')}</p>
      <dl className="about-facts">
        <div>
          <dt>{copy('about.versionLabel')}</dt>
          <dd data-testid="about-version">{version || copy('about.versionUnknown')}</dd>
        </div>
        <div>
          <dt>{copy('about.licenseLabel')}</dt>
          <dd>{copy('about.licenseValue')}</dd>
        </div>
        <div>
          <dt>{copy('about.repositoryLabel')}</dt>
          <dd className="about-repository">{copy('about.repositoryUrl')}</dd>
        </div>
      </dl>
      <p className="about-license-note">{copy('about.licenseNotice')}</p>
      <div className="about-notices">
        <h4>{copy('about.thirdPartyNoticesTitle')}</h4>
        <p>{copy('about.thirdPartyNoticesIntro')}</p>
        <ul>
          {ABOUT_THIRD_PARTY_NOTICE_KEYS.map((key) => (
            <li key={key}>{copy(key)}</li>
          ))}
        </ul>
        <p>{copy('about.thirdPartyNoticesFull')}</p>
      </div>
    </section>
  )
}

function SettingsModal({
  initial,
  initialSection,
  themePreference,
  interfaceScale,
  readingPreferences,
  assistantActions,
  returnFocusRef,
  onClose,
  onSaved,
  onTest,
  onThemeChange,
  onInterfaceScaleChange,
  onReadingPreferencesChange,
  onAssistantActionsChange,
  pushToast
}: {
  initial: ProviderSettings
  initialSection: SettingsSectionId
  themePreference: ThemePreference
  interfaceScale: InterfaceScale
  readingPreferences: ReadingPreferences
  assistantActions: AssistantActionSettings
  returnFocusRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
  onSaved: (settings: ProviderSettings) => void
  onTest: (settings: ProviderSettings) => Promise<ProviderCheckOutcome>
  onThemeChange: (preference: ThemePreference) => void
  onInterfaceScaleChange: (scale: InterfaceScale) => void
  onReadingPreferencesChange: (preferences: ReadingPreferences) => void
  onAssistantActionsChange: (settings: AssistantActionSettings) => void
  pushToast: (message: string, tone?: ToastState['tone']) => void
}): ReactNode {
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl)
  const [model, setModel] = useState(initial.model)
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection)
  const [fonts, setFonts] = useState<string[] | null>(null)
  const keyRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)
  const testSequenceRef = useRef(0)

  useDialogFocus(true, onClose, dialogRef, returnFocusRef)

  useEffect(() => {
    panelRef.current?.scrollTo(0, 0)
  }, [activeSection])

  useEffect(() => {
    let alive = true
    const loadFonts = async (): Promise<void> => {
      try {
        const list = await window.readerApi.listSystemFonts()
        if (alive) setFonts(list)
      } catch {
        if (alive) setFonts([])
      }
    }
    void loadFonts()
    return () => {
      alive = false
    }
  }, [])

  const fontGroups = useMemo(() => groupReadingFonts(fonts ?? []), [fonts])

  const selectedFontUsable = useMemo(() => {
    const selected = readingPreferences.fontFamily
    if (!selected || fonts === null || !fonts.includes(selected)) return true
    try {
      return document.fonts.check(`12px "${selected}"`)
    } catch {
      return true
    }
  }, [fonts, readingPreferences.fontFamily])

  const fontNote = fonts === null
    ? copy('settings.fontsLoading')
    : fonts.length === 0
      ? copy('settings.fontsUnavailable')
      : selectedFontUsable
        ? ''
        : copy('settings.fontUnavailableHint')

  const settingsSections: ReadonlyArray<{ id: SettingsSectionId; label: string; icon: ReactNode }> = [
    { id: 'appearance', label: copy('settings.appearanceTitle'), icon: <Palette size={14} /> },
    { id: 'reading', label: copy('settings.readingTitle'), icon: <BookOpen size={14} /> },
    { id: 'assistant', label: copy('settings.assistantTitle'), icon: <MessageSquareText size={14} /> },
    { id: 'model', label: copy('settings.modelTitle'), icon: <Cpu size={14} /> },
    { id: 'about', label: copy('about.title'), icon: <Info size={14} /> }
  ]

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      testSequenceRef.current += 1
    }
  }, [])

  const persist = async (): Promise<ProviderSettings> => {
    const key = keyRef.current?.value.trim()
    const saved = await window.readerApi.saveProviderSettings({
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      ...(key ? { apiKey: key } : {})
    })
    if (keyRef.current) keyRef.current.value = ''
    return saved
  }

  const handleSave = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy('save')
    setStatus(null)
    try {
      const saved = await persist()
      onSaved(saved)
      if (mountedRef.current) {
        pushToast(copy('settings.savedToast'), 'success')
        onClose()
      }
    } catch (error) {
      if (mountedRef.current) {
        setStatus({ ok: false, message: readableError(error, copy('settings.saveFailed')) })
      }
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }

  const handleTest = async (): Promise<void> => {
    const sequence = testSequenceRef.current + 1
    testSequenceRef.current = sequence
    setBusy('test')
    setStatus(null)
    try {
      const saved = await persist()
      const result = await onTest(saved)
      if (!mountedRef.current || sequence !== testSequenceRef.current || !result.current) return
      setStatus(result)
      if (result.ok) pushToast(copy('settings.testSuccessToast'), 'success')
    } catch (error) {
      if (mountedRef.current && sequence === testSequenceRef.current) {
        setStatus({ ok: false, message: readableError(error, copy('settings.testFailed')) })
      }
    } finally {
      if (mountedRef.current && sequence === testSequenceRef.current) setBusy(null)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="settings-modal" data-testid="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="modal-header">
          <div>
            <h2 id="settings-title">{copy('settings.title')}</h2>
          </div>
          <button className="icon-button" data-testid="settings-close" type="button" onClick={onClose} aria-label={copy('settings.closeAria')}>
            <X size={18} />
          </button>
        </header>

        <div className="settings-body">
          <nav className="settings-nav" role="tablist" aria-label={copy('settings.sectionsAria')} aria-orientation="vertical">
            {settingsSections.map((section) => (
              <button
                className={activeSection === section.id ? 'is-active' : ''}
                data-testid={`settings-nav-${section.id}`}
                id={`settings-tab-${section.id}`}
                key={section.id}
                type="button"
                role="tab"
                aria-selected={activeSection === section.id}
                aria-controls={`settings-panel-${section.id}`}
                onClick={() => setActiveSection(section.id)}
              >
                {section.icon}{section.label}
              </button>
            ))}
          </nav>
          <div className="settings-panel" ref={panelRef}>
            {activeSection === 'appearance' && (
              <section className="settings-section" id="settings-panel-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance">
                <h3 id="appearance-settings-title">{copy('settings.appearanceTitle')}</h3>
            <div className="settings-row">
              <div><strong>{copy('settings.themeLabel')}</strong><small>{copy('settings.themeHint')}</small></div>
              <div className="theme-control" data-testid="theme-switcher" role="group" aria-label={copy('settings.themeGroupAria')}>
                <div className="theme-options">
                  {THEME_OPTIONS.map((option) => (
                    <button
                      className={`theme-option ${themePreference === option.value ? 'is-active' : ''}`}
                      data-testid={`theme-${option.value}`}
                      key={option.value}
                      type="button"
                      aria-label={option.ariaLabel}
                      aria-pressed={themePreference === option.value}
                      onClick={() => onThemeChange(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="settings-row">
              <div><strong>{copy('settings.scaleLabel')}</strong><small>{copy('settings.scaleHint')}</small></div>
              <div className="segmented-control" data-testid="interface-scale" role="group" aria-label={copy('settings.scaleGroupAria')}>
                {([90, 100, 110, 125] as const).map((scale) => (
                  <button
                    className={interfaceScale === scale ? 'is-active' : ''}
                    data-testid={`scale-${scale}`}
                    key={scale}
                    type="button"
                    aria-pressed={interfaceScale === scale}
                    onClick={() => onInterfaceScaleChange(scale)}
                  >{scale}%</button>
                ))}
              </div>
            </div>
              </section>
            )}

            {activeSection === 'reading' && (
              <section className="settings-section" id="settings-panel-reading" role="tabpanel" aria-labelledby="settings-tab-reading">
                <div className="settings-section-heading">
                  <h3 id="reading-settings-title">{copy('settings.readingTitle')}</h3>
              <button className="text-button" data-testid="reading-reset" type="button" onClick={() => onReadingPreferencesChange({ ...DEFAULT_READING_PREFERENCES })}>{copy('settings.restoreDefaults')}</button>
            </div>
            <label className="settings-range" htmlFor="reading-font-scale">
              <span><strong>{copy('settings.fontLabel')}</strong><output>{readingPreferences.fontScale}%</output></span>
              <input
                id="reading-font-scale"
                data-testid="reading-font-scale"
                type="range"
                min="80"
                max="140"
                step="5"
                aria-label={copy('settings.fontAria')}
                value={readingPreferences.fontScale}
                onChange={(event) => onReadingPreferencesChange({ ...readingPreferences, fontScale: Number(event.target.value) })}
              />
            </label>
            <div className="settings-select-grid">
              <label className="settings-select-full" htmlFor="reading-font-family">
                <span>{copy('settings.fontFamilyLabel')}</span>
                <select
                  id="reading-font-family"
                  data-testid="reading-font-family"
                  value={readingPreferences.fontFamily ?? ''}
                  onChange={(event) =>
                    onReadingPreferencesChange({
                      ...readingPreferences,
                      fontFamily: event.target.value.trim() || null
                    })
                  }
                >
                  <option value="">{copy('settings.followBookDefault')}</option>
                  {readingPreferences.fontFamily &&
                    fonts !== null &&
                    !fonts.includes(readingPreferences.fontFamily) && (
                      <option value={readingPreferences.fontFamily} style={{ fontFamily: readingPreferences.fontFamily }}>
                        {readingPreferences.fontFamily}
                      </option>
                    )}
                  {fonts !== null && fonts.length > 0 && (
                    <>
                      {fontGroups.common.length > 0 && (
                        <optgroup label={copy('settings.commonChineseFonts')}>
                          {fontGroups.common.map((name) => (
                            <option key={name} value={name} style={{ fontFamily: name }}>{name}</option>
                          ))}
                        </optgroup>
                      )}
                      {fontGroups.others.length > 0 && (
                        <optgroup label={copy('settings.allFonts')}>
                          {fontGroups.others.map((name) => (
                            <option key={name} value={name} style={{ fontFamily: name }}>{name}</option>
                          ))}
                        </optgroup>
                      )}
                    </>
                  )}
                </select>
                <small className="settings-font-note">
                  {fontNote}
                </small>
              </label>
              <label className="settings-select-full" htmlFor="reading-paper-theme">
                <span>{copy('settings.paperTheme')}</span>
                <select id="reading-paper-theme" data-testid="reading-paper-theme" value={readingPreferences.paperTheme} onChange={(event) => onReadingPreferencesChange({ ...readingPreferences, paperTheme: event.target.value as ReadingPaperTheme })}>
                  <option value="light">{copy('settings.paperThemeLight')}</option>
                  <option value="sepia">{copy('settings.paperThemeSepia')}</option>
                  <option value="dark">{copy('settings.paperThemeDark')}</option>
                </select>
                <small className="settings-font-note">{copy('settings.paperThemeHint')}</small>
              </label>
              <label htmlFor="reading-line-height"><span>{copy('settings.lineHeight')}</span><select id="reading-line-height" data-testid="reading-line-height" value={readingPreferences.lineHeight} onChange={(event) => onReadingPreferencesChange({ ...readingPreferences, lineHeight: event.target.value as ReadingPreferences['lineHeight'] })}><option value="original">{copy('settings.followBookDefault')}</option><option value="1.5">1.5</option><option value="1.7">1.7</option><option value="1.9">1.9</option></select></label>
              <label htmlFor="reading-indent"><span>{copy('settings.indent')}</span><select id="reading-indent" data-testid="reading-indent" value={readingPreferences.indent} onChange={(event) => onReadingPreferencesChange({ ...readingPreferences, indent: event.target.value as ReadingPreferences['indent'] })}><option value="original">{copy('settings.followBookDefault')}</option><option value="none">{copy('settings.noIndent')}</option><option value="2em">2em</option></select></label>
              <label htmlFor="reading-content-width"><span>{copy('settings.contentWidth')}</span><select id="reading-content-width" data-testid="reading-content-width" value={readingPreferences.contentWidth} onChange={(event) => onReadingPreferencesChange({ ...readingPreferences, contentWidth: event.target.value as ReadingPreferences['contentWidth'] })}><option value="original">{copy('settings.followBookDefault')}</option><option value="narrow">{copy('settings.contentWidthNarrow')}</option><option value="standard">{copy('settings.contentWidthStandard')}</option><option value="wide">{copy('settings.contentWidthWide')}</option></select></label>
              <label htmlFor="reading-paragraph-spacing"><span>{copy('settings.paragraphSpacing')}</span><select id="reading-paragraph-spacing" data-testid="reading-paragraph-spacing" value={readingPreferences.paragraphSpacing} onChange={(event) => onReadingPreferencesChange({ ...readingPreferences, paragraphSpacing: event.target.value as ReadingPreferences['paragraphSpacing'] })}><option value="original">{copy('settings.followBookDefault')}</option><option value="compact">{copy('settings.spacingCompact')}</option><option value="standard">{copy('settings.spacingStandard')}</option><option value="relaxed">{copy('settings.spacingRelaxed')}</option></select></label>
            </div>
              </section>
            )}

            {activeSection === 'assistant' && (
              <section className="settings-section" id="settings-panel-assistant" role="tabpanel" aria-labelledby="settings-tab-assistant">
                <div className="settings-section-heading">
                  <h3 id="assistant-settings-title">{copy('settings.assistantTitle')}</h3>
                  <button
                    className="text-button"
                    data-testid="assistant-actions-reset"
                    type="button"
                    onClick={() => onAssistantActionsChange(createDefaultAssistantActionSettings())}
                  >
                    {copy('settings.restoreDefaults')}
                  </button>
                </div>
                <AssistantActionFields settings={assistantActions} onChange={onAssistantActionsChange} />
              </section>
            )}

            {activeSection === 'model' && (
              <section className="settings-section" id="settings-panel-model" role="tabpanel" aria-labelledby="settings-tab-model">
                <h3 id="model-settings-title">{copy('settings.modelTitle')}</h3>
                <form onSubmit={handleSave}>
          <label className="field-label" htmlFor="provider-base-url">{copy('settings.baseUrlLabel')}</label>
          <input
            id="provider-base-url"
            data-testid="provider-base-url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            disabled={busy !== null}
            placeholder={copy('settings.baseUrlPlaceholder')}
            spellCheck={false}
            required
          />
          <p className="field-hint">{copy('settings.baseUrlHint', { path: '/v1/chat/completions' })}</p>

          <label className="field-label" htmlFor="provider-model">{copy('settings.modelLabel')}</label>
          <input
            id="provider-model"
            data-testid="provider-model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            disabled={busy !== null}
            placeholder={copy('settings.modelPlaceholder')}
            spellCheck={false}
            required
          />

          <div className="label-row">
            <label className="field-label" htmlFor="provider-api-key">{copy('settings.apiKeyLabel')}</label>
            {initial.hasApiKey && <span className="saved-key"><Check size={12} /> {copy('settings.apiKeySaved')}</span>}
          </div>
          <input
            id="provider-api-key"
            data-testid="provider-api-key"
            ref={keyRef}
            type="password"
            autoComplete="off"
            disabled={busy !== null}
            placeholder={initial.hasApiKey ? copy('settings.apiKeyPlaceholderSaved') : copy('settings.apiKeyPlaceholderEmpty')}
          />
          <p className="field-hint">{copy('settings.apiKeyHint')}</p>

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
              {copy('settings.testConnection')}
            </button>
            <button
              className="primary-button"
              data-testid="provider-save"
              type="submit"
              disabled={busy !== null || !baseUrl.trim() || !model.trim()}
            >
              {busy === 'save' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
              {copy('settings.save')}
            </button>
          </footer>
            </form>
              </section>
            )}

            {activeSection === 'about' && <AboutPanel />}
          </div>
        </div>
      </section>
    </div>
  )
}

export default function App(): ReactNode {
  const [themePreference, setThemePreference] = useState<ThemePreference>(readThemePreference)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(themePreference))
  const [interfaceScale, setInterfaceScale] = useState<InterfaceScale>(readInterfaceScale)
  const [readingPreferences, setReadingPreferences] = useState<ReadingPreferences>(readReadingPreferences)
  const [assistantActions, setAssistantActions] = useState<AssistantActionSettings>(readAssistantActionSettings)
  const [books, setBooks] = useState<BookRecord[]>([])
  const [activeBook, setActiveBook] = useState<BookRecord | null>(null)
  const [bookState, setBookState] = useState<LoadState>('idle')
  const [bookError, setBookError] = useState('')
  const [libraryState, setLibraryState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [libraryError, setLibraryError] = useState('')
  const [importing, setImporting] = useState(false)
  const [toc, setToc] = useState<TocItem[]>([])
  const [collapsedTocItems, setCollapsedTocItems] = useState<Set<string>>(() => new Set())
  const [leftView, setLeftView] = useState<LeftView>('library')
  const [rightView, setRightView] = useState<RightView>('assistant')
  const [selection, setSelection] = useState<SelectionContext | null>(null)
  const [selectionDraft, setSelectionDraft] = useState<ReaderSelectionDraft | null>(null)
  const [conversationSelection, setConversationSelection] = useState<SelectionContext | null>(null)
  const [turns, setTurns] = useState<ConversationTurn[]>([])
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [insights, setInsights] = useState<SavedInsight[]>([])
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [highlights, setHighlights] = useState<HighlightRecord[]>([])
  const [highlightsLoading, setHighlightsLoading] = useState(false)
  const [pendingDeleteHighlightId, setPendingDeleteHighlightId] = useState<string | null>(null)
  const [currentLocator, setCurrentLocator] = useState<string | null>(null)
  const [naturalLocator, setNaturalLocator] = useState<string | null>(null)
  const [currentChapterProgress, setCurrentChapterProgress] = useState(0)
  const [currentChapterTitle, setCurrentChapterTitle] = useState('')
  const [currentChapterHref, setCurrentChapterHref] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [executedSearchQuery, setExecutedSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ReadonlyArray<ReaderSearchResult>>([])
  const [searchState, setSearchState] = useState<SearchState>('idle')
  const [searchError, setSearchError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSectionId>('appearance')
  const [assistantDialogOpen, setAssistantDialogOpen] = useState(false)
  const [assistantDialogSource, setAssistantDialogSource] = useState<AssistantDialogSource>('conversation')
  const [archiveSession, setArchiveSession] = useState<ArchiveSessionState | null>(null)
  const [archiveDraft, setArchiveDraft] = useState('')
  const [detailsBook, setDetailsBook] = useState<BookRecord | null>(null)
  const [pendingDeleteInsightId, setPendingDeleteInsightId] = useState<string | null>(null)
  const [provider, setProvider] = useState<ProviderSettings>(EMPTY_PROVIDER)
  const [providerConnection, setProviderConnection] = useState<ProviderConnectionState>({
    status: 'not-configured',
    message: providerStatusLabel('not-configured')
  })
  const [toast, setToast] = useState<ToastState | null>(null)

  const hostRef = useRef<HTMLDivElement>(null)
  const readerSurfaceRef = useRef<HTMLElement>(null)
  const selectionToolbarRef = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<ReaderAdapter | null>(null)
  const activeBookRef = useRef<BookRecord | null>(null)
  const activeRequestRef = useRef<string | null>(null)
  const requestSessionRef = useRef(new Map<string, AssistantSession>())
  const archiveSessionRef = useRef<ArchiveSessionState | null>(null)
  const openSequenceRef = useRef(0)
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastProgressFlushRef = useRef(0)
  const closingRef = useRef(false)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingProgressRef = useRef<{ bookId: string; locator: string; progress: number } | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const followupRef = useRef<HTMLTextAreaElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const settingsReturnFocusRef = useRef<HTMLButtonElement>(null)
  const assistantExpandButtonRef = useRef<HTMLButtonElement>(null)
  const detailsReturnFocusRef = useRef<HTMLButtonElement>(null)
  const assistantDialogRef = useRef<HTMLElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const readingPreferencesRef = useRef(readingPreferences)
  const preferencesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const naturalPositionRef = useRef<{ locator: string | null; progress: number }>({ locator: null, progress: 0 })
  const chapterTitleOverrideRef = useRef<string | null>(null)
  const providerRevisionRef = useRef(0)
  const providerCheckSequenceRef = useRef(0)
  const requestProviderRevisionRef = useRef(new Map<string, number>())
  const searchSequenceRef = useRef(0)

  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  const openSettings = useCallback((section: SettingsSectionId, trigger: HTMLButtonElement): void => {
    settingsReturnFocusRef.current = trigger
    setSettingsInitialSection(section)
    setSettingsOpen(true)
  }, [])
  const closeAssistantDialog = useCallback(() => setAssistantDialogOpen(false), [])
  const closeBookDetails = useCallback(() => setDetailsBook(null), [])
  const openBookDetails = useCallback((book: BookRecord, trigger: HTMLButtonElement): void => {
    detailsReturnFocusRef.current = trigger
    setDetailsBook(book)
  }, [])
  useDialogFocus(assistantDialogOpen, closeAssistantDialog, assistantDialogRef, assistantExpandButtonRef)

  useEffect(() => {
    activeBookRef.current = activeBook
  }, [activeBook])

  useEffect(() => {
    archiveSessionRef.current = archiveSession
  }, [archiveSession])

  useEffect(() => {
    if (leftView !== 'search') return undefined
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [leftView])

  useLayoutEffect(() => {
    try {
      window.localStorage.setItem(INTERFACE_SCALE_STORAGE_KEY, String(interfaceScale))
    } catch {
      // Scaling remains active for this session when storage is unavailable.
    }
    document.documentElement.dataset.interfaceScale = String(interfaceScale)
  }, [interfaceScale])

  useLayoutEffect(() => {
    const systemTheme = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null

    const applyTheme = (): void => {
      const nextTheme = themePreference === 'system'
        ? (systemTheme?.matches ? 'dark' : 'light')
        : themePreference
      setResolvedTheme(nextTheme)
      document.documentElement.dataset.theme = nextTheme
      document.documentElement.dataset.themePreference = themePreference
      document.documentElement.style.colorScheme = nextTheme
    }

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themePreference)
    } catch {
      // Theme switching still works for this session when storage is unavailable.
    }

    applyTheme()
    if (themePreference !== 'system' || !systemTheme) return undefined

    systemTheme.addEventListener('change', applyTheme)
    return () => systemTheme.removeEventListener('change', applyTheme)
  }, [themePreference])

  useEffect(() => {
    activeRequestRef.current = activeRequestId
  }, [activeRequestId])

  const pushToast = useCallback((message: string, tone: ToastState['tone'] = 'neutral'): void => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ id: Date.now(), tone, message })
    toastTimerRef.current = setTimeout(() => setToast(null), 3200)
  }, [])

  const commitProviderSettings = useCallback((settings: ProviderSettings): number => {
    const revision = providerRevisionRef.current + 1
    providerRevisionRef.current = revision
    providerCheckSequenceRef.current += 1
    setProvider(settings)
    const status: ProviderConnectionStatus = providerIsConfigured(settings) ? 'checking' : 'not-configured'
    setProviderConnection({ status, message: providerStatusLabel(status) })
    return revision
  }, [])

  const runProviderCheck = useCallback(async (revision: number): Promise<ProviderCheckOutcome> => {
    const sequence = providerCheckSequenceRef.current + 1
    providerCheckSequenceRef.current = sequence
    if (revision === providerRevisionRef.current) {
      setProviderConnection({ status: 'checking', message: providerStatusLabel('checking') })
    }
    let result: ProviderTestResult
    try {
      result = await window.readerApi.testProvider()
    } catch (error) {
      result = { ok: false, message: readableError(error, copy('provider.backgroundTestFailed')) }
    }
    const current = revision === providerRevisionRef.current && sequence === providerCheckSequenceRef.current
    if (current) {
      const status: ProviderConnectionStatus = result.ok ? 'connected' : 'disconnected'
      setProviderConnection({ status, message: result.message || providerStatusLabel(status) })
    }
    return { ...result, current }
  }, [])

  const handleProviderSaved = useCallback((settings: ProviderSettings): void => {
    const revision = commitProviderSettings(settings)
    if (!providerIsConfigured(settings)) return
    const check = runProviderCheck(revision)
    const sequence = providerCheckSequenceRef.current
    void check.then((result) => {
      if (!result.ok && revision === providerRevisionRef.current && sequence === providerCheckSequenceRef.current) {
        pushToast(result.message || copy('provider.backgroundTestFailed'), 'error')
      }
    })
  }, [commitProviderSettings, pushToast, runProviderCheck])

  const handleProviderTest = useCallback(async (settings: ProviderSettings): Promise<ProviderCheckOutcome> => {
    const revision = commitProviderSettings(settings)
    if (!providerIsConfigured(settings)) {
      return { ok: false, message: providerStatusLabel('not-configured'), current: true }
    }
    return runProviderCheck(revision)
  }, [commitProviderSettings, runProviderCheck])

  useEffect(() => {
    readingPreferencesRef.current = readingPreferences
    try {
      window.localStorage.setItem(READING_PREFERENCES_STORAGE_KEY, JSON.stringify(readingPreferences))
    } catch {
      // Reading preferences remain active for this session when storage is unavailable.
    }
    if (!adapterRef.current) return undefined
    if (preferencesTimerRef.current) clearTimeout(preferencesTimerRef.current)
    preferencesTimerRef.current = setTimeout(() => {
      preferencesTimerRef.current = null
      void adapterRef.current?.setPreferences(readingPreferences).catch((error) => {
        pushToast(readableError(error, copy('reader.preferencesFailed')), 'error')
      })
    }, 220)
    return () => {
      if (preferencesTimerRef.current) clearTimeout(preferencesTimerRef.current)
    }
  }, [pushToast, readingPreferences])

  useEffect(() => {
    persistAssistantActionSettings(normalizeAssistantActionSettings(assistantActions))
  }, [assistantActions])

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

  const refreshInsights = useCallback(async (bookId: string): Promise<void> => {
    setInsightsLoading(true)
    try {
      const records = await window.readerApi.listInsights(bookId)
      if (activeBookRef.current?.id === bookId) setInsights(records)
    } catch (error) {
      pushToast(readableError(error, copy('insights.readFailed')), 'error')
    } finally {
      setInsightsLoading(false)
    }
  }, [pushToast])

  const refreshHighlights = useCallback(async (bookId: string): Promise<void> => {
    setHighlightsLoading(true)
    try {
      const records = await window.readerApi.listHighlights(bookId)
      if (activeBookRef.current?.id !== bookId) return
      setHighlights(records)
      const adapter = adapterRef.current
      if (adapter) {
        await adapter.setHighlights(records)
      }
    } catch (error) {
      pushToast(readableError(error, copy('highlights.readFailed')), 'error')
    } finally {
      setHighlightsLoading(false)
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
    searchSequenceRef.current += 1
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
    setSelectionDraft(null)
    setConversationSelection(null)
    setTurns([])
    setArchiveSession(null)
    setArchiveDraft('')
    archiveSessionRef.current = null
    setActiveRequestId(null)
    activeRequestRef.current = null
    requestSessionRef.current.clear()
    setToc([])
    setCollapsedTocItems(new Set())
    setInsights([])
    setHighlights([])
    setPendingDeleteHighlightId(null)
    setCurrentLocator(book.lastLocator)
    setNaturalLocator(book.lastLocator)
    setCurrentChapterProgress(0)
    setCurrentChapterTitle('')
    setCurrentChapterHref(null)
    setSearchQuery('')
    setSearchResults([])
    setSearchState('idle')
    setSearchError('')
    naturalPositionRef.current = { locator: book.lastLocator, progress: book.progress }

    try {
      const payload = await window.readerApi.readBook(book.id)
      if (sequence !== openSequenceRef.current || !hostRef.current) return
      const adapter = createReaderAdapter(book.format, hostRef.current, {
        bookId: book.id,
        onRelocated: ({ locator, progress, chapterProgress, chapterTitle, chapterHref, reason }) => {
          setCurrentLocator(locator)
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
        onSelectionDraftChanged: setSelectionDraft,
        onNotice: ({ message, tone }) => pushToast(message, tone === 'info' ? 'neutral' : 'error')
      })
      adapterRef.current = adapter
      await adapter.setPreferences(readingPreferencesRef.current)
      const result = await adapter.open(payload.bytes, book.lastLocator)
      if (sequence !== openSequenceRef.current) {
        adapter.destroy()
        return
      }
      setToc(result.toc)
      setBookState('ready')
      setLeftView('toc')
      void refreshInsights(book.id)
      void refreshHighlights(book.id)

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
      setBookError(readableError(error, copy('reader.openFailed')))
    }
  }, [destroyReader, pushToast, refreshHighlights, refreshInsights, scheduleProgress])

  useEffect(() => {
    let alive = true
    const initialize = async (): Promise<void> => {
      if (!window.readerApi) {
        setLibraryState('error')
        setLibraryError(copy('reader.bridgeFailed'))
        return
      }
      const [, settings] = await Promise.all([
        refreshBooks(),
        window.readerApi.getProviderSettings().catch(() => EMPTY_PROVIDER)
      ])
      if (!alive || providerRevisionRef.current !== 0) return
      const revision = commitProviderSettings(settings)
      if (providerIsConfigured(settings)) void runProviderCheck(revision)
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
  }, [commitProviderSettings, destroyReader, refreshBooks, runProviderCheck])

  const persistArchiveHistory = useCallback(async (insightId: string, sessionTurns: ConversationTurn[]): Promise<void> => {
    const bookId = activeBookRef.current?.id
    if (!bookId) return
    const history = historyFromTurns(sessionTurns)
    if (history.length < 2) return
    try {
      const updated = await window.readerApi.updateInsightHistory({ bookId, id: insightId, history })
      setInsights((current) => current.map((insight) => insight.id === updated.id ? { ...insight, history: updated.history } : insight))
    } catch (error) {
      pushToast(readableError(error, copy('insights.saveFailed')), 'error')
    }
  }, [pushToast])

  useEffect(() => {
    if (!window.readerApi) return undefined
    return window.readerApi.onLlmEvent((event: LlmEvent) => {
      const session = requestSessionRef.current.get(event.requestId) ?? 'conversation'
      const applyUpdate = (current: ConversationTurn[]): ConversationTurn[] => current.map((turn) => {
        if (turn.requestId !== event.requestId) return turn
        if (event.type === 'delta') return { ...turn, answer: turn.answer + event.delta }
        if (event.type === 'usage') return { ...turn, usage: event.usage }
        if (event.type === 'completed') return { ...turn, model: event.model, status: 'completed' }
        return { ...turn, status: 'error', error: event.message }
      })
      if (session === 'archive') {
        const current = archiveSessionRef.current
        if (current) {
          const turns = applyUpdate(current.turns)
          const next = { ...current, turns }
          archiveSessionRef.current = next
          setArchiveSession(next)
          if (event.type === 'completed') void persistArchiveHistory(current.insightId, turns)
        }
      } else {
        setTurns(applyUpdate)
      }

      if (event.type === 'completed' || event.type === 'error') {
        const requestRevision = requestProviderRevisionRef.current.get(event.requestId)
        if (requestRevision === providerRevisionRef.current) {
          if (event.type === 'completed') {
            providerCheckSequenceRef.current += 1
            setProviderConnection({ status: 'connected', message: providerStatusLabel('connected') })
          } else if (event.code !== 'CANCELLED') {
            providerCheckSequenceRef.current += 1
            setProviderConnection({ status: 'disconnected', message: event.message })
          }
        }
        requestProviderRevisionRef.current.delete(event.requestId)
        requestSessionRef.current.delete(event.requestId)
        if (activeRequestRef.current === event.requestId) {
          activeRequestRef.current = null
          setActiveRequestId(null)
        }
      }
    })
  }, [persistArchiveHistory])
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
      pushToast(result.duplicate ? copy('library.duplicateToast') : copy('library.importedToast'), result.duplicate ? 'neutral' : 'success')
      await openBook(result.book)
    } catch (error) {
      pushToast(readableError(error, copy('library.importFailed')), 'error')
    } finally {
      setImporting(false)
    }
  }, [importing, openBook, pushToast, refreshBooks])

  const openSearchView = useCallback((): void => {
    if (!activeBookRef.current || !adapterRef.current) return
    setLeftView('search')
  }, [])

  const runSearch = useCallback(async (value: string): Promise<void> => {
    const query = value.trim()
    const queryLength = Array.from(query).length
    if (queryLength < 1 || queryLength > READER_SEARCH_QUERY_MAX_LENGTH) {
      searchSequenceRef.current += 1
      setSearchResults([])
      setExecutedSearchQuery('')
      setSearchState('error')
      setSearchError(copy('reader.searchInvalid'))
      return
    }
    const adapter = adapterRef.current
    const bookId = activeBookRef.current?.id
    if (!adapter || !bookId) return
    const sequence = ++searchSequenceRef.current
    setSearchState('searching')
    setSearchError('')
    try {
      const results = await adapter.search(query)
      if (
        sequence !== searchSequenceRef.current ||
        adapterRef.current !== adapter ||
        activeBookRef.current?.id !== bookId
      ) return
      setSearchResults(results)
      setExecutedSearchQuery(query)
      setSearchState('ready')
    } catch (error) {
      if (sequence !== searchSequenceRef.current || adapterRef.current !== adapter) return
      setSearchResults([])
      setExecutedSearchQuery('')
      setSearchState('error')
      setSearchError(readableError(error, copy('reader.searchFailed')))
    }
  }, [])

  const submitSearch = useCallback((event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void runSearch(searchQuery)
  }, [runSearch, searchQuery])

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
      if (event.key === 'Escape' && !settingsOpen && !assistantDialogOpen && !detailsBook) {
        adapterRef.current?.clearSelection()
        setSelection(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [assistantDialogOpen, bookState, detailsBook, openSearchView, settingsOpen])

  const startRequest = useCallback(async (action: LlmAction, question: string, sourceSelection?: SelectionContext, session: AssistantSession = 'conversation'): Promise<void> => {
    const cleanQuestion = question.trim()
    if (!cleanQuestion || activeRequestRef.current) return
    const currentArchive = session === 'archive' ? archiveSession : null
    if (session === 'archive' && !currentArchive) return

    const context = session === 'archive'
      ? currentArchive?.selection
      : (sourceSelection ?? conversationSelection ?? selection)
    if (!context) return

    const sessionTurns = currentArchive ? currentArchive.turns : turns
    const priorTurns = sessionTurns.filter((turn) => turn.status === 'completed' && turn.answer)
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
      status: 'streaming'
    }

    if (session === 'archive' && currentArchive) {
      const next = { ...currentArchive, turns: [...currentArchive.turns, turn] }
      archiveSessionRef.current = next
      setArchiveSession(next)
      setArchiveDraft('')
    } else {
      const newContext = !conversationSelection || conversationSelection.anchor !== context.anchor
      setConversationSelection(context)
      setTurns(newContext ? [turn] : [...turns, turn])
      setDraft('')
      setRightView('assistant')
    }
    adapterRef.current?.clearSelection()
    setSelection(null)
    setActiveRequestId(requestId)
    activeRequestRef.current = requestId
    requestSessionRef.current.set(requestId, session)
    const providerRevision = providerRevisionRef.current
    requestProviderRevisionRef.current.set(requestId, providerRevision)

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
      const message = readableError(error, copy('error.requestStartFailed'))
      const markFailed = (current: ConversationTurn[]): ConversationTurn[] => current.map((item) => (
        item.requestId === requestId ? { ...item, status: 'error', error: message } : item
      ))
      if (session === 'archive') {
        setArchiveSession((current) => current ? { ...current, turns: markFailed(current.turns) } : current)
      } else {
        setTurns(markFailed)
      }
      activeRequestRef.current = null
      setActiveRequestId(null)
      requestProviderRevisionRef.current.delete(requestId)
      requestSessionRef.current.delete(requestId)
      if (providerRevision === providerRevisionRef.current) {
        providerCheckSequenceRef.current += 1
        setProviderConnection({ status: 'disconnected', message })
      }
    }
  }, [archiveSession, assistantActions, conversationSelection, provider.model, selection, turns])
  // 划词工具栏跟随选区:出现时同步定位,滚动/缩放时按帧重算并直接写样式,
  // 避免经过 React 状态造成级联渲染。
  useLayoutEffect(() => {
    const toolbar = selectionToolbarRef.current
    const surface = readerSurfaceRef.current
    if (!toolbar || !surface || !selection || bookState !== 'ready') return

    const position = (): void => {
      const anchor = findSelectionAnchorRect(hostRef.current)
      const surfaceRect = surface.getBoundingClientRect()
      const toolbarWidth = toolbar.offsetWidth
      const toolbarHeight = toolbar.offsetHeight
      let left: number
      let top: number
      if (anchor) {
        const anchorTop = anchor.top - surfaceRect.top
        const anchorBottom = anchor.bottom - surfaceRect.top
        const anchorCenterX = anchor.centerX - surfaceRect.left
        top = anchorTop - toolbarHeight - 10
        if (top < 4) top = anchorBottom + 10
        left = anchorCenterX - toolbarWidth / 2
      } else {
        left = (surfaceRect.width - toolbarWidth) / 2
        top = surfaceRect.height - toolbarHeight - 24
      }
      left = Math.max(8, Math.min(left, surfaceRect.width - toolbarWidth - 8))
      top = Math.max(4, Math.min(top, surfaceRect.height - toolbarHeight - 4))
      toolbar.style.left = `${Math.round(left)}px`
      toolbar.style.top = `${Math.round(top)}px`
    }

    position()
    let frame = 0
    const schedulePosition = (): void => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        position()
      })
    }
    window.addEventListener('scroll', schedulePosition, true)
    window.addEventListener('resize', schedulePosition)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedulePosition, true)
      window.removeEventListener('resize', schedulePosition)
    }
  }, [selection, bookState, interfaceScale])

  const handleSelectionAction = (action: LlmAction): void => {
    if (!selection) return
    if (action === 'ask') {
      const isNew = !conversationSelection || conversationSelection.anchor !== selection.anchor
      setConversationSelection(selection)
      if (isNew) setTurns([])
      setRightView('assistant')
      adapterRef.current?.clearSelection()
      setSelection(null)
      window.setTimeout(() => followupRef.current?.focus(), 0)
      return
    }
    void startRequest(action, assistantActions[action].prompt, selection)
  }

  const cancelRequest = async (): Promise<void> => {
    const requestId = activeRequestRef.current
    if (!requestId) return
    const session = requestSessionRef.current.get(requestId) ?? 'conversation'
    try {
      await window.readerApi.cancelLlm(requestId)
    } finally {
      const markCancelled = (current: ConversationTurn[]): ConversationTurn[] => current.map((turn) => (
        turn.requestId === requestId
          ? {
              ...turn,
              status: 'error',
              error: turn.answer ? copy('assistant.cancelledPartial') : copy('assistant.cancelledEmpty')
            }
          : turn
      ))
      if (session === 'archive') {
        setArchiveSession((current) => current ? { ...current, turns: markCancelled(current.turns) } : current)
      } else {
        setTurns(markCancelled)
      }
      activeRequestRef.current = null
      setActiveRequestId(null)
      requestSessionRef.current.delete(requestId)
    }
  }

  useEffect(() => {
    if (assistantDialogOpen || assistantDialogSource !== 'archive') return
    const requestId = activeRequestRef.current
    if (!requestId) return
    void window.readerApi.cancelLlm(requestId).catch(() => undefined)
    const session = requestSessionRef.current.get(requestId)
    if (session === 'archive') {
      setArchiveSession((current) => current ? { ...current, turns: current.turns.map((turn) => (
        turn.requestId === requestId
          ? { ...turn, status: 'error', error: turn.answer ? copy('assistant.cancelledPartial') : copy('assistant.cancelledEmpty') }
          : turn
      )) } : current)
    }
    activeRequestRef.current = null
    setActiveRequestId(null)
    requestSessionRef.current.delete(requestId)
  }, [assistantDialogOpen, assistantDialogSource])

  const submitQuestion = (event: FormEvent): void => {
    event.preventDefault()
    if (!conversationSelection || !draft.trim()) return
    void startRequest('ask', draft)
  }

  const submitArchiveQuestion = (event: FormEvent): void => {
    event.preventDefault()
    if (!archiveSession || !archiveDraft.trim()) return
    void startRequest('ask', archiveDraft, undefined, 'archive')
  }
  const handleComposerKey = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  const navigateToAnchor = useCallback(async (anchor: string, showSelection = false): Promise<void> => {
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
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
      highlightTimerRef.current = setTimeout(() => {
        adapter.clearHighlight()
        highlightTimerRef.current = null
      }, 2_800)
    } catch (error) {
      pushToast(readableError(error, copy('reader.navigateSourceFailed')), 'error')
    }
  }, [pushToast])

  const navigateToSearchResult = useCallback(async (result: ReaderSearchResult): Promise<void> => {
    chapterTitleOverrideRef.current = result.chapterTitle
    await navigateToAnchor(result.anchor)
    setCurrentLocator(result.anchor)
    setCurrentChapterTitle(result.chapterTitle)
    setCurrentChapterProgress(0)
  }, [navigateToAnchor])

  const openInsight = useCallback((insight: SavedInsight): void => {
    const requestId = activeRequestRef.current
    if (requestId) {
      activeRequestRef.current = null
      setActiveRequestId(null)
      requestSessionRef.current.delete(requestId)
      void window.readerApi.cancelLlm(requestId).catch(() => undefined)
    }
    adapterRef.current?.clearSelection()
    setSelection(null)
    const session: ArchiveSessionState = {
      insightId: insight.id,
      selection: insight.selection,
      turns: turnsFromInsight(insight)
    }
    archiveSessionRef.current = session
    setArchiveSession(session)
    setArchiveDraft('')
    setAssistantDialogSource('archive')
    setAssistantDialogOpen(true)
  }, [])
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
      chapterTitleOverrideRef.current = null
      await adapter.goTo(target)
      setCurrentLocator(target)
    } catch (error) {
      pushToast(readableError(error, copy('reader.navigateChapterFailed')), 'error')
    }
  }, [pushToast])

  const saveSelectionHighlight = async (): Promise<void> => {
    if (!selection || !activeBook) return
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
    try {
      const target = insights.find((insight) => insight.id === insightId)
      const deleted = await window.readerApi.deleteInsight(insightId)
      setPendingDeleteInsightId(null)
      setInsights((current) => current.filter((insight) => insight.id !== insightId))
      if (archiveSessionRef.current?.insightId === insightId) {
        archiveSessionRef.current = null
        setArchiveSession(null)
        setArchiveDraft('')
        if (assistantDialogSource === 'archive' && assistantDialogOpen) setAssistantDialogOpen(false)
      }
      if (target) {
        setTurns((current) => current.map((turn) => turn.question === target.question && turn.answer === target.answer ? { ...turn, saved: false } : turn))
      }
      if (!deleted && activeBook) void refreshInsights(activeBook.id)
      pushToast(deleted ? copy('insights.removed') : copy('insights.alreadyRemoved'), 'neutral')
    } catch (error) {
      pushToast(readableError(error, copy('insights.removeFailed')), 'error')
    }
  }

  const saveTurn = async (turn: ConversationTurn): Promise<void> => {
    if (!activeBook || turn.status !== 'completed' || !turn.answer || turn.saved) return
    try {
      await window.readerApi.saveInsight({
        bookId: activeBook.id,
        selection: turn.selection,
        question: turn.question,
        answer: turn.answer,
        model: turn.model || provider.model
      })
      setTurns((current) => current.map((item) => item.id === turn.id ? { ...item, saved: true } : item))
      await refreshInsights(activeBook.id)
      pushToast(copy('insights.savedToast'), 'success')
    } catch (error) {
      pushToast(readableError(error, copy('insights.saveFailed')), 'error')
    }
  }

  const canAsk = Boolean(conversationSelection && !activeRequestId)
  const canAskArchive = Boolean(archiveSession && !activeRequestId)
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

  return (
    <div
      className="app-shell"
      data-testid="app-shell"
      data-theme={resolvedTheme}
      data-theme-preference={themePreference}
      data-interface-scale={interfaceScale}
    >
      <aside className="left-sidebar">
        <header className="brand-row">
          <div className="brand-copy">
            <strong>{copy('app.name')}</strong>
          </div>
        </header>

        <nav className="sidebar-tabs" aria-label={copy('library.navAria')}>
          <button className={leftView === 'library' ? 'is-active' : ''} data-testid="library-tab" type="button" onClick={() => setLeftView('library')}>
            <Library size={15} />{copy('library.tabLibrary')}<span>{books.length}</span>
          </button>
          <button className={leftView === 'toc' ? 'is-active' : ''} type="button" onClick={() => setLeftView('toc')} disabled={!activeBook}>
            <PanelLeftClose size={15} />{copy('library.tabToc')}
          </button>
          <button className={leftView === 'highlights' ? 'is-active' : ''} data-testid="highlights-tab" type="button" onClick={() => setLeftView('highlights')} disabled={!activeBook}>
            <Bookmark size={15} />{copy('library.tabHighlights')}
          </button>
        </nav>

        <div className="sidebar-content">
          {leftView === 'library' && (
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
              {books.map((book) => (
                <div className={'book-item ' + (activeBook?.id === book.id ? 'is-active' : '')} key={book.id}>
                  <button
                    className="book-item-open"
                    data-testid="book-item"
                    data-book-id={book.id}
                    data-source-format={book.sourceFormat}
                    type="button"
                    onClick={() => void openBook(book)}
                  >
                    <BookCover book={book} />
                    <span className="book-meta">
                      <strong title={book.title}>{book.title}</strong>
                      <small>{book.author || bookFallbackDescription(book)}</small>
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

          {leftView === 'toc' && (
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

          {leftView === 'highlights' && (
            <div className="highlight-list" data-testid="highlight-list" aria-label={copy('library.highlightsAria')}>
              <div className="highlight-list-heading">
                <h2>{copy('highlights.title')}</h2>
                <span>{copy('highlights.count', { count: highlights.length })}</span>
              </div>
              {highlightsLoading && <div className="sidebar-loading"><LoaderCircle className="spin" size={17} /> {copy('highlights.loading')}</div>}
              {!highlightsLoading && !activeBook && <EmptyState icon={<Bookmark size={20} />} title={copy('highlights.noBookTitle')} detail={copy('highlights.noBookDetail')} />}
              {!highlightsLoading && activeBook && highlights.length === 0 && <EmptyState icon={<Bookmark size={20} />} title={copy('highlights.emptyTitle')} detail={copy('highlights.emptyDetail')} />}
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

          {leftView === 'search' && (
            <div className="reader-search" data-testid="reader-search" aria-label={copy('reader.searchTitle')}>
              <div className="reader-search-heading">
                <h2>{copy('reader.searchTitle')}</h2>
                <button
                  className="icon-button"
                  data-testid="reader-search-close"
                  type="button"
                  aria-label={copy('reader.searchClose')}
                  title={copy('reader.searchClose')}
                  onClick={() => setLeftView('toc')}
                >
                  <X size={15} />
                </button>
              </div>
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

        <footer className="sidebar-footer">
          {leftView === 'library' && (
            <button className="import-button" data-testid="import-book" type="button" onClick={() => void importBook()} disabled={importing}>
              {importing ? <LoaderCircle className="spin" size={17} /> : <Import size={17} />}
              <span>{importing ? copy('library.importing') : copy('library.import')}</span>
            </button>
          )}
          <button ref={settingsButtonRef} className="settings-entry" data-testid="settings-button" type="button" onClick={(event) => openSettings('appearance', event.currentTarget)}>
            <Settings size={16} />
            <span>{copy('settings.title')}</span>
            <i
              className={`connection-status-dot is-${providerConnection.status}`}
              data-testid="provider-connection-status"
              role="status"
              aria-label={providerStatusLabel(providerConnection.status)}
              title={providerConnection.message || providerStatusLabel(providerConnection.status)}
            />
          </button>
        </footer>
      </aside>

      <main className="reader-column" data-current-chapter-title={currentChapterTitle}>
        <header className="reader-header">
          {activeBook ? (
            <>
              <div className="reader-heading">
                <span className="format-chip">{activeBook.sourceFormat.toUpperCase()}</span>
                <div>
                  <h1>{activeBook.title}</h1>
                  <p>{activeBook.author || copy('common.unknownAuthor')}</p>
                </div>
              </div>
              <div className="reader-header-actions">
                <button className="icon-button" data-testid="reader-search-button" type="button" aria-label={copy('reader.searchOpen')} title={copy('reader.searchOpen')} onClick={openSearchView}><Search size={17} /></button>
                <button className="icon-button" data-testid="book-details-button" type="button" aria-label={copy('bookDetails.openAria', { title: activeBook.title })} title={copy('bookDetails.openAria', { title: activeBook.title })} onClick={(event) => openBookDetails(activeBook, event.currentTarget)}><Info size={17} /></button>
                <button className="icon-button reader-settings-button" data-testid="reader-return-button" type="button" aria-label={copy('reader.returnToReading')} title={copy('reader.returnToReading')} disabled={bookState !== 'ready' || !naturalLocator || currentLocator === naturalLocator} onClick={() => void returnToReading()}><ArrowLeft size={17} /></button>
                <button className="icon-button reader-settings-button" data-testid="reader-settings-button" type="button" aria-label={copy('reader.readingSettings')} title={copy('reader.readingSettings')} onClick={(event) => openSettings('reading', event.currentTarget)}><SlidersHorizontal size={17} /></button>
                <div className="reading-progress">
                  <span
                    aria-label={currentChapterTitle || copy('common.currentChapter')}
                    title={currentChapterTitle || copy('common.currentChapter')}
                  >{currentChapterTitle || copy('common.currentChapter')}</span>
                  <strong>{Math.round(currentChapterProgress * 100)}%</strong>
                  <div><i style={{ width: `${Math.max(0, Math.min(100, currentChapterProgress * 100))}%` }} /></div>
                </div>
              </div>
            </>
          ) : (
            <div className="reader-heading is-empty"><span className="visually-hidden">{copy('reader.areaAria')}</span></div>
          )}
        </header>

        <section ref={readerSurfaceRef} className={`reader-surface is-${bookState}`} data-paper-theme={readingPreferences.paperTheme}>
          <div className="reader-host" data-testid="reader-host" ref={hostRef} aria-label={copy('reader.areaAria')} />

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
                  onClick={() => void importBook()}
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
              <button data-testid="action-explain" data-icon={assistantActions.explain.icon} type="button" title={assistantActions.explain.label} onClick={() => handleSelectionAction('explain')}><AssistantActionIconView icon={assistantActions.explain.icon} size={15} />{assistantActions.explain.label}</button>
              <button data-testid="action-context" data-icon={assistantActions.context.icon} type="button" title={assistantActions.context.label} onClick={() => handleSelectionAction('context')}><AssistantActionIconView icon={assistantActions.context.icon} size={15} />{assistantActions.context.label}</button>
              <button data-testid="action-ask" data-icon={assistantActions.ask.icon} type="button" title={assistantActions.ask.label} onClick={() => handleSelectionAction('ask')}><AssistantActionIconView icon={assistantActions.ask.icon} size={15} />{assistantActions.ask.label}</button>
              <button data-testid="action-save-highlight" type="button" onClick={() => void saveSelectionHighlight()}><Bookmark size={15} />{copy('assistant.actionSaveHighlight')}</button>
              <button className="toolbar-close" type="button" onClick={() => { adapterRef.current?.clearSelection(); setSelection(null) }} aria-label={copy('assistant.selectionCloseAria')}><X size={14} /></button>
            </div>
          )}
        </section>
      </main>

      <aside className="right-sidebar" data-testid="ai-panel">
        <header className="assistant-header">
          <div className="assistant-title"><span><Sparkles size={16} /></span><strong>{copy('assistant.title')}</strong></div>
          <div className="assistant-header-actions">
            <button ref={assistantExpandButtonRef} className="icon-button" data-testid="assistant-expand-button" type="button" aria-label={copy('assistant.expandDialog')} title={copy('assistant.expandDialog')} onClick={() => { setAssistantDialogSource('conversation'); setAssistantDialogOpen(true) }}><Maximize2 size={17} /></button>
            <WindowControls />
          </div>
        </header>

        <nav className="assistant-tabs" aria-label={copy('assistant.viewsAria')}>
          <button className={rightView === 'assistant' ? 'is-active' : ''} type="button" onClick={() => setRightView('assistant')}>{copy('assistant.tabConversation')}</button>
          <button className={rightView === 'insights' ? 'is-active' : ''} data-testid="insights-tab" type="button" onClick={() => setRightView('insights')}>
            {copy('assistant.tabInsights')}{insights.length > 0 && <span>{insights.length}</span>}
          </button>
        </nav>

        {rightView === 'assistant' && !assistantDialogOpen && (
          <ConversationPane conversationSelection={conversationSelection} turns={turns} provider={provider} activeRequestId={activeRequestId} draft={draft} canAsk={canAsk} followupRef={followupRef} onDraftChange={setDraft} onNavigate={(anchor) => void navigateToAnchor(anchor)} onSave={(turn) => void saveTurn(turn)} onCancel={() => void cancelRequest()} onSubmit={submitQuestion} onComposerKey={handleComposerKey} />
        )}

        {rightView === 'insights' && (
          <div className="insights-view">
            {insightsLoading && <div className="sidebar-loading"><LoaderCircle className="spin" size={17} /> {copy('insights.loading')}</div>}
            {!insightsLoading && !activeBook && <EmptyState icon={<Bookmark size={20} />} title={copy('insights.noBookTitle')} detail={copy('insights.noBookDetail')} />}
            {!insightsLoading && activeBook && insights.length === 0 && <EmptyState icon={<Bookmark size={20} />} title={copy('insights.emptyTitle')} detail={copy('insights.emptyDetail')} />}
            <div className="insight-list">
              {insights.map((insight) => (
                <article
                  className="insight-item"
                  data-testid="insight-item"
                  data-insight-id={insight.id}
                  key={insight.id}
                >
                  <div
                    className="insight-content"
                    role="button"
                    tabIndex={0}
                    onClick={() => void openInsight(insight)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openInsight(insight)
                      }
                    }}
                  >
                    <span className="insight-quote">“{insight.selection.quote}”</span>
                    <strong className="insight-question">{insight.question}</strong>
                    <AnswerText text={insight.answer} selection={insight.selection} readOnly />
                  </div>
                  <footer>
                    <span>{insight.selection.chapterTitle || copy('common.currentChapter')} · {formatDate(insight.createdAt)}</span>
                    {pendingDeleteInsightId === insight.id ? (
                      <span className="insight-delete-confirmation">
                        <span>{copy('insights.removeQuestion')}</span>
                        <button data-testid="insight-delete-confirm" type="button" onClick={() => void deleteInsight(insight.id)}>{copy('common.confirm')}</button>
                        <button data-testid="insight-delete-cancel" type="button" onClick={() => setPendingDeleteInsightId(null)}>{copy('common.back')}</button>
                      </span>
                    ) : (
                      <span className="insight-actions">
                        <button type="button" onClick={() => void navigateToAnchor(insight.selection.anchor)}>{copy('insights.backToSource')} <ChevronRight size={12} /></button>
                        <button data-testid="insight-delete" type="button" aria-label={copy('insights.removeAria')} onClick={() => setPendingDeleteInsightId(insight.id)}><Trash2 size={13} /></button>
                      </span>
                    )}
                  </footer>
                </article>
              ))}
            </div>
          </div>
        )}
      </aside>

      {selectionDraft && <PdfSelectionReviewDialog draft={selectionDraft} />}

      {assistantDialogOpen && (
        <div className="modal-backdrop assistant-dialog-backdrop" role="presentation">
          <section ref={assistantDialogRef} className="assistant-dialog" data-testid="assistant-dialog" role="dialog" aria-modal="true" aria-labelledby="assistant-dialog-title">
            <header className="modal-header">
              <div><h2 id="assistant-dialog-title">{copy('assistant.dialogTitle')}</h2></div>
              <button className="icon-button" data-testid="assistant-dialog-close" type="button" onClick={closeAssistantDialog} aria-label={copy('assistant.closeDialog')}><X size={18} /></button>
            </header>
            <div className="assistant-dialog-body">
              {assistantDialogSource === 'archive' && archiveSession ? (
                <ConversationPane conversationSelection={archiveSession.selection} turns={archiveSession.turns} provider={provider} activeRequestId={activeRequestId} draft={archiveDraft} canAsk={canAskArchive} followupRef={followupRef} onDraftChange={setArchiveDraft} onNavigate={(anchor) => void navigateToAnchor(anchor)} onCancel={() => void cancelRequest()} onSubmit={submitArchiveQuestion} onComposerKey={handleComposerKey} showSave={false} />
              ) : (
                <ConversationPane conversationSelection={conversationSelection} turns={turns} provider={provider} activeRequestId={activeRequestId} draft={draft} canAsk={canAsk} followupRef={followupRef} onDraftChange={setDraft} onNavigate={(anchor) => void navigateToAnchor(anchor)} onSave={(turn) => void saveTurn(turn)} onCancel={() => void cancelRequest()} onSubmit={submitQuestion} onComposerKey={handleComposerKey} />
              )}
            </div>
          </section>
        </div>
      )}

      {settingsOpen && (
        <SettingsModal
          initial={provider}
          initialSection={settingsInitialSection}
          themePreference={themePreference}
          interfaceScale={interfaceScale}
          readingPreferences={readingPreferences}
          assistantActions={assistantActions}
          returnFocusRef={settingsReturnFocusRef}
          onClose={closeSettings}
          onSaved={handleProviderSaved}
          onTest={handleProviderTest}
          onThemeChange={setThemePreference}
          onInterfaceScaleChange={setInterfaceScale}
          onReadingPreferencesChange={setReadingPreferences}
          onAssistantActionsChange={setAssistantActions}
          pushToast={pushToast}
        />
      )}

      {detailsBook && (
        <BookDetailsModal
          key={detailsBook.id}
          book={detailsBook}
          returnFocusRef={detailsReturnFocusRef}
          onClose={closeBookDetails}
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
