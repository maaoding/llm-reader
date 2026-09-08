import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { AppDatabase } from '../../src/main/database'
import { BookContextStore } from '../../src/main/book-context-store'
import { KnowledgeSettingsService } from '../../src/main/knowledge-settings'
import { KnowledgeHttp } from '../../src/main/knowledge-http'
import { SemanticIndexService, embed } from '../../src/main/semantic-index'
import { DocumentProcessingService, cloudAssetUrl } from '../../src/main/document-processing'
import { normalizeDocling, normalizeMineru } from '../../src/main/document-normalizer'
import { knowledgeSettingsSchema } from '../../src/main/schemas'
import type { DocumentSection, SaveKnowledgeSettingsInput } from '../../src/shared/contracts'

const resources: { db: AppDatabase; semantic?: SemanticIndexService }[] = []
afterEach(async () => {
  resources.forEach((item) => item.semantic?.dispose())
  await new Promise((resolve) => setTimeout(resolve, 10))
  resources.splice(0).forEach((item) => item.db.close())
})
const settingsInput = (): SaveKnowledgeSettingsInput => ({
  embedding: { enabled: true, baseUrl: 'http://127.0.0.1/v1', model: 'vector-test', apiKey: 'fixture-secret' },
  document: { processor: 'none', baseUrl: '', ocr: true, language: 'ch' }
})
function setup(count = 2) {
  const db = new AppDatabase(':memory:')
  const resource: typeof resources[number] = { db }; resources.push(resource)
  const store = new BookContextStore(db), bookId = randomUUID()
  db.insertBook({ id: bookId, title: '索引样本', sha256: 'a'.repeat(64), author: null, format: 'txt', sourceFormat: 'txt', originalName: 'sample.txt', storedName: 'sample.txt', importedAt: '1', lastOpenedAt: null, lastLocator: null, progress: 0 })
  store.reset(bookId, randomUUID(), 'fixture', 'analysis-model', 'original-fingerprint')
  const section: DocumentSection = { id: 'c0-s0', chapterId: 'c0', chapterTitle: '讨论判断', order: 0, blocks: Array.from({ length: count }, (_, index) =>
    ({ id: `p${index}`, kind: 'paragraph', text: index === 0 ? '个体受到群体压力而改变判断。' : '这是关于观察天气的记录。', anchor: `txt:${index * 50}:${index * 50 + 20}` })) }
  store.append(bookId, [section]); store.status(bookId, 'ready')
  const protector = { isAvailable: () => true, encrypt: (value: string) => Buffer.from(`encrypted:${value}`), decrypt: (value: Uint8Array) => Buffer.from(value).toString().slice(10) }
  const settings = new KnowledgeSettingsService(db, protector)
  settings.save(settingsInput())
  return { db, store, settings, bookId, resource }
}
function embeddingFetch() {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { input: string[] }
    return Response.json({ data: body.input.map((value, index) => ({ index, embedding: /群体|随大流/u.test(value) ? [1, 0, 0] : [0, 1, 0] })) })
  })
}
const mineruItems = [
  { type: 'text', text: '论证😀', text_level: 1, page_idx: 0, bbox: [0, 120, 1000, 250] },
  { type: 'text', text: '重复原文。', page_idx: 0 },
  { type: 'text', text: '重复原文。', page_idx: 1 },
  { type: 'table', table_caption: ['结果表'], table_body: '<table><tr><td>条件</td><td>例外</td></tr></table>', page_idx: 1 }
]
const doclingDocument = () => ({ pages: { '1': { size: { width: 600, height: 800 } }, '2': { size: { width: 600, height: 800 } } },
  body: { children: [{ $ref: '#/texts/1' }, { $ref: '#/texts/0' }] },
  texts: [{ text: '第二页的证据。', label: 'text', prov: [{ page_no: 2, bbox: { t: 120, coord_origin: 'TOPLEFT' } }] },
    { text: '第一章：定义', label: 'section_header', prov: [{ page_no: 1, bbox: { t: 600, coord_origin: 'BOTTOMLEFT' } }] }] })

