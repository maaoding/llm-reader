import type { LlmAction } from '@shared/contracts'
import { copy } from '@shared/copy'

export const ASSISTANT_ACTIONS_STORAGE_KEY = 'llm-reader.assistant-actions'
export const MAX_ASSISTANT_ACTION_LABEL_LENGTH = 12
export const MAX_ASSISTANT_ACTION_PROMPT_LENGTH = 2_000

export interface AssistantActionSettings {
  explain: { label: string; prompt: string }
  context: { label: string; prompt: string }
  ask: { label: string }
}

export function createDefaultAssistantActionSettings(): AssistantActionSettings {
  return {
    explain: {
      label: copy('assistant.actionExplain'),
      prompt: copy('assistant.questionExplain')
    },
    context: {
      label: copy('assistant.actionContext'),
      prompt: copy('assistant.questionContext')
    },
    ask: {
      label: copy('assistant.actionAsk')
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

export function normalizeAssistantActionSettings(value: unknown): AssistantActionSettings {
  const defaults = createDefaultAssistantActionSettings()
  const record = toRecord(value)
  const explain = toRecord(record.explain)
  const context = toRecord(record.context)
  const ask = toRecord(record.ask)

  return {
    explain: {
      label: normalizeLabel(explain.label, defaults.explain.label),
      prompt: normalizePrompt(explain.prompt, defaults.explain.prompt)
    },
    context: {
      label: normalizeLabel(context.label, defaults.context.label),
      prompt: normalizePrompt(context.prompt, defaults.context.prompt)
    },
    ask: {
      label: normalizeLabel(ask.label, defaults.ask.label)
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
