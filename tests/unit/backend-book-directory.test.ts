import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { BookContextStore } from '../../src/main/book-context-store'
import { BookAnalysisService } from '../../src/main/book-analysis'
import { LlmService } from '../../src/main/llm-service'
import type { ProviderService } from '../../src/main/provider-service'
import { documentSections } from '../../src/shared/document-structure'
import type { DocumentSection, LlmRequest, NormalizedDocument } from '../../src/shared/contracts'

const resources: Array<{ db: AppDatabase; service: BookAnalysisService }> = []
afterEach(() => {
  for (const { db, service } of resources.splice(0)) { service.dispose(); db.close() }
  vi.restoreAllMocks()
})
const credentials = { baseUrl: 'http://127.0.0.1/v1', model: 'fixture', apiKey: 'test-only', compatibility: 'auto' as const }
function fixture(count = 3, prefix = '章节'): NormalizedDocument {
  return { version: 2, diagnostics: [],
    nodes: Array.from({ length: count }, (_, index) => ({ id: `n${index}`, title: `${prefix}${index}`, kind: 'section', parentId: null, level: 1, order: index, anchor: `txt:${index * 100}:0` })),
    units: Array.from({ length: count }, (_, index) => ({ id: `u${index}`, nodeId: `n${index}`, order: index, text: `${prefix}${index}的原文😀`, kind: 'paragraph', relatedIds: [], searchable: true,
      sources: [{ anchor: `txt:${index * 100}:${index * 100 + 10}`, precision: 'text' }] })) }
}
function setup() {
  const db = new AppDatabase(':memory:'), store = new BookContextStore(db)
  const provider = { getCredentials: () => credentials }, llm = new LlmService(provider)
  const planner = vi.spyOn(llm, 'requestText').mockResolvedValue({ text: '{"chapters":[],"terms":[]}' })
  const search = vi.fn<BookContextStore['search']>((bookId) => store.originals(bookId).slice(0, 1))
  const service = new BookAnalysisService(store, provider as unknown as ProviderService, llm, { search })
  resources.push({ db, service })
  const prepare = (bookId: string, document: NormalizedDocument) => {
    store.prepare(bookId, randomUUID(), randomUUID())
    const sections = documentSections(document)
    store.cacheDocument(bookId, document, sections.length); store.append(bookId, sections)
    db.connection.prepare("UPDATE book_documents SET status = 'ready' WHERE book_id = ?").run(bookId)
  }
  const addBook = (title: string, document?: NormalizedDocument) => {
    const id = randomUUID()
    db.insertBook({ id, title, sha256: id.replaceAll('-', '').repeat(2), author: null, format: 'txt', sourceFormat: 'txt', originalName: 'fixture.txt', storedName: `${id}.txt`, importedAt: '2026-10-27', lastOpenedAt: null, lastLocator: null, progress: 0 })
    if (document) prepare(id, document)
    else store.prepare(id, randomUUID(), randomUUID(), 1)
    return id
  }
  return { db, store, service, planner, search, addBook, prepare }
}
const request = (bookIds: string[]): Extract<LlmRequest, { scope: 'books' }> => ({ scope: 'books', bookIds,
  requestId: randomUUID(), conversationId: randomUUID(), action: 'ask', question: '比较这些书的观点', history: [] })
const context = (state: ReturnType<typeof setup>, ids: string[], signal = new AbortController().signal) => state.service.context(request(ids), credentials, signal)

