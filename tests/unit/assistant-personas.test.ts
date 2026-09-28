// @vitest-environment jsdom

import { beforeEach, expect, it } from 'vitest'
import { ASSISTANT_PERSONAS_STORAGE_KEY, defaultPersona, normalizePersonaSettings, persistPersonaSettings, readPersonaSettings } from '../../src/renderer/src/assistant-personas'

beforeEach(() => window.localStorage.clear())

it('takes an independent default snapshot for a new conversation and preserves it after preset edits', () => {
  const first = { id: 'mentor', name: '社科阅读', prompt: '先理清作者的论证。' }
  const settings = { presets: [first], defaultId: first.id }
  expect(persistPersonaSettings(settings)).toBe(true)
  const conversation = defaultPersona(readPersonaSettings())
  persistPersonaSettings({ presets: [{ ...first, prompt: '改为简要回答。' }], defaultId: first.id })
  expect(conversation?.prompt).toBe('先理清作者的论证。')
  expect(defaultPersona(readPersonaSettings())?.prompt).toBe('改为简要回答。')
  persistPersonaSettings({ presets: [], defaultId: null })
  expect(conversation?.prompt).toBe('先理清作者的论证。')
})

it('drops corrupt presets and clears missing defaults without losing valid ones', () => {
  window.localStorage.setItem(ASSISTANT_PERSONAS_STORAGE_KEY, '{')
  expect(readPersonaSettings()).toEqual({ presets: [], defaultId: null })
  expect(normalizePersonaSettings({ presets: [
    { id: 'ok', name: ' 有效 ', prompt: ' 分析原文 ' },
    { id: 'ok', name: '重复', prompt: '忽略' },
    { id: 'empty', name: '空', prompt: '' }
  ], defaultId: 'missing' })).toEqual({ presets: [{ id: 'ok', name: '有效', prompt: '分析原文' }], defaultId: null })
})
