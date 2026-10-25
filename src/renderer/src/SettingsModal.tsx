import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { AlertCircle, BookOpen, Check, Cpu, Info, LoaderCircle, MessageSquareText, Palette, Plus, RefreshCw, Save, Sparkles, Trash2, Unplug, X } from 'lucide-react'
import type { AppUpdatePhase, PersonaSettings, ProviderCompatibility, ProviderOverview, ProviderProfile, ProviderProtocol, RequestSettingsInput, TextReadingMode } from '@shared/contracts'
import { copy, type CopyKey, type UiLanguage } from '@shared/copy'
import { publicRequestSettings } from '@shared/request-settings'
import appIcon from '../../../resources/icon.png'
import { AssistantActionIconView } from './AssistantActionIcon'
import { PersonaSettingsPanel } from './AssistantPersonaSettings'
import { KnowledgeSettings } from './KnowledgeSettings'
import { ModelCombobox } from './ModelCombobox'
import { RequestSettingsEditor } from './RequestSettingsEditor'
import { Select } from './Select'
import { createDefaultAssistantActionSettings, MAX_ASSISTANT_ACTION_LABEL_LENGTH, MAX_ASSISTANT_ACTION_PROMPT_LENGTH, type AssistantActionIcon, type AssistantActionSettings } from './assistant-actions'
import { DEFAULT_READING_PREFERENCES, type PaperThemePreference, type ReadingPreferences, type ReadingTextAlign } from './readers/types'
import { readableError } from './readable-error'
import { useDialogFocus } from './use-dialog-focus'

export type ThemePreference = 'light' | 'system' | 'dark'
export type InterfaceScale = 90 | 100 | 110 | 125
export type SettingsSectionId = 'appearance' | 'reading' | 'assistant' | 'persona' | 'model' | 'knowledge' | 'about'

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; labelKey: CopyKey; ariaLabelKey: CopyKey }> = [
  { value: 'light', labelKey: 'settings.themeLight', ariaLabelKey: 'settings.themeLightAria' },
  { value: 'system', labelKey: 'settings.themeSystem', ariaLabelKey: 'settings.themeSystemAria' },
  { value: 'dark', labelKey: 'settings.themeDark', ariaLabelKey: 'settings.themeDarkAria' }
]

const UI_LANGUAGE_OPTIONS: ReadonlyArray<{ value: UiLanguage; labelKey: CopyKey }> = [
  { value: 'zh', labelKey: 'settings.languageZh' },
  { value: 'en', labelKey: 'settings.languageEn' }
]

const ASSISTANT_ACTION_ICON_OPTIONS: ReadonlyArray<{ value: AssistantActionIcon; labelKey: CopyKey }> = [
  { value: 'highlighter', labelKey: 'settings.assistantIconHighlighter' },
  { value: 'book-open', labelKey: 'settings.assistantIconBookOpen' },
  { value: 'message-square-text', labelKey: 'settings.assistantIconMessageSquareText' },
  { value: 'search', labelKey: 'settings.assistantIconSearch' },
  { value: 'lightbulb', labelKey: 'settings.assistantIconLightbulb' },
  { value: 'pen-line', labelKey: 'settings.assistantIconPenLine' },
  { value: 'quote', labelKey: 'settings.assistantIconQuote' },
  { value: 'book-marked', labelKey: 'settings.assistantIconBookMarked' }
]

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
      <Select id={id} data-testid={id} value={value} onChange={(event) => onChange(event.target.value as AssistantActionIcon)}>
        {ASSISTANT_ACTION_ICON_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{copy(option.labelKey)}</option>
        ))}
      </Select>
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

function AssistantActionFields({
  settings,
  onChange
}: {
  settings: AssistantActionSettings
  onChange: (settings: AssistantActionSettings) => void
}): ReactNode {
  // 每次渲染按当前语言重建，避免空依赖 memo 冻结切换前的默认值。
  const defaults = createDefaultAssistantActionSettings()
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
  'about.noticeElectronUpdater',
  'about.noticeEpubjs',
  'about.noticeJszip',
  'about.noticeLocalforage',
  'about.noticePdfjs',
  'about.noticeLucide',
  'about.noticeReact',
  'about.noticeZod'
] as const

function updateStatusText(phase: AppUpdatePhase): string {
  switch (phase.status) {
    case 'checking':
      return copy('about.updateStatusChecking')
    case 'upToDate':
      return copy('about.updateStatusUpToDate')
    case 'available':
      return copy('about.updateStatusAvailable', { version: phase.version })
    case 'downloading':
      return copy('about.updateStatusDownloading', { percent: phase.percent })
    case 'downloaded':
      return copy('about.updateStatusDownloaded')
    case 'error':
      return copy('about.updateStatusError')
    case 'installError':
      return copy('about.updateStatusInstallError')
    case 'unsupported':
      return copy('about.updateStatusUnsupported')
    case 'idle':
      return copy('about.updateStatusIdle')
  }
}

