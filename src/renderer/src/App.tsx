import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  FileText,
  Highlighter,
  Import,
  Library,
  LoaderCircle,
  MessageSquareText,
  Maximize2,
  PanelLeftClose,
  RefreshCw,
  Save,
  SearchX,
  Send,
  Settings,
  Sparkles,
  Trash2,
  Unplug,
  X
} from 'lucide-react'
import {
  type CSSProperties,
  type FormEvent,
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
  BookRecord,
  LlmAction,
  LlmEvent,
  LlmUsage,
  ProviderSettings,
  ProviderTestResult,
  SavedInsight,
  SelectionContext,
  TocItem
} from '@shared/contracts'
import { copy } from '@shared/copy'
import {
  createReaderAdapter,
  DEFAULT_READING_PREFERENCES,
  type ReaderAdapter,
  type ReadingPreferences
} from './readers'

type LeftView = 'library' | 'toc'
type RightView = 'assistant' | 'insights'
type LoadState = 'idle' | 'loading' | 'ready' | 'error'
type TurnStatus = 'streaming' | 'completed' | 'error'
type ThemePreference = 'light' | 'system' | 'dark'
type ResolvedTheme = Exclude<ThemePreference, 'system'>
type InterfaceScale = 90 | 100 | 110 | 125
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
  explain: copy('assistant.questionExplain'),
  context: copy('assistant.questionContext')
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
    const value = JSON.parse(window.localStorage.getItem(READING_PREFERENCES_STORAGE_KEY) ?? '{}') as Partial<ReadingPreferences>
    return {
      fontScale: typeof value.fontScale === 'number' && value.fontScale >= 80 && value.fontScale <= 140 ? value.fontScale : DEFAULT_READING_PREFERENCES.fontScale,
      lineHeight: value.lineHeight === '1.5' || value.lineHeight === '1.7' || value.lineHeight === '1.9' ? value.lineHeight : 'original',
      indent: value.indent === 'none' || value.indent === '2em' ? value.indent : 'original'
    }
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
  if (action === 'explain') return copy('assistant.actionExplain')
  if (action === 'context') return copy('assistant.actionContext')
  return copy('assistant.actionAsk')
}

