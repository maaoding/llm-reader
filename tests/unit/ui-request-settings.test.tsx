// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { KnowledgeSettings } from '../../src/renderer/src/KnowledgeSettings'
import type { KnowledgeSettings as Settings, ReaderApi, SaveKnowledgeSettingsInput } from '../../src/shared/contracts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
function setup(initialEmbedding?: Settings['embedding']) {
  let settings: Settings = {
    webSearch: { enabled: false, baseUrl: 'https://api.tavily.com', hasApiKey: false },
    embedding: initialEmbedding ?? { enabled: false, baseUrl: '', model: '', hasApiKey: false },
    rerank: { enabled: false, baseUrl: '', model: '', hasApiKey: false },
    document: { enabled: false, processor: 'none', baseUrl: '', ocr: true, language: 'ch', hasApiKey: false }
  }
  const save = vi.fn(async (input: SaveKnowledgeSettingsInput) => {
    if (input.target === 'document') {
      const { customHeaders, apiKey, ...document } = input.document
      settings = { ...settings, document: { ...document, enabled: document.enabled ?? document.processor !== 'none', hasApiKey: Boolean(apiKey) || apiKey === undefined && settings.document.hasApiKey,
        hasCustomHeaders: Boolean(customHeaders && Object.keys(customHeaders).length) || customHeaders === undefined && Boolean(settings.document.hasCustomHeaders) } }
    } else if (input.target === 'embedding') {
      const { customHeaders, apiKey, ...embedding } = input.embedding
      settings = { ...settings, embedding: { ...embedding, hasApiKey: Boolean(apiKey) || apiKey === undefined && settings.embedding.hasApiKey,
        hasCustomHeaders: Boolean(customHeaders && Object.keys(customHeaders).length) || customHeaders === undefined && Boolean(settings.embedding.hasCustomHeaders) } }
    } else if (input.target === 'rerank' && input.rerank) {
      const { customHeaders, apiKey, ...rerank } = input.rerank
      settings = { ...settings, rerank: { ...rerank, hasApiKey: Boolean(apiKey) || apiKey === undefined && settings.rerank.hasApiKey,
        hasCustomHeaders: Boolean(customHeaders && Object.keys(customHeaders).length) || customHeaders === undefined && Boolean(settings.rerank.hasCustomHeaders) } }
    }
    return settings
  })
  const test = vi.fn<ReaderApi['testKnowledgeSettings']>(async () => ({ ok: true, message: '测试通过' }))
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
  expect(view.getByText(/复杂论文、表格和公式优先选 MinerU 或 Docling/u)).toBeTruthy()
  expect(view.getByLabelText('OCR 模型名称')).toBe(view.getByTestId('document-model'))
  expect(view.getByText(/当前应用按页保存文字/u)).toBeTruthy()
  expect((view.getByTestId('document-url') as HTMLInputElement).value).toBe('https://api.mistral.ai/v1')
  expect((view.getByTestId('document-model') as HTMLInputElement).value).toBe('mistral-ocr-latest')
  fireEvent.change(view.getByTestId('document-headers'), { target: { value: '{"X-Token":"draft-secret"}' } })
  fireEvent.change(view.getByTestId('document-body'), { target: { value: '{"extract_header":true}' } })
  fireEvent.change(view.getByTestId('document-timeout'), { target: { value: '120' } })
  fireEvent.click(view.getByTestId('document-test'))
  await waitFor(() => expect(view.test).toHaveBeenCalledWith(expect.objectContaining({ target: 'document', document: expect.objectContaining({
    processor: 'mistral-ocr', customHeaders: { 'X-Token': 'draft-secret' }, extraBody: { extract_header: true }, timeoutMs: 120_000
  }) })))
  expect(Object.keys(view.test.mock.calls[0][0])).toEqual(['target', 'document'])
  expect(view.save).not.toHaveBeenCalled()
  await waitFor(() => expect((view.getByTestId('document-save') as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(view.getByTestId('document-save'))
  await waitFor(() => expect(view.save).toHaveBeenCalledOnce())
  expect(view.save).toHaveBeenCalledWith(expect.objectContaining({ target: 'document', document: expect.objectContaining({ enabled: true }) }))
  await waitFor(() => expect((view.getByTestId('document-headers') as HTMLTextAreaElement).value).toBe(''))
  expect((view.getByTestId('document-headers') as HTMLTextAreaElement).placeholder).toContain('已保存')
  expect((view.getByTestId('document-save') as HTMLButtonElement).disabled).toBe(true)
  expect(view.dirty).toHaveBeenLastCalledWith(false)
})

it('blocks malformed and reserved JSON, reports dirty edits, and recovers when switching providers', async () => {
  const view = setup()
  fireEvent.change(await view.findByTestId('document-processor'), { target: { value: 'mistral-ocr' } })
  fireEvent.change(view.getByTestId('document-headers'), { target: { value: '{broken' } })
  expect((view.getByTestId('document-test') as HTMLButtonElement).disabled).toBe(true)
  expect((view.getByTestId('document-save') as HTMLButtonElement).disabled).toBe(true)
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
  expect(view.getByLabelText('视觉模型名称')).toBe(view.getByTestId('document-model'))
  expect(view.getByText(/兼容或 Anthropic 接口逐页识别 PDF 文字/u)).toBeTruthy()
  fireEvent.change(view.getByTestId('document-url'), { target: { value: 'https://api.anthropic.com' } })
  fireEvent.change(view.getByTestId('document-model'), { target: { value: 'claude-fixture' } })
  fireEvent.change(view.getByTestId('document-headers'), { target: { value: '{"Authorization":"secret"}' } })
  fireEvent.change(view.getByTestId('document-protocol'), { target: { value: 'anthropic' } })
  expect((view.getByTestId('document-headers') as HTMLTextAreaElement).value).toBe('')
  fireEvent.change(view.getByTestId('document-headers'), { target: { value: '{"x-api-key":"draft"}' } })
  fireEvent.click(view.getByTestId('document-clear-headers'))
  fireEvent.click(view.getByTestId('document-test'))
  await waitFor(() => expect(view.test).toHaveBeenCalledWith(expect.objectContaining({ document: expect.objectContaining({ protocol: 'anthropic', customHeaders: undefined }) })))
})

it('keeps each service draft independent and uses only the saved configuration for immediate toggles', async () => {
  const view = setup()
  await view.findByTestId('document-processor')
  fireEvent.change(view.getByTestId('embedding-url'), { target: { value: 'http://127.0.0.1:9/v1' } })
  fireEvent.change(view.getByTestId('embedding-model'), { target: { value: 'vectors' } })
  fireEvent.click(view.getByTestId('embedding-save'))
  await waitFor(() => expect(view.save).toHaveBeenCalledWith(expect.objectContaining({ target: 'embedding', embedding: expect.objectContaining({ enabled: true }) })))
  expect((view.getByTestId('embedding-enabled') as HTMLInputElement).checked).toBe(true)
  fireEvent.change(view.getByTestId('document-processor'), { target: { value: 'vision' } })
  fireEvent.change(view.getByTestId('document-body'), { target: { value: '{broken' } })
  fireEvent.change(view.getByTestId('embedding-model'), { target: { value: 'unsaved' } })
  fireEvent.click(view.getByTestId('embedding-enabled'))
  await waitFor(() => expect(view.save).toHaveBeenLastCalledWith(expect.objectContaining({ target: 'embedding', embedding: expect.objectContaining({ enabled: false, model: 'vectors' }) })))
  expect((view.getByTestId('embedding-model') as HTMLInputElement).value).toBe('unsaved')
  expect((view.getByTestId('embedding-enabled') as HTMLInputElement).checked).toBe(false)
  fireEvent.click(view.getByTestId('embedding-save'))
  await waitFor(() => expect(view.save).toHaveBeenLastCalledWith(expect.objectContaining({ target: 'embedding', embedding: expect.objectContaining({ enabled: false, model: 'unsaved' }) })))
})

it('shows a stale test result after editing and explains that OCR choices do not disable document parsing', async () => {
  const view = setup()
  fireEvent.change(await view.findByTestId('document-processor'), { target: { value: 'docling' } })
  expect(view.getByText('在准备原文时使用所选 PDF 解析服务')).toBeTruthy()
  fireEvent.change(view.getByTestId('document-ocr'), { target: { value: 'text' } })
  expect(view.getByText(/无论选择哪种方式/u)).toBeTruthy()
  fireEvent.click(view.getByTestId('document-test'))
  await waitFor(() => expect(view.getByTestId('knowledge-document-status').textContent).toContain('测试通过'))
  fireEvent.change(view.getByTestId('document-ocr'), { target: { value: 'ocr' } })
  expect(view.getByTestId('knowledge-document-status').textContent).toContain('请重新测试')
})

it('keeps the saved status visible during edits and only removes saved headers on save', async () => {
  const view = setup({ enabled: true, baseUrl: 'https://example.com/v1', model: 'vectors', hasApiKey: false, hasCustomHeaders: true })
  await view.findByTestId('embedding-headers')
  fireEvent.change(view.getByTestId('embedding-model'), { target: { value: 'new-vectors' } })
  expect(view.container.querySelector('[data-service="embedding"] > header')?.textContent).toContain('已启用')
  expect(view.container.querySelector('[data-service="embedding"] > header')?.textContent).toContain('有未保存的修改')
  fireEvent.click(view.getByTestId('embedding-clear-headers'))
  expect(view.getByText(/保存当前配置后移除请求头/u)).toBeTruthy()
  expect(view.save).not.toHaveBeenCalled()
  fireEvent.click(view.getByTestId('embedding-clear-headers'))
  expect(view.queryByText(/保存当前配置后移除请求头/u)).toBeNull()
  fireEvent.click(view.getByTestId('embedding-clear-headers'))
  fireEvent.click(view.getByTestId('embedding-save'))
  await waitFor(() => expect(view.save).toHaveBeenCalledWith(expect.objectContaining({ target: 'embedding', embedding: expect.objectContaining({ customHeaders: null, model: 'new-vectors' }) })))
  await waitFor(() => expect(view.queryByTestId('embedding-clear-headers')).toBeNull())
})

it('shows the latest failed test after saving or toggling and invalidates it after editing', async () => {
  const view = setup({ enabled: true, baseUrl: 'https://example.com/v1', model: 'vectors', hasApiKey: false })
  fireEvent.change(await view.findByTestId('embedding-model'), { target: { value: 'vectors-2' } })
  fireEvent.click(view.getByTestId('embedding-save'))
  await waitFor(() => expect(view.getByTestId('knowledge-embedding-status').textContent).toBe('此项配置已保存。'))
  view.test.mockResolvedValueOnce({ ok: false, message: 'HTTP 401' })
  fireEvent.click(view.getByTestId('embedding-test'))
  await waitFor(() => expect(view.getByTestId('knowledge-embedding-status').textContent).toBe('HTTP 401'))
  expect(view.getByTestId('knowledge-embedding-status').className).toContain('is-error-text')
  fireEvent.click(view.getByTestId('embedding-enabled'))
  await waitFor(() => expect(view.getByTestId('knowledge-embedding-status').textContent).toContain('已关闭'))
  view.test.mockRejectedValueOnce(new Error('service unavailable'))
  fireEvent.click(view.getByTestId('embedding-test'))
  await waitFor(() => expect(view.getByTestId('knowledge-embedding-status').textContent).toContain('service unavailable'))
  fireEvent.change(view.getByTestId('embedding-body'), { target: { value: '{broken' } })
  expect(view.getByTestId('knowledge-embedding-status').textContent).toContain('请重新测试')
  expect(view.container.querySelector('[data-service="embedding"] > header')?.textContent).toContain('有未保存的修改')
})

it('labels an in-progress save separately from a connection test', async () => {
  const view = setup({ enabled: true, baseUrl: 'https://example.com/v1', model: 'vectors', hasApiKey: false })
  fireEvent.change(await view.findByTestId('embedding-model'), { target: { value: 'vectors-2' } })
  let finish!: () => void
  const pending = new Promise<void>((resolve) => { finish = resolve })
  const save = view.save.getMockImplementation()!
  view.save.mockImplementationOnce(async (input) => { await pending; return save(input) })
  fireEvent.click(view.getByTestId('embedding-save'))
  expect(view.getByTestId('knowledge-embedding-status').textContent).toBe('正在保存…')
  finish()
  await waitFor(() => expect(view.getByTestId('knowledge-embedding-status').textContent).toBe('此项配置已保存。'))
})

it('starts with compact cards ordered by preparation, while switches stay available outside the details', async () => {
  const view = setup({ enabled: true, baseUrl: 'https://example.com/v1', model: 'vectors', hasApiKey: false })
  await view.findByTestId('embedding-enabled')
  expect(Array.from(view.container.querySelectorAll('[data-service]'), (card) => card.getAttribute('data-service'))).toEqual(['document', 'embedding', 'rerank', 'webSearch'])
  for (const kind of ['document', 'embedding', 'rerank', 'webSearch']) {
    expect((view.getByTestId(`${kind}-config`) as HTMLDetailsElement).open).toBe(false)
    expect(view.getByTestId(`${kind}-enabled`).closest('details')).toBeNull()
  }
  fireEvent.click(view.getByTestId('embedding-enabled'))
  await waitFor(() => expect(view.save).toHaveBeenCalledOnce())
  expect((view.getByTestId('embedding-config') as HTMLDetailsElement).open).toBe(false)
  expect(view.getByTestId('knowledge-embedding-status').closest('details')).toBeNull()
})
