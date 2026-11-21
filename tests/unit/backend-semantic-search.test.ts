import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { BookContextStore } from '../../src/main/book-context-store'
import { KnowledgeHttp } from '../../src/main/knowledge-http'
import { KnowledgeSettingsService } from '../../src/main/knowledge-settings'
import { SemanticIndexService } from '../../src/main/semantic-index'
import type { DocumentSection } from '../../src/shared/contracts'

const resources: Array<{ database: AppDatabase; service: SemanticIndexService }> = []
afterEach(() => {
  for (const { database, service } of resources.splice(0)) { service.dispose(); database.close() }
})
const signal = () => new AbortController().signal
const queryResponse = () => Response.json({ data: [{ index: 0, embedding: [1, 0, 0] }] })

async function setup(scores: number[]) {
  const database = new AppDatabase(':memory:'), store = new BookContextStore(database), bookId = randomUUID()
  database.insertBook({ id: bookId, sha256: 'a'.repeat(64), title: '语义检索', author: null, format: 'txt', sourceFormat: 'txt',
    originalName: 'fixture.txt', storedName: 'fixture.txt', importedAt: '2026-10-27', lastOpenedAt: null, lastLocator: null, progress: 0 })
  store.prepare(bookId, randomUUID(), 'original')
  const blocks = scores.map((_, index) => ({ id: `p${index}`, text: `原文 p${index}`, kind: 'paragraph' as const,
    anchor: `txt:${index * 50}:${index * 50 + 20}`, unitId: `u${index}`, unitRange: { start: 0, end: 20 },
    sources: [{ anchor: `txt:${index * 50}:${index * 50 + 20}`, start: index * 50, end: index * 50 + 20, precision: 'text' as const }] }))
  const sections: DocumentSection[] = []
  for (let index = 0; index < blocks.length; index += 32) sections.push({ id: `s${index}`, chapterId: 'chapter', chapterTitle: '正文', order: sections.length, blocks: blocks.slice(index, index + 32) })
  store.append(bookId, sections)
  store.db.prepare("UPDATE book_documents SET status = 'ready' WHERE book_id = ?").run(bookId)
  const settings = new KnowledgeSettingsService(database, { isAvailable: () => true, encrypt: (text) => Buffer.from(text), decrypt: (bytes) => Buffer.from(bytes).toString() })
  settings.save({ embedding: { enabled: true, baseUrl: 'http://127.0.0.1/v1', model: 'fixture' }, document: { processor: 'none', baseUrl: '', ocr: true, language: 'ch' } })
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const { input } = JSON.parse(String(init?.body)) as { input: string[] }
    if (input[0] === '检索问题') return queryResponse()
    return Response.json({ data: input.map((text, index) => {
      const score = scores[Number(/p(\d+)/u.exec(text)![1])]
      return { index, embedding: [score, Math.sqrt(1 - score * score), 0] }
    }) })
  })
  const service = new SemanticIndexService(store, settings, new KnowledgeHttp(fetcher))
  resources.push({ database, service }); service.start({ bookId })
  await vi.waitFor(() => expect(service.state(bookId)).toMatchObject({ status: 'ready', completed: scores.length }))
  fetcher.mockClear()
  return { database, store, bookId, service, settings, fetcher, blocks }
}

