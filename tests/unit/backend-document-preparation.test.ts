import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { AppDatabase } from '../../src/main/database'
import { BookContextStore } from '../../src/main/book-context-store'
import { BookAnalysisService } from '../../src/main/book-analysis'
import { boundContext, LlmService } from '../../src/main/llm-service'
import { ProviderService } from '../../src/main/provider-service'
import { SemanticIndexService } from '../../src/main/semantic-index'
import { KnowledgeHttp } from '../../src/main/knowledge-http'
import { KnowledgeSettingsService } from '../../src/main/knowledge-settings'
import { DocumentProcessingService } from '../../src/main/document-processing'
import { normalizeMineruDocument } from '../../src/main/document-normalizer'
import { RerankService } from '../../src/main/rerank-service'
import { documentSections } from '../../src/shared/document-structure'
import type { DocumentSection, LlmRequest, NormalizedDocument } from '../../src/shared/contracts'
import { structureDoclingFixture } from '../../scripts/document-structure-fixture'

const resources: { db: AppDatabase; service?: BookAnalysisService; semantic?: SemanticIndexService }[] = []
const directories: string[] = []
afterEach(async () => {
  for (const resource of resources) { resource.service?.dispose(); resource.semantic?.dispose() }
  await new Promise((done) => setTimeout(done, 20))
  for (const resource of resources.splice(0)) resource.db.close()
  for (const directory of directories.splice(0)) {
    if (dirname(resolve(directory)) !== resolve(tmpdir())) throw new Error('测试目录边界无效。')
    rmSync(directory, { recursive: true, force: true })
  }
})
const protector = { isAvailable: () => true, encrypt: (value: string) => Buffer.from(value), decrypt: (value: Uint8Array) => Buffer.from(value).toString() }
const credentials = { baseUrl: 'http://127.0.0.1/v1', model: 'fixture-model', apiKey: 'test-only', compatibility: 'auto' as const }
function fixture(): NormalizedDocument {
  return { version: 2, diagnostics: [], nodes: [
    { id: 'first', title: '前提', level: 1, parentId: null, order: 0, anchor: 'txt:0:10', kind: 'section' },
    { id: 'second', title: '例外', level: 1, parentId: null, order: 1, anchor: 'txt:100:110', kind: 'section' }
  ], units: [
    { id: 'unit-first', nodeId: 'first', order: 0, text: '共同核验仅在资料独立且记录可追溯时成立。', kind: 'paragraph', sources: [{ anchor: 'txt:0:23', precision: 'text' }], relatedIds: [], searchable: true },
    { id: 'unit-second', nodeId: 'second', order: 1, text: '临时例外只限立即危险，仍须补齐事后复核。', kind: 'paragraph', sources: [{ anchor: 'txt:100:123', precision: 'text' }], relatedIds: [], searchable: true }
  ] }
}
function setup(format: 'txt' | 'pdf' = 'txt', path = ':memory:') {
  const db = new AppDatabase(path), store = new BookContextStore(db), bookId = randomUUID(), profileId = randomUUID()
  db.insertBook({ id: bookId, sha256: 'a'.repeat(64), title: '自建样本', author: null, format, sourceFormat: format, originalName: 'fixture', storedName: 'fixture',
    importedAt: '2026-09-08', lastOpenedAt: null, lastLocator: null, progress: 0 })
  db.createProviderProfile({ id: profileId, name: 'fixture', base_url: credentials.baseUrl, model: credentials.model, compatibility: 'auto', is_active: 1, created_at: '1', updated_at: '1' })
  const provider = { getCredentials: vi.fn(() => credentials) }, llm = new LlmService(provider)
  const generate = vi.spyOn(llm, 'requestText').mockImplementation(async (_config, messages) => {
    if (messages[0].content.includes('为阅读问题')) return { text: '{"chapters":[],"terms":[]}' }
    const data = JSON.parse(messages[1].content) as DocumentSection | string[]
    return { text: Array.isArray(data) ? '真实已完成的概要。' : JSON.stringify({ summary: '已完成的部分笔记。', claims: [{ text: data.blocks[0].text, sourceIds: [data.blocks[0].id] }], conditions: [], exceptions: [], concepts: [] }) }
  })
  const service = new BookAnalysisService(store, provider as unknown as ProviderService, llm, store, 0)
  const resource = { db, service } as typeof resources[number]; resources.push(resource)
  const settings = new KnowledgeSettingsService(db, protector)
  const request: LlmRequest = { requestId: randomUUID(), conversationId: randomUUID(), bookId, scope: 'book', action: 'ask', question: '共同核验的前提与临时例外是什么？', history: [] }
  return { db, store, bookId, profileId, provider, llm, generate, service, resource, settings, request }
}
function prepare(state: ReturnType<typeof setup>, document = fixture()) {
  const job = state.service.prepare({ bookId: state.bookId }).document!
  state.service.append({ bookId: state.bookId, jobId: job.jobId, sections: documentSections(document), document })
  state.service.finish({ bookId: state.bookId, jobId: job.jobId })
  return job
}

