import type { LlmAction } from '@shared/contracts'
import { copy, copyIn, type CopyKey } from '@shared/copy'

export const ASSISTANT_ACTIONS_STORAGE_KEY = 'llm-reader.assistant-actions'
export const MAX_ASSISTANT_ACTION_LABEL_LENGTH = 12
export const MAX_ASSISTANT_ACTION_PROMPT_LENGTH = 2_000

const DEFAULT_PROMPT_VERSION = 2
const LEGACY_DEFAULT_PROMPTS = {
  explain: '请用清晰、准确的语言解释这段内容。',
  context: '请结合本章上下文说明这段内容的含义与作用。'
}

const ACTION_DEFAULT_KEYS = {
  explain: { label: 'assistant.actionExplain', prompt: 'assistant.questionExplain' },
  context: { label: 'assistant.actionContext', prompt: 'assistant.questionContext' },
  ask: { label: 'assistant.actionAsk' }
} as const

const UI_LANGUAGES_FOR_DEFAULTS = ['zh', 'en'] as const

// 与任一语言默认文案完全一致的存储值视为“仍是默认”，随界面语言切换；自定义值保留。
function followLanguageDefault(value: string, key: CopyKey): string {
  for (const language of UI_LANGUAGES_FOR_DEFAULTS) {
    if (value === copyIn(language, key)) return copy(key)
  }
  return value
}

export const ASSISTANT_ACTION_ICONS = [
  'highlighter',
  'book-open',
  'message-square-text',
  'search',
  'lightbulb',
  'pen-line',
  'quote',
  'book-marked'
] as const

export type AssistantActionIcon = (typeof ASSISTANT_ACTION_ICONS)[number]

export interface AssistantActionSettings {
  explain: { label: string; prompt: string; icon: AssistantActionIcon }
  context: { label: string; prompt: string; icon: AssistantActionIcon }
  ask: { label: string; icon: AssistantActionIcon }
}

export function createDefaultAssistantActionSettings(): AssistantActionSettings {
  return {
    explain: {
      label: copy('assistant.actionExplain'),
      prompt: copy('assistant.questionExplain'),
      icon: 'highlighter'
    },
    context: {
      label: copy('assistant.actionContext'),
      prompt: copy('assistant.questionContext'),
      icon: 'book-open'
    },
    ask: {
      label: copy('assistant.actionAsk'),
      icon: 'message-square-text'
    }
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
}

function normalizeLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (trimmed.length === 0) return fallback
  if (Array.from(trimmed).length > MAX_ASSISTANT_ACTION_LABEL_LENGTH) return fallback
  return trimmed
}

function normalizePrompt(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (trimmed.length === 0) return fallback
  if (Array.from(trimmed).length > MAX_ASSISTANT_ACTION_PROMPT_LENGTH) return fallback
  return trimmed
}

function normalizeIcon(value: unknown, fallback: AssistantActionIcon): AssistantActionIcon {
  return ASSISTANT_ACTION_ICONS.includes(value as AssistantActionIcon) ? value as AssistantActionIcon : fallback
}

export function normalizeAssistantActionSettings(value: unknown): AssistantActionSettings {
  const defaults = createDefaultAssistantActionSettings()
  const record = toRecord(value)
  const explain = toRecord(record.explain)
  const context = toRecord(record.context)
  const ask = toRecord(record.ask)

  return {
    explain: {
      label: followLanguageDefault(normalizeLabel(explain.label, defaults.explain.label), ACTION_DEFAULT_KEYS.explain.label),
      prompt: followLanguageDefault(normalizePrompt(explain.prompt, defaults.explain.prompt), ACTION_DEFAULT_KEYS.explain.prompt),
      icon: normalizeIcon(explain.icon, defaults.explain.icon)
    },
    context: {
      label: followLanguageDefault(normalizeLabel(context.label, defaults.context.label), ACTION_DEFAULT_KEYS.context.label),
      prompt: followLanguageDefault(normalizePrompt(context.prompt, defaults.context.prompt), ACTION_DEFAULT_KEYS.context.prompt),
      icon: normalizeIcon(context.icon, defaults.context.icon)
    },
    ask: {
      label: followLanguageDefault(normalizeLabel(ask.label, defaults.ask.label), ACTION_DEFAULT_KEYS.ask.label),
      icon: normalizeIcon(ask.icon, defaults.ask.icon)
    }
  }
}

export function readAssistantActionSettings(): AssistantActionSettings {
  if (typeof window === 'undefined') return createDefaultAssistantActionSettings()
  try {
    const stored = window.localStorage.getItem(ASSISTANT_ACTIONS_STORAGE_KEY)
    const record = toRecord(stored ? JSON.parse(stored) as unknown : null)
    const settings = normalizeAssistantActionSettings(record)
    // Older versions persisted defaults too. Upgrade only exact old defaults;
    // custom prompts, labels and icons retain their existing values.
    if (record.defaultPromptVersion === undefined) {
      const defaults = createDefaultAssistantActionSettings()
      for (const action of ['explain', 'context'] as const) {
        if (settings[action].prompt === LEGACY_DEFAULT_PROMPTS[action]) settings[action].prompt = defaults[action].prompt
      }
    }
    return settings
  } catch {
    return createDefaultAssistantActionSettings()
  }
}

export function persistAssistantActionSettings(settings: AssistantActionSettings): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ASSISTANT_ACTIONS_STORAGE_KEY, JSON.stringify({ ...settings, defaultPromptVersion: DEFAULT_PROMPT_VERSION }))
  } catch {
    // Custom assistant actions remain active for this session when storage is unavailable.
  }
}

export function assistantActionLabel(
  settings: AssistantActionSettings,
  action: LlmAction
): string {
  if (action === 'explain') return settings.explain.label
  if (action === 'context') return settings.context.label
  return settings.ask.label
}
