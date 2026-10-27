import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { BookContextStore } from '../../src/main/book-context-store'
import { BookAnalysisService } from '../../src/main/book-analysis'
import { LlmService } from '../../src/main/llm-service'
import type { ProviderService } from '../../src/main/provider-service'
import type { DocumentSection, LlmRequest, Passage } from '../../src/shared/contracts'
import type { SectionNote } from '../../src/shared/book-context'

const resources: Array<{ db: AppDatabase; service: BookAnalysisService }> = []
afterEach(() => {
  for (const { db, service } of resources.splice(0)) { service.dispose(); db.close() }
  vi.restoreAllMocks()
})
const credentials = { baseUrl: 'http://127.0.0.1/v1', model: 'fixture', apiKey: 'test-only', compatibility: 'auto' as const }
function setup() {
  const db = new AppDatabase(':memory:'), store = new BookContextStore(db)
  const provider = { getCredentials: () => credentials }, llm = new LlmService(provider)
  vi.spyOn(llm, 'requestText').mockResolvedValue({ text: '{"chapters":[],"terms":[]}' })
  const retriever = { search: vi.fn((): Passage[] => []) }
  const service = new BookAnalysisService(store, provider as unknown as ProviderService, llm, retriever)
  resources.push({ db, service })
  const addBook = (sections: DocumentSection[] = [], title = '章节样本') => {
    const bookId = randomUUID()
    db.insertBook({ id: bookId, title, sha256: bookId.replaceAll('-', '').repeat(2), author: null, format: 'txt', sourceFormat: 'txt',
      originalName: 'fixture.txt', storedName: `${bookId}.txt`, importedAt: '2026-10-27', lastOpenedAt: null, lastLocator: null, progress: 0 })
    store.reset(bookId, randomUUID(), 'fixture', 'fixture', 'fixture')
    store.append(bookId, sections); store.status(bookId, 'ready')
    return bookId
  }
  return { db, store, service, addBook }
}
const request = (bookId: string): Extract<LlmRequest, { scope: 'book' }> => ({ scope: 'book', bookId,
  requestId: randomUUID(), conversationId: randomUUID(), action: 'ask', question: '章节之间有什么联系？', history: [] })
function section(order: number, chapterId: string, chapterTitle = chapterId): DocumentSection {
  return { id: `s${order}`, chapterId, chapterTitle, order,
    blocks: [{ id: `p${order}`, text: `原文${order}`, anchor: `txt:${order * 100}:${order * 100 + 4}`, kind: 'paragraph' }] }
}
function note(input: DocumentSection, concept = false): SectionNote {
  const point = { text: input.blocks[0].text, sourceIds: [input.blocks[0].id] }
  return { summary: `笔记${input.order}`, claims: concept ? [] : [point], conditions: [], exceptions: [],
    concepts: concept ? [{ ...point, term: '概念', aliases: [] }] : [] }
}
const context = (state: ReturnType<typeof setup>, input: LlmRequest, chapters: string[] = []) =>
  state.service.context(input, credentials, new AbortController().signal, () => undefined, { chapters, terms: [] })

