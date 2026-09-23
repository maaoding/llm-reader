import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { LlmEvent, LlmRequest } from '../../src/shared/contracts'
import { AppDatabase } from '../../src/main/database'
import { BookContextStore } from '../../src/main/book-context-store'
import { buildChatCompletionsUrl, buildModelsUrl, LlmService, type CompletionPayload, type ProviderCredentials } from '../../src/main/llm-service'
import { ProviderTransport } from '../../src/main/provider-transport'
import { ProviderService } from '../../src/main/provider-service'
import { ProfileSecretStore } from '../../src/main/secret-store'
import { llmRequestSchema, providerConfigurationSchema } from '../../src/main/schemas'

interface Captured { path: string; headers: IncomingHttpHeaders; body?: CompletionPayload }
const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu
let server: Server, endpoint: string
let captured: Captured[] = []
let respond: (request: Captured) => { status?: number; headers?: Record<string, string>; content: unknown }
const success = { choices: [{ message: { content: '回答 [P1]' } }] }

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = ''
    request.on('data', (data: Buffer) => { body += data.toString() })
    request.on('end', () => {
      const item = { path: request.url!, headers: request.headers, body: body ? JSON.parse(body) as CompletionPayload : undefined }
      captured.push(item)
      const result = respond(item)
      response.writeHead(result.status ?? 200, { 'content-type': 'application/json', ...result.headers })
      response.end(typeof result.content === 'string' ? result.content : JSON.stringify(result.content))
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Local fixture unavailable')
  endpoint = `http://127.0.0.1:${address.port}`
})
beforeEach(() => {
  captured = []
  respond = (item) => ({ content: item.path.endsWith('/models') ? { data: [{ id: 'fixture-model' }] } : success })
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()))
})

function question(conversationId = randomUUID()): LlmRequest {
  return { requestId: randomUUID(), conversationId, action: 'ask', question: '解释证据', history: [],
    selection: { bookId: randomUUID(), quote: '证据', anchor: 'txt:0:2', chapterTitle: '开篇', passages: [{ id: 'p1', text: '证据', anchor: 'txt:0:2' }] } }
}
function run(llm: LlmService, input: LlmRequest): Promise<LlmEvent[]> {
  return new Promise((done) => {
    const events: LlmEvent[] = []
    llm.start(input, (event) => {
      events.push(event)
      if (event.type === 'completed' || event.type === 'error') done(events)
    })
  })
}
const directories: string[] = []
const databases: AppDatabase[] = []
afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) {
    expect(dirname(directory)).toBe(resolve(tmpdir()))
    await rm(directory, { recursive: true, force: true })
  }
})
async function providerFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'llm-reader-go-test-'))
  directories.push(directory)
  const database = new AppDatabase(':memory:')
  databases.push(database)
  const provider = new ProviderService(database, {
    isAvailable: () => true, encrypt: (value) => Buffer.from(value), decrypt: (value) => Buffer.from(value).toString()
  }, new ProfileSecretStore(join(directory, 'keys'), join(directory, 'legacy.bin')), fetch, '0.4.0-test')
  return { database, provider }
}

