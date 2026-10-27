import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { BookContextStore, searchTokens } from '../../src/main/book-context-store'
import type { DocumentBlock, DocumentSection } from '../../src/shared/contracts'

const databases: AppDatabase[] = []
afterEach(() => databases.splice(0).forEach((database) => database.close()))

function setup() {
  const database = new AppDatabase(':memory:')
  databases.push(database)
  const bookId = randomUUID(), store = new BookContextStore(database)
  database.insertBook({ id: bookId, sha256: 'a'.repeat(64), title: '入库样本', author: null, format: 'txt', sourceFormat: 'txt',
    originalName: 'fixture.txt', storedName: 'fixture.txt', importedAt: '2026-10-26', lastOpenedAt: null, lastLocator: null, progress: 0 })
  store.reset(bookId, randomUUID(), randomUUID(), 'mock', 'fixture')
  return { store, bookId }
}

function block(id: string, text = 'ＡＢＣ 从众 😀 é 𠀀𠮷'): DocumentBlock {
  const anchor = `txt:12:${12 + Array.from(text).length}`
  return { id, text, anchor, kind: 'paragraph', sources: [{ anchor, precision: 'text' }] }
}

function section(order: number, blocks: DocumentBlock[]): DocumentSection {
  return { id: `s${order}`, chapterId: `c${order}`, chapterTitle: 'Hydrology', order, blocks }
}

describe('document batch indexing', () => {
  it('normalizes searchable words while retaining repeated terms and Chinese bigrams', () => {
    const terms = searchTokens('ＡＢＣ abc １２３ 从众😀').split(' ')
    expect(terms.slice(0, 3)).toEqual(['abc', 'abc', '123'])
    expect(terms).toContain('从众')
    expect(searchTokens('𠀀𠮷')).toContain('𠀀𠮷')
    expect(searchTokens(' \n 😀 / * : () ')).toBe('')
  })

  it('preserves heading precedence, source metadata, search order and progress across batches', () => {
    const { store, bookId } = setup()
    const sections = [section(0, [
      { ...block('a'), headingPath: ['Science', 'Astronomy'] },
      { ...block('b'), headingPath: ['Science', 'Astronomy'] },
      { ...block('c'), headingPath: ['Science', 'Botany'] },
      block('fallback'),
      { ...block('empty-heading'), headingPath: [] },
      { ...block('hidden', 'hiddenonly 隐藏内容'), searchable: false }
    ]), section(1, [{ ...block('later'), headingPath: ['Science', 'Botany'] }])]
    store.db.prepare('UPDATE book_documents SET total = 12 WHERE book_id = ?').run(bookId)
    store.append(bookId, sections.slice(0, 1))
    store.append(bookId, sections.slice(1))

    expect(store.sections(bookId)).toEqual(sections.map((section) => ({ section, note: null })))
    expect(store.search(bookId, 'astronomy').map((passage) => passage.blockId)).toEqual(['a', 'b'])
    expect(store.search(bookId, 'botany').map((passage) => passage.blockId)).toEqual(['c', 'later'])
    expect(store.search(bookId, 'hydrology').map((passage) => passage.blockId)).toEqual(['fallback'])
    expect(store.search(bookId, 'hiddenonly')).toEqual([])
    expect(store.search(bookId, 'abc')).toHaveLength(6)
    expect(store.passages(bookId, ['a'])[0]).toMatchObject(sections[0].blocks[0])
    expect(store.originals(bookId).map((passage) => passage.blockId)).toEqual(['a', 'b', 'c', 'fallback', 'empty-heading', 'later'])
    expect(store.db.prepare('SELECT count(*) AS n FROM book_fts').get()).toMatchObject({ n: 6 })
    const characters = sections.flatMap((section) => section.blocks).reduce((sum, block) => sum + Array.from(block.text).length, 0)
    expect(store.document(bookId)).toMatchObject({ characters, completed: 2, total: 12 })
    expect(store.record(bookId)).toMatchObject({ characters })
  })

  it.each(['duplicate block', 'progress update'])('rolls back the entire batch after a failed %s and allows retry', (failure) => {
    const { store, bookId } = setup()
    store.append(bookId, [section(0, [block('existing', '原有证据')])])
    const snapshot = () => Object.fromEntries(['book_sections', 'book_blocks', 'book_fts', 'book_analysis', 'book_documents']
      .map((table) => [table, store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
    const previous = snapshot()
    const sections = [section(1, [block('new', 'next')]), section(2, [block('retry', 'next')])]
    if (failure === 'progress update') store.db.exec(`CREATE TRIGGER fail_index_progress BEFORE UPDATE ON book_documents
      BEGIN SELECT RAISE(ABORT, 'test progress failure'); END`)
    const failing = failure === 'duplicate block'
      ? [sections[0], { ...sections[1], blocks: [block('existing', 'next')] }] : sections
    expect(() => store.append(bookId, failing)).toThrow()
    expect(snapshot()).toEqual(previous)
    expect(store.search(bookId, 'next')).toEqual([])

    if (failure === 'progress update') store.db.exec('DROP TRIGGER fail_index_progress')
    store.append(bookId, sections)
    expect(store.search(bookId, 'next').map((passage) => passage.blockId)).toEqual(['new', 'retry'])
    expect(store.document(bookId)).toMatchObject({ completed: 3, total: 3, characters: 12 })
    expect(store.record(bookId)).toMatchObject({ characters: 12 })
  })
})
