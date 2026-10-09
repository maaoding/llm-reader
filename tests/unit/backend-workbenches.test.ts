import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AppDatabase, migrations } from '../../src/main/database'
import { BookContextStore } from '../../src/main/book-context-store'
import { BookAnalysisService } from '../../src/main/book-analysis'
import { boundContext, LlmService } from '../../src/main/llm-service'
import { buildWorkbenchMarkdown } from '../../src/main/workbench-export'
import { contextSnapshotSchema, llmRequestSchema, workbenchSchema } from '../../src/main/schemas'
import type { ProviderService } from '../../src/main/provider-service'
import type { ContextSnapshot, LlmEvent, LlmRequest, WorkbenchRecord } from '../../src/shared/contracts'

const credentials = { baseUrl: 'https://example.test', model: 'fixture', apiKey: 'test-only', compatibility: 'auto' as const }
function book(database: AppDatabase, title: string): string {
  const id = randomUUID()
  database.insertBook({ id, title, sha256: id.replaceAll('-', '').repeat(2), author: null, format: 'txt', sourceFormat: 'txt', originalName: `${title}.txt`, storedName: `${id}.txt`, importedAt: '2026-01-01', lastOpenedAt: null, lastLocator: null, progress: 0 })
  return id
}
const request = (bookIds: string[]): Extract<LlmRequest, { scope: 'books' }> => ({ requestId: randomUUID(), conversationId: randomUUID(), scope: 'books', bookIds, action: 'ask', question: '比较两本书关于群体判断的观点', history: [] })

