import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { ProviderService } from '../../src/main/provider-service'
import { ProfileSecretStore } from '../../src/main/secret-store'
import { LlmService, type ProviderCredentials } from '../../src/main/llm-service'
import { KnowledgeSettingsService } from '../../src/main/knowledge-settings'
import { KnowledgeHttp } from '../../src/main/knowledge-http'
import { DocumentProcessingService } from '../../src/main/document-processing'
import { buildCompletionUrl, buildProviderUrl } from '../../src/main/provider-protocol'
import { OCR_TEST_IMAGE } from '../../src/main/vision-ocr-sample'
import { customHeadersSchema, extraBodySchema } from '../../src/shared/request-settings'
import { knowledgeSettingsSchema } from '../../src/main/schemas'
import { embed } from '../../src/main/semantic-index'
import { rerank } from '../../src/main/rerank-service'
import type { SaveKnowledgeSettingsInput } from '../../src/shared/contracts'

const resources: Array<() => void> = []
afterEach(() => { resources.splice(0).reverse().forEach((close) => close()); vi.useRealTimers() })
const protector = {
  isAvailable: () => true,
  encrypt: (value: string) => Uint8Array.from(Buffer.from(value), (byte) => byte ^ 0xa5),
  decrypt: (value: Uint8Array) => Buffer.from(Uint8Array.from(value, (byte) => byte ^ 0xa5)).toString()
}
const credentials: ProviderCredentials = { baseUrl: 'https://claude.example/proxy/v1/messages', protocol: 'anthropic',
  compatibility: 'auto', model: 'claude-fixture', apiKey: 'fixture-key', customHeaders: { 'X-Project': 'reader' }, extraBody: { max_tokens: 512 } }
const signal = () => new AbortController().signal
const message = (text = '回答', stop = 'end_turn') => ({ type: 'message', model: 'claude-fixture', stop_reason: stop,
  content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text }], usage: { input_tokens: 10, output_tokens: 3 } })
const settingsInput = (processor: 'vision' | 'mistral-ocr' | 'unstructured' = 'vision'): SaveKnowledgeSettingsInput => ({
  embedding: { enabled: false, baseUrl: '', model: '' },
  document: { processor, baseUrl: 'https://document.example/v1', model: processor === 'mistral-ocr' ? 'mistral-ocr-latest' : 'claude-fixture',
    protocol: processor === 'vision' ? 'anthropic' : undefined, ocr: true, language: 'ch', apiKey: 'document-key',
    customHeaders: { 'X-Document-Token': 'private-header' }, timeoutMs: 120_000 }
})
function database() {
  const db = new AppDatabase(':memory:'); resources.push(() => db.close()); return db
}
function documentFixture(processor: 'vision' | 'mistral-ocr' | 'unstructured', fetcher: typeof fetch) {
  const db = database(), settings = new KnowledgeSettingsService(db, protector), bookId = randomUUID()
  db.insertBook({ id: bookId, title: '扫描件', sha256: 'a'.repeat(64), author: null, format: 'pdf', sourceFormat: 'pdf', originalName: 'scan.pdf', storedName: 'scan.pdf', importedAt: '1', lastOpenedAt: null, lastLocator: null, progress: 0 })
  settings.save(settingsInput(processor))
  const service = new DocumentProcessingService(db, settings, new KnowledgeHttp(fetcher, 'fixture'))
  return { db, bookId, settings, service, extract: (count = 1) => service.extract(bookId, new Uint8Array(), count, signal(), async () => OCR_TEST_IMAGE) }
}
async function complete(fetcher: typeof fetch, config = credentials) {
  return new LlmService({ getCredentials: () => config }, fetcher).requestText(config,
    [{ role: 'system', content: '只根据原文回答' }, { role: 'user', content: '解释' }, { role: 'assistant', content: '上一轮' }, { role: 'user', content: '继续' }],
    { sessionId: randomUUID() }, signal())
}