function ProgressRing({ value }: { value: number }): ReactNode {
  const normalized = Math.max(0, Math.min(1, value || 0))
  return (
    <span
      className="progress-ring"
      style={{ '--progress': `${normalized * 360}deg` } as CSSProperties}
      aria-label={copy('reader.progressAria', { percent: Math.round(normalized * 100) })}
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
                  <span className="citation citation-unknown" title={copy('assistant.citationUnknownTitle')} key={partIndex}>
                    {part}<small>{copy('assistant.citationUnverified')}</small>
                  </span>
                )
              }
              return (
                <button
                  className="citation citation-valid"
                  key={partIndex}
                  type="button"
                  title={copy('assistant.citationJumpTitle', { passageId })}
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
  onComposerKey
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
  onSave: (turn: ConversationTurn) => void
  onCancel: () => void
  onSubmit: (event: FormEvent) => void
  onComposerKey: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void
}): ReactNode {
  const selectedPassageCount = conversationSelection?.passages.length ?? 0
  return (
    <>
      <div className="assistant-scroll">
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
                <div className="question-bubble"><span>{actionLabel(turn.action)}</span><p>{turn.question}</p></div>
                <div className="answer-card" data-testid={isLatest ? 'answer-current' : undefined}>
                  <div className="answer-label"><span><Sparkles size={13} /></span><strong className="answer-model" title={turn.model || provider.model || copy('assistant.modelUnavailable')}>{turn.model || provider.model || copy('assistant.modelUnavailable')}</strong></div>
                  {turn.answer && conversationSelection ? <CitationText text={turn.answer} selection={conversationSelection} onNavigate={onNavigate} /> : turn.status === 'streaming' ? <div className="answer-thinking"><i /><i /><i /><span>{copy('assistant.thinking')}</span></div> : null}
                  {turn.status === 'streaming' && turn.answer && <span className="stream-caret" aria-label={copy('assistant.generatingAria')} />}
                  {turn.error && <div className={`turn-error ${turn.answer ? 'is-muted' : ''}`}><AlertCircle size={14} />{turn.error}</div>}
                  {turn.status === 'completed' && (
                    <footer className="answer-footer">
                      <span>{turn.usage?.totalTokens ? copy('assistant.tokenUsage', { count: turn.usage.totalTokens }) : ''}</span>
                      <button data-testid={isLatest ? 'answer-save' : undefined} className={turn.saved ? 'is-saved' : ''} type="button" onClick={() => onSave(turn)} disabled={turn.saved}>
                        {turn.saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}{turn.saved ? copy('assistant.saved') : copy('assistant.save')}
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
        {activeRequestId && <button className="cancel-generation" data-testid="cancel-request" type="button" onClick={onCancel}><CircleStop size={14} />{copy('assistant.stop')}</button>}
        <form onSubmit={onSubmit}>
          <textarea data-testid="followup-input" ref={followupRef} value={draft} onChange={(event) => onDraftChange(event.target.value)} onKeyDown={onComposerKey} placeholder={conversationSelection ? (turns.length ? copy('assistant.placeholderFollowup') : copy('assistant.placeholderFirst')) : copy('assistant.placeholderNoSelection')} disabled={!canAsk} rows={2} maxLength={2000} />
          <button type="submit" aria-label={copy('assistant.sendAria')} disabled={!canAsk || !draft.trim()}><Send size={16} /></button>
        </form>
      </div>
    </>
  )
}

function SettingsModal({
  initial,
  themePreference,
  interfaceScale,
  readingPreferences,
  returnFocusRef,
  onClose,
  onSaved,
  onTest,
  onThemeChange,
  onInterfaceScaleChange,
  onReadingPreferencesChange,
  pushToast
}: {
  initial: ProviderSettings
  themePreference: ThemePreference
  interfaceScale: InterfaceScale
  readingPreferences: ReadingPreferences
  returnFocusRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
  onSaved: (settings: ProviderSettings) => void
  onTest: (settings: ProviderSettings) => Promise<ProviderCheckOutcome>
  onThemeChange: (preference: ThemePreference) => void
  onInterfaceScaleChange: (scale: InterfaceScale) => void
  onReadingPreferencesChange: (preferences: ReadingPreferences) => void
  pushToast: (message: string, tone?: ToastState['tone']) => void
}): ReactNode {
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl)
  const [model, setModel] = useState(initial.model)
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [preferenceStatus, setPreferenceStatus] = useState('')
  const keyRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const mountedRef = useRef(true)
  const testSequenceRef = useRef(0)

  useDialogFocus(true, onClose, dialogRef, returnFocusRef)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      testSequenceRef.current += 1
    }
  }, [])

  const announcePreference = (message: string): void => {
    setPreferenceStatus(message)
  }

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

        <div className="settings-sections">
          <section className="settings-section" aria-labelledby="appearance-settings-title">
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
                      onClick={() => { onThemeChange(option.value); announcePreference(copy('settings.themeChanged', { theme: option.label })) }}
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
                    onClick={() => { onInterfaceScaleChange(scale); announcePreference(copy('settings.scaleChanged', { scale })) }}
                  >{scale}%</button>
                ))}
              </div>
            </div>
          </section>

          <section className="settings-section" aria-labelledby="reading-settings-title">
            <div className="settings-section-heading">
              <h3 id="reading-settings-title">{copy('settings.readingTitle')}</h3>
              <button className="text-button" data-testid="reading-reset" type="button" onClick={() => { onReadingPreferencesChange({ ...DEFAULT_READING_PREFERENCES }); announcePreference(copy('settings.readingRestored')) }}>{copy('settings.restoreDefaults')}</button>
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
                onChange={(event) => { onReadingPreferencesChange({ ...readingPreferences, fontScale: Number(event.target.value) }); announcePreference(copy('settings.fontChanged', { scale: event.target.value })) }}
              />
            </label>
            <div className="settings-select-grid">
              <label htmlFor="reading-line-height"><span>{copy('settings.lineHeight')}</span><select id="reading-line-height" data-testid="reading-line-height" value={readingPreferences.lineHeight} onChange={(event) => { onReadingPreferencesChange({ ...readingPreferences, lineHeight: event.target.value as ReadingPreferences['lineHeight'] }); announcePreference(copy('settings.lineHeightUpdated')) }}><option value="original">{copy('settings.followBookDefault')}</option><option value="1.5">1.5</option><option value="1.7">1.7</option><option value="1.9">1.9</option></select></label>
              <label htmlFor="reading-indent"><span>{copy('settings.indent')}</span><select id="reading-indent" data-testid="reading-indent" value={readingPreferences.indent} onChange={(event) => { onReadingPreferencesChange({ ...readingPreferences, indent: event.target.value as ReadingPreferences['indent'] }); announcePreference(copy('settings.indentUpdated')) }}><option value="original">{copy('settings.followBookDefault')}</option><option value="none">{copy('settings.noIndent')}</option><option value="2em">2em</option></select></label>
            </div>
          </section>

          <section className="settings-section" aria-labelledby="model-settings-title">
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
        </div>
        <div className="settings-feedback" data-testid="settings-feedback" role="status" aria-live="polite">{preferenceStatus}</div>
      </section>
    </div>
  )
}

