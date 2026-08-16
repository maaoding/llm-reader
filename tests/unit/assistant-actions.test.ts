// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { copy } from '../../src/shared/copy'
import {
  ASSISTANT_ACTIONS_STORAGE_KEY,
  assistantActionLabel,
  createDefaultAssistantActionSettings,
  MAX_ASSISTANT_ACTION_LABEL_LENGTH,
  MAX_ASSISTANT_ACTION_PROMPT_LENGTH,
  normalizeAssistantActionSettings,
  persistAssistantActionSettings,
  readAssistantActionSettings,
  type AssistantActionSettings
} from '../../src/renderer/src/assistant-actions'

describe('assistant action settings', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('uses the shared copy text and default icons', () => {
    expect(createDefaultAssistantActionSettings()).toEqual({
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
    })
  })

  it('normalizes untrusted persisted values field by field', () => {
    expect(
      normalizeAssistantActionSettings({
        explain: { label: '  通俗解释  ', prompt: '  请用通俗语言解释。  ', icon: 'lightbulb' },
        context: { label: 42, prompt: '', icon: 'unknown-icon' },
        ask: { label: '直接问', icon: null }
      })
    ).toEqual({
      explain: { label: '通俗解释', prompt: '请用通俗语言解释。', icon: 'lightbulb' },
      context: {
        label: copy('assistant.actionContext'),
        prompt: copy('assistant.questionContext'),
        icon: 'book-open'
      },
      ask: { label: '直接问', icon: 'message-square-text' }
    })
  })

  it('rejects empty or oversized labels and prompts and invalid icons', () => {
    const longLabel = '很'.repeat(MAX_ASSISTANT_ACTION_LABEL_LENGTH + 1)
    const longPrompt = '问'.repeat(MAX_ASSISTANT_ACTION_PROMPT_LENGTH + 1)
    const normalized = normalizeAssistantActionSettings({
      explain: { label: longLabel, prompt: longPrompt, icon: 'sparkles' },
      context: { label: '  ', prompt: '  ', icon: 42 },
      ask: { label: null, icon: '' }
    })
    const defaults = createDefaultAssistantActionSettings()

    expect(normalized.explain).toEqual(defaults.explain)
    expect(normalized.context).toEqual(defaults.context)
    expect(normalized.ask).toEqual(defaults.ask)
  })

  it('falls back to defaults for malformed JSON and non-object roots', () => {
    const defaults = createDefaultAssistantActionSettings()
    expect(normalizeAssistantActionSettings(null)).toEqual(defaults)
    expect(normalizeAssistantActionSettings('bad')).toEqual(defaults)
    expect(normalizeAssistantActionSettings([])).toEqual(defaults)
    expect(readAssistantActionSettings()).toEqual(defaults)

    window.localStorage.setItem(ASSISTANT_ACTIONS_STORAGE_KEY, '{not-json')
    expect(readAssistantActionSettings()).toEqual(defaults)
  })

  it('persists and restores valid settings and resolves action labels', () => {
    const settings: AssistantActionSettings = {
      explain: { label: '通俗解释', prompt: '请用通俗语言解释这段内容。', icon: 'lightbulb' },
      context: { label: '看上下文', prompt: '请结合本章上下文分析这段内容。', icon: 'quote' },
      ask: { label: '直接问', icon: 'pen-line' }
    }
    persistAssistantActionSettings(settings)
    expect(readAssistantActionSettings()).toEqual(settings)
    expect(assistantActionLabel(settings, 'explain')).toBe('通俗解释')
    expect(assistantActionLabel(settings, 'context')).toBe('看上下文')
    expect(assistantActionLabel(settings, 'ask')).toBe('直接问')
  })
})
