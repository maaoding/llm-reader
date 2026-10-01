// @vitest-environment jsdom
import React, { createRef, useState } from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SettingsModal } from '../../src/renderer/src/App'
import { createDefaultAssistantActionSettings } from '../../src/renderer/src/assistant-actions'
import { DEFAULT_READING_PREFERENCES } from '../../src/renderer/src/readers/types'
import type { KnowledgeSettings, PersonaSettings, ProviderOverview, ProviderProfile, ReaderApi } from '../../src/shared/contracts'

// Settings do not mount a book; keep native PDF/canvas readers outside this component test.
vi.mock('../../src/renderer/src/readers', async () => ({
  ...await import('../../src/renderer/src/readers/types'),
  ...await import('../../src/renderer/src/readers/reading-preferences'),
  ...await import('../../src/renderer/src/readers/search'),
  createReaderAdapter: vi.fn()
}))

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  // jsdom 尚未实现 Popover；菜单的真实开合、焦点和视觉行为由 Electron E2E 覆盖。
  Object.defineProperty(HTMLElement.prototype, 'hidePopover', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLElement.prototype, 'showPopover', { configurable: true, value: vi.fn() })
})
afterEach(() => { cleanup(); document.body.replaceChildren(); vi.restoreAllMocks() })

const profile: ProviderProfile = { id: 'first', name: 'Reading', baseUrl: 'https://example.com/v1', model: 'model-1',
  hasApiKey: true, compatibility: 'auto', protocol: 'openai', isActive: false, createdAt: '1', updatedAt: '1' }
const knowledge: KnowledgeSettings = {
  webSearch: { enabled: false, baseUrl: 'https://api.tavily.com', hasApiKey: false },
  embedding: { enabled: false, baseUrl: '', model: '', hasApiKey: false },
  rerank: { enabled: false, baseUrl: '', model: '', hasApiKey: false },
  document: { enabled: false, processor: 'none', baseUrl: '', ocr: true, language: 'ch', hasApiKey: false }
}

function setup(options: { overview?: ProviderOverview; knowledge?: KnowledgeSettings; initialSection?: 'model' | 'persona' | 'knowledge'; initialService?: 'document' | 'embedding' } = {}) {
  let overview = options.overview ?? { profiles: [profile], activeProfileId: null }
  const api = {
    listSystemFonts: vi.fn(async () => []),
    getKnowledgeSettings: vi.fn(async () => options.knowledge ?? knowledge),
    saveKnowledgeSettings: vi.fn<ReaderApi['saveKnowledgeSettings']>(async () => options.knowledge ?? knowledge),
    createProviderProfile: vi.fn<ReaderApi['createProviderProfile']>(async (input) => {
      overview = { ...overview, profiles: [...overview.profiles, { ...profile, ...input, id: 'new' }] }
      return overview
    }),
    updateProviderProfile: vi.fn<ReaderApi['updateProviderProfile']>(async (input) => {
      overview = { ...overview, profiles: overview.profiles.map((item) => item.id === input.id ? { ...item, ...input } : item) }
      return overview
    }),
    activateProviderProfile: vi.fn<ReaderApi['activateProviderProfile']>(async (id) => {
      overview = { activeProfileId: id, profiles: overview.profiles.map((item) => ({ ...item, isActive: item.id === id })) }
      return overview
    }),
    testProviderConfiguration: vi.fn<ReaderApi['testProviderConfiguration']>(async () => ({ ok: true, message: 'Connection passed' }))
  }
  Object.defineProperty(window, 'readerApi', { configurable: true, value: api })
  const close = vi.fn(), changed = vi.fn(), toast = vi.fn()
  const trigger = document.createElement('button')
  document.body.append(trigger)
  const returnFocusRef = createRef<HTMLButtonElement>()
  returnFocusRef.current = trigger
  function Harness() {
    const [personas, setPersonas] = useState<PersonaSettings>({ presets: [{ id: 'persona', name: 'Reader', prompt: 'Explain the book.' }], defaultId: null })
    return <SettingsModal initialOverview={overview} initialSection={options.initialSection ?? 'model'} initialService={options.initialService}
      themePreference="light" interfaceScale={100} readingPreferences={DEFAULT_READING_PREFERENCES} paperThemePreference="default"
      assistantActions={createDefaultAssistantActionSettings()} personaSettings={personas} returnFocusRef={returnFocusRef}
      onClose={close} onOverviewChange={changed} pushToast={toast} onThemeChange={vi.fn()} onInterfaceScaleChange={vi.fn()}
      onReadingPreferencesChange={vi.fn()} onPaperThemePreferenceChange={vi.fn()} onAssistantActionsChange={vi.fn()}
      onPersonaSettingsChange={(next) => { setPersonas(next); return true }} />
  }
  const view = render(<Harness />)
  return { ...view, api, close, changed, toast, trigger }
}

