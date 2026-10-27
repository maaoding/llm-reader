import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { BookContextStore } from '../../src/main/book-context-store'
import { KnowledgeHttp } from '../../src/main/knowledge-http'
import { KnowledgeSettingsService } from '../../src/main/knowledge-settings'
import { SemanticIndexService } from '../../src/main/semantic-index'
import type { DocumentBlock, DocumentSection } from '../../src/shared/contracts'

const resources: Array<{ database: AppDatabase; services: SemanticIndexService[] }> = []
afterEach(async () => {
  for (const { services } of resources) services.forEach((service) => service.dispose())
  await new Promise((resolve) => setTimeout(resolve, 10))
  resources.splice(0).forEach(({ database }) => database.close())
})

function setup(count = 70) {
  const database = new AppDatabase(':memory:')
  const resource = { database, services: [] as SemanticIndexService[] }; resources.push(resource)
  const bookId = randomUUID(), store = new BookContextStore(database)
  database.insertBook({ id: bookId, sha256: 'a'.repeat(64), title: '语义批次', author: null, format: 'txt', sourceFormat: 'txt',
    originalName: 'fixture.txt', storedName: 'fixture.txt', importedAt: '2026-10-26', lastOpenedAt: null, lastLocator: null, progress: 0 })
  store.reset(bookId, randomUUID(), 'fixture', 'mock', 'fixture')
  const blocks: DocumentBlock[] = Array.from({ length: count }, (_, index) => ({ id: `p${index}`, text: `原文 p${index}`,
    anchor: `txt:${index * 50}:${index * 50 + 6}`, kind: 'paragraph', headingPath: ['正文', `第${Math.floor(index / 32) + 1}章`], searchable: index % 9 !== 8 }))
  const sections: DocumentSection[] = []
  for (let index = 0; index < count; index += 32) sections.push({ id: `s${index}`, chapterId: `c${index}`, chapterTitle: '章节', order: sections.length, blocks: blocks.slice(index, index + 32) })
  store.append(bookId, sections); store.status(bookId, 'ready')
  const settings = new KnowledgeSettingsService(database, { isAvailable: () => true, encrypt: (text) => Buffer.from(text), decrypt: (bytes) => Buffer.from(bytes).toString() })
  settings.save({ embedding: { enabled: true, baseUrl: 'http://127.0.0.1/v1', model: 'fixture' }, document: { processor: 'none', baseUrl: '', ocr: true, language: 'ch' } })
  const requests: string[][] = []
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const { input } = JSON.parse(String(init?.body)) as { input: string[] }
    requests.push(input)
    return Response.json({ data: input.map((text, index) => ({ index, embedding: [1, Number(/p(\d+)/u.exec(text)![1]) + 1, 0] })) })
  })
  const createService = () => {
    const service = new SemanticIndexService(store, settings, new KnowledgeHttp(fetcher))
    resource.services.push(service)
    return service
  }
  const originals = blocks.filter((block) => block.searchable !== false)
  return { store, bookId, requests, originals, createService }
}

const embeddingInput = (block: DocumentBlock) => `${block.headingPath!.join(' / ')}\n${block.text}`

