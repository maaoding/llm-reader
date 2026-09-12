import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContextSnapshot, DocumentSection, LlmEvent, LlmRequest, Passage, SaveKnowledgeSettingsInput } from '../../src/shared/contracts'
import { AppDatabase } from '../../src/main/database'
import { KnowledgeSettingsService } from '../../src/main/knowledge-settings'
import { KnowledgeHttp } from '../../src/main/knowledge-http'
import { rerank, RerankService } from '../../src/main/rerank-service'
import { nearbyEvidence, organizeEvidence, rerankCandidates, rerankQuery, targetChapters } from '../../src/main/rerank-evidence'
import { BookContextStore } from '../../src/main/book-context-store'
import { BookAnalysisService } from '../../src/main/book-analysis'
import { SemanticIndexService } from '../../src/main/semantic-index'
import { boundContext, LlmService } from '../../src/main/llm-service'
import type { ProviderService } from '../../src/main/provider-service'
import { contextSnapshotSchema, knowledgeSettingsSchema, testKnowledgeSettingsSchema } from '../../src/main/schemas'
import { buildInsightExportMarkdown } from '../../src/main/insight-export'

const databases: AppDatabase[] = [], directories: string[] = []
afterEach(() => { databases.splice(0).forEach((db) => db.close()); directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })) })
const protector = { isAvailable: () => true, encrypt: (text: string) => Buffer.from(`encrypted:${text}`), decrypt: (bytes: Uint8Array) => Buffer.from(bytes).toString().slice(10) }
const input = (): SaveKnowledgeSettingsInput => ({
  embedding: { enabled: false, baseUrl: '', model: '' }, document: { processor: 'none', baseUrl: '', ocr: true, language: 'ch' },
  rerank: { enabled: true, baseUrl: 'https://example.com/v1', model: 'independent-reranker', apiKey: 'rerank-only' }
})
function settingsSetup() {
  const db = new AppDatabase(':memory:'); databases.push(db)
  const settings = new KnowledgeSettingsService(db, protector)
  return { db, settings }
}
const passages: Passage[] = Array.from({ length: 4 }, (_, i) => ({ id: `b${i}`, blockId: `b${i}`, chapterId: `c${i}`, chapterTitle: '相同标题', text: `本地原文${i}😀`, anchor: `txt:${i * 30}:${i * 30 + 15}` }))
const signal = () => new AbortController().signal
const config = { enabled: true, baseUrl: 'https://example.com/v1', model: 'ranker', apiKey: 'rerank-only', revision: '1' }