describe('lightweight book directories', () => {
  it('preserves section array order, duplicate titles and Unicode while excluding group nodes', () => {
    const state = setup(), document = fixture(4)
    document.nodes[0].kind = 'group'
    document.nodes[1].title = document.nodes[3].title = '同名😀𠮷章节'
    document.nodes[1].parentId = document.nodes[0].id
    document.nodes[1].order = 20; document.nodes[2].order = 10
    const bookId = state.addBook('节点样本', document)
    expect(state.store.chapterDirectory(bookId)).toEqual([
      { id: 'n1', title: '同名😀𠮷章节' }, { id: 'n2', title: '章节2' }, { id: 'n3', title: '同名😀𠮷章节' }
    ])
  })

  it('keeps a normalized document with no section nodes empty instead of using legacy chapters', () => {
    const state = setup(), document = fixture(1)
    document.nodes[0].kind = 'group'
    const bookId = state.addBook('分组文档', document)
    expect(state.store.sections(bookId)).toHaveLength(1)
    expect(state.store.chapterDirectory(bookId)).toEqual([])
  })

  it('keeps legacy chapter first positions and last titles in section order, independent of insertion order', () => {
    const state = setup(), bookId = state.addBook('旧版文档')
    const sections: DocumentSection[] = [
      { id: 's3', chapterId: 'z', chapterTitle: '更新后的标题', order: 3, blocks: [] },
      { id: 's0', chapterId: 'z', chapterTitle: '最初标题', order: 0, blocks: [] },
      { id: 's2', chapterId: 'a', chapterTitle: '同名', order: 2, blocks: [] },
      { id: 's1', chapterId: 'b', chapterTitle: '同名', order: 1, blocks: [] }
    ].map((section) => ({ ...section, blocks: [{ id: `p${section.order}`, text: '旧版原文', anchor: `txt:${section.order * 100}:0`, kind: 'paragraph' }] }))
    state.store.append(bookId, sections)
    expect(state.store.chapterDirectory(bookId)).toEqual([{ id: 'z', title: '更新后的标题' }, { id: 'b', title: '同名' }, { id: 'a', title: '同名' }])
    expect(state.store.chapterDirectory(state.addBook('空书'))).toEqual([])
    expect(state.store.chapterDirectory(randomUUID())).toEqual([])
  })

  it('reads fresh directory and source content on the next request after a rebuild', async () => {
    const state = setup(), first = state.addBook('甲书', fixture(1, '旧标题')), second = state.addBook('乙书', fixture(1, '乙书'))
    state.planner.mockResolvedValue({ text: JSON.stringify({ chapters: [], terms: [], books: [first] }) })
    const before = await context(state, [first, second])
    state.prepare(first, fixture(1, '新标题'))
    const after = await context(state, [first, second])
    const directories = state.planner.mock.calls.map(([, messages]) => JSON.parse(messages[1].content).chapters)
    expect(directories[0][0]).toEqual({ id: 'B0C0', title: '《甲书》 旧标题0' })
    expect(directories[1][0]).toEqual({ id: 'B0C0', title: '《甲书》 新标题0' })
    expect(before.passages[0].text).toBe('旧标题0的原文😀')
    expect(after.passages[0].text).toBe('新标题0的原文😀')
  })

  it.each([false, true])('preserves the planner directory count and character budgets with long titles %s', async (long) => {
    const state = setup(), document = fixture(70, long ? '😀'.repeat(240) : '章')
    const ids = [state.addBook('甲书', document), state.addBook('乙书', document)]
    await context(state, ids)
    const payload = JSON.parse(state.planner.mock.calls[0][1][1].content)
    const expected = ids.flatMap((_id, bookIndex) => {
      const result: Array<{ id: string; title: string }> = []
      let budget = 3_000
      for (const [index, chapter] of document.nodes.entries()) {
        const title = Array.from(`《${bookIndex ? '乙书' : '甲书'}》 ${chapter.title}`).slice(0, 200).join('')
        budget -= Array.from(title).length + 40
        if (budget < 0 || index >= 40) break
        result.push({ id: `B${bookIndex}C${index}`, title })
      }
      return result
    })
    expect(payload.chapters).toEqual(expected)
    expect(payload.chapters).toHaveLength(long ? 24 : 80)
  })

  it('loads full text only for selected books and maps planner IDs to the original chapter IDs', async () => {
    const state = setup(), first = state.addBook('甲书', fixture()), second = state.addBook('乙书', fixture(2, '乙书'))
    state.planner.mockResolvedValue({ text: JSON.stringify({ chapters: ['B0C1', 'B1C0'], terms: ['词'], books: [first] }) })
    const structure = vi.spyOn(state.store, 'structure'), sections = vi.spyOn(state.store, 'sections')
    const result = await context(state, [first, second])
    expect(structure).toHaveBeenCalledExactlyOnceWith(first)
    expect(sections).toHaveBeenCalledExactlyOnceWith(first)
    expect(state.search.mock.calls[0][3]).toEqual(['n1'])
    expect(state.search.mock.calls[0][4]).toEqual(['词'])
    expect(result.passages.every((passage) => passage.bookId === first)).toBe(true)
    expect(result.books?.map((book) => book.id)).toEqual([first, second])
  })

  it.each(['rebuild', 'delete', 'pause'] as const)('rejects a %s of an input book during planning, even when retrieval excludes it', async (change) => {
    const state = setup(), first = state.addBook('甲书', fixture()), second = state.addBook('乙书', fixture())
    state.planner.mockImplementationOnce(async () => {
      if (change === 'rebuild') state.prepare(second, fixture(1, '更新后的原文'))
      else if (change === 'delete') state.db.deleteBook(second)
      else state.db.connection.prepare("UPDATE book_documents SET status = 'paused' WHERE book_id = ?").run(second)
      return { text: JSON.stringify({ chapters: [], terms: [], books: [first] }) }
    })
    await expect(context(state, [first, second])).rejects.toMatchObject({ code: change === 'delete' ? 'BOOK_NOT_FOUND' : 'DOCUMENT_CHANGED' })
  })

  it('stops before retrieval when cancelled during planning', async () => {
    const state = setup(), bookId = state.addBook('甲书', fixture()), controller = new AbortController()
    state.planner.mockImplementationOnce(async () => { controller.abort(); return { text: '{"chapters":[],"terms":[]}' } })
    await expect(context(state, [bookId], controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(state.search).not.toHaveBeenCalled()
  })
})
