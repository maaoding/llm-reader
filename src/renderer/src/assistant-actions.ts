import type { LlmAction } from '@shared/contracts'
import { copy } from '@shared/copy'

export const ASSISTANT_ACTIONS_STORAGE_KEY = 'llm-reader.assistant-actions'
export const MAX_ASSISTANT_ACTION_LABEL_LENGTH = 12
export const MAX_ASSISTANT_ACTION_PROMPT_LENGTH = 2_000

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
      label: normalizeLabel(explain.label, defaults.explain.label),
      prompt: normalizePrompt(explain.prompt, defaults.explain.prompt),
      icon: normalizeIcon(explain.icon, defaults.explain.icon)
    },
    context: {
      label: normalizeLabel(context.label, defaults.context.label),
      prompt: normalizePrompt(context.prompt, defaults.context.prompt),
      icon: normalizeIcon(context.icon, defaults.context.icon)
    },
    ask: {
      label: normalizeLabel(ask.label, defaults.ask.label),
      icon: normalizeIcon(ask.icon, defaults.ask.icon)
    }
  }
}

export function readAssistantActionSettings(): AssistantActionSettings {
  if (typeof window === 'undefined') return createDefaultAssistantActionSettings()
  try {
    const stored = window.localStorage.getItem(ASSISTANT_ACTIONS_STORAGE_KEY)
    return normalizeAssistantActionSettings(stored ? JSON.parse(stored) as unknown : null)
  } catch {
    return createDefaultAssistantActionSettings()
  }
}

export function persistAssistantActionSettings(settings: AssistantActionSettings): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ASSISTANT_ACTIONS_STORAGE_KEY, JSON.stringify(settings))
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
