import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { BookContextStore } from '../../src/main/book-context-store'
import { normalizeOcrPages } from '../../src/main/vision-ocr'
import { bookDocumentSearchSchema } from '../../src/main/schemas'
import { DOCUMENT_STRUCTURE_VERSION } from '../../src/shared/document-structure'

const databases: AppDatabase[] = []
afterEach(() => { for (const database of databases.splice(0)) database.close() })
function prepared(pages: string[]) {
  const database = new AppDatabase(':memory:'); databases.push(database)
  const bookId = randomUUID(), store = new BookContextStore(database)
  database.insertBook({ id: bookId, sha256: 'a'.repeat(64), title: '扫描书', author: null, format: 'pdf', sourceFormat: 'pdf', originalName: 'scan.pdf', storedName: 'scan.pdf', importedAt: '2026-01-01', lastOpenedAt: null, lastLocator: null, progress: 0 })
  store.prepare(bookId, randomUUID(), 'fixture')
  store.cacheDocument(bookId, normalizeOcrPages(pages), pages.length)
  database.connection.prepare("UPDATE book_documents SET status = 'ready' WHERE book_id = ?").run(bookId)
  return { database, store, bookId }
}

it('searches cached OCR literally, handles Unicode and returns the actual page', async () => {
  const { store, bookId } = prepared(['前言没有目标。', '目标 A+B 😀 独立复核是必要条件。', '第二次独立复核。'])
  expect(await store.searchDocument(bookId, 'a+b')).toEqual({ available: true, results: [{ anchor: 'pdfpos:2:0', chapterTitle: '第 2 页', excerpt: '目标 A+B 😀 独立复核是必要条件。' }] })
  expect((await store.searchDocument(bookId, '独立复核')).results.map((item) => item.anchor)).toEqual(['pdfpos:2:0', 'pdfpos:3:0'])
  expect((await store.searchDocument(bookId, '😀')).results).toHaveLength(1)
  expect(await store.searchDocument(bookId, '不存在')).toEqual({ available: true, results: [] })
})

it('bounds results and rejects missing, incomplete or outdated prepared text', async () => {
  const { store, database, bookId } = prepared(['测试 '.repeat(250)])
  expect((await store.searchDocument(bookId, '测试')).results).toHaveLength(200)
  for (const status of ['preparing', 'paused', 'error']) {
    database.connection.prepare('UPDATE book_documents SET status = ?').run(status)
    expect(await store.searchDocument(bookId, '测试')).toEqual({ available: false, results: [] })
  }
  database.connection.prepare("UPDATE book_documents SET status = 'ready', version = ?").run(DOCUMENT_STRUCTURE_VERSION - 1)
  expect((await store.searchDocument(bookId, '测试')).available).toBe(false)
  database.connection.exec('DELETE FROM book_documents')
  expect((await store.searchDocument(bookId, '测试')).available).toBe(false)
  await expect(store.searchDocument(randomUUID(), '测试')).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  for (const query of ['', '  ', '😀'.repeat(101)]) expect(bookDocumentSearchSchema.safeParse({ bookId, query }).success).toBe(false)
  expect(bookDocumentSearchSchema.safeParse({ bookId, query: '😀'.repeat(100) }).success).toBe(true)
})
