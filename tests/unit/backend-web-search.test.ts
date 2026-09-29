import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContextSnapshot, DocumentSection, LlmEvent, LlmRequest } from '../../src/shared/contracts'
import { AppDatabase, migrations } from '../../src/main/database'
import { KnowledgeSettingsService } from '../../src/main/knowledge-settings'
import { KnowledgeHttp } from '../../src/main/knowledge-http'
import { tavilySearch, WebSearchService } from '../../src/main/web-search-service'
import { BookContextStore } from '../../src/main/book-context-store'
import { BookAnalysisService } from '../../src/main/book-analysis'
import { boundContext, LlmService } from '../../src/main/llm-service'
import type { ProviderService } from '../../src/main/provider-service'
import { contextSnapshotSchema, knowledgeSettingsSchema, webSourceOpenSchema } from '../../src/main/schemas'
import { buildInsightExportMarkdown } from '../../src/main/insight-export'
import { removeWebSearchSchema } from './support/legacy-web-search'

const databases: AppDatabase[] = [], directories: string[] = []
afterEach(() => { databases.splice(0).forEach((db) => db.close()); directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })); vi.restoreAllMocks() })
const protector = { isAvailable: () => true, encrypt: (text: string) => Buffer.from(`encrypted:${text}`), decrypt: (bytes: Uint8Array) => Buffer.from(bytes).toString().slice(10) }
const config = { enabled: true, baseUrl: 'https://search.example', apiKey: 'search-only-fixture', revision: '1' }
const oldSettings = { embedding: { enabled: false, baseUrl: '', model: '' }, document: { processor: 'none' as const, baseUrl: '', ocr: true, language: 'ch' as const } }
const webResult = { title: '独立网页资料', url: 'https://evidence.example/article', content: '外部例证，仅用作资料。', score: 0.9, raw_content: null }
const signal = () => new AbortController().signal

function setup(prepared = false, fetcher?: typeof fetch) {
  const db = new AppDatabase(':memory:'); databases.push(db)
  const bookId = randomUUID()
  db.insertBook({ id: bookId, sha256: 'a'.repeat(64), title: '联网样本', author: null, format: 'txt', sourceFormat: 'txt', originalName: 'sample.txt', storedName: 'sample.txt', importedAt: '1', lastOpenedAt: null, lastLocator: null, progress: 0 })
  const settings = new KnowledgeSettingsService(db, protector)
  settings.save({ ...oldSettings, webSearch: { enabled: true, baseUrl: config.baseUrl, apiKey: config.apiKey }, target: 'webSearch' })
  const store = new BookContextStore(db)
  if (prepared) {
    store.reset(bookId, randomUUID(), 'fixture', 'qa', 'original')
    const section: DocumentSection = { id: 's1', chapterId: 'c1', chapterTitle: '第一章', order: 0,
      blocks: [{ id: 'b1', text: '从众要求核对证据。', anchor: 'txt:0:10', kind: 'paragraph' }] }
    store.append(bookId, [section]); store.status(bookId, 'ready')
  }
  const credentials = { baseUrl: 'https://qa.example/v1', model: 'qa', apiKey: 'qa-only-fixture', compatibility: 'auto' as const, timeoutMs: 90_000 }
  const provider = { getCredentials: () => credentials }, llm = new LlmService(provider, fetcher)
  const planner = vi.spyOn(llm, 'requestText').mockResolvedValue({ text: JSON.stringify({ chapters: ['c1'], terms: ['证据'], webSearch: { needed: true, query: '从众 最新研究' } }), usage: { totalTokens: 3 } })
  const searchFetch = vi.fn<typeof fetch>(async () => Response.json({ query: 'ignored', results: [webResult], images: [], response_time: 0.2 }))
  const search = new WebSearchService(settings, new KnowledgeHttp(searchFetch, '0.6.0'))
  const analysis = new BookAnalysisService(store, provider as unknown as ProviderService, llm)
  analysis.webSearch = search
  llm.contextProvider = (request, creds, abortSignal, progress) => analysis.context(request, creds, abortSignal, progress)
  const request: LlmRequest = { requestId: randomUUID(), conversationId: randomUUID(), action: 'ask', question: '有哪些最新外部例证？', webSearch: 'auto', history: [],
    ...(prepared ? { scope: 'book' as const, bookId } : { scope: 'selection' as const, selection: { bookId, quote: '从众要求核对证据。', anchor: 'txt:0:10', chapterTitle: '第一章', passages: [{ id: 'original', text: '从众要求核对证据。', anchor: 'txt:0:10' }] } }) }
  return { db, settings, store, bookId, credentials, llm, planner, searchFetch, search, analysis, request }
}