describe('independent preparation, notes and semantic lifecycle', () => {
  it.each(
    (['book', 'selection'] as const).flatMap((scope) => [false, true].map((rerank) => ({ scope, rerank })))
  )('keeps direct hits ahead of optional linked notes for $scope with rerank=$rerank', async ({ scope, rerank }) => {
    const state = setup(), document: NormalizedDocument = { version: 2, nodes: [], units: [], diagnostics: [] }
    for (let index = 0; index < 7; index++) {
      const nodeId = `chapter-${index}`, offset = index * 1000
      document.nodes.push({ id: nodeId, title: `章节 ${index}`, level: 1, parentId: null, order: index, anchor: `txt:${offset}:${offset + 10}`, kind: 'section' })
      const add = (id: string, text: string, kind: 'paragraph' | 'note', relatedIds: string[], start: number): void => {
        document.units.push({ id, nodeId, order: document.units.length, text, kind, relatedIds, searchable: true,
          sources: [{ anchor: `txt:${start}:${start + Array.from(text).length}`, precision: 'text' }] })
      }
      if (index < 6) {
        add(`body-${index}`, `相关章节正文 ${index}。`, 'paragraph', [`note-${index}`], offset)
        add(`note-${index}`, `可选脚注说明 ${index}。`, 'note', [`body-${index}`], offset + 100)
      } else add('best', '唯一直接回答：最低核验次数是三次。', 'paragraph', [], offset)
    }
    prepare(state, document)
    const originals = state.store.originals(state.bookId)
    const best = originals.find((passage) => passage.unitId === 'best')!
    const representatives = originals.filter((passage) => passage.unitId?.startsWith('body-'))
    const directNote = originals.find((passage) => passage.unitId === 'note-0')!
    const ranked = [best, ...representatives, directNote]
    vi.spyOn(state.store, 'search').mockReturnValue(ranked)
    state.generate.mockResolvedValue({ text: JSON.stringify({ chapters: document.nodes.slice(0, 6).map((node) => node.id), terms: [] }) })
    const rankFetch = vi.fn<typeof fetch>(async () => Response.json({ results: ranked.map((_passage, index) => ({ index, relevance_score: ranked.length - index })) }))
    state.settings.save({ embedding: { enabled: false, baseUrl: '', model: '' }, document: { processor: 'none', baseUrl: '', ocr: true, language: 'ch' },
      rerank: { enabled: rerank, baseUrl: credentials.baseUrl, model: 'fixture-rerank' } })
    state.service.rerank = new RerankService(state.settings, new KnowledgeHttp(rankFetch))
    const selected = { id: 'selected', text: '当前选区待核对。', anchor: 'txt:7000:7008', chapterTitle: '当前章节' }
    const request: LlmRequest = scope === 'book' ? state.request : {
      requestId: randomUUID(), conversationId: randomUUID(), scope, action: 'ask', question: state.request.question, history: [],
      selection: { bookId: state.bookId, quote: selected.text, anchor: selected.anchor, chapterTitle: selected.chapterTitle,
        passages: [selected, ...representatives.slice(0, 2)] }
    }
    const context = await state.service.context(request, credentials, new AbortController().signal)
    expect(context.passages).toHaveLength(12)
    expect(new Set(context.passages.map((passage) => passage.blockId)).size).toBe(12)
    expect(context.passages.slice(0, ranked.length).map((passage) => passage.blockId)).toEqual([...representatives, best, directNote].map((passage) => passage.blockId))
    expect(context.passages.find((passage) => passage.blockId === directNote.blockId)?.evidenceRole).toBeUndefined()
    expect(context.passages.slice(ranked.length).every((passage) => passage.evidenceRole === 'extension')).toBe(true)
    for (const limit of [6000, 1500]) {
      const bounded = boundContext(request, context, limit).context
      expect(bounded.passages.some((passage) => passage.blockId === best.blockId && passage.text === best.text)).toBe(true)
      expect(representatives.every((original) => bounded.passages.some((passage) => passage.blockId === original.blockId))).toBe(true)
      expect(bounded.passages.map((passage) => passage.id)).toEqual(bounded.passages.map((_passage, index) => `P${index + 1}`))
      if (scope === 'selection') expect(bounded.passages[0].text).toBe(selected.text)
    }
    expect(state.generate).toHaveBeenCalledTimes(1)
    expect(rankFetch).toHaveBeenCalledTimes(rerank ? 1 : 0)
  })
  it('recovers missing MinerU annotations from cached raw output on explicit rebuild without uploading again', async () => {
    const state = setup('pdf')
    state.settings.save({ embedding: { enabled: false, baseUrl: '', model: '' }, document: { processor: 'mineru-local', baseUrl: credentials.baseUrl, ocr: true, language: 'ch' } })
    const fetcher = vi.fn<typeof fetch>(async () => { throw new Error('原始解析缓存可用，不应调用远端。') })
    const processor = new DocumentProcessingService(state.db, state.settings, new KnowledgeHttp(fetcher))
    state.service.documents = processor
    const raw = [{ type: 'text', page_idx: 0, text: '已有正常正文。' },
      { type: 'table', page_idx: 0, bbox: [0, 200, 900, 800], table_body: '', table_caption: ['历史样本'], table_footnote: ['样本数为三十。'] }]
    const oldStructure = normalizeMineruDocument(raw.slice(0, 1), 1)
    const fingerprint = createHash('sha256').update(JSON.stringify(['a'.repeat(64), processor.identity()])).digest('hex')
    state.db.connection.prepare('INSERT INTO document_jobs(book_id, fingerprint, task_id, raw_json, structure_json) VALUES (?, ?, ?, ?, ?)')
      .run(state.bookId, fingerprint, 'cached-task', JSON.stringify(raw), JSON.stringify(oldStructure))
    const job = state.service.prepare({ bookId: state.bookId, rebuild: true }).document!
    const sections = await processor.extract(state.bookId, new Uint8Array(), 1, new AbortController().signal)
    state.service.append({ bookId: state.bookId, jobId: job.jobId, sections, document: processor.structure(state.bookId) })
    state.service.finish({ bookId: state.bookId, jobId: job.jobId })
    expect(fetcher).not.toHaveBeenCalled()
    expect(state.generate).not.toHaveBeenCalled()
    expect(state.store.documentState(state.bookId).status).toBe('ready')
    expect(state.store.search(state.bookId, '三十').some((passage) => passage.text === '样本数为三十。' && passage.anchor === 'pdfpos:1:0.2')).toBe(true)
    expect(processor.structure(state.bookId)?.units.some((unit) => unit.kind === 'caption' && unit.text === '历史样本')).toBe(true)
  })
  it('prepares TXT without reading model credentials and permits full-book questions with no notes or overview', async () => {
    const state = setup()
    state.provider.getCredentials.mockImplementation(() => { throw new Error('应当无需模型。') })
    expect(() => state.service.start({ bookId: state.bookId, profileId: state.profileId })).toThrow()
    prepare(state)
    expect(state.provider.getCredentials).not.toHaveBeenCalled()
    expect(state.generate).not.toHaveBeenCalled()
    expect(state.service.state(state.bookId)).toMatchObject({ status: 'empty', document: { status: 'ready' }, completedSections: 0 })
    const context = await state.service.context(state.request, credentials, new AbortController().signal)
    expect(context.coverage).toEqual({ covered: 0, total: 2 })
    expect(context.background).toBe('')
    expect(context.passages.some((passage) => passage.text.includes('资料独立'))).toBe(true)
    expect(state.generate).toHaveBeenCalledTimes(1)
  })
  it('uses actual partial notes through error, pause and restart without scheduling another external call', async () => {
    const state = setup(); prepare(state)
    state.service.onState = (next) => { if (next.status === 'analyzing' && next.completedSections === 1) state.service.cancel(state.bookId) }
    state.service.start({ bookId: state.bookId, profileId: state.profileId })
    await vi.waitFor(() => expect(state.service.state(state.bookId).status).toBe('paused'))
    const count = state.generate.mock.calls.length
    state.store.status(state.bookId, 'error', '模拟概要失败')
    state.service.dispose()
    const restarted = new BookAnalysisService(state.store, state.provider as unknown as ProviderService, state.llm)
    state.resource.service = restarted
    expect(state.generate).toHaveBeenCalledTimes(count)
    const context = await restarted.context(state.request, credentials, new AbortController().signal)
    expect(context.coverage).toEqual({ covered: 1, total: 2 })
    expect(context.background).toContain('已完成的部分笔记')
    expect(context.background).not.toMatch(/全书概要|null|undefined/u)
    expect(context.passages).not.toHaveLength(0)
  })
  it('resumes derived chunks from the normalized artifact and rejects stale preparation callbacks', async () => {
    const state = setup(), document = fixture(), sections = documentSections(document)
    const first = state.service.prepare({ bookId: state.bookId }).document!
    state.service.append({ bookId: state.bookId, jobId: first.jobId, sections: sections.slice(0, 1), document })
    expect(() => state.service.finish({ bookId: state.bookId, jobId: first.jobId })).toThrow()
    state.service.cancelPreparation(state.bookId)
    const next = state.service.prepare({ bookId: state.bookId }).document!
    expect(next.jobId).not.toBe(first.jobId)
    expect(() => state.service.append({ bookId: state.bookId, jobId: first.jobId, sections })).toThrow()
    await vi.waitFor(() => expect(state.service.state(state.bookId).document?.status).toBe('ready'))
    expect(state.store.originals(state.bookId)).toHaveLength(2)
    expect(state.generate).not.toHaveBeenCalled()
  })
  it('keeps vectors during note rebuild, marks both derived products stale on original rebuild, and ignores deleted jobs', async () => {
    const state = setup(); prepare(state)
    state.settings.save({ embedding: { enabled: true, baseUrl: credentials.baseUrl, model: 'vectors' }, document: { processor: 'none', baseUrl: '', ocr: true, language: 'ch' } })
    const embeddingCalls: string[][] = []
    const semantic = new SemanticIndexService(state.store, state.settings, new KnowledgeHttp(async (_url, input) => {
      const texts = (JSON.parse(String(input?.body)) as { input: string[] }).input; embeddingCalls.push(texts)
      return Response.json({ data: texts.map((_text, index) => ({ index, embedding: [1, 0] })) })
    }))
    state.resource.semantic = semantic; state.service.semantic = semantic
    semantic.start({ bookId: state.bookId })
    await vi.waitFor(() => expect(semantic.state(state.bookId).status).toBe('ready'))
    expect(state.store.record(state.bookId)).toBeUndefined()
    state.service.start({ bookId: state.bookId, profileId: state.profileId })
    await vi.waitFor(() => expect(state.service.state(state.bookId).status).toBe('ready'))
    const originals = state.store.originals(state.bookId), vectors = state.db.connection.prepare('SELECT * FROM book_vectors').all()
    state.service.start({ bookId: state.bookId, profileId: state.profileId, rebuild: true })
    expect(state.store.originals(state.bookId)).toEqual(originals)
    expect(state.db.connection.prepare('SELECT * FROM book_vectors').all()).toEqual(vectors)
    expect(semantic.state(state.bookId).status).toBe('ready')
    expect(embeddingCalls).toHaveLength(1)
    const job = state.service.prepare({ bookId: state.bookId, rebuild: true }).document!
    expect(state.service.state(state.bookId).status).toBe('stale')
    expect(semantic.state(state.bookId).status).toBe('stale')
    state.service.cancelPreparation(state.bookId); state.db.deleteBook(state.bookId)
    expect(() => state.service.finish({ bookId: state.bookId, jobId: job.jobId })).toThrow()
    await new Promise((done) => setTimeout(done, 10))
    expect(state.store.record(state.bookId)).toBeUndefined()
    expect(state.db.connection.prepare('SELECT count(*) AS n FROM book_vectors').get()?.n).toBe(0)
  })
  it('rebuilds a PDF structure from bounded cached raw output, without another upload or poll', async () => {
    const state = setup('pdf')
    state.settings.save({ embedding: { enabled: false, baseUrl: '', model: '' }, document: { processor: 'docling', baseUrl: 'http://127.0.0.1', ocr: true, language: 'ch' } })
    const fetcher = vi.fn<typeof fetch>(async (url, init) => init?.method === 'POST' ? Response.json({ task_id: 'accepted' }) :
      String(url).includes('/result/') ? Response.json({ status: 'success', document: { json_content: structureDoclingFixture() } }) : Response.json({ task_status: 'success' }))
    const documents = new DocumentProcessingService(state.db, state.settings, new KnowledgeHttp(fetcher), 1)
    const before = await documents.extract(state.bookId, Buffer.from('%PDF-fixture'), 6, new AbortController().signal)
    const requests = fetcher.mock.calls.length
    documents.rebuild(state.bookId)
    const after = await documents.extract(state.bookId, Buffer.from('%PDF-fixture'), 6, new AbortController().signal)
    expect(after).toEqual(before)
    expect(fetcher).toHaveBeenCalledTimes(requests)
    expect(state.db.connection.prepare('SELECT task_id FROM document_jobs').get()?.task_id).toBe('accepted')
  })
})