describe('Anthropic Messages and custom request settings', () => {
  it.each(['https://a.example/proxy', 'https://a.example/proxy/v1', 'https://a.example/proxy/v1/messages'])('normalizes native and proxy endpoints: %s', (url) => {
    expect(buildCompletionUrl(url, 'anthropic')).toBe('https://a.example/proxy/v1/messages')
    expect(buildProviderUrl(url, 'models')).toBe('https://a.example/proxy/v1/models')
  })
  it('preserves custom full endpoint paths without adding v1', () => {
    expect(buildCompletionUrl('https://a.example/custom/messages', 'anthropic')).toBe('https://a.example/custom/messages')
    expect(buildCompletionUrl('https://a.example/v2/chat/completions')).toBe('https://a.example/v2/chat/completions')
    expect(buildProviderUrl('https://a.example/custom/messages', 'models')).toBe('https://a.example/custom/models')
  })
  it('converts system prompts, preserves history and parses JSON text and usage', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(message()))
    expect(await complete(fetcher)).toEqual({ text: '回答', usage: { promptTokens: 10, completionTokens: 3, totalTokens: 13 } })
    const [url, request] = fetcher.mock.calls[0]
    expect(url).toBe(credentials.baseUrl)
    expect(request).toMatchObject({ redirect: 'manual', headers: { 'x-api-key': 'fixture-key', 'anthropic-version': '2023-06-01', 'X-Project': 'reader' } })
    expect(new Headers(request?.headers).has('Authorization')).toBe(false)
    expect(JSON.parse(String(request?.body))).toMatchObject({ system: '只根据原文回答', max_tokens: 512, stream: true, messages: [
      { role: 'user', content: '解释' }, { role: 'assistant', content: '上一轮' }, { role: 'user', content: '继续' }
    ] })
  })
  it.each([null, undefined, 'max_tokens'])('rejects incomplete JSON messages (%s)', async (stop_reason) => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ...message(), stop_reason }))
    await expect(complete(fetcher)).rejects.toMatchObject({ code: 'PROVIDER_INCOMPLETE' })
  })
  it('handles fragmented UTF-8 SSE, ignores thinking and merges cumulative token usage', async () => {
    const events = [
      { type: 'message_start', message: { model: 'claude-fixture', usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 20 } } },
      { type: 'ping' }, { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'private reasoning' } },
      { type: 'content_block_start', content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: '中文😀' } },
      { type: 'future_event' }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } }, { type: 'message_stop' }
    ]
    const bytes = new TextEncoder().encode(events.map((event) => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join(''))
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start(controller) {
      for (let offset = 0; offset < bytes.length; offset += 3) controller.enqueue(bytes.slice(offset, offset + 3))
      controller.close()
    } }), { headers: { 'Content-Type': 'text/event-stream' } }))
    expect(await complete(fetcher)).toEqual({ text: '中文😀', usage: { promptTokens: 25, completionTokens: 8, totalTokens: 33 } })
  })
  it.each(['error', 'truncated', 'interrupted'])('does not report an unfinished stream as success (%s)', async (kind) => {
    const tail = kind === 'error' ? { type: 'error', error: { message: 'private upstream details' } }
      : kind === 'truncated' ? { type: 'message_delta', delta: { stop_reason: 'max_tokens' } } : { type: 'ping' }
    const stream = [{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } }, tail].map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
    const fetcher = vi.fn<typeof fetch>(async () => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }))
    await expect(complete(fetcher)).rejects.toMatchObject({ code: kind === 'error' ? 'PROVIDER_STREAM_ERROR' : kind === 'truncated' ? 'PROVIDER_INCOMPLETE' : 'STREAM_INTERRUPTED' })
  })
  it('falls back to nonstream Messages using the same endpoint, headers and parameters', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('stream unsupported', { status: 400 })).mockResolvedValueOnce(Response.json(message()))
    await complete(fetcher)
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([credentials.baseUrl, credentials.baseUrl])
    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).stream)).toEqual([true, false])
  })
  it('encrypts headers, keeps secrets out of public settings, and scopes reuse to endpoint and protocol', async () => {
    const db = database(), root = mkdtempSync(join(tmpdir(), 'reader-custom-'))
    resources.push(() => rmSync(root, { force: true, recursive: true }))
    const fetcher = vi.fn<typeof fetch>(async (url) => String(url).endsWith('/models') ? Response.json({ data: [{ id: 'claude-fixture' }], has_more: true }) : Response.json(message()))
    const service = new ProviderService(db, protector, new ProfileSecretStore(join(root, 'keys'), join(root, 'legacy')), fetcher)
    const input = { name: 'Claude', ...credentials, customHeaders: { 'X-Secret': 'private-header', 'x-API-key': 'override-key' } }
    const profile = service.createProfile(input).profiles[0]
    expect(JSON.stringify(profile)).not.toContain('private-header')
    expect(profile).toMatchObject({ protocol: 'anthropic', hasCustomHeaders: true, extraBody: { max_tokens: 512 } })
    expect(Buffer.from(db.getProviderProfile(profile.id)!.headers_secret!).includes(Buffer.from('private-header'))).toBe(false)
    expect(db.getProviderProfile(profile.id)?.request_json).not.toContain('private-header')
    service.activateProfile(profile.id)
    expect((await service.testConnection()).ok).toBe(true)
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('x-api-key')).toBe('override-key')
    expect((await service.listModels({ profileId: profile.id, baseUrl: profile.baseUrl, protocol: 'anthropic' })).truncated).toBe(true)
    await service.testConfiguration({ ...input, profileId: profile.id, baseUrl: 'https://other.example', customHeaders: undefined })
    expect(new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers).has('X-Secret')).toBe(false)
    service.updateProfile({ ...input, id: profile.id, customHeaders: undefined })
    expect(service.getCredentials().customHeaders?.['X-Secret']).toBe('private-header')
    service.updateProfile({ ...input, id: profile.id, customHeaders: null })
    expect(service.getCredentials().customHeaders).toEqual({})
  })
  it('validates headers and parameters before making requests', () => {
    for (const headers of [{ Host: 'other.example' }, { 'Content-Type': 'text/plain' }, { 'X-Token': 'a\r\nb' }, { Authorization: 'a', authorization: 'b' }, { bad: 1 }]) {
      expect(customHeadersSchema.safeParse(headers).success).toBe(false)
    }
    for (const extraBody of [{ messages: [] }, { document: { url: 'https://other.example' } }, { output_format: 'html' }]) expect(extraBodySchema.safeParse(extraBody).success).toBe(false)
    const input = settingsInput()
    expect(knowledgeSettingsSchema.safeParse({ ...input, document: { ...input.document, timeoutMs: 0 } }).success).toBe(false)
  })
  it('accepts header-only model authentication and prevents saved credentials crossing endpoints or protocols', async () => {
    const db = database(), root = mkdtempSync(join(tmpdir(), 'reader-header-auth-'))
    resources.push(() => rmSync(root, { recursive: true, force: true }))
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(message()))
    const service = new ProviderService(db, protector, new ProfileSecretStore(join(root, 'keys'), join(root, 'legacy')), fetcher)
    const input = { name: 'Header auth', baseUrl: credentials.baseUrl, model: credentials.model, protocol: 'anthropic' as const, customHeaders: { Authorization: 'Bearer header-only' } }
    const profile = service.createProfile(input).profiles[0]
    service.activateProfile(profile.id)
    expect(await service.testConnection()).toMatchObject({ ok: true })
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer header-only')
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).has('x-api-key')).toBe(false)
    service.updateProfile({ ...input, id: profile.id, apiKey: 'saved-key', customHeaders: null })
    expect(await service.testConfiguration({ profileId: profile.id, baseUrl: 'https://other.example', model: profile.model, protocol: 'anthropic' })).toMatchObject({ ok: false })
    expect(await service.testConfiguration({ profileId: profile.id, baseUrl: profile.baseUrl, model: profile.model, protocol: 'openai' })).toMatchObject({ ok: false })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(() => service.updateProfile({ ...input, id: profile.id, baseUrl: 'https://other.example', customHeaders: undefined })).toThrow()
    expect(service.getCredentials().baseUrl).toBe(profile.baseUrl)
  })
  it('applies the configured inference timeout', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
    }))
    const pending = expect(complete(fetcher, { ...credentials, timeoutMs: 1_000 })).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(1_000)
    await pending
  })
  it('sends custom headers and body options for embeddings and reranking', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: [{ index: 0, embedding: [1, 0] }] }))
      .mockResolvedValueOnce(Response.json({ results: [{ index: 0, relevance_score: 1 }] }))
    const config = { enabled: true, baseUrl: 'https://knowledge.example/v1', model: 'fixture', apiKey: 'default-key', revision: '1',
      customHeaders: { authorization: 'Bearer custom-key', 'User-Agent': 'Custom Reader' }, extraBody: { vendor_option: true } }
    const http = new KnowledgeHttp(fetcher)
    await embed(http, config, ['原文'], signal())
    await rerank(http, config, '问题', [{ id: 'p1', text: '原文', anchor: 'pdfpos:1:0' }], signal())
    for (const [, init] of fetcher.mock.calls) {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer custom-key')
      expect(new Headers(init?.headers).get('User-Agent')).toBe('Custom Reader')
      expect(JSON.parse(String(init?.body)).vendor_option).toBe(true)
    }
  })
})