it('keeps typing focus when a draft first changes and uses the latest unsaved guard on Escape', async () => {
  const view = setup()
  await view.findByTestId('document-config')
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const input = view.getByTestId('provider-profile-name')
  input.focus()
  fireEvent.change(input, { target: { value: 'Changed' } })
  expect(document.activeElement).toBe(input)
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(confirm).toHaveBeenCalledOnce()
  expect(view.close).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(input)
  confirm.mockReturnValue(true)
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(view.close).toHaveBeenCalledOnce()
  view.unmount()
  expect(document.activeElement).toBe(view.trigger)
  view.trigger.remove()
})

it('keeps persona drafts across sections and marks pending changes until they are saved', async () => {
  const view = setup({ initialSection: 'persona' })
  await view.findByTestId('document-config')
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const input = view.getByTestId('persona-prompt')
  input.focus()
  fireEvent.change(input, { target: { value: 'Draft prompt for this preset' } })
  expect(document.activeElement).toBe(input)
  fireEvent.click(view.getByTestId('settings-nav-model'))
  expect(confirm).not.toHaveBeenCalled()
  expect(view.getByTestId('settings-nav-persona').querySelector('.settings-nav-pending')).not.toBeNull()
  fireEvent.click(view.getByTestId('settings-nav-persona'))
  expect((view.getByTestId('persona-prompt') as HTMLTextAreaElement).value).toBe('Draft prompt for this preset')
  fireEvent.change(view.getByTestId('persona-default'), { target: { value: 'persona' } })
  expect((view.getByTestId('persona-prompt') as HTMLTextAreaElement).value).toBe('Draft prompt for this preset')
  fireEvent.click(view.getByTestId('settings-close'))
  expect(view.close).not.toHaveBeenCalled()
  fireEvent.click(view.getByTestId('persona-save'))
  await waitFor(() => expect(view.getByTestId('settings-nav-persona').querySelector('.settings-nav-pending')).toBeNull())
  fireEvent.click(view.getByTestId('settings-close'))
  expect(view.close).toHaveBeenCalledOnce()
  view.trigger.remove()
})

it('saves and activates a new configuration with one action while plain save leaves it inactive', async () => {
  const view = setup({ overview: { profiles: [], activeProfileId: null } })
  await view.findByTestId('document-config')
  fireEvent.change(view.getByTestId('provider-profile-name'), { target: { value: 'New model' } })
  fireEvent.change(view.getByTestId('provider-api-key'), { target: { value: 'test-key' } })
  expect(view.getByTestId('provider-activate').textContent).toContain('保存并使用')
  fireEvent.click(view.getByTestId('provider-activate'))
  await waitFor(() => expect(view.api.activateProviderProfile).toHaveBeenCalledWith('new'))
  await waitFor(() => expect(view.getByTestId('provider-activate').textContent).toContain('当前使用'))
  expect(view.api.createProviderProfile).toHaveBeenCalledOnce()
  expect(view.api.createProviderProfile.mock.invocationCallOrder[0]).toBeLessThan(view.api.activateProviderProfile.mock.invocationCallOrder[0])
  expect(view.changed).toHaveBeenLastCalledWith(expect.objectContaining({ activeProfileId: 'new' }), true)
  view.unmount(); view.trigger.remove()

  const plain = setup({ overview: { profiles: [], activeProfileId: null } })
  await plain.findByTestId('document-config')
  fireEvent.change(plain.getByTestId('provider-profile-name'), { target: { value: 'Save for later' } })
  fireEvent.click(plain.getByTestId('provider-save'))
  await waitFor(() => expect(plain.api.createProviderProfile).toHaveBeenCalledOnce())
  await waitFor(() => expect(plain.queryByTestId('provider-dirty-hint')).toBeNull())
  expect(plain.api.activateProviderProfile).not.toHaveBeenCalled()
  plain.trigger.remove()
})