function downgradeDocumentTables(db: AppDatabase): void {
  db.connection.exec(`
    CREATE TABLE sections_old (book_id TEXT NOT NULL REFERENCES book_analysis(book_id) ON DELETE CASCADE, section_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
      chapter_title TEXT NOT NULL, ordinal INTEGER NOT NULL, content_json TEXT NOT NULL, note_json TEXT, PRIMARY KEY(book_id,section_id), UNIQUE(book_id,ordinal)) STRICT;
    INSERT INTO sections_old SELECT * FROM book_sections;
    CREATE TABLE blocks_old (id INTEGER PRIMARY KEY, book_id TEXT NOT NULL REFERENCES book_analysis(book_id) ON DELETE CASCADE, block_id TEXT NOT NULL,
      section_id TEXT NOT NULL, chapter_id TEXT NOT NULL, chapter_title TEXT NOT NULL, ordinal INTEGER NOT NULL, text TEXT NOT NULL, anchor TEXT NOT NULL, UNIQUE(book_id,block_id)) STRICT;
    INSERT INTO blocks_old SELECT id,book_id,block_id,section_id,chapter_id,chapter_title,ordinal,text,anchor FROM book_blocks;
    CREATE TABLE indexes_old (book_id TEXT PRIMARY KEY REFERENCES book_analysis(book_id) ON DELETE CASCADE, fingerprint TEXT NOT NULL, model TEXT NOT NULL,
      status TEXT NOT NULL, dimension INTEGER, message TEXT) STRICT;
    INSERT INTO indexes_old SELECT * FROM semantic_indexes;
    CREATE TABLE vectors_old (block_rowid INTEGER PRIMARY KEY REFERENCES blocks_old(id) ON DELETE CASCADE, book_id TEXT NOT NULL REFERENCES indexes_old(book_id) ON DELETE CASCADE, vector BLOB NOT NULL) STRICT;
    INSERT INTO vectors_old SELECT * FROM book_vectors;
    DROP TABLE book_vectors; DROP TABLE semantic_indexes; DROP TRIGGER book_blocks_delete; DROP TABLE book_blocks; DROP TABLE book_sections;
    ALTER TABLE sections_old RENAME TO book_sections; ALTER TABLE blocks_old RENAME TO book_blocks;
    ALTER TABLE indexes_old RENAME TO semantic_indexes; ALTER TABLE vectors_old RENAME TO book_vectors;
    CREATE INDEX book_vectors_book ON book_vectors(book_id);
    CREATE TRIGGER book_blocks_delete AFTER DELETE ON book_blocks BEGIN DELETE FROM book_fts WHERE rowid = old.id; END;
    DROP TABLE book_documents;
    ALTER TABLE document_jobs DROP COLUMN raw_json; ALTER TABLE document_jobs DROP COLUMN structure_json;
    ALTER TABLE provider_profiles DROP COLUMN protocol; ALTER TABLE provider_profiles DROP COLUMN request_json; ALTER TABLE provider_profiles DROP COLUMN headers_secret; ALTER TABLE knowledge_settings DROP COLUMN headers_secret; DROP TABLE book_session_history; DELETE FROM schema_migrations WHERE version >= 14;
  `)
}

