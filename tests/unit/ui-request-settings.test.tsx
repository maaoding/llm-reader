// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { KnowledgeSettings } from '../../src/renderer/src/KnowledgeSettings'
import type { KnowledgeSettings as Settings, ReaderApi, SaveKnowledgeSettingsInput } from '../../src/shared/contracts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
function setup() {
  let settings: Settings = {
    embedding: { enabled: false, baseUrl: '', model: '', hasApiKey: false },
    rerank: { enabled: false, baseUrl: '', model: '', hasApiKey: false },
    document: { processor: 'none', baseUrl: '', ocr: true, language: 'ch', hasApiKey: false }
  }
  const save = vi.fn(async (input: SaveKnowledgeSettingsInput) => {
    const { customHeaders, apiKey, ...document } = input.document
    settings = { ...settings, document: { ...document, hasApiKey: Boolean(apiKey), hasCustomHeaders: Boolean(customHeaders && Object.keys(customHeaders).length) } }
    return settings
  })
  const test = vi.fn(async () => ({ ok: true, message: '测试通过' }))
  Object.defineProperty(window, 'readerApi', { configurable: true, value: {
    getKnowledgeSettings: async () => settings, saveKnowledgeSettings: save, testKnowledgeSettings: test
  } as unknown as ReaderApi })
  const dirty = vi.fn()
  const view = render(<KnowledgeSettings hidden={false} onDirty={dirty} />)
  return { ...view, save, test, dirty }
}

it('applies the Mistral preset, tests unsaved headers and parameters, then clears secret inputs after save', async () => {
  const view = setup()
  fireEvent.change(await view.findByTestId('document-processor'), { target: { value: 'mistral-ocr' } })
  expect((view.getByTestId('document-url') as HTMLInputElement).value).toBe('https://api.mistral.ai/v1')
  expect((view.getByTestId('document-model') as HTMLInputElement).value).toBe('mistral-ocr-latest')
  fireEvent.change(view.getByTestId('document-headers'), { target: { value: '{"X-Token":"draft-secret"}' } })
  fireEvent.change(view.getByTestId('document-body'), { target: { value: '{"extract_header":true}' } })
  fireEvent.change(view.getByTestId('document-timeout'), { target: { value: '120' } })
  fireEvent.click(view.getByTestId('document-test'))
  await waitFor(() => expect(view.test).toHaveBeenCalledWith(expect.objectContaining({ target: 'document', document: expect.objectContaining({
    processor: 'mistral-ocr', customHeaders: { 'X-Token': 'draft-secret' }, extraBody: { extract_header: true }, timeoutMs: 120_000
  }) })))
  expect(view.save).not.toHaveBeenCalled()
  await waitFor(() => expect((view.getByTestId('knowledge-save') as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(view.getByTestId('knowledge-save'))
  await waitFor(() => expect(view.save).toHaveBeenCalledOnce())
  await waitFor(() => expect((view.getByTestId('document-headers') as HTMLTextAreaElement).value).toBe(''))
  expect((view.getByTestId('document-headers') as HTMLTextAreaElement).placeholder).toContain('已保存')
  expect((view.getByTestId('knowledge-save') as HTMLButtonElement).disabled).toBe(true)
  expect(view.dirty).toHaveBeenLastCalledWith(false)
})

it('blocks malformed and reserved JSON, reports dirty edits, and recovers when switching providers', async () => {
  const view = setup()
  fireEvent.change(await view.findByTestId('document-processor'), { target: { value: 'mistral-ocr' } })
  fireEvent.change(view.getByTestId('document-headers'), { target: { value: '{broken' } })
  expect((view.getByTestId('document-test') as HTMLButtonElement).disabled).toBe(true)
  expect((view.getByTestId('knowledge-save') as HTMLButtonElement).disabled).toBe(true)
  expect(view.dirty).toHaveBeenLastCalledWith(true)
  fireEvent.change(view.getByTestId('document-processor'), { target: { value: 'unstructured' } })
  fireEvent.change(view.getByTestId('document-url'), { target: { value: 'http://localhost:8000/general/v0/general' } })
  expect((view.getByTestId('document-test') as HTMLButtonElement).disabled).toBe(false)
  fireEvent.change(view.getByTestId('document-body'), { target: { value: '{"files":[]}' } })
  expect((view.getByTestId('document-test') as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(view.getByTestId('document-body'), { target: { value: '{"strategy":"hi_res"}' } })
  expect((view.getByTestId('document-test') as HTMLButtonElement).disabled).toBe(false)
  expect(view.test).not.toHaveBeenCalled()
})

it('selects Claude for vision OCR and clears header drafts after endpoint or protocol changes', async () => {
  const view = setup()
  fireEvent.change(await view.findByTestId('document-processor'), { target: { value: 'vision' } })
  fireEvent.change(view.getByTestId('document-url'), { target: { value: 'https://api.anthropic.com' } })
  fireEvent.change(view.getByTestId('document-model'), { target: { value: 'claude-fixture' } })
  fireEvent.change(view.getByTestId('document-headers'), { target: { value: '{"Authorization":"secret"}' } })
  fireEvent.change(view.getByTestId('document-protocol'), { target: { value: 'anthropic' } })
  expect((view.getByTestId('document-headers') as HTMLTextAreaElement).value).toBe('')
  fireEvent.change(view.getByTestId('document-headers'), { target: { value: '{"x-api-key":"draft"}' } })
  fireEvent.click(view.getByTestId('document-clear-headers'))
  fireEvent.click(view.getByTestId('document-test'))
  await waitFor(() => expect(view.test).toHaveBeenCalledWith(expect.objectContaining({ document: expect.objectContaining({ protocol: 'anthropic', customHeaders: null }) })))
})