describe('chapter evidence and summary reads', () => {
  it('reads exact summary IDs within one book, including empty values, and observes updates and resets', () => {
    const state = setup(), first = state.addBook(), second = state.addBook()
    const unusual = 'chapter-引号"\'😀-final'
    for (const bookId of [first, second]) {
      state.store.saveSummary(bookId, unusual, bookId === first ? '第一本摘要' : '另一本摘要')
      state.store.saveSummary(bookId, 'chapter-empty-final', '')
      state.store.saveSummary(bookId, 'book-0-0', '未请求的中间摘要')
    }
    const saved = state.store.summaries(first, [unusual, 'missing', 'chapter-empty-final', unusual])
    expect(saved).toEqual(new Map([[unusual, '第一本摘要'], ['chapter-empty-final', '']]))
    expect(state.store.summaries(first, [])).toEqual(new Map())
    expect(state.store.summaries(randomUUID(), [unusual])).toEqual(new Map())
    state.store.saveSummary(first, unusual, '更新后的摘要')
    expect(state.store.summaries(first, [unusual]).get(unusual)).toBe('更新后的摘要')
    expect(saved.get(unusual)).toBe('第一本摘要')
    state.store.resetNotes(first, randomUUID(), 'fixture', 'fixture', 'fixture')
    expect(state.store.summaries(first, [unusual])).toEqual(new Map())
    expect(state.store.summaries(second, [unusual]).get(unusual)).toBe('另一本摘要')
  })

  it('retrieves a large chapter directory without dropping or mixing summaries', () => {
    const state = setup(), bookId = state.addBook()
    const ids = Array.from({ length: 2_048 }, (_, index) => `chapter-c${index}-final`)
    for (const [index, id] of ids.entries()) state.store.saveSummary(bookId, id, `摘要${index}`)
    const summaries = state.store.summaries(bookId, [...ids].reverse())
    expect(summaries.size).toBe(ids.length)
    expect(ids.map((id) => summaries.get(id))).toEqual(ids.map((_id, index) => `摘要${index}`))
  })

  it('keeps chapter order and the first section note, including a missing note and concept-only evidence', async () => {
    const state = setup()
    const sections = [section(0, 'z', '同名'), section(1, 'a', '同名'), section(2, 'z', '同名'), section(3, 'b', '同名'), section(4, 'a', '同名')]
    const bookId = state.addBook(sections)
    for (const index of [0, 2, 3, 4]) state.store.saveNote(bookId, sections[index].id, note(sections[index], index === 3))
    for (const id of ['a', 'b', 'z']) state.store.saveSummary(bookId, `chapter-${id}-final`, `${id}章摘要`)
    const result = await context(state, request(bookId))
    expect(result.passages.map((passage) => passage.blockId)).toEqual(['p0', 'p3'])
    expect(result.background).toBe('章节笔记：\n同名: z章摘要\n同名: a章摘要\n同名: b章摘要')
    expect(result.coverage).toEqual({ covered: 4, total: 5 })
  })

  it.each(['selection', undefined] as const)('reads only relevant chapter summaries for selection scope %s', async (scope) => {
    const state = setup(), sections = [section(0, 'z'), section(1, 'a'), section(2, 'b')]
    const bookId = state.addBook(sections)
    for (const id of ['a', 'b', 'z']) state.store.saveSummary(bookId, `chapter-${id}-final`, `${id}章摘要`)
    const read = vi.spyOn(state.store, 'summaries')
    const selected = sections[1]
    const result = await context(state, { scope, requestId: randomUUID(), conversationId: randomUUID(), action: 'ask', question: '解释原文', history: [],
      selection: { bookId, quote: selected.blocks[0].text, chapterTitle: selected.chapterTitle, anchor: selected.blocks[0].anchor, passages: [] } })
    expect(result.background).toBe('章节笔记：\na: a章摘要')
    expect(read).toHaveBeenCalledExactlyOnceWith(bookId, ['chapter-a-final'])
  })

  it('returns empty background when a selection has no relevant chapters', async () => {
    const state = setup(), bookId = state.addBook([section(0, 'first')])
    state.store.saveSummary(bookId, 'chapter-first-final', '无关章节摘要')
    const result = await context(state, { scope: 'selection', requestId: randomUUID(), conversationId: randomUUID(), action: 'ask', question: '解释原文', history: [],
      selection: { bookId, quote: '书末原文', chapterTitle: '书末', anchor: 'txt:10000:10004', passages: [] } })
    expect(result.background).toBe('')
  })

  it('keeps all summaries at the Unicode budget boundary and uses relevant chapters when exceeded', async () => {
    const state = setup(), bookId = state.addBook([section(0, 'z', '章Z'), section(1, 'a', '章A')])
    const first = '😀'.repeat(1_000), second = '𠮷'.repeat(1_491)
    state.store.saveSummary(bookId, 'chapter-z-final', first)
    state.store.saveSummary(bookId, 'chapter-a-final', second)
    expect((await context(state, request(bookId), ['a'])).background).toBe(`章节笔记：\n章Z: ${first}\n章A: ${second}`)
    state.store.saveSummary(bookId, 'chapter-a-final', second + '𠮷')
    expect((await context(state, request(bookId), ['a'])).background).toBe(`章节笔记：\n章A: ${second}𠮷`)
  })

  it('keeps summaries and source IDs isolated across books with identical chapter IDs', async () => {
    const state = setup(), shared = section(0, 'same', '相同章节')
    const ids = ['甲书', '乙书', '未选书'].map((title) => {
      const bookId = state.addBook([shared], title)
      state.store.saveNote(bookId, shared.id, note(shared))
      state.store.saveSummary(bookId, 'chapter-same-final', `${title}自己的摘要`)
      return bookId
    })
    const result = await context(state, { scope: 'books', bookIds: ids.slice(0, 2), requestId: randomUUID(), conversationId: randomUUID(), action: 'ask', question: '比较两书', history: [] })
    expect(result.background).toBe('《甲书》\n章节笔记：\n相同章节: 甲书自己的摘要\n《乙书》\n章节笔记：\n相同章节: 乙书自己的摘要')
    expect(result.passages.map((passage) => [passage.bookId, passage.blockId])).toEqual([[ids[0], 'p0'], [ids[1], 'p0']])
  })
})
