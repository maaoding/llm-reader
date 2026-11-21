import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { BookContextStore } from '../../src/main/book-context-store'
import { bookIdSchema, bookChapterNotesSchema } from '../../src/main/schemas'
import type { DocumentSection } from '../../src/shared/contracts'

const databases: AppDatabase[] = []
afterEach(() => databases.splice(0).forEach((db) => db.close()))
function fixture() {
  const database = new AppDatabase(':memory:'); databases.push(database)
  const store = new BookContextStore(database)
  const addBook = () => {
    const id = randomUUID()
    database.insertBook({ id, sha256: id.replaceAll('-', '').repeat(2), title: '笔记样本', author: null,
      format: 'txt', sourceFormat: 'txt', originalName: 'notes.txt', storedName: id + '.txt', importedAt: '2026-01-01',
      lastOpenedAt: null, lastLocator: null, progress: 0 })
    store.reset(id, randomUUID(), randomUUID(), 'mock', 'fixture')
    return id
  }
  const bookId = addBook()
  const sections: DocumentSection[] = Array.from({ length: 14 }, (_, order) => ({ id: `s${order}`, chapterId: order < 12 ? 'first' : 'second',
    chapterTitle: '同名章节', order, blocks: [{ id: `p${order}`, text: `原文 ${order}`, anchor: `txt:${order * 20}:${order * 20 + 5}`,
      kind: 'paragraph', headingPath: [order < 12 ? '上篇' : '下篇', '同名章节'] }] }))
  store.append(bookId, sections)
  const save = (index: number, sourceIds = [`p${index}`]) => store.saveNote(bookId, `s${index}`, {
    summary: `已生成笔记 ${index}`, claims: [{ text: `观点 ${index}`, sourceIds }], conditions: [], exceptions: [], concepts: []
  })
  return { database, store, bookId, addBook, save }
}
describe('existing book notes read API', () => {
  it('rejects invalid IPC inputs and extra fields', () => {
    for (const value of ['', 'other', null, {}, 12]) expect(bookIdSchema.safeParse(value).success).toBe(false)
    const bookId = randomUUID()
    for (const input of [{ bookId }, { bookId, chapterId: '' }, { bookId, chapterId: 'a', cursor: 'bad!cursor' },
      { bookId, chapterId: 'a', cursor: 'a'.repeat(4097) }, { bookId, chapterId: 'a', path: '../database' }]) {
      expect(bookChapterNotesSchema.safeParse(input).success).toBe(false)
    }
  })
  it('keeps real chapter identities and returns only existing summaries, including partial results', () => {
    const { store, bookId, save } = fixture()
    save(0); store.status(bookId, 'paused')
    const index = store.notesIndex(bookId)
    expect(index.overview).toBeNull()
    expect(index.chapters).toEqual([
      { id: 'first', title: '同名章节', headingPath: ['上篇', '同名章节'], completed: 1, total: 12 },
      { id: 'second', title: '同名章节', headingPath: ['下篇', '同名章节'], completed: 0, total: 2 }
    ])
    expect(JSON.stringify(index)).not.toContain('原文')
    expect(store.chapterNotes({ bookId, chapterId: 'second' })).toMatchObject({ summary: null, notes: [] })
    store.saveSummary(bookId, 'chapter-first-final', '真实章节汇总')
    store.db.prepare('UPDATE book_analysis SET overview = ? WHERE book_id = ?').run('真实全书概述', bookId)
    store.status(bookId, 'error')
    expect(store.notesIndex(bookId).overview).toBe('真实全书概述')
    expect(store.chapterNotes({ bookId, chapterId: 'first' })).toMatchObject({ summary: '真实章节汇总', notes: [{ id: 's0' }] })
  })
  it('paginates at ten, validates each original source and preserves page metadata', () => {
    const { store, bookId, save, addBook } = fixture()
    for (let i = 0; i < 12; i++) save(i)
    const otherBook = addBook()
    store.append(otherBook, [{ id: 'foreign', chapterId: 'first', chapterTitle: '另一书', order: 0,
      blocks: [{ id: 'foreign-p', text: '不可泄漏', anchor: 'txt:0:4', kind: 'paragraph' }] }])
    save(0, ['p0', 'p0', 'foreign-p', 'p13', 'missing'])
    const sources = [{ page: 3, anchor: 'pdfpos:3:0', precision: 'table' }, { page: 4, anchor: 'pdfpos:4:0', precision: 'table' }]
    store.db.prepare('UPDATE book_blocks SET metadata_json = ? WHERE book_id = ? AND block_id = ?')
      .run(JSON.stringify({ sources, id: 'wrong-id', text: 'wrong-text', anchor: 'wrong-anchor' }), bookId, 'p0')
    const first = store.chapterNotes({ bookId, chapterId: 'first' })
    expect(first.notes).toHaveLength(10)
    expect(first.notes[0].claims[0]).toMatchObject({ missingSources: true, sources: [{ id: 'p0', text: '原文 0', anchor: 'txt:0:5', sources }] })
    expect(first.notes[0].claims[0].sources).toHaveLength(1)
    expect(JSON.stringify(first)).not.toContain('不可泄漏')
    const last = store.chapterNotes({ bookId, chapterId: 'first', cursor: first.nextCursor })
    expect(last.notes.map((note) => note.id)).toEqual(['s10', 's11'])
    expect(last.nextCursor).toBeUndefined()
  })
  it('rejects cross-book, cross-chapter, corrupt and stale cursors after rebuild or deletion', () => {
    const { database, store, bookId, save, addBook } = fixture()
    for (let i = 0; i < 12; i++) save(i)
    const cursor = store.chapterNotes({ bookId, chapterId: 'first' }).nextCursor!
    expect(() => store.chapterNotes({ bookId: addBook(), chapterId: 'first', cursor })).toThrow()
    expect(() => store.chapterNotes({ bookId, chapterId: 'second', cursor })).toThrow()
    expect(() => store.chapterNotes({ bookId, chapterId: 'first', cursor: 'not-json' })).toThrow()
    store.resetNotes(bookId, randomUUID(), randomUUID(), 'mock', 'rebuilt')
    expect(() => store.chapterNotes({ bookId, chapterId: 'first', cursor })).toThrow()
    expect(store.chapterNotes({ bookId, chapterId: 'first' }).notes).toEqual([])
    store.prepare(bookId, randomUUID(), 'new-original')
    expect(() => store.chapterNotes({ bookId, chapterId: 'first', cursor })).toThrow()
    database.deleteBook(bookId)
    expect(() => store.notesIndex(bookId)).toThrow()
    expect(() => store.chapterNotes({ bookId, chapterId: 'first' })).toThrow()
  })
})