describe('knowledge settings and local vectors', () => {
  it('keeps keys out of public settings and clears endpoint-crossing credentials', () => {
    const { settings, db } = setup()
    expect(settings.get().embedding).toMatchObject({ hasApiKey: true })
    expect(JSON.stringify(settings.get())).not.toContain('fixture-secret')
    expect(String(db.connection.prepare("SELECT config_json FROM knowledge_settings WHERE kind = 'embedding'").get()!.config_json)).not.toContain('secret')
    const original = settings.embedding().revision
    const input = settingsInput(); delete input.embedding.apiKey; input.embedding.enabled = false
    settings.save(input)
    expect(settings.embedding().revision).toBe(original)
    expect(settings.embedding().apiKey).toBe('fixture-secret')
    expect(settings.embedding({ ...input.embedding, baseUrl: 'https://another.example/v1' }).apiKey).toBe('')
    settings.save({ ...input, embedding: { ...input.embedding, apiKey: null } })
    expect(settings.get().embedding.hasApiKey).toBe(false)
  })
  it('rejects credential-bearing, nonlocal HTTP and query-string URLs', () => {
    for (const baseUrl of ['https://user:secret@example.com', 'http://example.com/v1', 'https://example.com?key=abc', 'file:///c:/document']) {
      expect(knowledgeSettingsSchema.safeParse({ ...settingsInput(), embedding: { ...settingsInput().embedding, baseUrl } }).success).toBe(false)
    }
  })
  it('finds a synonym missed by FTS and isolates books, then falls back on embedding errors', async () => {
    const { store, settings, resource, bookId } = setup()
    const fetcher = embeddingFetch(), http = new KnowledgeHttp(fetcher, '0.4.0')
    const service = new SemanticIndexService(store, settings, http); resource.semantic = service
    service.start({ bookId })
    await vi.waitFor(() => expect(service.state(bookId).status).toBe('ready'))
    expect(store.search(bookId, '随大流')).toEqual([])
    const hits = await service.search(bookId, '随大流', [], new AbortController().signal)
    expect(hits[0].id).toBe('p0')
    expect(await service.search(randomUUID(), '随大流', [], new AbortController().signal)).toEqual([])
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer fixture-secret', 'User-Agent': 'LLM-Reader/0.4.0' })
    expect(fetcher.mock.calls[0][1]?.redirect).toBe('manual')
    fetcher.mockRejectedValueOnce(new TypeError('contains private upstream data'))
    const fallback = store.search(bookId, '天气')
    expect(await service.search(bookId, '随大流', fallback, new AbortController().signal)).toEqual(fallback)
    settings.save({ ...settingsInput(), embedding: { ...settingsInput().embedding, model: 'another-model' } })
    expect(service.state(bookId).status).toBe('stale')
    expect(() => service.start({ bookId })).toThrow('重建')
  })
  it('retains finished batches on cancel, resumes after restart, and cascades rebuild/delete', async () => {
    const { db, store, settings, resource, bookId } = setup(32)
    const fetcher = embeddingFetch(), http = new KnowledgeHttp(fetcher)
    let service = new SemanticIndexService(store, settings, http); resource.semantic = service
    service.onChange = () => { if (service.state(bookId).completed === 16) service.cancel(bookId) }
    service.start({ bookId })
    await vi.waitFor(() => expect(service.state(bookId)).toMatchObject({ status: 'paused', completed: 16 }))
    expect(fetcher).toHaveBeenCalledTimes(1)
    service = new SemanticIndexService(store, settings, http); resource.semantic = service
    service.start({ bookId })
    await vi.waitFor(() => expect(service.state(bookId)).toMatchObject({ status: 'ready', completed: 32 }))
    expect(fetcher).toHaveBeenCalledTimes(2)
    const noisyLexical = store.search(bookId, '天气')
    expect(noisyLexical).toHaveLength(24)
    expect((await service.search(bookId, '随大流', noisyLexical, new AbortController().signal)).slice(0, 12).some((item) => item.id === 'p0')).toBe(true)
    service.start({ bookId, rebuild: true })
    await vi.waitFor(() => expect(service.state(bookId).status).toBe('ready'))
    expect(fetcher).toHaveBeenCalledTimes(5)
    store.reset(bookId, randomUUID(), 'fixture', 'analysis-model', 'same')
    expect(db.connection.prepare('SELECT count(*) AS total FROM book_vectors').get()!.total).toBe(0)
    expect(db.connection.prepare('SELECT status FROM semantic_indexes WHERE book_id = ?').get(bookId)?.status).toBe('stale')
  })
  it('rejects malformed, zero and inconsistent embeddings and never follows redirects', async () => {
    const { settings } = setup()
    const config = settings.embedding(), signal = new AbortController().signal
    for (const data of [[], [{ index: 1, embedding: [1] }], [{ index: 0, embedding: [0, 0] }], [{ index: 0, embedding: [Infinity] }]]) {
      const http = new KnowledgeHttp(vi.fn(async () => Response.json({ data })))
      await expect(embed(http, config, ['问题'], signal)).rejects.toThrow('向量')
    }
    await expect(embed(new KnowledgeHttp(vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://another.example' } }))), config, ['问题'], signal)).rejects.toThrow('跳转')
    await expect(embed(new KnowledgeHttp(vi.fn(async () => { throw new TypeError('SECRET RAW RESPONSE') })), config, ['问题'], signal)).rejects.not.toThrow('SECRET')
  })
  it('cancels in-flight embedding work before book deletion and rejects changed dimensions on resume', async () => {
    const { db, store, settings, bookId, resource } = setup(32)
    let release: ((response: Response) => void) | undefined
    const fetcher = embeddingFetch()
    fetcher.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve }))
    const service = new SemanticIndexService(store, settings, new KnowledgeHttp(fetcher)); resource.semantic = service
    service.start({ bookId })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    service.cancel(bookId)
    db.connection.prepare('DELETE FROM books WHERE id = ?').run(bookId)
    release!(Response.json({ data: Array.from({ length: 16 }, (_, index) => ({ index, embedding: [1, 0] })) }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(db.connection.prepare('SELECT count(*) AS total FROM book_vectors').get()!.total).toBe(0)
  })
  it('preserves the first batch when a provider changes dimension, and requires a consistent rebuild', async () => {
    const { store, settings, bookId, resource } = setup(32)
    const fetcher = embeddingFetch()
    fetcher.mockImplementationOnce(async () => Response.json({ data: Array.from({ length: 16 }, (_, index) => ({ index, embedding: [1, 0] })) }))
    const service = new SemanticIndexService(store, settings, new KnowledgeHttp(fetcher)); resource.semantic = service
    service.start({ bookId })
    await vi.waitFor(() => expect(service.state(bookId)).toMatchObject({ status: 'error', completed: 16 }))
    expect(service.state(bookId).message).toContain('维度')
    service.start({ bookId, rebuild: true })
    await vi.waitFor(() => expect(service.state(bookId)).toMatchObject({ status: 'ready', completed: 32 }))
  })
})

describe('document conversion boundaries', () => {
  it('preserves Unicode, duplicates, reading order, tables, and source page anchors', () => {
    const sections = normalizeMineru(mineruItems, 2)
    const blocks = sections.flatMap((section) => section.blocks)
    expect(blocks[0]).toMatchObject({ text: '论证😀', anchor: 'pdfpos:1:0.12' })
    expect(blocks.filter((block) => block.text === '重复原文。')).toHaveLength(2)
    expect(new Set(blocks.map((block) => block.id)).size).toBe(blocks.length)
    expect(blocks.find((block) => block.kind === 'table')?.text).toContain('条件\t例外')
    const docling = normalizeDocling(doclingDocument(), 2).flatMap((section) => section.blocks)
    expect(docling[0]).toMatchObject({ text: '第一章：定义', anchor: 'pdfpos:1:0.25' })
    expect(docling[1].anchor).toBe('pdfpos:2:0.15')
    expect(() => normalizeMineru(mineruItems, 1)).toThrow('页码')
    const missing = doclingDocument(); delete (missing.pages as Record<string, unknown>)['2']
    expect(() => normalizeDocling(missing, 2)).toThrow('页码')
    const shiftedPages = { ...doclingDocument(), pages: { '1': { size: { height: 800 } }, '3': { size: { height: 800 } } } }
    shiftedPages.texts[0].prov[0].page_no = 1
    expect(() => normalizeDocling(shiftedPages, 2)).toThrow('页码')
    const cycle = doclingDocument(); cycle.body.children.push({ $ref: '#/texts/1' })
    expect(() => normalizeDocling(cycle, 2)).toThrow('结构')
  })
  it('preserves Docling table rows and rejects missing provenance instead of inventing pages', () => {
    const document = { ...doclingDocument(), tables: [{ data: { table_cells: [
      { text: '条件', start_row_offset_idx: 0, start_col_offset_idx: 0 }, { text: '例外', start_row_offset_idx: 0, start_col_offset_idx: 1 },
      { text: '群体压力', start_row_offset_idx: 1, start_col_offset_idx: 0 }, { text: '独立判断', start_row_offset_idx: 1, start_col_offset_idx: 1 }
    ] }, prov: [{ page_no: 2, bbox: { t: 40, coord_origin: 'TOPLEFT' } }] }] }
    document.body.children.push({ $ref: '#/tables/0' })
    expect(normalizeDocling(document, 2).flatMap((section) => section.blocks).at(-1)?.text).toBe('条件\t例外\n群体压力\t独立判断')
    document.tables[0].prov = []
    expect(() => normalizeDocling(document, 2)).toThrow('结构')
  })
  it('does not resubmit failed or uncertain document tasks, and never caches partial results', async () => {
    const { db, settings, bookId } = setup()
    settings.save({ ...settingsInput(), document: { processor: 'docling', baseUrl: 'http://127.0.0.1', ocr: true, language: 'ch' } })
    let partial = false
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (init?.method === 'POST') return Response.json({ task_id: 'failed-job' })
      if (String(url).includes('/result/')) return Response.json({ status: 'partial_success', document: { json_content: doclingDocument() } })
      return Response.json({ task_status: partial ? 'success' : 'failure' })
    })
    const service = new DocumentProcessingService(db, settings, new KnowledgeHttp(fetcher), 1)
    await expect(service.extract(bookId, Buffer.from('%PDF-fixture'), 2, new AbortController().signal)).rejects.toThrow('未完成')
    await expect(service.extract(bookId, Buffer.from('%PDF-fixture'), 2, new AbortController().signal)).rejects.toThrow('未完成')
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    partial = true
    await expect(service.extract(bookId, Buffer.from('%PDF-fixture'), 2, new AbortController().signal)).rejects.toThrow('未完成')
    expect(db.connection.prepare('SELECT result_json FROM document_jobs WHERE book_id = ?').get(bookId)!.result_json).toBeNull()
    db.connection.prepare("UPDATE document_jobs SET task_id = 'submitting' WHERE book_id = ?").run(bookId)
    const calls = fetcher.mock.calls.length
    await expect(service.extract(bookId, Buffer.from('%PDF-fixture'), 2, new AbortController().signal)).rejects.toThrow('未完成')
    expect(fetcher.mock.calls).toHaveLength(calls)
    db.connection.prepare('DELETE FROM books WHERE id = ?').run(bookId)
    expect(db.connection.prepare('SELECT count(*) AS total FROM document_jobs').get()!.total).toBe(0)
  })
  it.each(['docling', 'mineru-local'] as const)('submits %s asynchronously and resumes the same remote job after cancellation', async (processor) => {
    const { db, settings, bookId } = setup()
    settings.save({ ...settingsInput(), document: { processor, baseUrl: 'http://127.0.0.1', ocr: true, language: 'ch', apiKey: 'doc-only' } })
    let polls = 0, submitted = 0, complete = false
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      const path = new URL(String(url)).pathname
      if (init?.method === 'POST') {
        submitted++
        expect(init.body).toBeInstanceOf(FormData)
        const form = init.body as FormData
        if (processor === 'docling') {
          expect(form.get('ocr_preset')).toBe('easyocr')
          expect(form.get('ocr_engine')).toBe('easyocr')
          expect(form.getAll('ocr_lang')).toEqual(['ch_sim', 'en'])
          expect(form.get('do_ocr')).toBe('true')
        }
        return Response.json({ task_id: 'job-fixed' })
      }
      if (path.endsWith('job-fixed/result') || path.startsWith('/v1/result/')) return Response.json(processor === 'docling'
        ? { status: 'success', document: { json_content: doclingDocument() } } : { results: { document: { content_list: JSON.stringify(mineruItems) } } })
      polls++
      return Response.json(processor === 'docling' ? { task_status: complete ? 'success' : 'started' } : { status: complete ? 'completed' : 'processing' })
    })
    let service = new DocumentProcessingService(db, settings, new KnowledgeHttp(fetcher), 20)
    const controller = new AbortController()
    const first = service.extract(bookId, Buffer.from('%PDF-fixture'), 2, controller.signal)
    const rejected = expect(first).rejects.toBeDefined()
    await vi.waitFor(() => expect(polls).toBeGreaterThan(0))
    controller.abort(); await rejected
    expect(db.connection.prepare('SELECT task_id FROM document_jobs WHERE book_id = ?').get(bookId)!.task_id).toBe('job-fixed')
    complete = true
    service = new DocumentProcessingService(db, settings, new KnowledgeHttp(fetcher), 1)
    const result = await service.extract(bookId, Buffer.from('%PDF-fixture'), 2, new AbortController().signal)
    expect(result.length).toBeGreaterThan(0); expect(submitted).toBe(1)
    const calls = fetcher.mock.calls.length
    expect(await service.extract(bookId, Buffer.from('%PDF-fixture'), 2, new AbortController().signal)).toEqual(result)
    expect(fetcher.mock.calls).toHaveLength(calls)
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject(processor === 'docling' ? { 'X-Api-Key': 'doc-only' } : { Authorization: 'Bearer doc-only' })
    service.reset(bookId)
    await service.extract(bookId, Buffer.from('%PDF-fixture'), 2, new AbortController().signal)
    expect(submitted).toBe(2)
  })
  it('waits for MinerU to queue an uploaded file, keeps credentials off assets, and bounds result URLs', async () => {
    const { db, settings, bookId } = setup()
    settings.save({ ...settingsInput(), document: { processor: 'mineru-cloud', baseUrl: 'http://127.0.0.1', ocr: true, language: 'ch', apiKey: 'cloud-only' } })
    const zip = new JSZip(); zip.file('document_content_list.json', JSON.stringify(mineruItems))
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const states = ['waiting-file', 'waiting-file', 'pending', 'running', 'converting', 'done']
    let polls = 0
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      const path = new URL(String(url)).pathname
      if (path === '/upload' || path === '/result.zip') {
        expect(init?.headers).not.toHaveProperty('Authorization')
        return path === '/upload' ? new Response(null) : new Response(new Uint8Array(bytes))
      }
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer cloud-only' })
      if (path.endsWith('/file-urls/batch')) return Response.json({ code: 0, data: { batch_id: 'batch-fixed', file_urls: ['http://127.0.0.1/upload'] } })
      return Response.json({ code: 0, data: { extract_result: [{ state: states[polls++], full_zip_url: 'http://127.0.0.1/result.zip' }] } })
    })
    const service = new DocumentProcessingService(db, settings, new KnowledgeHttp(fetcher), 1)
    expect((await service.extract(bookId, Buffer.from('%PDF-fixture'), 2, new AbortController().signal)).length).toBeGreaterThan(0)
    expect(polls).toBe(states.length)
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1)
    expect(db.connection.prepare('SELECT result_json FROM document_jobs WHERE book_id = ?').get(bookId)!.result_json).not.toBeNull()
    for (const url of ['file:///c:/data', 'http://127.0.0.1/upload', 'https://evil.example/upload', 'https://aliyuncs.com.evil.example/x']) {
      expect(() => cloudAssetUrl(url, 'https://mineru.net')).toThrow()
    }
    expect(cloudAssetUrl('https://mineru.oss-cn-shanghai.aliyuncs.com/result.zip', 'https://mineru.net')).toContain('aliyuncs.com')
  })
})
