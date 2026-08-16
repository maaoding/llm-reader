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
  readAssistantActionSettings
} from '../../src/renderer/src/assistant-actions'

describe('assistant action settings', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('uses the shared copy text as defaults', () => {
    expect(createDefaultAssistantActionSettings()).toEqual({
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
    })
  })

  it('normalizes untrusted persisted values field by field', () => {
    expect(
      normalizeAssistantActionSettings({
        explain: { label: '  通俗解释  ', prompt: '  请用通俗语言解释。  ' },
        context: { label: 42, prompt: '' },
        ask: {}
      })
    ).toEqual({
      explain: { label: '通俗解释', prompt: '请用通俗语言解释。' },
      context: {
        label: copy('assistant.actionContext'),
        prompt: copy('assistant.questionContext')
      },
      ask: { label: copy('assistant.actionAsk') }
    })
  })

  it('rejects empty or oversized labels and prompts', () => {
    const longLabel = '很'.repeat(MAX_ASSISTANT_ACTION_LABEL_LENGTH + 1)
    const longPrompt = '问'.repeat(MAX_ASSISTANT_ACTION_PROMPT_LENGTH + 1)
    const normalized = normalizeAssistantActionSettings({
      explain: { label: longLabel, prompt: longPrompt },
      context: { label: '  ', prompt: '  ' },
      ask: { label: null }
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
    const settings = {
      explain: { label: '通俗解释', prompt: '请用通俗语言解释这段内容。' },
      context: { label: '看上下文', prompt: '请结合本章上下文分析这段内容。' },
      ask: { label: '直接问' }
    }
    persistAssistantActionSettings(settings)
    expect(readAssistantActionSettings()).toEqual(settings)
    expect(assistantActionLabel(settings, 'explain')).toBe('通俗解释')
    expect(assistantActionLabel(settings, 'context')).toBe('看上下文')
    expect(assistantActionLabel(settings, 'ask')).toBe('直接问')
  })
})