it('keeps a successfully saved profile if activation fails and retries activation without saving again', async () => {
  const view = setup()
  await view.findByTestId('document-config')
  view.api.activateProviderProfile.mockRejectedValueOnce(new Error('Activation unavailable'))
  fireEvent.change(view.getByTestId('provider-model'), { target: { value: 'model-2' } })
  fireEvent.click(view.getByTestId('provider-activate'))
  await waitFor(() => expect(view.getByTestId('provider-status').textContent).toContain('配置已保存，但未能设为当前'))
  expect(view.queryByTestId('provider-dirty-hint')).toBeNull()
  expect(view.getByTestId('provider-activate').textContent).toContain('设为当前')
  fireEvent.click(view.getByTestId('provider-activate'))
  await waitFor(() => expect(view.getByTestId('provider-activate').textContent).toContain('当前使用'))
  expect(view.api.updateProviderProfile).toHaveBeenCalledOnce()
  expect(view.api.activateProviderProfile).toHaveBeenCalledTimes(2)
  view.trigger.remove()
})

it('preserves the draft and current profile if saving fails before activation', async () => {
  const view = setup()
  await view.findByTestId('document-config')
  view.api.updateProviderProfile.mockRejectedValueOnce(new Error('Storage unavailable'))
  fireEvent.change(view.getByTestId('provider-model'), { target: { value: 'unsaved-model' } })
  fireEvent.click(view.getByTestId('provider-activate'))
  await waitFor(() => expect(view.getByTestId('provider-status').textContent).toContain('Storage unavailable'))
  expect((view.getByTestId('provider-model') as HTMLInputElement).value).toBe('unsaved-model')
  expect(view.queryByTestId('provider-dirty-hint')).not.toBeNull()
  expect(view.api.activateProviderProfile).not.toHaveBeenCalled()
  expect(view.changed).not.toHaveBeenCalled()
  view.trigger.remove()
})

it('clears stale model test feedback after the endpoint changes', async () => {
  const view = setup()
  await view.findByTestId('document-config')
  fireEvent.click(view.getByTestId('provider-test'))
  await waitFor(() => expect(view.getByTestId('provider-status').textContent).toContain('Connection passed'))
  fireEvent.change(view.getByTestId('provider-base-url'), { target: { value: 'https://different.example/v1' } })
  expect(view.queryByTestId('provider-status')).toBeNull()
  view.trigger.remove()
})

it('opens and focuses a requested service without expanding the other cards', async () => {
  const view = setup({ initialSection: 'knowledge', initialService: 'document' })
  await waitFor(() => expect((view.getByTestId('document-config') as HTMLDetailsElement).open).toBe(true))
  expect(document.activeElement).toBe(view.getByTestId('document-processor'))
  expect((view.getByTestId('embedding-config') as HTMLDetailsElement).open).toBe(false)
  const input = view.getByTestId('document-processor')
  fireEvent.change(input, { target: { value: 'vision' } })
  expect(document.activeElement).toBe(input)
  view.trigger.remove()
})