function AboutPanel(): ReactNode {
  const [version, setVersion] = useState('')
  const [updatePhase, setUpdatePhase] = useState<AppUpdatePhase | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)

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
    void window.readerApi
      .getAppUpdatePhase()
      .then((phase) => {
        if (!alive) return
        setUpdatePhase(phase)
        if (phase.status === 'idle') {
          void window.readerApi
            ?.checkForAppUpdate()
            .then((checked) => {
              if (alive) setUpdatePhase(checked)
            })
            .catch(() => undefined)
        }
      })
      .catch(() => undefined)
    const unsubscribe = window.readerApi.onAppUpdateEvent((phase) => {
      if (alive) setUpdatePhase(phase)
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  const updateActionLabel =
    updatePhase?.status === 'available'
      ? copy('about.updateDownloadAction')
      : updatePhase?.status === 'downloaded'
        ? copy('about.updateInstallAction')
        : copy('about.updateCheckAction')
  const updateActionDisabled =
    !updatePhase ||
    updateBusy ||
    updatePhase.status === 'checking' ||
    updatePhase.status === 'downloading' ||
    updatePhase.status === 'installError' ||
    updatePhase.status === 'unsupported'

  const handleUpdateAction = (): void => {
    const api = window.readerApi
    if (!api || !updatePhase || updateBusy) return
    if (updatePhase.status === 'downloaded') {
      void api.installAppUpdate().catch(() => undefined)
      return
    }
    setUpdateBusy(true)
    const request: Promise<AppUpdatePhase> =
      updatePhase.status === 'available' ? api.downloadAppUpdate() : api.checkForAppUpdate()
    void request
      .then((phase) => setUpdatePhase(phase))
      .catch(() => setUpdatePhase((current) => (current?.status === 'downloading' ? current : { status: 'error' })))
      .finally(() => setUpdateBusy(false))
  }

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
      <div className="about-update" data-testid="about-update">
        <div className="about-update-head">
          <span className="about-update-label">{copy('about.updateLabel')}</span>
          <button
            className="secondary-button compact-button"
            data-testid="update-action-button"
            type="button"
            onClick={handleUpdateAction}
            disabled={updateActionDisabled}
          >
            {updateActionLabel}
          </button>
        </div>
        {updatePhase && (
          <p className="about-update-status" data-testid="update-status" aria-live="polite">
            {updateStatusText(updatePhase)}
          </p>
        )}
        {(updatePhase?.status === 'available' || updatePhase?.status === 'downloaded') &&
          updatePhase.releaseNotes && (
          <div className="about-update-notes" data-testid="update-release-notes">
            <h4>{copy('about.updateNotesTitle')}</h4>
            <p>{updatePhase.releaseNotes}</p>
          </div>
        )}
        {updatePhase?.status === 'downloaded' && (
          <p className="about-update-hint">{copy('about.updateDownloadedHint')}</p>
        )}
      </div>
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

export function SettingsModal({
  initialOverview,
  initialSection,
  initialService,
  themePreference,
  interfaceScale,
  uiLanguage,
  readingPreferences,
  textReading,
  paperThemePreference,
  assistantActions,
  personaSettings,
  returnFocusRef,
  onClose,
  onOverviewChange,
  onThemeChange,
  onInterfaceScaleChange,
  onUiLanguageChange,
  onReadingPreferencesChange,
  onPaperThemePreferenceChange,
  onAssistantActionsChange,
  onPersonaSettingsChange,
  onWebSearchChange,
  pushToast
}: {
  initialOverview: ProviderOverview
  initialSection: SettingsSectionId
  initialService?: 'document' | 'embedding'
  themePreference: ThemePreference
  interfaceScale: InterfaceScale
  uiLanguage: UiLanguage
  readingPreferences: ReadingPreferences
  textReading?: { mode: TextReadingMode; rendering: 'plain' | 'markdown'; onChange: (mode: TextReadingMode) => void }
  paperThemePreference: PaperThemePreference
  assistantActions: AssistantActionSettings
  personaSettings: PersonaSettings
  returnFocusRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
  onOverviewChange: (overview: ProviderOverview, checkActive: boolean) => void
  onThemeChange: (preference: ThemePreference) => void
  onInterfaceScaleChange: (scale: InterfaceScale) => void
  onUiLanguageChange: (language: UiLanguage) => void
  onReadingPreferencesChange: (preferences: ReadingPreferences) => void
  onPaperThemePreferenceChange: (preference: PaperThemePreference) => void
  onAssistantActionsChange: (settings: AssistantActionSettings) => void
  onPersonaSettingsChange: (settings: PersonaSettings) => boolean
  onWebSearchChange?: (enabled: boolean) => void
  pushToast: (message: string, tone?: 'success' | 'error' | 'neutral') => void
}): ReactNode {
  const initiallySelected = initialOverview.profiles.find((profile) => profile.id === initialOverview.activeProfileId)
    ?? initialOverview.profiles[0]
    ?? null
  const [overview, setOverview] = useState(initialOverview)
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(initiallySelected?.id ?? null)
  const [profileName, setProfileName] = useState(initiallySelected?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(initiallySelected?.baseUrl ?? 'https://api.openai.com')
  const [model, setModel] = useState(initiallySelected?.model ?? 'gpt-4.1-mini')
  const [compatibility, setCompatibility] = useState<ProviderCompatibility>(initiallySelected?.compatibility ?? 'auto')
  const [protocol, setProtocol] = useState<ProviderProtocol>(initiallySelected?.protocol ?? 'openai')
  const [requestSettings, setRequestSettings] = useState<RequestSettingsInput>(publicRequestSettings(initiallySelected ?? {}))
  const [requestInvalid, setRequestInvalid] = useState(false)
  const [requestEditorRevision, setRequestEditorRevision] = useState(0)
  const [baseline, setBaseline] = useState({
    protocol: initiallySelected?.protocol ?? 'openai' as ProviderProtocol,
    requestSettings: JSON.stringify(publicRequestSettings(initiallySelected ?? {})),
    name: initiallySelected?.name ?? '',
    baseUrl: initiallySelected?.baseUrl ?? 'https://api.openai.com',
    model: initiallySelected?.model ?? 'gpt-4.1-mini',
    compatibility: initiallySelected?.compatibility ?? 'auto' as ProviderCompatibility
  })
  const [keyDirty, setKeyDirty] = useState(false)
  const [knowledgeDirty, setKnowledgeDirty] = useState(false)
  const [personaDirty, setPersonaDirty] = useState(false)
  const [busy, setBusy] = useState<'save' | 'save-and-use' | 'test' | 'models' | 'activate' | 'delete' | null>(null)
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [modelStatus, setModelStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection)
  const [fonts, setFonts] = useState<string[] | null>(null)
  const keyRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)
  const testSequenceRef = useRef(0)
  const modelCacheRef = useRef(new Map<string, { baseUrl: string; compatibility: ProviderCompatibility; protocol: ProviderProtocol; models: string[]; truncated: boolean }>())

  const selectedProfile = overview.profiles.find((profile) => profile.id === selectedProfileId) ?? null
  const savedKeyMatches = Boolean(selectedProfile?.hasApiKey && selectedProfile.baseUrl === baseUrl && (selectedProfile.protocol ?? 'openai') === protocol)
  const dirty = requestInvalid || protocol !== baseline.protocol || JSON.stringify(requestSettings) !== baseline.requestSettings || keyDirty || profileName !== baseline.name || baseUrl !== baseline.baseUrl || model !== baseline.model || compatibility !== baseline.compatibility

  const confirmDiscard = (): boolean => !dirty || window.confirm(copy('settings.discardChanges'))

  const requestClose = useCallback((): void => {
    if ((!dirty && !knowledgeDirty && !personaDirty) || window.confirm(copy('settings.discardChanges'))) onClose()
  }, [dirty, knowledgeDirty, personaDirty, onClose])

  useDialogFocus(true, requestClose, dialogRef, returnFocusRef)

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

  const cacheKey = (profileId: string | null): string => profileId ?? '__new__'

  const resetSecretInput = (): void => {
    if (keyRef.current) keyRef.current.value = ''
    setKeyDirty(false)
  }

  const loadProfile = (profile: ProviderProfile): void => {
    setSelectedProfileId(profile.id)
    setProfileName(profile.name)
    setBaseUrl(profile.baseUrl)
    setModel(profile.model)
    setCompatibility(profile.compatibility)
    setProtocol(profile.protocol ?? 'openai')
    setRequestSettings(publicRequestSettings(profile))
    setRequestInvalid(false)
    setRequestEditorRevision((value) => value + 1)
    setBaseline({ protocol: profile.protocol ?? 'openai', requestSettings: JSON.stringify(publicRequestSettings(profile)), name: profile.name, baseUrl: profile.baseUrl, model: profile.model, compatibility: profile.compatibility })
    resetSecretInput()
    setStatus(null)
    const entry = modelCacheRef.current.get(cacheKey(profile.id))
    const cached = entry?.baseUrl === profile.baseUrl && entry.compatibility === profile.compatibility && entry.protocol === (profile.protocol ?? 'openai') ? entry : undefined
    setModelOptions(cached?.models ?? [])
    setModelStatus(cached
      ? { ok: true, message: cached.truncated
        ? copy('settings.modelsTruncated', { count: cached.models.length })
        : copy('settings.modelsFetched', { count: cached.models.length }) }
      : null)
  }

  const loadNewProfile = (): void => {
    const active = overview.profiles.find((profile) => profile.id === overview.activeProfileId)
    const next = {
      name: '',
      protocol: active?.protocol ?? 'openai' as ProviderProtocol,
      requestSettings: '{}',
      baseUrl: active?.baseUrl ?? 'https://api.openai.com',
      model: active?.model ?? 'gpt-4.1-mini',
      compatibility: 'auto' as ProviderCompatibility
    }
    setSelectedProfileId(null)
    setProfileName(next.name)
    setBaseUrl(next.baseUrl)
    setModel(next.model)
    setCompatibility(next.compatibility)
    setProtocol(next.protocol)
    setRequestSettings({})
    setRequestInvalid(false)
    setRequestEditorRevision((value) => value + 1)
    setBaseline(next)
    resetSecretInput()
    setStatus(null)
    const cached = modelCacheRef.current.get(cacheKey(null))
    setModelOptions(cached?.baseUrl === next.baseUrl && cached.compatibility === next.compatibility && cached.protocol === next.protocol ? cached.models : [])
    setModelStatus(null)
  }

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
    { id: 'persona', label: copy('persona.title'), icon: <Sparkles size={14} /> },
    { id: 'model', label: copy('settings.modelTitle'), icon: <Cpu size={14} /> },
    { id: 'knowledge', label: copy('knowledge.title'), icon: <BookOpen size={14} /> },
    { id: 'about', label: copy('about.title'), icon: <Info size={14} /> }
  ]

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      testSequenceRef.current += 1
    }
  }, [])

  const handleSave = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (requestInvalid || busy) return
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    const useAfterSave = submitter instanceof HTMLButtonElement && submitter.value === 'save-and-use'
    let savedSuccessfully = false
    setBusy(useAfterSave ? 'save-and-use' : 'save')
    setStatus(null)
    try {
      const key = keyRef.current?.value.trim()
      const input = {
        ...requestSettings, protocol,
        name: profileName.trim(),
        compatibility,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        ...(key ? { apiKey: key } : {})
      }
      const previousIds = new Set(overview.profiles.map((profile) => profile.id))
      const next = selectedProfileId
        ? await window.readerApi.updateProviderProfile({ id: selectedProfileId, ...input })
        : await window.readerApi.createProviderProfile(input)
      const saved = selectedProfileId
        ? next.profiles.find((profile) => profile.id === selectedProfileId)
        : next.profiles.find((profile) => !previousIds.has(profile.id))
      savedSuccessfully = true
      onOverviewChange(next, Boolean(saved?.isActive))
      if (mountedRef.current) {
        setOverview(next)
        if (saved) {
          if (!selectedProfileId) {
            const cached = modelCacheRef.current.get(cacheKey(null))
            if (cached) modelCacheRef.current.set(cacheKey(saved.id), cached)
          }
          loadProfile(saved)
        }
      }
      if (useAfterSave && saved) {
        if (mountedRef.current) setBusy('activate')
        const activated = await window.readerApi.activateProviderProfile(saved.id)
        onOverviewChange(activated, true)
        if (mountedRef.current) {
          setOverview(activated)
          const current = activated.profiles.find((profile) => profile.id === saved.id)
          if (current) loadProfile(current)
        }
        pushToast(copy('settings.savedAndActivatedToast'), 'success')
      } else {
        pushToast(copy('settings.savedToast'), 'success')
      }
    } catch (error) {
      const reason = readableError(error, copy('settings.saveFailed'))
      const message = savedSuccessfully && useAfterSave ? copy('settings.savedActivationFailed', { reason }) : reason
      if (mountedRef.current) {
        setStatus({ ok: false, message })
      } else pushToast(message, 'error')
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }

  const handleTest = async (testMode: 'text' | 'stream' = 'text'): Promise<void> => {
    const sequence = testSequenceRef.current + 1
    testSequenceRef.current = sequence
    setBusy('test')
    setStatus(null)
    try {
      const key = keyRef.current?.value.trim()
      const result = await window.readerApi.testProviderConfiguration({
        ...requestSettings, protocol, testMode,
        compatibility,
        ...(selectedProfileId ? { profileId: selectedProfileId } : {}),
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        ...(key ? { apiKey: key } : {})
      })
      if (!mountedRef.current || sequence !== testSequenceRef.current) return
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

  const handleFetchModels = async (): Promise<void> => {
    setBusy('models')
    setModelStatus(null)
    try {
      const key = keyRef.current?.value.trim()
      const result = await window.readerApi.listProviderModels({
        ...requestSettings, protocol,
        compatibility,
        ...(selectedProfileId ? { profileId: selectedProfileId } : {}),
        baseUrl: baseUrl.trim(),
        ...(key ? { apiKey: key } : {})
      })
      if (!mountedRef.current) return
      modelCacheRef.current.set(cacheKey(selectedProfileId), {
        protocol, compatibility,
        baseUrl: baseUrl.trim(),
        models: result.models,
        truncated: result.truncated
      })
      setModelOptions(result.models)
      setModelStatus({
        ok: true,
        message: result.truncated
          ? copy('settings.modelsTruncated', { count: result.models.length })
          : copy('settings.modelsFetched', { count: result.models.length })
      })
    } catch (error) {
      if (mountedRef.current) {
        setModelStatus({ ok: false, message: readableError(error, copy('settings.testFailed')) })
      }
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }

  const handleActivate = async (): Promise<void> => {
    if (!selectedProfileId || dirty) return
    setBusy('activate')
    setStatus(null)
    try {
      const next = await window.readerApi.activateProviderProfile(selectedProfileId)
      if (!mountedRef.current) return
      setOverview(next)
      const selected = next.profiles.find((profile) => profile.id === selectedProfileId)
      if (selected) loadProfile(selected)
      onOverviewChange(next, true)
      pushToast(copy('settings.profileActivatedToast'), 'success')
    } catch (error) {
      if (mountedRef.current) setStatus({ ok: false, message: readableError(error, copy('settings.saveFailed')) })
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (!selectedProfile || !confirmDiscard()) return
    if (!window.confirm(copy('settings.deleteProfileQuestion', { name: selectedProfile.name }))) return
    setBusy('delete')
    setStatus(null)
    try {
      const deletedName = selectedProfile.name
      const next = await window.readerApi.deleteProviderProfile(selectedProfile.id)
      if (!mountedRef.current) return
      setOverview(next)
      const nextSelected = next.profiles[0] ?? null
      if (nextSelected) loadProfile(nextSelected)
      else loadNewProfile()
      onOverviewChange(next, false)
      pushToast(copy('settings.profileDeletedToast', { name: deletedName }), 'success')
    } catch (error) {
      if (mountedRef.current) setStatus({ ok: false, message: readableError(error, copy('settings.saveFailed')) })
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <section ref={dialogRef} className="settings-modal" data-testid="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="modal-header">
          <div>
            <h2 id="settings-title">{copy('settings.title')}</h2>
          </div>
          <button className="icon-button" data-testid="settings-close" type="button" onClick={requestClose} aria-label={copy('settings.closeAria')}>
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
                onClick={() => {
                  if (section.id === activeSection) return
                  setActiveSection(section.id)
                }}
              >
                {section.icon}{section.label}
                {(section.id === 'knowledge' && knowledgeDirty || section.id === 'model' && dirty || section.id === 'persona' && personaDirty) &&
                  <span className="settings-nav-pending" aria-label={copy('knowledge.pending')} title={copy('knowledge.pending')}>•</span>}
              </button>
            ))}
          </nav>
          <div className="settings-panel" ref={panelRef}>
            {activeSection === 'appearance' && (
              <section className="settings-section" id="settings-panel-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance">
                <h3 id="appearance-settings-title">{copy('settings.appearanceTitle')}</h3>
                <p className="field-hint">{copy('settings.immediateHint')}</p>
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
                      aria-label={copy(option.ariaLabelKey)}
                      aria-pressed={themePreference === option.value}
                      onClick={() => onThemeChange(option.value)}
                    >
                      {copy(option.labelKey)}
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
            <div className="settings-row">
              <div><strong>{copy('settings.languageLabel')}</strong><small>{copy('settings.languageHint')}</small></div>
              <div className="segmented-control language-control" data-testid="ui-language" role="group" aria-label={copy('settings.languageGroupAria')}>
                {UI_LANGUAGE_OPTIONS.map((option) => (
                  <button
                    className={uiLanguage === option.value ? 'is-active' : ''}
                    data-testid={`ui-language-${option.value}`}
                    key={option.value}
                    type="button"
                    lang={option.value === 'en' ? 'en' : 'zh-CN'}
                    aria-pressed={uiLanguage === option.value}
                    onClick={() => onUiLanguageChange(option.value)}
                  >{copy(option.labelKey)}</button>
                ))}
              </div>
            </div>
              </section>
            )}

            {activeSection === 'reading' && (
              <section className="settings-section" id="settings-panel-reading" role="tabpanel" aria-labelledby="settings-tab-reading">
            <div className="settings-section-heading">
              <h3 id="reading-settings-title">{copy('settings.readingTitle')}</h3>
              <button className="text-button" data-testid="reading-reset" type="button" onClick={() => { onPaperThemePreferenceChange('default'); onReadingPreferencesChange({ ...DEFAULT_READING_PREFERENCES }); textReading?.onChange('auto') }}>{copy('settings.restoreDefaults')}</button>
            </div>
            <p className="field-hint">{copy('settings.immediateHint')}</p>
            <p className="field-hint">{copy('settings.readingScopeHint')}</p>
            {textReading && <div className="settings-select-grid">
              <label className="settings-select-full" htmlFor="text-reading-mode"><span>{copy('settings.textReadingMode')}</span>
                <Select id="text-reading-mode" data-testid="text-reading-mode" value={textReading.mode} onChange={(event) => textReading.onChange(event.target.value as TextReadingMode)}>
                  <option value="auto">{copy('settings.textModeAuto')}</option><option value="plain">{copy('settings.textModePlain')}</option><option value="markdown">{copy('settings.textModeMarkdown')}</option>
                </Select>
              </label>
              <p className="field-hint settings-select-full" data-testid="text-reading-status">{copy(textReading.rendering === 'markdown' ? 'settings.textRenderedMarkdown' : 'settings.textRenderedPlain')} {copy('settings.textModeHint')}</p>
            </div>}
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
                <Select
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
                </Select>
                <small className="settings-font-note">
                  {fontNote}
                </small>
              </label>
              <label className="settings-select-full" htmlFor="reading-paper-theme">
                <span>{copy('settings.paperTheme')}</span>
                <Select
                  id="reading-paper-theme"
                  data-testid="reading-paper-theme"
                  value={paperThemePreference}
                  onChange={(event) => onPaperThemePreferenceChange(event.target.value as PaperThemePreference)}
                >
                  <option value="default">{copy('settings.paperThemeDefault')}</option>
                  <option value="eye-care">{copy('settings.paperThemeEyeCare')}</option>
                </Select>
                <small className="settings-font-note">{copy('settings.paperThemeHint')}</small>
              </label>
              <label htmlFor="reading-line-height"><span>{copy('settings.lineHeight')}</span><Select id="reading-line-height" data-testid="reading-line-height" value={readingPreferences.lineHeight} onChange={(event) => onReadingPreferencesChange({ ...readingPreferences, lineHeight: event.target.value as ReadingPreferences['lineHeight'] })}><option value="original">{copy('settings.followBookDefault')}</option><option value="1.5">1.5</option><option value="1.7">1.7</option><option value="1.9">1.9</option></Select></label>
              <label htmlFor="reading-indent"><span>{copy('settings.indent')}</span><Select id="reading-indent" data-testid="reading-indent" value={readingPreferences.indent} onChange={(event) => onReadingPreferencesChange({ ...readingPreferences, indent: event.target.value as ReadingPreferences['indent'] })}><option value="original">{copy('settings.followBookDefault')}</option><option value="none">{copy('settings.noIndent')}</option><option value="2em">2em</option></Select></label>
              <label htmlFor="reading-content-width"><span>{copy('settings.contentWidth')}</span><Select id="reading-content-width" data-testid="reading-content-width" value={readingPreferences.contentWidth} onChange={(event) => onReadingPreferencesChange({ ...readingPreferences, contentWidth: event.target.value as ReadingPreferences['contentWidth'] })}><option value="original">{copy('settings.followBookDefault')}</option><option value="narrow">{copy('settings.contentWidthNarrow')}</option><option value="standard">{copy('settings.contentWidthStandard')}</option><option value="wide">{copy('settings.contentWidthWide')}</option></Select></label>
              <label htmlFor="reading-paragraph-spacing"><span>{copy('settings.paragraphSpacing')}</span><Select id="reading-paragraph-spacing" data-testid="reading-paragraph-spacing" value={readingPreferences.paragraphSpacing} onChange={(event) => onReadingPreferencesChange({ ...readingPreferences, paragraphSpacing: event.target.value as ReadingPreferences['paragraphSpacing'] })}><option value="original">{copy('settings.followBookDefault')}</option><option value="compact">{copy('settings.spacingCompact')}</option><option value="standard">{copy('settings.spacingStandard')}</option><option value="relaxed">{copy('settings.spacingRelaxed')}</option></Select></label>
              <label htmlFor="reading-text-align"><span>{copy('settings.textAlign')}</span><Select id="reading-text-align" data-testid="reading-text-align" value={readingPreferences.textAlign} onChange={(event) => onReadingPreferencesChange({ ...readingPreferences, textAlign: event.target.value as ReadingTextAlign })}><option value="original">{copy('settings.followBookDefault')}</option><option value="justify">{copy('settings.textAlignJustify')}</option><option value="left">{copy('settings.textAlignLeft')}</option></Select></label>
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

            <section className="settings-section" id="settings-panel-persona" role="tabpanel" aria-labelledby="settings-tab-persona" hidden={activeSection !== 'persona'}>
                <h3>{copy('persona.title')}</h3>
                <PersonaSettingsPanel settings={personaSettings} onChange={onPersonaSettingsChange}
                  onError={() => pushToast(copy('persona.saveFailed'), 'error')}
                  onSaved={() => pushToast(copy('persona.saved'), 'success')} onDirtyChange={setPersonaDirty} />
              </section>

            {activeSection === 'about' && <AboutPanel />}
            <KnowledgeSettings hidden={activeSection !== 'knowledge'} onDirty={setKnowledgeDirty} initialService={initialService} onWebSearchChange={onWebSearchChange} />

            <section
              className="settings-section"
              id="settings-panel-model"
              role="tabpanel"
              aria-labelledby="settings-tab-model"
              hidden={activeSection !== 'model'}
            >
                <h3 id="model-settings-title">{copy('settings.modelTitle')}</h3>
                <p className="field-hint">{copy('settings.modelSaveHint')}</p>
                <form onSubmit={handleSave}>
                  <div className="provider-profile-toolbar">
                    <div className="provider-profile-select">
                      <label className="field-label" htmlFor="provider-profile">{copy('settings.profileLabel')}</label>
                      <Select
                        id="provider-profile"
                        data-testid="provider-profile"
                        value={selectedProfileId ?? ''}
                        disabled={busy !== null}
                        onChange={(event) => {
                          if (!confirmDiscard()) return
                          const profile = overview.profiles.find((item) => item.id === event.target.value)
                          if (profile) loadProfile(profile)
                          else loadNewProfile()
                        }}
                      >
                        {!selectedProfileId && <option value="">{copy('settings.newProfilePlaceholder')}</option>}
                        {overview.profiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.name}{profile.isActive ? ` · ${copy('settings.activeProfile')}` : ''}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="provider-profile-actions">
                      <button
                        className="secondary-button compact-button"
                        data-testid="provider-new"
                        type="button"
                        disabled={busy !== null || overview.profiles.length >= 10}
                        onClick={() => { if (confirmDiscard()) loadNewProfile() }}
                      >
                        <Plus size={14} /> {copy('settings.newProfile')}
                      </button>
                      <button
                        className="text-button danger-text"
                        data-testid="provider-delete"
                        type="button"
                        disabled={busy !== null || !selectedProfile}
                        onClick={handleDelete}
                      >
                        <Trash2 size={14} aria-hidden="true" /> {copy('settings.deleteProfile')}
                      </button>
                    </div>
                  </div>
                  {overview.profiles.length >= 10 && <p className="field-hint">{copy('settings.profileLimit')}</p>}
                  {dirty && <p className="field-hint" data-testid="provider-dirty-hint">{copy('settings.unsavedHint')}</p>}

                  <label className="field-label" htmlFor="provider-profile-name">{copy('settings.profileNameLabel')}</label>
                  <input
                    id="provider-profile-name"
                    data-testid="provider-profile-name"
                    value={profileName}
                    onChange={(event) => setProfileName(event.target.value)}
                    disabled={busy !== null}
                    placeholder={copy('settings.profileNamePlaceholder')}
                    maxLength={60}
                    required
                  />

                  <label className="field-label" htmlFor="provider-protocol">{copy('request.protocol')}</label>
                  <Select id="provider-protocol" data-testid="provider-protocol" value={protocol} disabled={busy !== null}
                    onChange={(event) => {
                      const next = event.target.value as ProviderProtocol
                      setProtocol(next)
                      resetSecretInput()
                      if (['https://api.openai.com', 'https://api.anthropic.com'].includes(baseUrl)) setBaseUrl(next === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com')
                      setRequestSettings({ ...requestSettings, customHeaders: undefined })
                      setRequestInvalid(false)
                      modelCacheRef.current.delete(cacheKey(selectedProfileId)); setModelOptions([]); setModelStatus(null); setStatus(null)
                    }}>
                    <option value="openai">{copy('request.openai')}</option><option value="anthropic">{copy('request.anthropic')}</option>
                  </Select>
                  <label className="field-label" htmlFor="provider-base-url">{copy('settings.baseUrlLabel')}</label>
                  <input
                    id="provider-base-url"
                    data-testid="provider-base-url"
                    value={baseUrl}
                    onChange={(event) => {
                      setBaseUrl(event.target.value)
                      setStatus(null)
                      resetSecretInput()
                      setRequestSettings({ ...requestSettings, customHeaders: undefined }); setRequestInvalid(false)
                      modelCacheRef.current.delete(cacheKey(selectedProfileId))
                      setModelOptions([])
                      setModelStatus(null)
                    }}
                    disabled={busy !== null}
                    placeholder={copy('settings.baseUrlPlaceholder')}
                    spellCheck={false}
                    required
                  />
                  <p className="field-hint">{copy('settings.baseUrlHint', { path: protocol === 'anthropic' ? '/v1/messages' : '/v1/chat/completions' })}</p>

                  <label className="field-label" htmlFor="provider-compatibility">{copy('settings.compatibilityLabel')}</label>
                  <Select id="provider-compatibility" data-testid="provider-compatibility" value={compatibility} disabled={busy !== null}
                    onChange={(event) => {
                      setCompatibility(event.target.value as ProviderCompatibility)
                      modelCacheRef.current.delete(cacheKey(selectedProfileId))
                      setModelOptions([])
                      setModelStatus(null)
                      setStatus(null)
                    }}>
                    <option value="auto">{copy('settings.compatibilityAuto')}</option>
                    <option value="opencode-go">{copy('settings.compatibilityGo')}</option>
                  </Select>
                  <p className="field-hint">{copy('settings.compatibilityHint')}</p>

                  <div className="provider-model-heading">
                    <label className="field-label" htmlFor="provider-model">{copy('settings.modelLabel')}</label>
                    <button
                      className="text-button"
                      data-testid="provider-models-fetch"
                      type="button"
                      disabled={busy !== null || requestInvalid || !baseUrl.trim()}
                      onClick={handleFetchModels}
                    >
                      {busy === 'models' ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
                      {busy === 'models' ? copy('settings.fetchingModels') : copy('settings.fetchModels')}
                    </button>
                  </div>
                  <ModelCombobox value={model} options={modelOptions} disabled={busy !== null}
                    onChange={(value) => { setModel(value); setStatus(null) }} />
                  {modelStatus && (
                    <p className={`field-hint ${modelStatus.ok ? 'is-success-text' : 'is-error-text'}`} data-testid="provider-models-status" role="status">
                      {modelStatus.message}
                    </p>
                  )}

                  <div className="label-row">
                    <label className="field-label" htmlFor="provider-api-key">{copy('settings.apiKeyLabel')}</label>
                    {savedKeyMatches && <span className="saved-key"><Check size={12} /> {copy('settings.apiKeySaved')}</span>}
                  </div>
                  <input
                    id="provider-api-key"
                    data-testid="provider-api-key"
                    ref={keyRef}
                    type="password"
                    autoComplete="off"
                    disabled={busy !== null}
                    onChange={() => {
                      setKeyDirty(true)
                      setStatus(null)
                      modelCacheRef.current.delete(cacheKey(selectedProfileId))
                      setModelOptions([])
                      setModelStatus(null)
                    }}
                    placeholder={savedKeyMatches ? copy('settings.apiKeyPlaceholderSaved') : copy('settings.apiKeyPlaceholderEmpty')}
                  />
                  <p className="field-hint">{copy('settings.apiKeyHint')}</p>

                  {status && (
                    <div className={`provider-status ${status.ok ? 'is-success' : 'is-error'}`} data-testid="provider-status" role="status">
                      {status.ok ? <Check size={16} /> : <AlertCircle size={16} />}
                      <span>{status.message}</span>
                    </div>
                  )}

                  <fieldset disabled={busy !== null} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                    <RequestSettingsEditor key={selectedProfileId + ':' + requestEditorRevision + ':' + baseUrl + ':' + protocol} id="provider" value={requestSettings}
                      savedHeaders={selectedProfile?.hasCustomHeaders && selectedProfile.baseUrl === baseUrl && (selectedProfile.protocol ?? 'openai') === protocol}
                      onInvalidChange={(invalid) => { setRequestInvalid(invalid); if (invalid) setStatus(null) }} onChange={(settings) => {
                        setRequestSettings(settings); setStatus(null); setModelOptions([]); setModelStatus(null)
                        modelCacheRef.current.delete(cacheKey(selectedProfileId))
                      }} />
                  </fieldset>
                  <footer className="modal-actions provider-modal-actions">
                    <button
                      className="secondary-button"
                      data-testid="provider-test"
                      type="button"
                      disabled={busy !== null || requestInvalid || !baseUrl.trim() || !model.trim()}
                      onClick={() => void handleTest()}
                    >
                      {busy === 'test' ? <LoaderCircle className="spin" size={16} /> : <Unplug size={16} />}
                      {copy('settings.testConnection')}
                    </button>
                    <button className="secondary-button" data-testid="provider-test-stream" type="button"
                      disabled={busy !== null || requestInvalid || !baseUrl.trim() || !model.trim()}
                      onClick={() => void handleTest('stream')}>{copy('settings.testStream')}</button>
                    <button
                      className={selectedProfile?.isActive ? 'secondary-button' : 'primary-button'}
                      data-testid="provider-activate"
                      type={!selectedProfile?.isActive && (!selectedProfile || dirty) ? 'submit' : 'button'}
                      name="action"
                      value="save-and-use"
                      disabled={busy !== null || requestInvalid || !profileName.trim() || !baseUrl.trim() || !model.trim() || selectedProfile?.isActive}
                      onClick={selectedProfile && !dirty ? handleActivate : undefined}
                    >
                      {busy === 'activate' || busy === 'save-and-use' ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
                      {selectedProfile?.isActive ? copy('settings.activeProfile') : !selectedProfile || dirty ? copy('settings.saveAndUse') : copy('settings.setActive')}
                    </button>
                    <button
                      className={selectedProfile?.isActive ? 'primary-button' : 'secondary-button'}
                      data-testid="provider-save"
                      type="submit"
                      disabled={busy !== null || requestInvalid || !profileName.trim() || !baseUrl.trim() || !model.trim() || Boolean(selectedProfile && !dirty)}
                    >
                      {busy === 'save' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
                      {copy('settings.save')}
                    </button>
                  </footer>
                </form>
            </section>
          </div>
        </div>
      </section>
    </div>
  )
}