describe('provider request compatibility over HTTP', () => {
  it('matches normalized official origins and paths, and scopes proxy opt-in to its configuration', async () => {
    // Resolve the official URL policy normally; only the network destination is the local test server.
    const transport = new ProviderTransport((_url, init) => fetch(`${endpoint}/capture`, init), '0.4.0-test')
    const sessionId = randomUUID()
    for (const [baseUrl, go] of [
      ['https://opencode.ai/zen/go', true], ['https://OPENCODE.ai:443/zen/go/v1/', true],
      ['https://opencode.ai/zen/go/v1/chat/completions?q=ignored#ignored', true],
      ['https://opencode.ai.evil.test/zen/go/v1', false], ['https://opencode.ai:444/zen/go/v1', false],
      ['https://other.test/zen/go/v1', false], ['https://opencode.ai/zen/v1', false],
      ['https://opencode.ai/zen/go/v10', false], ['https://opencode.ai/other/zen/go/v1', false]
    ] as const) {
      for (const url of [buildChatCompletionsUrl(baseUrl), buildModelsUrl(baseUrl)]) {
        await transport.send(url, { apiKey: 'fixture-only', compatibility: 'auto' }, { sessionId }, { method: 'GET', accept: 'application/json', signal: new AbortController().signal })
        expect(captured.at(-1)?.headers['x-opencode-session']).toBe(go ? sessionId : undefined)
        expect(captured.at(-1)?.headers['user-agent']).toBe('LLM-Reader/0.4.0-test')
        expect(captured.at(-1)?.headers['x-opencode-client']).toBeUndefined()
      }
    }
    await transport.send(`${endpoint}/v1/models`, { apiKey: 'fixture-only', compatibility: 'opencode-go' }, { sessionId }, { method: 'GET', accept: 'application/json', signal: new AbortController().signal })
    expect(captured.at(-1)?.headers['x-opencode-session']).toBe(sessionId)
  })

  it('reuses the conversation across planning, shrinking, streaming fallback and follow-ups, with credential snapshots', async () => {
    let credentials: ProviderCredentials = { baseUrl: endpoint, model: 'fixture', apiKey: 'fixture-only', compatibility: 'opencode-go' }
    const llm = new LlmService({ getCredentials: () => ({ ...credentials }) }, fetch, '0.4.0-test')
    llm.contextProvider = async (request, selected, signal) => {
      await llm.requestText(selected, [{ role: 'user', content: 'planner' }], { sessionId: request.conversationId }, signal)
      return llm.localContext(request)
    }
    let answerAttempts = 0
    respond = (item) => {
      if (item.body?.messages[0].content === 'planner') return { content: success }
      answerAttempts++
      if (answerAttempts === 1) {
        credentials = { ...credentials, compatibility: 'auto' }
        return { status: 400, content: 'maximum context length exceeded' }
      }
      if (answerAttempts === 2) return { status: 400, content: 'stream unsupported' }
      return { content: success }
    }
    const initial = question()
    expect((await run(llm, initial)).at(-1)?.type).toBe('completed')
    expect(captured).toHaveLength(4)
    expect(captured.map((item) => item.headers['x-opencode-session'])).toEqual(Array(4).fill(initial.conversationId))
    expect(captured.slice(1).map((item) => item.body?.stream)).toEqual([true, true, false])
    credentials = { ...credentials, compatibility: 'opencode-go' }
    await run(llm, { ...initial, requestId: randomUUID(), history: [{ role: 'assistant', content: '上轮回答' }] })
    expect(captured.slice(-2).every((item) => item.headers['x-opencode-session'] === initial.conversationId)).toBe(true)
    const next = question()
    await run(llm, next)
    expect(captured.at(-1)?.headers['x-opencode-session']).toBe(next.conversationId)
    expect(next.conversationId).not.toBe(initial.conversationId)
    credentials = { ...credentials, compatibility: 'auto' }
    await run(llm, { ...initial, requestId: randomUUID() })
    expect(captured.slice(-2).every((item) => item.headers['x-opencode-session'] === undefined)).toBe(true)
  })

  it('uses draft compatibility for probes and model lists, with independent opaque IDs', async () => {
    const { provider } = await providerFixture()
    const profile = provider.createProfile({ name: '中转', baseUrl: endpoint, model: 'fixture', apiKey: 'fixture-only' }).profiles[0]
    const input = { profileId: profile.id, baseUrl: endpoint, model: profile.model, compatibility: 'opencode-go' as const }
    expect(await provider.testConfiguration(input)).toMatchObject({ ok: true })
    expect(await provider.listModels(input)).toMatchObject({ models: ['fixture-model'] })
    expect(provider.getOverview().profiles[0].compatibility).toBe('auto')
    provider.updateProfile({ id: profile.id, name: profile.name, ...input })
    provider.activateProfile(profile.id)
    expect(await provider.testConnection()).toMatchObject({ ok: true })
    const sessions = captured.map((item) => item.headers['x-opencode-session'])
    expect(sessions.every((id) => typeof id === 'string' && uuid.test(id))).toBe(true)
    expect(new Set(sessions).size).toBe(3)
    expect(captured.every((item) => item.headers['user-agent'] === 'LLM-Reader/0.4.0-test')).toBe(true)
    expect(provider.getCredentials().compatibility).toBe('opencode-go')
  })

  it('rejects Go redirects without following them and reports header rejection without fallback or echoed body', async () => {
    const credentials = { baseUrl: endpoint, model: 'fixture', apiKey: 'fixture-only', compatibility: 'opencode-go' as const }
    const llm = new LlmService({ getCredentials: () => credentials })
    respond = () => ({ status: 307, headers: { location: `${endpoint}/must-not-receive` }, content: '' })
    expect((await run(llm, question())).at(-1)).toMatchObject({ type: 'error', code: 'PROVIDER_REDIRECT' })
    expect(captured).toHaveLength(1)
    respond = () => ({ status: 400, content: 'missing x-opencode-session, fixture-sensitive-body-must-not-echo' })
    const event = (await run(llm, question())).at(-1)
    expect(event).toMatchObject({ type: 'error', code: 'PROVIDER_SESSION_REJECTED', retryable: false })
    expect(JSON.stringify(event)).not.toContain('fixture-sensitive-body')
    expect(captured).toHaveLength(2)
    const { provider } = await providerFixture()
    expect(await provider.testConfiguration(credentials)).toMatchObject({ ok: false, message: expect.stringContaining('会话标识') })
    await expect(provider.listModels(credentials)).rejects.toMatchObject({ code: 'PROVIDER_SESSION_REJECTED' })
  })

  it('requires UUID conversation IDs at IPC and defaults old configuration input to auto', () => {
    const request = question()
    expect(llmRequestSchema.safeParse(request).success).toBe(true)
    for (const conversationId of [undefined, 'one-global-id', `${randomUUID()}\r\nOther: injected`]) {
      expect(llmRequestSchema.safeParse({ ...request, conversationId }).success).toBe(false)
    }
    expect(providerConfigurationSchema.parse({ baseUrl: endpoint, model: 'fixture' }).compatibility).toBe('auto')
  })
})