describe('bounded semantic recall', () => {
  it.each([24, 40])('retains late high scores and stable ties for the top %i matches', async (limit) => {
    const state = await setup(Array.from({ length: 160 }, (_, index) => index < 120 ? [-0.5, 0, 0.25, 0.5, 0.75][index % 5] : 1))
    // Equal scores retain the vector scan order, independent of the blocks' reading ordinals.
    state.store.db.prepare('UPDATE book_blocks SET ordinal = 1000 - ordinal WHERE book_id = ?').run(state.bookId)
    const hits = await state.service.search(state.bookId, '检索问题', [], signal(), limit)
    const expected = Array.from({ length: limit }, (_, index) => `p${120 + index}`)
    expect(hits.map((hit) => hit.blockId)).toEqual(expected)
    expect(hits).toEqual(state.store.passages(state.bookId, expected))
    expect(state.fetcher).toHaveBeenCalledOnce()
  })

  it('keeps earlier tied candidates after later, strictly better matches displace the cutoff', async () => {
    const scores = [...Array<number>(30).fill(0.5), ...Array<number>(30).fill(-0.5), ...Array<number>(6).fill(1), ...Array<number>(30).fill(0.5)]
    const state = await setup(scores)
    const hits = await state.service.search(state.bookId, '检索问题', [], signal())
    expect(hits.map((hit) => hit.blockId)).toEqual([
      ...Array.from({ length: 6 }, (_, index) => `p${60 + index}`), ...Array.from({ length: 18 }, (_, index) => `p${index}`)
    ])
  })

  it('ranks negative scores and signed zero correctly when fewer than the requested matches exist', async () => {
    const state = await setup([-0.5, -1, 0, -0, -0.25, 0.5])
    expect((await state.service.search(state.bookId, '检索问题', [], signal())).map((hit) => hit.blockId)).toEqual(['p5', 'p2', 'p3', 'p4', 'p0', 'p1'])
  })

  it('preserves the passage lookup cap and existing slice behavior for custom limits', async () => {
    const state = await setup(Array.from({ length: 160 }, (_, index) => index / 200 - 0.4))
    const ids = state.blocks.map((block) => block.id).reverse()
    for (const limit of [-Infinity, -159, -1, -0.5, 0, 0.5, 1, 7.9, 24, 40, 100, 150, Infinity, NaN]) {
      const expected = ids.slice(0, limit).slice(0, 100).slice(0, limit === 24 ? 24 : limit * 2)
      expect((await state.service.search(state.bookId, '检索问题', [], signal(), limit)).map((hit) => hit.blockId)).toEqual(expected)
    }
  })

  it('preserves leading lexical and semantic evidence and the lexical copy of overlapping passages', async () => {
    const state = await setup(Array.from({ length: 96 }, (_, index) => index >= 60 ? 1 : 0))
    const lexical = state.store.passages(state.bookId, ['p0', 'p1', 'p2', 'p60', 'p61', 'p62'])
      .map((passage) => ({ ...passage, text: passage.text + '（关键词命中）' }))
    for (const limit of [24, 40]) {
      const hits = await state.service.search(state.bookId, '检索问题', lexical, signal(), limit)
      expect(hits.slice(0, 12).map((hit) => hit.blockId)).toEqual(expect.arrayContaining(['p0', 'p1', 'p2', 'p60', 'p61', 'p62']))
      expect(new Set(hits.map((hit) => hit.blockId)).size).toBe(hits.length)
      expect(hits.find((hit) => hit.blockId === 'p60')?.text).toBe('原文 p60（关键词命中）')
    }
  })

  it('keeps hidden passages excluded without filling their slots with lower-ranked evidence', async () => {
    const state = await setup(Array<number>(50).fill(0.5))
    state.store.db.prepare("UPDATE book_blocks SET searchable = 0 WHERE book_id = ? AND block_id IN ('p0', 'p23')").run(state.bookId)
    expect((await state.service.search(state.bookId, '检索问题', [], signal())).map((hit) => hit.blockId))
      .toEqual(Array.from({ length: 22 }, (_, index) => `p${index + 1}`))
  })

  it.each([
    ['wrong dimension', [0, 1]], ['NaN', [0, NaN, 0]], ['infinite score', [Infinity, 0, 0]]
  ] as const)('falls back on a late vector with %s even after enough candidates have been collected', async (_label, values) => {
    const state = await setup(Array<number>(64).fill(0.5))
    const lexical = state.store.passages(state.bookId, ['p1'])
    state.store.db.prepare("UPDATE book_vectors SET vector = ? WHERE block_rowid = (SELECT id FROM book_blocks WHERE book_id = ? AND block_id = 'p63')")
      .run(Buffer.from(Float32Array.from(values).buffer), state.bookId)
    const passages = vi.spyOn(state.store, 'passages')
    expect(await state.service.search(state.bookId, '检索问题', lexical, signal())).toBe(lexical)
    expect(passages).not.toHaveBeenCalled()
  })

  it('falls back when the query dimension changes', async () => {
    const state = await setup([0.5, 1]), lexical = state.store.passages(state.bookId, ['p0'])
    state.fetcher.mockResolvedValueOnce(Response.json({ data: [{ index: 0, embedding: [1, 0] }] }))
    expect(await state.service.search(state.bookId, '检索问题', lexical, signal())).toBe(lexical)
  })

  it.each(['rebuild', 'settings', 'delete'] as const)('keeps the existing fallback when %s occurs during the query embedding', async (change) => {
    const state = await setup([0.5, 1]), lexical = state.store.passages(state.bookId, ['p0'])
    state.fetcher.mockImplementationOnce(async () => {
      if (change === 'rebuild') state.store.prepare(state.bookId, randomUUID(), 'rebuilt-original')
      else if (change === 'settings') state.settings.save({ embedding: { enabled: true, baseUrl: 'http://127.0.0.1/v1', model: 'changed' }, document: { processor: 'none', baseUrl: '', ocr: true, language: 'ch' }, target: 'embedding' })
      else state.database.deleteBook(state.bookId)
      return queryResponse()
    })
    const passages = vi.spyOn(state.store, 'passages')
    expect(await state.service.search(state.bookId, '检索问题', lexical, signal())).toBe(lexical)
    expect(passages).not.toHaveBeenCalled()
  })

  it('propagates explicit cancellation while awaiting the query embedding', async () => {
    const state = await setup([0.5, 1])
    state.fetcher.mockImplementationOnce(() => new Promise<Response>(() => undefined))
    const controller = new AbortController(), pending = state.service.search(state.bookId, '检索问题', [], controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