export default function App(): ReactNode {
  const [themePreference, setThemePreference] = useState<ThemePreference>(readThemePreference)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(themePreference))
  const [interfaceScale, setInterfaceScale] = useState<InterfaceScale>(readInterfaceScale)
  const [readingPreferences, setReadingPreferences] = useState<ReadingPreferences>(readReadingPreferences)
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
  const [conversationSelection, setConversationSelection] = useState<SelectionContext | null>(null)
  const [turns, setTurns] = useState<ConversationTurn[]>([])
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [insights, setInsights] = useState<SavedInsight[]>([])
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [assistantDialogOpen, setAssistantDialogOpen] = useState(false)
  const [pendingDeleteInsightId, setPendingDeleteInsightId] = useState<string | null>(null)
  const [provider, setProvider] = useState<ProviderSettings>(EMPTY_PROVIDER)
  const [providerConnection, setProviderConnection] = useState<ProviderConnectionState>({
    status: 'not-configured',
    message: providerStatusLabel('not-configured')
  })
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
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const assistantExpandButtonRef = useRef<HTMLButtonElement>(null)
  const assistantDialogRef = useRef<HTMLElement>(null)
  const readingPreferencesRef = useRef(readingPreferences)
  const preferencesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const providerRevisionRef = useRef(0)
  const providerCheckSequenceRef = useRef(0)
  const requestProviderRevisionRef = useRef(new Map<string, number>())

  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  const closeAssistantDialog = useCallback(() => setAssistantDialogOpen(false), [])
  useDialogFocus(assistantDialogOpen, closeAssistantDialog, assistantDialogRef, assistantExpandButtonRef)

  useEffect(() => {
    activeBookRef.current = activeBook
  }, [activeBook])

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
    setCollapsedTocItems(new Set())
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
  }, [destroyReader, refreshInsights, scheduleProgress])

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
      pushToast(result.duplicate ? copy('library.duplicateToast') : copy('library.importedToast'), result.duplicate ? 'neutral' : 'success')
      await openBook(result.book)
    } catch (error) {
      pushToast(readableError(error, copy('library.importFailed')), 'error')
    } finally {
      setImporting(false)
    }
  }, [importing, openBook, pushToast, refreshBooks])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape' && !settingsOpen && !assistantDialogOpen) setSelection(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [assistantDialogOpen, settingsOpen])

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
      model: provider.model,
      status: 'streaming'
    }

    setConversationSelection(context)
    setTurns(newContext ? [turn] : [...turns, turn])
    setSelection(null)
    setDraft('')
    setRightView('assistant')
    setActiveRequestId(requestId)
    activeRequestRef.current = requestId
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
      setTurns((current) => current.map((item) => item.requestId === requestId ? { ...item, status: 'error', error: message } : item))
      activeRequestRef.current = null
      setActiveRequestId(null)
      requestProviderRevisionRef.current.delete(requestId)
      if (providerRevision === providerRevisionRef.current) {
        providerCheckSequenceRef.current += 1
        setProviderConnection({ status: 'disconnected', message })
      }
    }
  }, [conversationSelection, provider.model, selection, turns])

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
        error: turn.answer ? copy('assistant.cancelledPartial') : copy('assistant.cancelledEmpty')
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
      pushToast(readableError(error, copy('reader.navigateSourceFailed')), 'error')
    }
  }, [pushToast])

  const navigateToToc = useCallback(async (href: string): Promise<void> => {
    const adapter = adapterRef.current
    if (!adapter) return
    try {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current)
        highlightTimerRef.current = null
      }
      adapter.clearHighlight()
      await adapter.goTo(href)
    } catch (error) {
      pushToast(readableError(error, copy('reader.navigateChapterFailed')), 'error')
    }
  }, [pushToast])

  const deleteInsight = async (insightId: string): Promise<void> => {
    try {
      const target = insights.find((insight) => insight.id === insightId)
      const deleted = await window.readerApi.deleteInsight(insightId)
      setPendingDeleteInsightId(null)
      setInsights((current) => current.filter((insight) => insight.id !== insightId))
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
      pushToast(copy('insights.savedToast'), 'success')
    } catch (error) {
      pushToast(readableError(error, copy('insights.saveFailed')), 'error')
    }
  }

  const canAsk = Boolean(conversationSelection && !activeRequestId)
  const visibleToc = useMemo(() => {
    const ancestorIds: string[] = []
    return toc.map((item, index) => {
      ancestorIds.length = item.depth
      const hidden = ancestorIds.some((id) => collapsedTocItems.has(id))
      const hasChildren = index + 1 < toc.length && toc[index + 1].depth > item.depth
      ancestorIds[item.depth] = item.id
      return { item, index, hidden, hasChildren }
    }).filter((entry) => !entry.hidden)
  }, [collapsedTocItems, toc])

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
          <button className={leftView === 'library' ? 'is-active' : ''} type="button" onClick={() => setLeftView('library')}>
            <Library size={15} />{copy('library.tabLibrary')}<span>{books.length}</span>
          </button>
          <button className={leftView === 'toc' ? 'is-active' : ''} type="button" onClick={() => setLeftView('toc')} disabled={!activeBook}>
            <PanelLeftClose size={15} />{copy('library.tabToc')}
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
                    <small>{book.author || (book.format === 'epub' ? copy('library.epubDescription') : copy('library.txtDescription'))}</small>
                  </span>
                  <ProgressRing value={book.progress} />
                </button>
              ))}
            </div>
          )}

          {leftView === 'toc' && (
            <div className="toc-list" aria-label={copy('library.tocAria')}>
              {bookState === 'loading' && <div className="sidebar-loading"><LoaderCircle className="spin" size={17} /> {copy('library.tocLoading')}</div>}
              {bookState === 'ready' && toc.length === 0 && (
                <EmptyState icon={<SearchX size={20} />} title={copy('library.tocEmptyTitle')} detail={copy('library.tocEmptyDetail')} />
              )}
              {visibleToc.map(({ item, index, hasChildren }) => (
                <div className="toc-row" style={{ '--toc-depth': Math.min(item.depth, 3) } as CSSProperties} key={`${item.id}-${index}`}>
                  {hasChildren ? (
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
                  ) : <span className="toc-disclosure-spacer" />}
                  <button className="toc-item" data-testid="toc-item" data-toc-id={item.id} type="button" onClick={() => void navigateToToc(item.href)} title={item.label}>
                    <span>{item.label}</span>
                  </button>
                </div>
              ))}
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
          <button ref={settingsButtonRef} className="settings-entry" data-testid="settings-button" type="button" onClick={() => setSettingsOpen(true)}>
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

      <main className="reader-column">
        <header className="reader-header">
          {activeBook ? (
            <>
              <div className="reader-heading">
                <span className="format-chip">{activeBook.format.toUpperCase()}</span>
                <div>
                  <h1>{activeBook.title}</h1>
                  <p>{activeBook.author || copy('common.unknownAuthor')}</p>
                </div>
              </div>
              <div className="reading-progress">
                <span>{copy('reader.progress')}</span>
                <strong>{Math.round(activeBook.progress * 100)}%</strong>
                <div><i style={{ width: `${Math.max(0, Math.min(100, activeBook.progress * 100))}%` }} /></div>
              </div>
            </>
          ) : (
            <div className="reader-heading is-empty"><span className="visually-hidden">{copy('reader.areaAria')}</span></div>
          )}
        </header>

        <section className={`reader-surface is-${bookState}`}>
          <div className="reader-host" data-testid="reader-host" ref={hostRef} aria-label={copy('reader.areaAria')} />

          {!activeBook && libraryState !== 'loading' && (
            <div className="reader-overlay welcome-state" aria-label={copy('reader.emptyAria')}><span className="visually-hidden">{copy('reader.emptyText')}</span></div>
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
              data-testid="selection-toolbar"
              role="toolbar"
              aria-label={copy('assistant.selectionToolbarAria')}
              onMouseDown={(event) => event.preventDefault()}
            >
              <span className="selection-spark"><Sparkles size={15} /></span>
              <button data-testid="action-explain" type="button" onClick={() => handleSelectionAction('explain')}><Highlighter size={15} />{copy('assistant.actionExplain')}</button>
              <button data-testid="action-context" type="button" onClick={() => handleSelectionAction('context')}><BookOpen size={15} />{copy('assistant.actionContext')}</button>
              <button data-testid="action-ask" type="button" onClick={() => handleSelectionAction('ask')}><MessageSquareText size={15} />{copy('assistant.actionAsk')}</button>
              <button className="toolbar-close" type="button" onClick={() => setSelection(null)} aria-label={copy('assistant.selectionCloseAria')}><X size={14} /></button>
            </div>
          )}
        </section>
      </main>

      <aside className="right-sidebar" data-testid="ai-panel">
        <header className="assistant-header">
          <div className="assistant-title"><span><Sparkles size={16} /></span><strong>{copy('assistant.title')}</strong></div>
          <button ref={assistantExpandButtonRef} className="icon-button" data-testid="assistant-expand-button" type="button" aria-label={copy('assistant.expandDialog')} title={copy('assistant.expandDialog')} onClick={() => setAssistantDialogOpen(true)}><Maximize2 size={17} /></button>
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
                  <button className="insight-content" type="button" onClick={() => void navigateToAnchor(insight.selection.anchor)}>
                    <span className="insight-quote">“{insight.selection.quote}”</span>
                    <strong>{insight.question}</strong>
                    <p>{insight.answer}</p>
                  </button>
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

      {assistantDialogOpen && (
        <div className="modal-backdrop assistant-dialog-backdrop" role="presentation">
          <section ref={assistantDialogRef} className="assistant-dialog" data-testid="assistant-dialog" role="dialog" aria-modal="true" aria-labelledby="assistant-dialog-title">
            <header className="modal-header">
              <div><h2 id="assistant-dialog-title">{copy('assistant.dialogTitle')}</h2></div>
              <button className="icon-button" data-testid="assistant-dialog-close" type="button" onClick={closeAssistantDialog} aria-label={copy('assistant.closeDialog')}><X size={18} /></button>
            </header>
            <div className="assistant-dialog-body">
              <ConversationPane conversationSelection={conversationSelection} turns={turns} provider={provider} activeRequestId={activeRequestId} draft={draft} canAsk={canAsk} followupRef={followupRef} onDraftChange={setDraft} onNavigate={(anchor) => void navigateToAnchor(anchor)} onSave={(turn) => void saveTurn(turn)} onCancel={() => void cancelRequest()} onSubmit={submitQuestion} onComposerKey={handleComposerKey} />
            </div>
          </section>
        </div>
      )}

      {settingsOpen && (
        <SettingsModal
          initial={provider}
          themePreference={themePreference}
          interfaceScale={interfaceScale}
          readingPreferences={readingPreferences}
          returnFocusRef={settingsButtonRef}
          onClose={closeSettings}
          onSaved={handleProviderSaved}
          onTest={handleProviderTest}
          onThemeChange={setThemePreference}
          onInterfaceScaleChange={setInterfaceScale}
          onReadingPreferencesChange={setReadingPreferences}
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