it('migrates old archives and analysis IDs once, preserving timestamps, notes and existing cache identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-reader-go-migration-'))
  directories.push(root)
  const path = join(root, 'reader.sqlite3')
  let database = new AppDatabase(path)
  const bookId = randomUUID(), insightId = randomUUID(), jobId = randomUUID()
  try {
    database.insertBook({ id: bookId, title: '旧书', sha256: 'b'.repeat(64), author: null, format: 'txt', sourceFormat: 'txt', originalName: 'old.txt', storedName: 'old.txt', importedAt: '1', lastOpenedAt: null, lastLocator: null, progress: 0 })
    database.createProviderProfile({ id: 'legacy', name: '旧配置', base_url: endpoint, model: 'fixture', compatibility: 'auto', is_active: 1, created_at: '1', updated_at: 'unchanged' })
    const request = question()
    if (request.scope === 'book') throw new Error('Expected selection fixture')
    const input = { bookId, selection: { ...request.selection, bookId }, question: '问题', answer: '答案', model: 'fixture' }
    database.insertInsight(insightId, input, '1')
    const store = new BookContextStore(database)
    store.reset(bookId, jobId, 'legacy', 'fixture', 'unchanged-fingerprint')
    store.saveSummary(bookId, 'book', '旧全书笔记')
    store.status(bookId, 'ready')
    database.connection.exec(`ALTER TABLE provider_profiles DROP COLUMN compatibility;
      ALTER TABLE insights DROP COLUMN conversation_id; ALTER TABLE book_analysis DROP COLUMN session_id;
      ALTER TABLE book_analysis DROP COLUMN progress_json; DROP TABLE book_analysis_failures;
      DROP TABLE book_vectors; DROP TABLE semantic_indexes; DROP TABLE knowledge_settings; DROP TABLE document_jobs;
      ALTER TABLE provider_profiles DROP COLUMN protocol; ALTER TABLE provider_profiles DROP COLUMN request_json; ALTER TABLE provider_profiles DROP COLUMN headers_secret; DROP TABLE book_session_history; DROP TABLE ocr_page_previews; DELETE FROM schema_migrations WHERE version >= 10;`)
    database.close()
    database = new AppDatabase(path)
    const migrated = database.listInsights(bookId)[0]
    const record = new BookContextStore(database).record(bookId)!
    expect(migrated.conversationId).toMatch(uuid)
    expect(record.session_id).toMatch(uuid)
    expect(record.session_id).not.toBe(migrated.conversationId)
    expect(record).toMatchObject({ job_id: jobId, fingerprint: 'unchanged-fingerprint', status: 'ready' })
    expect(new BookContextStore(database).summary(bookId, 'book')).toBe('旧全书笔记')
    expect(database.getActiveProviderProfile()).toMatchObject({ compatibility: 'auto', updated_at: 'unchanged' })
    database.close()
    database = new AppDatabase(path)
    expect(database.listInsights(bookId)[0]).toEqual(migrated)
    expect(new BookContextStore(database).record(bookId)?.session_id).toBe(record.session_id)
    expect(database.updateInsightHistory(insightId, { id: insightId, bookId, history: [...migrated.history, { role: 'user', content: '追问' }, { role: 'assistant', content: '回答' }] })?.conversationId).toBe(migrated.conversationId)
  } finally { database.close() }
})