const configuredKnowledge: KnowledgeSettings = {
  embedding: { enabled: false, baseUrl: 'https://example.com/v1', model: 'saved-embedding', hasApiKey: true },
  rerank: { enabled: false, baseUrl: 'https://example.com/v1', model: 'saved-rerank', hasApiKey: true },
  document: { enabled: false, processor: 'docling', baseUrl: 'http://127.0.0.1:5001', ocr: true, language: 'ch', hasApiKey: false },
  webSearch: { enabled: false, baseUrl: 'https://api.tavily.com', hasApiKey: true }
}

it('names each switch after its service and keeps unconfigured services disabled', async () => {
  const view = setup({ initialSection: 'knowledge' })
  await view.findByRole('switch', { name: 'PDF 解析' })
  for (const name of ['PDF 解析', '按含义查找（Embedding）', '原文排序（Rerank）', '联网搜索（Tavily）']) {
    const control = view.getByRole('switch', { name }) as HTMLInputElement
    expect(control.checked).toBe(false)
    expect(control.matches(':disabled')).toBe(true)
  }
  expect(view.getAllByText('首次使用请展开“配置详情”，填写后点击“保存并启用”。')).toHaveLength(4)
  expect(view.queryByText('已启用')).toBeNull()
  expect(view.queryByText('已关闭')).toBeNull()
})

it('locks service switches until saving completes and keeps unsaved configuration drafts', async () => {
  const view = setup({ initialSection: 'knowledge', knowledge: configuredKnowledge })
  const control = await view.findByRole('switch', { name: '按含义查找（Embedding）' }) as HTMLInputElement
  fireEvent.change(view.getByTestId('embedding-model'), { target: { value: 'unsaved-embedding' } })
  let completeSave!: (value: KnowledgeSettings) => void
  view.api.saveKnowledgeSettings.mockReturnValueOnce(new Promise((resolve) => { completeSave = resolve }))
  fireEvent.click(control)
  expect(view.api.saveKnowledgeSettings).toHaveBeenCalledWith(expect.objectContaining({
    target: 'embedding', embedding: expect.objectContaining({ enabled: true, model: 'saved-embedding' })
  }))
  expect(control.checked).toBe(false)
  expect(control.getAttribute('aria-busy')).toBe('true')
  for (const item of view.getAllByRole('switch')) expect(item.matches(':disabled')).toBe(true)
  completeSave({ ...configuredKnowledge, embedding: { ...configuredKnowledge.embedding, enabled: true } })
  await waitFor(() => expect(control.checked).toBe(true))
  await waitFor(() => expect(control.matches(':disabled')).toBe(false))
  expect(view.queryByTestId('knowledge-embedding-status')).toBeNull()
  expect((view.getByTestId('embedding-model') as HTMLInputElement).value).toBe('unsaved-embedding')
  expect(view.getByTestId('settings-nav-knowledge').querySelector('.settings-nav-pending')).not.toBeNull()
  fireEvent.click(view.getByTestId('settings-nav-model'))
  fireEvent.click(view.getByTestId('settings-nav-knowledge'))
  expect((view.getByTestId('embedding-model') as HTMLInputElement).value).toBe('unsaved-embedding')
})

it('keeps the saved enabled state and editable draft when a switch change fails', async () => {
  const saved = { ...configuredKnowledge, embedding: { ...configuredKnowledge.embedding, enabled: true } }
  const view = setup({ initialSection: 'knowledge', knowledge: saved })
  const control = await view.findByRole('switch', { name: '按含义查找（Embedding）' }) as HTMLInputElement
  fireEvent.change(view.getByTestId('embedding-model'), { target: { value: 'unsaved-embedding' } })
  view.api.saveKnowledgeSettings.mockRejectedValueOnce(new Error('无法保存设置'))
  fireEvent.click(control)
  await waitFor(() => expect(view.getByTestId('knowledge-embedding-status').textContent).toContain('无法保存设置'))
  expect(control.checked).toBe(true)
  expect(control.matches(':disabled')).toBe(false)
  expect((view.getByTestId('embedding-model') as HTMLInputElement).value).toBe('unsaved-embedding')
  expect(view.getByTestId('settings-nav-knowledge').querySelector('.settings-nav-pending')).not.toBeNull()
})