describe('independent multi-book workbenches', () => {
  it('upgrades without changing single-book sessions, restores workbenches and never cascades book deletion into shared history', () => {
    const root = mkdtempSync(join(tmpdir(), 'workbench-storage-'))
    const path = join(root, 'reader.sqlite')
    let db = new AppDatabase(path)
    try {
      const first = book(db, '第一本'), second = book(db, '第二本')
      const session = { bookId: first, conversationId: randomUUID(), scope: 'book' as const, selection: null, draft: '单书草稿', turns: [], updatedAt: '2026-01-01' }
      db.upsertBookSession(session)
      db.connection.exec('DROP TABLE workbench_books; DROP TABLE workbenches')
      db.connection.prepare('DELETE FROM schema_migrations WHERE version = ?').run(migrations.length)
      db.close(); db = new AppDatabase(path)
      expect(db.getBookSession(first)).toEqual(session)
      const record = db.createWorkbench('对读', [first, second])
      const snapshot: ContextSnapshot = { scope: 'books', bookId: first, books: [{ id: first, title: '第一本' }, { id: second, title: '第二本' }], selection: null, background: '', coverage: { covered: 0, total: 2 }, passages: [{ id: 'P1', bookId: second, bookTitle: '第二本', text: '第二本的原文', anchor: 'txt:0:7' }] }
      const saved: WorkbenchRecord = { ...record, draft: '工作台草稿', turns: [{ id: randomUUID(), bookIds: [first, second], question: '比较', answer: '第二本的观点 [P1]', model: 'fixture', status: 'completed', context: snapshot }] }
      db.saveWorkbench(saved)
      db.close(); db = new AppDatabase(path)
      expect(db.getWorkbench(record.id)).toMatchObject({ name: '对读', bookIds: [first, second], draft: '工作台草稿', turns: saved.turns })
      db.deleteBook(second)
      expect(db.getWorkbench(record.id)).toMatchObject({ bookIds: [first], turns: saved.turns })
      expect(db.getBookSession(first)).toEqual(session)
      const markdown = buildWorkbenchMarkdown(db.getWorkbench(record.id)!, db.listBooks())
      expect(markdown).toContain('第二本的原文')
      expect(markdown).toContain('[P1] 第二本')
      db.deleteWorkbench(record.id)
      expect(db.saveWorkbench(saved)).toBeNull()
      expect(db.getStoredBook(first)).toBeTruthy()
      expect(db.getBookSession(first)).toEqual(session)
    } finally { db.close(); rmSync(root, { recursive: true, force: true }) }
  })

  it('plans once, retrieves both books with colliding local IDs, excludes unselected books and degrades to local retrieval', async () => {
    const db = new AppDatabase(':memory:')
    const llm = new LlmService({ getCredentials: () => credentials })
    const planner = vi.spyOn(llm, 'requestText').mockResolvedValue({ text: JSON.stringify({ chapters: [], terms: ['群体判断'] }) })
    const store = new BookContextStore(db)
    const service = new BookAnalysisService(store, { getCredentials: () => credentials } as unknown as ProviderService, llm)
    try {
      const ids = ['甲书', '乙书', '未选书'].map((title, index) => {
        const id = book(db, title)
        store.prepare(id, randomUUID(), id, 1)
        store.append(id, [{ id: 'c0-s0', chapterId: 'c0', chapterTitle: '相同章节', order: 0, blocks: [{ id: 'same-block', anchor: 'txt:0:20', text: `群体判断：${index === 0 ? '群体压力使人从众' : index === 1 ? '独立检验能抵抗从众' : '这个内容不应进入回答'}`, kind: 'paragraph' }] }])
        db.connection.prepare("UPDATE book_documents SET status = 'ready' WHERE book_id = ?").run(id)
        return id
      })
      const req = request(ids.slice(0, 2))
      const context = await service.context(req, credentials, new AbortController().signal)
      expect(planner).toHaveBeenCalledTimes(1)
      expect(new Set(context.passages.map((passage) => passage.bookId))).toEqual(new Set(ids.slice(0, 2)))
      expect(context.passages.some((passage) => passage.bookId === ids[2])).toBe(false)
      const bounded = boundContext(req, context, 3_000).context
      expect(bounded.passages).toHaveLength(2)
      expect(bounded.passages.map((passage) => passage.id)).toEqual(['P1', 'P2'])
      expect(contextSnapshotSchema.safeParse(bounded).success).toBe(true)
      planner.mockRejectedValueOnce(new Error('planner unavailable'))
      expect((await service.context(req, credentials, new AbortController().signal)).passages).toHaveLength(2)
      db.connection.prepare("UPDATE book_documents SET status = 'paused' WHERE book_id = ?").run(ids[1])
      await expect(service.context(req, credentials, new AbortController().signal)).rejects.toMatchObject({ code: 'BOOK_NOT_READY' })
    } finally { service.dispose(); db.close() }
  })

  it('retains evidence from all five books within a reduced input budget and rejects forged source membership', () => {
    const ids = Array.from({ length: 5 }, () => randomUUID())
    const req = request(ids)
    const context: ContextSnapshot = { scope: 'books', bookId: ids[0], books: ids.map((id, index) => ({ id, title: `书${index}` })), selection: null, background: '背景'.repeat(2_000), coverage: { covered: 0, total: 5 },
      passages: ids.flatMap((bookId, index) => Array.from({ length: 12 }, (_, block) => ({ id: `b${block}`, blockId: `b${block}`, bookId, bookTitle: `书${index}`, anchor: `txt:${block}:100`, text: '各书自己的原文证据。'.repeat(1_000) }))) }
    for (const budget of [6_000, 3_000]) {
      const result = boundContext(req, context, budget)
      expect(new Set(result.context.passages.map((passage) => passage.bookId))).toEqual(new Set(ids))
      expect(new Set(result.context.passages.map((passage) => passage.id)).size).toBe(result.context.passages.length)
      expect(Array.from(JSON.stringify(result)).length).toBeLessThan(budget * 4)
      expect(contextSnapshotSchema.safeParse(result.context).success).toBe(true)
      const forged = { ...result.context, passages: [{ ...result.context.passages[0], bookId: randomUUID() }] }
      expect(contextSnapshotSchema.safeParse(forged).success).toBe(false)
      expect(workbenchSchema.safeParse({ id: req.conversationId, name: '样本', bookIds: ids, draft: '', turns: [{ id: randomUUID(), bookIds: [ids[0]], question: '问题', answer: '回答', model: 'fixture', status: 'completed', context: result.context }], persona: null, webSearch: 'off' }).success).toBe(false)
    }
    expect(llmRequestSchema.safeParse({ ...req, bookIds: [ids[0], ids[0]] }).success).toBe(false)
    expect(llmRequestSchema.safeParse({ ...req, bookIds: [...ids, randomUUID()] }).success).toBe(false)
  })

  it('shares two model slots across reading and workbenches, and cancels queued requests before any provider call', async () => {
    const releases: Array<() => void> = []
    const fetcher = vi.fn(async () => {
      await new Promise<void>((resolve) => releases.push(resolve))
      return Response.json({ model: 'fixture', choices: [{ message: { content: '答案' } }] })
    })
    const llm = new LlmService({ getCredentials: () => credentials }, fetcher)
    llm.contextProvider = async (req) => {
      if (req.scope !== 'books') return llm.localContext(req)
      return { scope: 'books', bookId: req.bookIds[0], books: req.bookIds.map((id) => ({ id, title: '样本' })), selection: null, background: '', passages: [], coverage: { covered: 0, total: 0 } }
    }
    const events: LlmEvent[] = []
    const reqs = Array.from({ length: 4 }, () => request([randomUUID(), randomUUID()]))
    const first = reqs[0]
    llm.start({ ...first, scope: 'selection', selection: { bookId: first.bookIds[0], quote: '原文', anchor: 'txt:0:2', chapterTitle: '第一章', passages: [] } }, (event) => events.push(event))
    reqs.slice(1).forEach((req) => llm.start(req, (event) => events.push(event)))
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    llm.cancelBook(reqs[2].bookIds[1])
    expect(events).toContainEqual(expect.objectContaining({ requestId: reqs[2].requestId, type: 'error', code: 'CANCELLED' }))
    releases[0]()
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    releases[1](); releases[2]()
    await vi.waitFor(() => expect(llm.isBusy).toBe(false))
    expect(events.filter((event) => event.type === 'completed')).toHaveLength(3)
  })
})