describe('semantic indexing batches', () => {
  it('visits every searchable source once in reading order, including ties across batch boundaries', async () => {
    const { store, bookId, requests, originals, createService } = setup()
    const ordinal = (block: DocumentBlock) => Number(block.id.slice(1)) % 3
    const update = store.db.prepare('UPDATE book_blocks SET ordinal = ? WHERE book_id = ? AND block_id = ?')
    for (const block of originals) update.run(ordinal(block), bookId, block.id)
    const service = createService()
    service.start({ bookId })
    await vi.waitFor(() => expect(service.state(bookId)).toMatchObject({ status: 'ready', completed: originals.length, total: originals.length }))
    expect(requests.flat()).toEqual([...originals].sort((left, right) => ordinal(left) - ordinal(right)).map(embeddingInput))
    expect(requests.map((batch) => batch.length)).toEqual([16, 16, 16, 15])
    const rows = store.db.prepare('SELECT b.block_id, v.vector FROM book_vectors v JOIN book_blocks b ON b.id = v.block_rowid WHERE v.book_id = ?').all(bookId)
    for (const row of rows) {
      const value = Number(String(row.block_id).slice(1)) + 1, norm = Math.hypot(1, value, 0)
      expect(Buffer.from(row.vector as Uint8Array)).toEqual(Buffer.from(Float32Array.from([1 / norm, value / norm, 0]).buffer))
    }
  })

  it('fills earlier holes after restart while keeping completed vectors, including later rows', async () => {
    const { store, bookId, requests, originals, createService } = setup()
    const first = createService()
    first.onChange = () => { if (first.state(bookId).completed === 16) first.cancel(bookId) }
    first.start({ bookId })
    await vi.waitFor(() => expect(first.state(bookId)).toMatchObject({ status: 'paused', completed: 16 }))
    store.db.prepare("DELETE FROM book_vectors WHERE block_rowid IN (SELECT id FROM book_blocks WHERE book_id = ? AND block_id IN ('p0', 'p3'))").run(bookId)
    const later = store.db.prepare("SELECT id FROM book_blocks WHERE book_id = ? AND block_id = 'p69'").get(bookId)!
    store.db.prepare('INSERT INTO book_vectors(block_rowid, book_id, vector) VALUES (?, ?, ?)').run(later.id, bookId, Buffer.from(Float32Array.from([0, 0, 1]).buffer))
    const saved = store.db.prepare('SELECT b.block_id, v.vector FROM book_vectors v JOIN book_blocks b ON b.id = v.block_rowid WHERE v.book_id = ? ORDER BY b.ordinal, b.id').all(bookId)
    const savedIds = new Set(saved.map((row) => String(row.block_id)))
    requests.length = 0
    const resumed = createService()
    resumed.start({ bookId })
    await vi.waitFor(() => expect(resumed.state(bookId)).toMatchObject({ status: 'ready', completed: originals.length }))
    expect(requests.flat()).toEqual(originals.filter((block) => !savedIds.has(block.id)).map(embeddingInput))
    const current = store.db.prepare('SELECT b.block_id, v.vector FROM book_vectors v JOIN book_blocks b ON b.id = v.block_rowid WHERE v.book_id = ? ORDER BY b.ordinal, b.id').all(bookId)
    expect(current.filter((row) => savedIds.has(String(row.block_id)))).toEqual(saved)
  })

  it.each(['vector insert', 'dimension update'])('rolls back a failed %s and resumes from the first uncommitted batch', async (failure) => {
    const { store, bookId, requests, originals, createService } = setup(48)
    store.db.exec(failure === 'vector insert' ? `CREATE TRIGGER fail_semantic_batch BEFORE INSERT ON book_vectors
      WHEN (SELECT block_id FROM book_blocks WHERE id = NEW.block_rowid) = 'p20'
      BEGIN SELECT RAISE(ABORT, 'fixture vector failure'); END` : `CREATE TRIGGER fail_semantic_batch BEFORE UPDATE OF dimension ON semantic_indexes
      WHEN (SELECT count(*) FROM book_vectors WHERE book_id = NEW.book_id) > 16
      BEGIN SELECT RAISE(ABORT, 'fixture dimension failure'); END`)
    const service = createService()
    service.start({ bookId })
    await vi.waitFor(() => expect(service.state(bookId)).toMatchObject({ status: 'error', completed: 16 }))
    expect(requests).toHaveLength(2)
    expect(requests[0]).toEqual(originals.slice(0, 16).map(embeddingInput))
    const failedBatch = requests[1]
    store.db.exec('DROP TRIGGER fail_semantic_batch')
    service.start({ bookId })
    await vi.waitFor(() => expect(service.state(bookId)).toMatchObject({ status: 'ready', completed: originals.length }))
    expect(requests[2]).toEqual(failedBatch)
    expect(requests.slice(2).flat()).toEqual(originals.slice(16).map(embeddingInput))
  })
})