it('upgrades a version-10 analysis cache without changing its identity and persists a bounded failure history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-reader-analysis-migration-'))
  directories.push(root)
  const path = join(root, 'reader.sqlite3'), bookId = randomUUID()
  let database = new AppDatabase(path)
  try {
    database.insertBook({ id: bookId, title: '旧缓存', sha256: 'c'.repeat(64), author: null, format: 'txt', sourceFormat: 'txt', originalName: 'old.txt', storedName: 'old.txt', importedAt: '1', lastOpenedAt: null, lastLocator: null, progress: 0 })
    database.createProviderProfile({ id: 'legacy', name: '旧配置', base_url: endpoint, model: 'fixture', compatibility: 'auto', is_active: 1, created_at: '1', updated_at: 'unchanged' })
    let store = new BookContextStore(database)
    store.reset(bookId, randomUUID(), 'legacy', 'fixture', 'old-fingerprint')
    store.saveSummary(bookId, 'book-0-0', '已保存的中间笔记')
    store.status(bookId, 'error', '旧提示')
    const previous = store.record(bookId)!
    database.connection.exec('ALTER TABLE book_analysis DROP COLUMN progress_json; DROP TABLE book_analysis_failures; DROP TABLE book_vectors; DROP TABLE semantic_indexes; DROP TABLE knowledge_settings; DROP TABLE document_jobs; ALTER TABLE provider_profiles DROP COLUMN protocol; ALTER TABLE provider_profiles DROP COLUMN request_json; ALTER TABLE provider_profiles DROP COLUMN headers_secret; DROP TABLE book_session_history; DROP TABLE ocr_page_previews; DELETE FROM schema_migrations WHERE version >= 11;')
    database.close()
    database = new AppDatabase(path)
    store = new BookContextStore(database)
    expect(store.record(bookId)).toEqual(previous)
    expect(store.summary(bookId, 'book-0-0')).toBe('已保存的中间笔记')
    expect(database.getActiveProviderProfile()?.updated_at).toBe('unchanged')
    for (let attempt = 1; attempt <= 12; attempt++) store.recordFailure(bookId, 'book-1-0', {
      stage: 'overview', code: 'ANALYSIS_SUMMARY_TOO_LONG', message: '汇总过长', occurredAt: `2026-09-07T00:00:${String(attempt).padStart(2, '0')}Z`, attempt, responseCharacters: 1700
    })
    store.progress(bookId, { stage: 'overview', completed: 0, total: 1, round: 2 })
    const failures = store.state(bookId).failures
    expect(failures).toHaveLength(10)
    expect(failures?.map((failure) => failure.attempt)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3])
    database.close()
    database = new AppDatabase(path)
    store = new BookContextStore(database)
    expect(store.state(bookId).failures).toEqual(failures)
    expect(store.record(bookId)).toMatchObject({ fingerprint: previous.fingerprint, session_id: previous.session_id, job_id: previous.job_id })
    store.reset(bookId, randomUUID(), 'legacy', 'fixture', 'rebuilt')
    expect(store.state(bookId).failures).toBeUndefined()
    expect(store.summary(bookId, 'book-0-0')).toBeNull()
  } finally { database.close() }
})