it('migrates a real version-13 error cache twice, preserving source rowids, vectors, sessions, archives and retrieval', () => {
  const directory = mkdtempSync(join(tmpdir(), 'llm-reader-document-migration-')); directories.push(directory)
  const path = join(directory, 'reader.sqlite3'), state = setup('txt', path)
  state.store.reset(state.bookId, randomUUID(), state.profileId, credentials.model, 'original-fingerprint')
  const section: DocumentSection = { id: 'old-section', chapterId: 'old-chapter', chapterTitle: '原章节', order: 0,
    blocks: [{ id: 'old-block', kind: 'paragraph', text: '旧结构的有效原文。', anchor: 'txt:10:20' }] }
  state.store.append(state.bookId, [section])
  state.db.connection.prepare("UPDATE book_analysis SET extraction_done = 1, status = 'error', overview = NULL WHERE book_id = ?").run(state.bookId)
  state.settings.save({ embedding: { enabled: true, baseUrl: credentials.baseUrl, model: 'vectors' }, document: { processor: 'none', baseUrl: '', ocr: true, language: 'ch' } })
  const revision = state.db.connection.prepare("SELECT revision FROM knowledge_settings WHERE kind = 'embedding'").get()!.revision
  const fingerprint = createHash('sha256').update(JSON.stringify(['a'.repeat(64), 'original-fingerprint', revision, credentials.baseUrl, 'vectors', 1])).digest('hex')
  state.db.connection.prepare("INSERT INTO semantic_indexes VALUES (?, ?, 'vectors', 'ready', 2, NULL)").run(state.bookId, fingerprint)
  const rowId = state.db.connection.prepare('SELECT id FROM book_blocks').get()!.id
  state.db.connection.prepare('INSERT INTO book_vectors VALUES (?, ?, ?)').run(rowId, state.bookId, Buffer.from(new Float32Array([1, 0]).buffer))
  const context = { scope: 'book' as const, bookId: state.bookId, selection: null, passages: [{ ...section.blocks[0], id: 'P1' }], background: '', coverage: { covered: 0, total: 1 } }
  const archive = state.db.insertInsight(randomUUID(), { bookId: state.bookId, selection: null, context, question: '原文是什么', answer: '原文 [P1]', model: 'fixture' }, '2026-09-08')
  const record = state.store.record(state.bookId), vectors = state.db.connection.prepare('SELECT * FROM book_vectors').all()
  downgradeDocumentTables(state.db)
  state.db.close(); resources.splice(resources.indexOf(state.resource), 1)
  for (let attempt = 0; attempt < 2; attempt++) {
    const migrated = new AppDatabase(path)
    try {
      const store = new BookContextStore(migrated), semantic = new SemanticIndexService(store, new KnowledgeSettingsService(migrated, protector), new KnowledgeHttp())
      expect(store.documentState(state.bookId)).toMatchObject({ status: 'ready', version: 1 })
      expect(store.record(state.bookId)).toEqual(record)
      expect(store.search(state.bookId, '有效原文')[0]).toMatchObject({ id: 'old-block', anchor: 'txt:10:20' })
      expect(migrated.connection.prepare('SELECT * FROM book_vectors').all()).toEqual(vectors)
      expect(semantic.state(state.bookId).status).toBe('ready')
      expect(migrated.listInsights(state.bookId)[0]).toEqual(archive)
      expect(migrated.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally { migrated.close() }
  }
})