function run(llm: LlmService, request: LlmRequest): Promise<LlmEvent[]> {
  return new Promise((resolve) => { const events: LlmEvent[] = []; llm.start(request, (event) => { events.push(event); if (event.type === 'completed' || event.type === 'error') resolve(events) }) })
}

describe('bounded Tavily requests', () => {
  it('accepts official extra fields while sending only the short query, fixed parameters and isolated credentials', async () => {
    const state = setup()
    const record = await state.search.search(config, '检索词😀', signal())
    expect(record).toMatchObject({ status: 'searched', sources: [{ id: 'W1', title: webResult.title, url: webResult.url, excerpt: webResult.content }] })
    const [url, init] = state.searchFetch.mock.calls[0]
    expect(url).toBe('https://search.example/search')
    expect(init?.redirect).toBe('manual')
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer search-only-fixture', 'User-Agent': 'LLM-Reader/0.6.0' })
    expect(JSON.parse(String(init?.body))).toEqual({ query: '检索词😀', search_depth: 'basic', max_results: 5, chunks_per_source: 2, include_answer: false, include_raw_content: false, include_images: false, auto_parameters: false })
    expect(JSON.stringify(init)).not.toContain('qa-only-fixture')
    expect(JSON.stringify(init)).not.toContain('x-opencode-session')
  })
  it('caps Unicode excerpts and drops credential URLs, unsafe protocols and empty results', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ results: [
      { ...webResult, content: '😀'.repeat(5_000) }, { ...webResult, url: 'javascript:alert(1)' },
      { ...webResult, url: 'https://user:password@example.com' }, { ...webResult, content: '' },
      { ...webResult, title: '', url: `https://evidence.example/${'x'.repeat(600)}` }
    ] }))
    const sources = await tavilySearch(new KnowledgeHttp(fetcher), config, '😀'.repeat(500), signal())
    expect(sources).toHaveLength(2); expect(Array.from(sources[0].excerpt)).toHaveLength(1_200)
    expect(Array.from(sources[1].title)).toHaveLength(200); expect(sources[1].url).toHaveLength(625)
    expect(Array.from(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).query)).toHaveLength(400)
    expect(webSourceOpenSchema.safeParse({ bookId: randomUUID(), url: 'file:///C:/secret' }).success).toBe(false)
    expect(contextSnapshotSchema.safeParse({ scope: 'book', bookId: randomUUID(), selection: null, passages: [], background: '', coverage: { covered: 0, total: 0 },
      webSearch: { status: 'searched', reason: 'searched', sources: [{ id: 'W1', title: 'bad', url: 'data:text/html,script', excerpt: 'bad' }] } }).success).toBe(false)
  })
  it.each([[401, 'authentication'], [429, 'rate-limit'], [500, 'server'], [302, 'redirect']] as const)('reports HTTP %s safely without retrying', async (status, reason) => {
    const state = setup(); state.searchFetch.mockResolvedValue(new Response('sensitive-provider-body', { status }))
    const record = await state.search.search(config, '固定检索词', signal())
    expect(record).toMatchObject({ status: 'failed', reason, sources: [] }); expect(state.searchFetch).toHaveBeenCalledOnce()
    expect(JSON.stringify(record)).not.toContain('sensitive-provider-body')
  })
  it('reports empty, invalid and oversized responses without preserving their raw contents', async () => {
    const state = setup()
    state.searchFetch.mockResolvedValueOnce(Response.json({ results: [] }))
    state.searchFetch.mockResolvedValueOnce(Response.json({ results: 'wrong' }))
    state.searchFetch.mockResolvedValueOnce(new Response('private-body', { headers: { 'content-length': '999999' } }))
    expect(await state.search.search(config, 'query', signal())).toMatchObject({ status: 'empty', sources: [] })
    expect(await state.search.search(config, 'query', signal())).toMatchObject({ status: 'failed', reason: 'invalid-response' })
    expect(await state.search.search(config, 'query', signal())).toMatchObject({ status: 'failed', reason: 'too-large' })
  })
  it('bounds response-body waiting and propagates explicit cancellation even if fetch ignores abort', async () => {
    const state = setup()
    state.searchFetch.mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')) } })))
    expect(await state.search.search({ ...config, timeoutMs: 20 }, 'query', signal())).toMatchObject({ status: 'failed', reason: 'timeout' })
    state.searchFetch.mockImplementation(() => new Promise(() => undefined))
    const controller = new AbortController(), pending = state.search.search(config, 'query', controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('single-round planning, fallback and retry', () => {
  it.each([false, true])('uses one combined decision and search for prepared=%s, with the current date and model', async (prepared) => {
    const state = setup(prepared), progress = vi.fn()
    const snapshot = await state.analysis.context(state.request, state.credentials, signal(), progress)
    expect(state.planner).toHaveBeenCalledOnce(); expect(state.searchFetch).toHaveBeenCalledOnce()
    expect(state.planner.mock.calls[0][0]).toMatchObject({ model: 'qa', timeoutMs: 12_000 })
    expect(state.planner.mock.calls[0][1][1].content).toContain(new Date().toISOString().slice(0, 10))
    expect(progress.mock.calls.flat()).toEqual(['deciding', 'searching'])
    expect(snapshot.webSearch?.status).toBe('searched')
  })
  it('never plans or searches an unprepared selection when off, and never searches prepared off-mode', async () => {
    const state = setup()
    expect((await state.analysis.context({ ...state.request, webSearch: 'off' }, state.credentials, signal())).webSearch).toBeUndefined()
    expect(state.planner).not.toHaveBeenCalled(); expect(state.searchFetch).not.toHaveBeenCalled()
    const prepared = setup(true)
    await prepared.analysis.context({ ...prepared.request, webSearch: 'off' }, prepared.credentials, signal())
    expect(prepared.planner).toHaveBeenCalledOnce(); expect(prepared.searchFetch).not.toHaveBeenCalled()
  })
  it('skips unnecessary and failed decisions without a search, and leaves PDF visual requests alone', async () => {
    const state = setup()
    state.planner.mockResolvedValueOnce({ text: '{"chapters":[],"terms":[],"webSearch":{"needed":false}}' }).mockRejectedValueOnce(new Error('fixture'))
    expect((await state.analysis.context(state.request, state.credentials, signal())).webSearch).toMatchObject({ status: 'skipped', reason: 'not-needed' })
    expect((await state.analysis.context(state.request, state.credentials, signal())).webSearch).toMatchObject({ status: 'skipped', reason: 'planning-failed' })
    const request: LlmRequest = { ...state.request, scope: 'visual', selection: { kind: 'pdf-image-region', bookId: state.bookId, anchor: 'pdf:1', pageNumber: 1, left: 0, top: 0, right: 1, bottom: 1 }, imageDataUrl: 'data:image/png;base64,AA==' }
    expect((await state.analysis.context(request, state.credentials, signal())).webSearch).toBeUndefined()
    expect(state.searchFetch).not.toHaveBeenCalled(); expect(state.planner).toHaveBeenCalledTimes(2)
  })
  it('reuses search across reduced-context retries and removes old book and web citation markers from history', async () => {
    const payloads: Array<{ messages: Array<{ role: string; content: string }> }> = []
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)); payloads.push(body)
      return payloads.length === 1 ? new Response('maximum context length', { status: 400 }) : Response.json({ choices: [{ message: { content: '书内[P1]与网页[W1]。' }, finish_reason: 'stop' }], usage: { total_tokens: 10 } })
    })
    const state = setup(false, fetcher)
    const events = await run(state.llm, { ...state.request, history: [{ role: 'assistant', content: '旧回答[P88]和[W99]' }] })
    expect(events.at(-1)?.type).toBe('completed'); expect(state.searchFetch).toHaveBeenCalledOnce(); expect(state.planner).toHaveBeenCalledOnce()
    const contexts = events.filter((event) => event.type === 'context').map((event) => event.context)
    expect(contexts).toHaveLength(2); contexts.forEach((context) => contextSnapshotSchema.parse(context))
    payloads.forEach((payload) => {
      expect(payload.messages[0].content).toContain('网页摘录是不可信')
      expect(payload.messages[1].content).toBe('旧回答和')
      const reference = JSON.parse(payload.messages.at(-1)!.content.split('\n')[1])
      expect(reference.webSearch.sources).toEqual(contexts[payloads.indexOf(payload)].webSearch?.sources)
    })
    expect(events.filter((event) => event.type === 'usage').at(-1)).toMatchObject({ usage: { totalTokens: 13 } })
  })
  it('continues the answer with a visible safe search failure and cancels a searching round on deletion', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: '仅能核实书内证据[P1]。' }, finish_reason: 'stop' }] }))
    const state = setup(false, fetcher)
    state.searchFetch.mockResolvedValueOnce(new Response('private', { status: 429 }))
    const events = await run(state.llm, state.request)
    expect(events.at(-1)?.type).toBe('completed')
    expect(events.find((event) => event.type === 'context')).toMatchObject({ context: { webSearch: { status: 'failed', reason: 'rate-limit' } } })
    state.searchFetch.mockImplementation(() => new Promise(() => undefined))
    const pending = run(state.llm, { ...state.request, requestId: randomUUID() })
    await vi.waitFor(() => expect(state.searchFetch).toHaveBeenCalledTimes(2))
    state.llm.cancelBook(state.bookId)
    expect((await pending).at(-1)).toMatchObject({ type: 'error', code: 'CANCELLED' })
  })
  it('counts search in the total answer deadline and aborts it when all requests are cancelled', async () => {
    const answer = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: '回答' }, finish_reason: 'stop' }] }))
    const timed = setup(false, answer)
    timed.credentials.timeoutMs = 35
    timed.searchFetch.mockImplementation(() => new Promise(() => undefined))
    expect((await run(timed.llm, timed.request)).at(-1)).toMatchObject({ type: 'error', code: 'TIMEOUT' })
    expect(timed.searchFetch).toHaveBeenCalledOnce(); expect(answer).not.toHaveBeenCalled()
    const closing = setup(false, answer)
    closing.searchFetch.mockImplementation(() => new Promise(() => undefined))
    const pending = run(closing.llm, closing.request)
    await vi.waitFor(() => expect(closing.searchFetch).toHaveBeenCalledOnce())
    closing.llm.cancelAll()
    expect((await pending).at(-1)).toMatchObject({ type: 'error', code: 'CANCELLED' })
    expect(answer).not.toHaveBeenCalled()
  })
})

