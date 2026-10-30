import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { isUiLanguage, setCopyLanguage, type UiLanguage } from '@shared/copy'
import type { ThemePreference, InterfaceScale } from './SettingsModal'
import { DEFAULT_READING_PREFERENCES, normalizeReadingPreferences, normalizePaperThemePreference, resolveEffectivePaperTheme, type ReadingPreferences, type PaperThemePreference } from './readers'
import { readAssistantActionSettings, persistAssistantActionSettings, normalizeAssistantActionSettings, type AssistantActionSettings } from './assistant-actions'

type ResolvedTheme = Exclude<ThemePreference, 'system'>

const THEME_STORAGE_KEY = 'llm-reader.theme'
const INTERFACE_SCALE_STORAGE_KEY = 'llm-reader.interface-scale'
const UI_LANGUAGE_STORAGE_KEY = 'llm-reader.ui-language'
const READING_PREFERENCES_STORAGE_KEY = 'llm-reader.reading-preferences'
const PAPER_THEME_PREFERENCE_STORAGE_KEY = 'llm-reader.paper-theme-preference'
const LEGACY_PAPER_THEME_MODE_STORAGE_KEY = 'llm-reader.paper-theme-mode'

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

// 应用启动渲染前读取一次并同步到 copy 模块，保证首帧就是所选语言。
function readUiLanguage(): UiLanguage {
  if (typeof window === 'undefined') return 'zh'
  try {
    const stored = window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY)
    return isUiLanguage(stored) ? stored : 'zh'
  } catch {
    return 'zh'
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
    return {
      ...normalizeReadingPreferences(value as ReadingPreferences),
      paperTheme: DEFAULT_READING_PREFERENCES.paperTheme
    }
  } catch {
    return { ...DEFAULT_READING_PREFERENCES }
  }
}

function readPaperThemePreference(): PaperThemePreference {
  try {
    return normalizePaperThemePreference(
      window.localStorage.getItem(PAPER_THEME_PREFERENCE_STORAGE_KEY)
    )
  } catch {
    return 'default'
  }
}

export function useAppPreferences() {
  // 初始化阶段同时切换 copy 模块语言，保证首帧渲染的文案与持久化语言一致。
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>(() => {
    const language = readUiLanguage()
    setCopyLanguage(language)
    return language
  })
  const [themePreference, setThemePreference] = useState<ThemePreference>(readThemePreference)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(themePreference))
  const [interfaceScale, setInterfaceScale] = useState<InterfaceScale>(readInterfaceScale)
  const [readingPreferences, setReadingPreferences] = useState<ReadingPreferences>(readReadingPreferences)
  const [paperThemePreference, setPaperThemePreference] = useState<PaperThemePreference>(readPaperThemePreference)
  const [assistantActions, setAssistantActions] = useState<AssistantActionSettings>(readAssistantActionSettings)
  const effectivePaperTheme = resolveEffectivePaperTheme(paperThemePreference, resolvedTheme)
  const effectiveReadingPreferences = useMemo(
    () => ({ ...readingPreferences, paperTheme: effectivePaperTheme }),
    [readingPreferences, effectivePaperTheme]
  )
  useLayoutEffect(() => {
    try {
      window.localStorage.setItem(INTERFACE_SCALE_STORAGE_KEY, String(interfaceScale))
    } catch {
      // Scaling remains active for this session when storage is unavailable.
    }
    document.documentElement.dataset.interfaceScale = String(interfaceScale)
  }, [interfaceScale])

  useLayoutEffect(() => {
    setCopyLanguage(uiLanguage)
    try {
      window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, uiLanguage)
    } catch {
      // The chosen language remains active for this session when storage is unavailable.
    }
    document.documentElement.lang = uiLanguage === 'en' ? 'en' : 'zh-CN'
    // 主进程的原生对话框与错误文案跟随同一语言。
    void window.readerApi.setUiLanguage(uiLanguage).catch(() => undefined)
  }, [uiLanguage])

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

  useLayoutEffect(() => {
    try {
      window.localStorage.setItem(PAPER_THEME_PREFERENCE_STORAGE_KEY, paperThemePreference)
      window.localStorage.removeItem(LEGACY_PAPER_THEME_MODE_STORAGE_KEY)
    } catch {
      // The selected paper preference still applies for this session when storage is unavailable.
    }
  }, [paperThemePreference])

  // 先切换 copy 模块再触发渲染，保证本次 commit 的所有文案已用新语言；
  // 仍为默认值的划词名称与提示词跟随语言，自定义值不受影响。
  const changeUiLanguage = useCallback((language: UiLanguage) => {
    setCopyLanguage(language)
    setUiLanguage(language)
    setAssistantActions((previous) => normalizeAssistantActionSettings(previous))
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(READING_PREFERENCES_STORAGE_KEY, JSON.stringify(readingPreferences))
    } catch {
      // Reading preferences remain active for this session when storage is unavailable.
    }
  }, [readingPreferences])

  useEffect(() => {
    persistAssistantActionSettings(normalizeAssistantActionSettings(assistantActions))
  }, [assistantActions])

  return {
    uiLanguage, themePreference, resolvedTheme, interfaceScale,
    readingPreferences, effectiveReadingPreferences, effectivePaperTheme, paperThemePreference, assistantActions,
    changeUiLanguage, setThemePreference, setInterfaceScale,
    setReadingPreferences, setPaperThemePreference, setAssistantActions
  }
}