describe('page document providers', () => {
  it('sends native Claude base64 images and rejects truncated OCR before caching', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(message('OCR'))).mockResolvedValueOnce(Response.json(message('partial', 'max_tokens')))
    const fixture = documentFixture('vision', fetcher)
    await fixture.service.test(fixture.settings.document(), signal())
    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
    expect(request.messages[0].content[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: OCR_TEST_IMAGE.split(',')[1] } })
    expect(request.max_tokens).toBe(8192)
    await expect(fixture.extract()).rejects.toMatchObject({ code: 'OCR_INCOMPLETE' })
    expect(fixture.service.progress(fixture.bookId)).toEqual({ completed: 0, total: 1 })
  })
  it('uses Mistral OCR page requests, caches blank pages and retries only failed pages', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ pages: [{ index: 0, markdown: '' }] }))
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ pages: [{ index: 0, header: '标题', markdown: '|条件|要求|\n|-|-|\n|审核|独立复核|', footer: '脚注' }] }))
    const fixture = documentFixture('mistral-ocr', fetcher)
    expect(fixture.service.usesVision()).toBe(true)
    await expect(fixture.extract(2)).rejects.toMatchObject({ code: 'KNOWLEDGE_HTTP_503' })
    expect(fixture.service.progress(fixture.bookId)).toEqual({ completed: 1, total: 2 })
    await fixture.extract(2)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher.mock.calls[0][0]).toBe('https://document.example/v1/ocr')
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ model: 'mistral-ocr-latest', include_image_base64: false, document: { type: 'image_url', image_url: OCR_TEST_IMAGE } })
    const structure = fixture.service.structure(fixture.bookId)!
    expect(structure.units[0].sources[0].page).toBe(2)
    expect(structure.units[0].text).toContain('脚注')
    await fixture.extract(2); expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('uploads multipart page images to Unstructured with custom form options and local page citations', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json([{ type: 'Title', text: '独立复核', metadata: { page_number: 999 } }, { type: 'NarrativeText', text: '必要条件' }]))
    const fixture = documentFixture('unstructured', fetcher), input = settingsInput('unstructured')
    fixture.settings.save({ ...input, document: { ...input.document, baseUrl: 'http://localhost:8000/general/v0/general', extraBody: { strategy: 'auto', languages: ['chi_sim', 'eng'] } } })
    await fixture.extract()
    const [url, request] = fetcher.mock.calls[0], form = request?.body as FormData
    expect(url).toBe('http://localhost:8000/general/v0/general')
    expect(new Headers(request?.headers).get('unstructured-api-key')).toBe('document-key')
    expect(new Headers(request?.headers).get('X-Document-Token')).toBe('private-header')
    expect(new Headers(request?.headers).has('Content-Type')).toBe(false)
    expect(form.get('files')).toBeInstanceOf(Blob)
    expect(form.get('strategy')).toBe('auto')
    expect(form.getAll('languages')).toEqual(['chi_sim', 'eng'])
    expect(fixture.service.structure(fixture.bookId)?.units[0]).toMatchObject({ text: '独立复核\n\n必要条件', sources: [expect.objectContaining({ page: 1 })] })
  })
  it('invalidates checkpoints after header edits and clears endpoint-bound secrets on provider switches', () => {
    const fixture = documentFixture('vision', vi.fn<typeof fetch>())
    const before = fixture.settings.documentRevision(), input = settingsInput()
    fixture.settings.save({ ...input, document: { ...input.document, customHeaders: { 'X-Document-Token': 'rotated' } } })
    expect(fixture.settings.documentRevision()).not.toBe(before)
    expect(JSON.stringify(fixture.settings.get())).not.toContain('rotated')
    expect(fixture.settings.document({ ...input.document, customHeaders: undefined }).customHeaders).toEqual({ 'X-Document-Token': 'rotated' })
    fixture.settings.save({ ...input, document: { ...input.document, baseUrl: 'https://new.example', apiKey: undefined, customHeaders: undefined } })
    expect(fixture.settings.document()).toMatchObject({ apiKey: '', customHeaders: {} })
  })
})