describe('budget, encrypted configuration and saved provenance', () => {
  it('reserves the complete selected text, limits web input to one third/5000 characters and reassigns separate IDs', async () => {
    const state = setup(), source = await state.analysis.context(state.request, state.credentials, signal())
    const snapshot: ContextSnapshot = { ...source, webSearch: { ...source.webSearch!, sources: Array.from({ length: 5 }, (_, i) => ({ id: `W${i + 20}`, title: '资料', url: `https://example.com/${i}`, excerpt: '😀\n"'.repeat(1500) })) } }
    for (const budget of [6000, 3000]) {
      const bounded = boundContext(state.request, snapshot, budget).context
      expect(bounded.passages[0].text).toBe(source.selection && 'quote' in source.selection ? source.selection.quote : '')
      expect(Array.from(JSON.stringify(bounded.webSearch)).length).toBeLessThanOrEqual(5000)
      expect(bounded.webSearch?.sources.map((source) => source.id)).toEqual(bounded.webSearch?.sources.map((_source, i) => `W${i + 1}`))
      expect(bounded.passages[0].id).toBe('P1')
    }
  })
  it('keeps credentials encrypted, old saves isolated, and endpoint changes unable to reuse secrets', () => {
    const state = setup(), before = state.db.connection.prepare("SELECT * FROM knowledge_settings WHERE kind = 'webSearch'").get()
    expect(JSON.stringify(state.settings.get())).not.toContain(config.apiKey)
    expect(String(before?.config_json)).not.toContain(config.apiKey)
    state.settings.save(oldSettings)
    expect(state.db.connection.prepare("SELECT * FROM knowledge_settings WHERE kind = 'webSearch'").get()).toEqual(before)
    expect(state.settings.webSearch({ enabled: true, baseUrl: 'https://other.example' }).apiKey).toBe('')
    expect(knowledgeSettingsSchema.safeParse({ ...oldSettings, webSearch: { enabled: true, baseUrl: 'http://remote.example', apiKey: config.apiKey } }).success).toBe(false)
  })
  it('persists empty-session modes without adding empty recent conversations or displacing real history', () => {
    const state = setup()
    const session = { bookId: state.bookId, conversationId: randomUUID(), scope: 'book' as const, selection: null, draft: '', turns: [], updatedAt: '1', webSearch: 'auto' as const }
    state.db.upsertBookSession(session)
    expect(state.db.getBookSession(state.bookId)?.webSearch).toBe('auto')
    expect(state.db.listRecentBookSessions(state.bookId)).toEqual([])
    for (let i = 0; i < 20; i++) state.db.upsertBookSession({ ...session, conversationId: randomUUID(), draft: `真实草稿 ${i}` })
    state.db.upsertBookSession({ ...session, webSearch: 'off' })
    expect(state.db.getBookSession(state.bookId)?.webSearch).toBe('off')
    expect(state.db.listRecentBookSessions(state.bookId)).toHaveLength(20)
  })
  it('drops all web excerpts when the selected original consumes the budget and reports the actual omission', async () => {
    const state = setup(), source = await state.analysis.context(state.request, state.credentials, signal())
    if (state.request.scope !== 'selection' || !source.selection || !('quote' in source.selection)) throw new Error('Expected text selection')
    const selection = { ...source.selection, quote: '原'.repeat(1300) }, request: LlmRequest = { ...state.request, selection }
    const context = { ...source, selection }
    const bounded = boundContext(request, context, 750).context
    expect(bounded.passages[0].text).toBe(selection.quote)
    expect(bounded.webSearch).toMatchObject({ status: 'empty', reason: 'budget', query: source.webSearch?.query, sources: [] })
    contextSnapshotSchema.parse(bounded)
  })
  it('migrates twice and preserves old data, modes, exact per-round sources, export and browser grants across restart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'reader-web-search-')); directories.push(root)
    const path = join(root, 'reader.sqlite'), state = setup(), snapshot = await state.analysis.context(state.request, state.credentials, signal())
    let db = new AppDatabase(path)
    try {
      const stored = state.db.getStoredBook(state.bookId)!
      db.insertBook(stored)
      const old = { bookId: state.bookId, conversationId: randomUUID(), scope: 'book' as const, selection: null, draft: '旧草稿', turns: [], updatedAt: '1' }
      db.upsertBookSession(old); removeWebSearchSchema(db); db.connection.prepare('DELETE FROM schema_migrations WHERE version = ?').run(migrations.length)
      db.close(); db = new AppDatabase(path)
      expect(db.getBookSession(state.bookId)).toEqual(old)
      db.upsertBookSession({ ...old, webSearch: 'auto' })
      db.replaceSessionTabs({ activeIndex: 0, tabs: [{ kind: 'live', bookId: state.bookId, insightId: null, draft: '', webSearch: 'off' }] })
      db.insertInsight(randomUUID(), { bookId: state.bookId, selection: snapshot.selection, context: snapshot, question: '问题', answer: '回答[W1][P1]', model: 'qa', webSearch: 'auto' }, '1')
      expect(db.hasRecordedWebSource(state.bookId, webResult.url)).toBe(false)
      db.recordWebSources(state.bookId, [webResult.url])
      db.close(); db = new AppDatabase(path)
      expect(db.getBookSession(state.bookId)?.webSearch).toBe('auto')
      expect(db.getRecentBookSession(state.bookId, old.conversationId)?.webSearch).toBe('auto')
      expect(db.listSessionTabs().tabs[0].webSearch).toBe('off')
      expect(db.listInsights(state.bookId)[0].context?.webSearch).toEqual(snapshot.webSearch)
      expect(db.hasRecordedWebSource(state.bookId, webResult.url)).toBe(true)
      const markdown = buildInsightExportMarkdown(db.listAllInsights())
      expect(markdown).toContain(webResult.url); expect(markdown).toContain(webResult.content); expect(markdown).toContain(snapshot.webSearch!.searchedAt!)
      db.deleteBook(state.bookId); expect(db.hasRecordedWebSource(state.bookId, webResult.url)).toBe(false)
    } finally { db.close() }
  })
})