describe('rerank configuration and archives', () => {
  it('defaults off, preserves omitted old inputs exactly and isolates saved keys by endpoint', () => {
    const { settings, db } = settingsSetup()
    expect(settings.get().rerank).toEqual({ enabled: false, baseUrl: '', model: '', hasApiKey: false })
    settings.save(input())
    const before = db.connection.prepare("SELECT * FROM knowledge_settings WHERE kind = 'rerank'").get()
    const oldInput = { embedding: input().embedding, document: input().document }
    settings.save(oldInput)
    expect(db.connection.prepare("SELECT * FROM knowledge_settings WHERE kind = 'rerank'").get()).toEqual(before)
    expect(settings.get().rerank).toMatchObject({ hasApiKey: true })
    expect(JSON.stringify(settings.get())).not.toContain('rerank-only')
    expect(settings.rerank({ ...config, apiKey: undefined }).apiKey).toBe('rerank-only')
    expect(settings.rerank({ ...config, baseUrl: 'https://other.example/v1', apiKey: undefined }).apiKey).toBe('')
    settings.save({ ...oldInput, rerank: { enabled: true, baseUrl: config.baseUrl, model: config.model, apiKey: null } })
    expect(settings.get().rerank.hasApiKey).toBe(false)
  })
  it('retains, clears and replaces an independent key without changing embedding revision', () => {
    const { settings } = settingsSetup()
    settings.save(input()); const revision = settings.embeddingRevision()
    const draft = { enabled: false, model: config.model, baseUrl: config.baseUrl }
    settings.save({ ...input(), rerank: draft })
    expect(settings.rerank().apiKey).toBe('rerank-only')
    settings.save({ ...input(), rerank: { ...draft, apiKey: null } })
    expect(settings.get().rerank.hasApiKey).toBe(false)
    settings.save({ ...input(), rerank: { ...draft, apiKey: 'new-rerank' } })
    expect(settings.rerank().apiKey).toBe('new-rerank')
    expect(settings.embeddingRevision()).toBe(revision)
  })
  it('migrates the old CHECK table twice without touching JSON, encrypted blobs, revision or analysis', () => {
    const directory = mkdtempSync(join(tmpdir(), 'llm-reader-rerank-migration-')); directories.push(directory)
    const path = join(directory, 'reader.sqlite3')
    let db = new AppDatabase(path)
    db.connection.exec(`DROP TABLE knowledge_settings;
      CREATE TABLE knowledge_settings(kind TEXT PRIMARY KEY CHECK(kind IN ('embedding', 'document')), config_json TEXT NOT NULL, secret BLOB, revision TEXT NOT NULL) STRICT;
      DELETE FROM schema_migrations WHERE version = 13;`)
    for (const kind of ['embedding', 'document']) db.connection.prepare('INSERT INTO knowledge_settings VALUES (?, ?, ?, ?)').run(kind, '{ "enabled": false, "unknownOldField": "保留" }', Buffer.from([0, 255, 14, 87]), `original-${kind}`)
    const previous = db.connection.prepare('SELECT * FROM knowledge_settings ORDER BY kind').all()
    db.close()
    for (let attempt = 0; attempt < 2; attempt++) {
      db = new AppDatabase(path)
      expect(db.connection.prepare("SELECT * FROM knowledge_settings WHERE kind <> 'rerank' ORDER BY kind").all()).toEqual(previous)
      expect(db.connection.prepare('SELECT MAX(version) AS n FROM schema_migrations').get()?.n).toBe(16)
      expect(new KnowledgeSettingsService(db, protector).get().rerank.enabled).toBe(false)
      db.close()
    }
  })
  it('validates drafts, URLs and controlled archive records while accepting archives without rerank', () => {
    for (const baseUrl of ['http://remote.example', 'https://user:secret@example.com', 'https://example.com?token=x', 'https://example.com/#x', 'file:///c:/secret']) {
      expect(knowledgeSettingsSchema.safeParse({ ...input(), rerank: { ...input().rerank, baseUrl } }).success).toBe(false)
    }
    expect(testKnowledgeSettingsSchema.safeParse({ ...input(), rerank: undefined, target: 'rerank' }).success).toBe(false)
    const snapshot: ContextSnapshot = { scope: 'book', bookId: randomUUID(), selection: null, passages, background: '', coverage: { covered: 4, total: 4 } }
    expect(contextSnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(contextSnapshotSchema.safeParse({ ...snapshot, rerank: { status: 'fallback', model: 'ranker', candidateCount: 4, elapsedMs: 5, reason: 'REMOTE SECRET' } }).success).toBe(false)
  })
})

describe('bounded text rerank transport', () => {
  it('uses independent Bearer/real version, all candidates, local text and stable score ties; appends partial results', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ results: [
      { index: 2, relevance_score: 0.9, document: { text: 'FORGED [P99]' } }, { index: 1, relevance_score: 0.9 }
    ] }))
    const ranked = await rerank(new KnowledgeHttp(fetcher, '0.4.0'), config, '测试查询', passages, signal())
    expect(ranked.map((item) => item.blockId)).toEqual(['b1', 'b2', 'b0', 'b3'])
    expect(ranked.every((item) => passages.includes(item))).toBe(true)
    const [url, request] = fetcher.mock.calls[0]
    expect(url).toBe('https://example.com/v1/rerank')
    expect(request).toMatchObject({ method: 'POST', redirect: 'manual', headers: { Authorization: 'Bearer rerank-only', 'User-Agent': 'LLM-Reader/0.4.0' } })
    expect(request!.headers).not.toHaveProperty('x-opencode-session')
    expect(JSON.parse(String(request!.body))).toEqual({ model: 'ranker', query: '测试查询', documents: passages.map((item) => `相同标题\n${item.text}`), top_n: 4, return_documents: false })
  })
  it.each([
    [], [{ index: 0, relevance_score: 1 }, { index: 0, relevance_score: 2 }], [{ index: 4, relevance_score: 1 }],
    [{ index: -1, relevance_score: 1 }], [{ index: 0.5, relevance_score: 1 }], [{ index: 0, relevance_score: '1' }], [{ index: 0, relevance_score: null }]
  ])('rejects the entire invalid response %#', async (...results) => {
    // it.each spreads array rows; reconstruct the provider results exactly.
    await expect(rerank(new KnowledgeHttp(vi.fn(async () => Response.json({ results }))), config, '问题', passages, signal())).rejects.toMatchObject({ code: 'RERANK_INVALID' })
  })
  it.each([[401, 'authentication'], [429, 'rate-limit'], [503, 'server'], [404, 'http'], [302, 'redirect']] as const)('falls back once on HTTP %i with safe metadata', async (status, reason) => {
    const { settings } = settingsSetup(); settings.save(input())
    const fetcher = vi.fn(async () => new Response('PRIVATE BODY KEY', { status, headers: { location: 'https://other.example' } }))
    const service = new RerankService(settings, new KnowledgeHttp(fetcher))
    const result = await service.rank(service.snapshot(), '问题', passages, signal())
    expect(result.passages).toEqual(passages); expect(result.record).toMatchObject({ status: 'fallback', reason, candidateCount: 4 })
    expect(JSON.stringify(result.record)).not.toContain('PRIVATE'); expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('falls back on network, malformed JSON, nonfinite scores and oversized declared/chunked bodies', async () => {
    const { settings } = settingsSetup(); settings.save(input())
    const responses = [() => { throw new TypeError('PRIVATE KEY') }, () => new Response('{'), () => new Response('{"results":[{"index":0,"relevance_score":1e999}]}'),
      () => new Response('x', { headers: { 'content-length': String(1024 * 1024 + 1) } }), () => new Response('x'.repeat(1024 * 1024 + 1))]
    for (const [i, response] of responses.entries()) {
      const fetcher = vi.fn(async () => response()), service = new RerankService(settings, new KnowledgeHttp(fetcher))
      const result = await service.rank(service.snapshot(), '问题', passages, signal())
      expect(result.passages).toEqual(passages)
      expect(result.record.reason).toBe(['network', 'invalid-response', 'invalid-response', 'too-large', 'too-large'][i])
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  })
  it('enforces the real five-second deadline for both a hung fetch and a hung body including uncooperative cancellation', async () => {
    const { settings } = settingsSetup(); settings.save(input())
    const fetchers = [vi.fn<typeof fetch>(() => new Promise(() => undefined)), vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ pull: () => new Promise(() => undefined), cancel: () => new Promise(() => undefined) })))]
    await Promise.all(fetchers.map(async (fetcher) => {
      const service = new RerankService(settings, new KnowledgeHttp(fetcher)), started = performance.now()
      const result = await service.rank(service.snapshot(), '问题', passages, signal())
      expect(result.record).toMatchObject({ status: 'fallback', reason: 'timeout' })
      expect(performance.now() - started).toBeGreaterThanOrEqual(4_900)
      expect(performance.now() - started).toBeLessThan(6_500)
      expect(fetcher).toHaveBeenCalledTimes(1)
    }))
  }, 8_000)
  it('never swallows cancellation or accepts late responses, and makes no request when disabled or alone', async () => {
    const { settings } = settingsSetup(); settings.save(input())
    let release!: (value: Response) => void
    const fetcher = vi.fn<typeof fetch>(() => new Promise((resolve) => { release = resolve }))
    const service = new RerankService(settings, new KnowledgeHttp(fetcher)), controller = new AbortController()
    expect((await service.rank({ ...service.snapshot(), enabled: false }, '问题', passages, signal())).record.reason).toBe('disabled')
    expect((await service.rank(service.snapshot(), '问题', passages.slice(0, 1), signal())).record.reason).toBe('insufficient-candidates')
    expect(fetcher).not.toHaveBeenCalled()
    const pending = service.rank(service.snapshot(), '问题', passages, controller.signal)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort(); await rejected
    release(Response.json({ results: [{ index: 0, relevance_score: 1 }] }))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

function bookSetup(fetcher?: typeof fetch) {
  const { db, settings } = settingsSetup(); settings.save(input())
  const bookId = randomUUID(), store = new BookContextStore(db)
  db.insertBook({ id: bookId, sha256: 'a'.repeat(64), title: '自建长文本', author: null, format: 'txt', sourceFormat: 'txt', originalName: 'fixture.txt', storedName: 'fixture.txt', importedAt: '1', lastOpenedAt: null, lastLocator: null, progress: 0 })
  store.reset(bookId, randomUUID(), 'fixture', 'qa', 'existing-analysis')
  const sections: DocumentSection[] = Array.from({ length: 24 }, (_, i) => ({ id: `s${i}`, chapterId: `c${Math.floor(i / 3)}`, chapterTitle: '重复标题', order: i,
    blocks: Array.from({ length: 3 }, (_, j) => ({ id: `b${i * 3 + j}`, kind: 'paragraph' as const, text: `规则 ${i * 3 + j}。` + '这是条件、例外与反例的原文。'.repeat(90), anchor: `txt:${(i * 3 + j) * 1800}:${(i * 3 + j + 1) * 1800}` })) }))
  store.append(bookId, sections)
  for (const section of sections) store.saveNote(bookId, section.id, { summary: '摘要不得作为重排证据', claims: [{ text: '笔记', sourceIds: [section.blocks[0].id] }], conditions: [], exceptions: [], concepts: [] })
  store.status(bookId, 'ready')
  const credentials = { baseUrl: 'https://qa.example/v1', model: 'qa', apiKey: 'qa-only', compatibility: 'auto' as const }, provider = { getCredentials: () => credentials }
  const llm = new LlmService(provider, fetcher)
  const planner = vi.spyOn(llm, 'requestText').mockResolvedValue({ text: JSON.stringify({ chapters: ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'], terms: ['规则'] }) })
  const service = new BookAnalysisService(store, provider as unknown as ProviderService, llm)
  const rankFetch = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init!.body)) as { documents: string[] }
    return Response.json({ results: body.documents.map((_text, index) => ({ index, relevance_score: index })) })
  })
  service.rerank = new RerankService(settings, new KnowledgeHttp(rankFetch))
  const request: LlmRequest = { scope: 'book', bookId, conversationId: randomUUID(), requestId: randomUUID(), action: 'ask', question: '比较规则的条件与例外', history: [] }
  return { db, settings, bookId, store, sections, credentials, llm, planner, service, rankFetch, request }
}

describe('retrieval, protected evidence and retry integration', () => {
  it('expands FTS to 40, ranks local blocks only and retains six chapter IDs despite repeated titles', async () => {
    const state = bookSetup(), search = vi.spyOn(state.store, 'search')
    const snapshot = await state.service.context(state.request, state.credentials, signal())
    expect(search.mock.calls[0][2]).toBe(40)
    expect(state.rankFetch).toHaveBeenCalledTimes(1); expect(state.planner).toHaveBeenCalledTimes(1)
    expect(snapshot.passages.length).toBeLessThanOrEqual(12)
    expect(new Set(snapshot.passages.filter((item) => item.evidenceRole).map((item) => item.chapterId)).size).toBe(6)
    const body = JSON.parse(String(state.rankFetch.mock.calls[0][1]!.body)) as { documents: string[]; top_n: number }
    expect(body.documents.length).toBeGreaterThan(24); expect(body.documents.length).toBeLessThanOrEqual(60)
    expect(body.top_n).toBe(body.documents.length)
    expect(body.documents.every((text) => state.sections.some((section) => section.blocks.some((block) => text === `重复标题\n${block.text}`)))).toBe(true)
    expect(snapshot.rerank?.status).toBe('applied')
  })
  it('preserves target candidates before pool truncation and keeps identical text at distinct locations', () => {
    const repeated = Array.from({ length: 85 }, (_, i) => ({ ...passages[0], id: `b${i}`, blockId: `b${i}`, chapterId: i < 79 ? 'c0' : `c${i - 78}`, anchor: `txt:${i}:999` }))
    const targets = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5']
    const candidates = rerankCandidates(repeated, [], targets)
    expect(candidates).toHaveLength(60)
    expect(new Set(candidates.map((item) => item.chapterId)).size).toBe(6)
    expect(organizeEvidence(candidates, [], targets)).toHaveLength(12)
    expect(targetChapters([], repeated)).toEqual(targets)
    expect(rerankCandidates([], [], ['missing'])).toEqual([])
  })
  it('caps Unicode query and selection, using action prompts and existing planning terms only', () => {
    const state = bookSetup()
    const local: LlmRequest = { ...state.request, scope: 'selection', action: 'explain', question: '', selection: { bookId: state.bookId, quote: '😀'.repeat(900), chapterTitle: '章', anchor: 'txt:0:900', passages: [] } }
    expect(rerankQuery(local, ['既有规划词'])).toContain('请用清晰')
    expect(rerankQuery(local, ['既有规划词'])).toContain('既有规划词')
    expect(Array.from(rerankQuery(local, [])).filter((text) => text === '😀')).toHaveLength(600)
    expect(Array.from(rerankQuery({ ...state.request, question: '😀'.repeat(2500) }, [])).length).toBe(2000)
    const long = rerankQuery({ ...local, question: '长问题'.repeat(2000) }, ['保留规划词'])
    expect(Array.from(long)).toHaveLength(2000)
    expect(long).toContain('保留规划词')
    expect(Array.from(long).filter((text) => text === '😀')).toHaveLength(600)
  })
  it('retains selection, nearby evidence and all six represented chapters after actual reduced-budget allocation', async () => {
    const state = bookSetup()
    const selection = { bookId: state.bookId, quote: '选区😀'.repeat(450), chapterTitle: '重复标题', anchor: 'txt:300000:301800', passages: [passages[0], { ...passages[1], anchor: 'txt:300000:301800' }, passages[2]] }
    const request: LlmRequest = { ...state.request, scope: 'selection', selection, history: [{ role: 'assistant', content: '旧回答[P99]'.repeat(1500) }] }
    const source = await state.service.context(request, state.credentials, signal())
    expect(nearbyEvidence(selection, []).length).toBe(2)
    for (const budget of [6000, 3000]) {
      const { context, history } = boundContext(request, source, budget)
      expect(context.passages[0].text).toBe(selection.quote)
      expect(context.passages.length).toBeLessThanOrEqual(13)
      expect(context.passages.map((item) => item.chapterId)).toEqual(expect.arrayContaining(['c0', 'c1', 'c2', 'c3', 'c4', 'c5']))
      expect(context.passages.filter((item) => item.evidenceRole === 'nearby')).toHaveLength(2)
      expect(context.passages.map((item) => item.id)).toEqual(context.passages.map((_item, i) => `P${i + 1}`))
      expect(history.every((item) => !item.content.includes('[P99]'))).toBe(true)
      expect(contextSnapshotSchema.safeParse(context).success).toBe(true)
    }
  })
  it('reuses captured settings across a mid-planning edit, and leaves analysis/vectors/document tasks unchanged', async () => {
    const state = bookSetup(), before = state.store.record(state.bookId)
    state.db.connection.prepare('INSERT INTO document_jobs(book_id, fingerprint, task_id, result_json) VALUES (?, ?, ?, ?)').run(state.bookId, 'original-document', 'job1', null)
    const semantic = new SemanticIndexService(state.store, state.settings, new KnowledgeHttp())
    const previousSemantic = semantic.state(state.bookId)
    state.planner.mockImplementationOnce(async () => {
      state.settings.save({ ...input(), rerank: { enabled: true, baseUrl: 'https://new.example/v1', model: 'new-ranker', apiKey: 'new-key' } })
      state.service.knowledgeChanged()
      return { text: '{"chapters":[],"terms":["规则"]}' }
    })
    await state.service.context(state.request, state.credentials, signal())
    expect(state.rankFetch.mock.calls[0][0]).toBe('https://example.com/v1/rerank')
    expect(state.rankFetch.mock.calls[0][1]!.headers).toMatchObject({ Authorization: 'Bearer rerank-only' })
    expect(state.store.record(state.bookId)).toEqual(before)
    expect(semantic.state(state.bookId)).toEqual(previousSemantic)
    expect(state.db.connection.prepare('SELECT * FROM document_jobs').get()).toMatchObject({ task_id: 'job1', fingerprint: 'original-document' })
  })
  it('keeps the disabled path at 24 and skips unanalyzed or empty-candidate requests', async () => {
    const state = bookSetup(), search = vi.spyOn(state.store, 'search')
    state.settings.save({ ...input(), rerank: { ...input().rerank!, enabled: false } })
    expect((await state.service.context(state.request, state.credentials, signal())).rerank).toBeUndefined()
    expect(search.mock.calls[0][2]).toBe(24); expect(state.rankFetch).not.toHaveBeenCalled()
    state.settings.save(input()); state.store.status(state.bookId, 'paused')
    state.store.db.prepare("UPDATE book_documents SET status = 'paused' WHERE book_id = ?").run(state.bookId)
    const local: LlmRequest = { ...state.request, scope: 'selection', selection: { bookId: state.bookId, quote: '原文', anchor: 'txt:0:2', chapterTitle: '章', passages: [passages[0]] } }
    expect((await state.service.context(local, state.credentials, signal())).rerank?.reason).toBe('not-ready')
    expect(state.rankFetch).not.toHaveBeenCalled()
    state.store.status(state.bookId, 'ready')
    state.store.db.prepare('UPDATE book_sections SET note_json = ?').run('{"summary":"摘要","claims":[],"conditions":[],"exceptions":[],"concepts":[]}')
    state.planner.mockResolvedValue({ text: '{"chapters":[],"terms":[]}' })
    expect((await state.service.context({ ...state.request, question: 'unmatchedword' }, state.credentials, signal())).rerank?.reason).toBe('insufficient-candidates')
    expect(state.rankFetch).not.toHaveBeenCalled()
  })
  it('expands vector recall to forty, retains semantic-only hits and preserves ready vectors across rerank changes', async () => {
    const state = bookSetup()
    state.settings.save({ ...input(), embedding: { enabled: true, baseUrl: 'http://127.0.0.1/v1', model: 'vectors' } })
    const http = new KnowledgeHttp(vi.fn<typeof fetch>(async (_url, init) => {
      const { input } = JSON.parse(String(init!.body)) as { input: string[] }
      return Response.json({ data: input.map((text, index) => ({ index, embedding: /规则 (?:6[5-9]|7[01])。|同义/u.test(text) ? [1, 0] : [0, 1] })) })
    }))
    const semantic = new SemanticIndexService(state.store, state.settings, http)
    try {
      semantic.start({ bookId: state.bookId })
      await vi.waitFor(() => expect(semantic.state(state.bookId).status).toBe('ready'))
      const originalVectors = state.db.connection.prepare('SELECT * FROM book_vectors ORDER BY block_rowid').all()
      const old = await semantic.search(state.bookId, '同义', [], signal())
      const expanded = await semantic.search(state.bookId, '同义', [], signal(), 40)
      expect(old).toHaveLength(24); expect(expanded).toHaveLength(40)
      const lexical = state.store.search(state.bookId, '规则', 40)
      const fused = await semantic.search(state.bookId, '同义', lexical, signal(), 40)
      expect(fused.slice(0, 12).some((item) => !lexical.some((hit) => hit.blockId === item.blockId))).toBe(true)
      state.settings.save({ ...input(), embedding: { enabled: true, baseUrl: 'http://127.0.0.1/v1', model: 'vectors' }, rerank: { ...input().rerank!, model: 'changed-ranker' } })
      state.service.knowledgeChanged()
      expect(semantic.state(state.bookId).status).toBe('ready')
      expect(state.db.connection.prepare('SELECT * FROM book_vectors ORDER BY block_rowid').all()).toEqual(originalVectors)
    } finally { semantic.dispose() }
  })
  it('ranks once across context shrink and streaming fallback, renewing actual citation mappings', async () => {
    const payloads: { messages: { content: string }[]; stream: boolean }[] = []
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      payloads.push(JSON.parse(String(init!.body)))
      if (payloads.length === 1) return new Response('maximum context length exceeded', { status: 400 })
      if (payloads.length === 2) return new Response('stream unsupported', { status: 415 })
      return Response.json({ choices: [{ message: { content: '结论[P1]' } }], model: 'qa' })
    })
    const state = bookSetup(fetcher)
    state.llm.contextProvider = (request, credentials, abort) => state.service.context(request, credentials, abort)
    const events = await new Promise<LlmEvent[]>((resolve) => {
      const events: LlmEvent[] = []
      state.llm.start(state.request, (event) => { events.push(event); if (event.type === 'completed' || event.type === 'error') resolve(events) })
    })
    expect(events.at(-1)?.type).toBe('completed')
    expect(state.rankFetch).toHaveBeenCalledTimes(1); expect(state.planner).toHaveBeenCalledTimes(1)
    const snapshots = events.filter((event) => event.type === 'context')
    expect(snapshots).toHaveLength(2); expect(payloads).toHaveLength(3); expect(payloads[2].stream).toBe(false)
    for (const [i, payload] of payloads.entries()) {
      const reference = JSON.parse(payload.messages.at(-1)!.content.split('\n')[1]) as { passages: Passage[] }
      expect(reference.passages.map((item) => item.id)).toEqual(snapshots[i ? 1 : 0].context.passages.map((item) => item.id))
      expect(Array.from(payload.messages.map((item) => item.content).join('')).length).toBeLessThan(i ? 12000 : 24000)
      expect(snapshots[i ? 1 : 0].context.passages.map((item) => item.chapterId)).toEqual(expect.arrayContaining(['c0', 'c1', 'c2', 'c3', 'c4', 'c5']))
    }
  })
  it('terminates book deletion during rerank without answering or resurrecting data on a late response', async () => {
    const fetcher = vi.fn<typeof fetch>(), state = bookSetup(fetcher)
    let release!: (value: Response) => void
    state.rankFetch.mockImplementation(() => new Promise((resolve) => { release = resolve }))
    state.llm.contextProvider = (request, credentials, abort) => state.service.context(request, credentials, abort)
    const events: LlmEvent[] = []
    state.llm.start(state.request, (event) => events.push(event))
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    state.llm.cancelBook(state.bookId); state.db.deleteBook(state.bookId)
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ type: 'error', code: 'CANCELLED' }))
    release(Response.json({ results: [{ index: 0, relevance_score: 1 }] }))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(fetcher).not.toHaveBeenCalled(); expect(state.store.record(state.bookId)).toBeUndefined()
    expect(events.some((event) => event.type === 'context' || event.type === 'delta')).toBe(false)
  })
  it('budgets escaped chapter titles, background and history by the actual serialized payload', async () => {
    const payloads: { messages: { content: string }[] }[] = []
    const state = bookSetup(async (_url, init) => {
      payloads.push(JSON.parse(String(init!.body)))
      if (payloads.length === 1) return new Response('maximum context length exceeded', { status: 400 })
      return Response.json({ choices: [{ message: { content: '答案[P1]' } }] })
    })
    const request: LlmRequest = { ...state.request, scope: 'selection',
      selection: { bookId: state.bookId, quote: '必须保留的选区', anchor: 'txt:0:8', chapterTitle: '"'.repeat(1000), passages: [passages[0]] },
      history: Array.from({ length: 200 }, () => ({ role: 'assistant', content: '\u0000\n"'.repeat(100) })) }
    const source = await state.service.context(request, state.credentials, signal())
    source.background = '\u0000'.repeat(12_000)
    source.passages = source.passages.map((item) => ({ ...item, text: '\u0000'.repeat(1_800) }))
    const reduced = boundContext(request, source, 3000).context
    expect(reduced.passages.map((item) => item.chapterId)).toEqual(expect.arrayContaining(['c0', 'c1', 'c2', 'c3', 'c4', 'c5']))
    expect(reduced.passages.every((item) => item.text.length > 0)).toBe(true)
    state.llm.contextProvider = async () => source
    const terminal = await new Promise<LlmEvent>((resolve) => state.llm.start(request, (event) => {
      if (event.type === 'error' || event.type === 'completed') resolve(event)
    }))
    expect(terminal.type).toBe('completed')
    expect(payloads).toHaveLength(2)
    payloads.forEach((payload, index) => expect(Array.from(payload.messages.map((item) => item.content).join('')).length).toBeLessThan(index ? 12_000 : 24_000))
  })
  it('archives new metadata and exports old/new source excerpts after an analysis rebuild', async () => {
    const state = bookSetup(), source = boundContext(state.request, await state.service.context(state.request, state.credentials, signal()), 6000).context
    for (const context of [source, { ...source, rerank: undefined }]) {
      state.db.insertInsight(randomUUID(), { bookId: state.bookId, selection: null, context, question: '规则', answer: '依据[P1]', model: 'qa' }, '2026-09-08')
    }
    state.store.reset(state.bookId, randomUUID(), 'fixture', 'qa', 'new-analysis')
    const archives = state.db.listAllInsights()
    expect(archives).toHaveLength(2)
    expect(archives.some((item) => item.context?.rerank?.status === 'applied')).toBe(true)
    const markdown = buildInsightExportMarkdown(archives)
    expect(markdown).toContain(source.passages[0].text)
    expect(markdown).not.toContain('rerank-only')
  })
})
