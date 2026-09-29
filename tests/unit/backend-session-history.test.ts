import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { removeWebSearchSchema } from './support/legacy-web-search'
import type { BookSessionRecord } from '../../src/shared/contracts'

function addBook(database: AppDatabase): string {
  const id = randomUUID()
  database.insertBook({ id, sha256: id.replaceAll('-', '').repeat(2), title: '会话样本', author: null, format: 'txt', sourceFormat: 'txt', originalName: 'sample.txt', storedName: id + '.txt', importedAt: '2026-01-01', lastOpenedAt: null, lastLocator: null, progress: 0 })
  return id
}
function session(bookId: string, index: number): BookSessionRecord {
  return { bookId, conversationId: randomUUID(), scope: 'book', selection: null, draft: `草稿 ${index}`, turns: [], updatedAt: new Date(1_800_000_000_000 + index * 1000).toISOString() }
}

it('keeps bounded per-book history across restart, preserves IDs and deletes only the requested session', () => {
  const root = mkdtempSync(join(tmpdir(), 'reader-session-history-'))
  let database = new AppDatabase(join(root, 'reader.sqlite'))
  try {
    const firstBook = addBook(database), secondBook = addBook(database)
    const records = Array.from({ length: 23 }, (_, i) => session(firstBook, i))
    records.forEach((record) => database.upsertBookSession(record))
    const other = session(secondBook, 50); database.upsertBookSession(other)
    expect(database.listRecentBookSessions(firstBook)).toHaveLength(20)
    expect(database.getRecentBookSession(firstBook, records[0].conversationId)).toBeNull()
    expect(database.getRecentBookSession(secondBook, records[22].conversationId)).toBeNull()
    const resumed = { ...records[3], draft: '恢复后续写', updatedAt: records[22].updatedAt }
    database.upsertBookSession(resumed)
    database.close(); database = new AppDatabase(join(root, 'reader.sqlite'))
    expect(database.getBookSession(firstBook)).toEqual(resumed)
    expect(database.getRecentBookSession(firstBook, records[22].conversationId)).toEqual(records[22])
    // Clearing an older conversation must not delete a newer current conversation.
    expect(database.deleteBookSession(firstBook, records[22].conversationId)).toBe(true)
    expect(database.getBookSession(firstBook)).toEqual(resumed)
    expect(database.deleteBookSession(firstBook, resumed.conversationId)).toBe(true)
    expect(database.getBookSession(firstBook)).toBeNull()
    expect(database.getRecentBookSession(firstBook, resumed.conversationId)).toBeNull()
    expect(database.listRecentBookSessions(firstBook)).toHaveLength(18)
    expect(database.getBookSession(secondBook)).toEqual(other)
    database.connection.prepare('DELETE FROM books WHERE id = ?').run(firstBook)
    expect(database.listRecentBookSessions(firstBook)).toEqual([])
    expect(database.listRecentBookSessions(secondBook)).toHaveLength(1)
  } finally { database.close(); rmSync(root, { recursive: true, force: true }) }
})

it('migrates the existing current conversation without losing its draft, answers or identifier', () => {
  const root = mkdtempSync(join(tmpdir(), 'reader-session-upgrade-'))
  let database = new AppDatabase(join(root, 'reader.sqlite'))
  try {
    const bookId = addBook(database)
    const record = { ...session(bookId, 1), turns: [{ id: randomUUID(), action: 'ask' as const, actionLabel: '提问', question: '旧问题', answer: '旧回答', model: 'fixture', status: 'completed' as const }] }
    database.upsertBookSession(record)
    removeWebSearchSchema(database)
    database.connection.exec('DROP TABLE book_session_history; DROP TABLE ocr_page_previews; ALTER TABLE book_sessions DROP COLUMN persona_json; ALTER TABLE insights DROP COLUMN persona_json; DELETE FROM schema_migrations WHERE version >= 18')
    database.close(); database = new AppDatabase(join(root, 'reader.sqlite'))
    expect(database.getBookSession(bookId)).toEqual(record)
    expect(database.getRecentBookSession(bookId, record.conversationId)).toEqual(record)
    expect(database.listRecentBookSessions(bookId)).toEqual([{ conversationId: record.conversationId, scope: 'book', title: '旧问题', turnCount: 1, updatedAt: record.updatedAt }])
  } finally { database.close(); rmSync(root, { recursive: true, force: true }) }
})

it('keeps session and archived-answer persona snapshots after preset changes and restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'reader-persona-history-'))
  let database = new AppDatabase(join(root, 'reader.sqlite'))
  try {
    const bookId = addBook(database)
    const first = { presetId: randomUUID(), name: '社科导师', prompt: '先解释概念。' }
    const second = { presetId: first.presetId, name: '社科导师', prompt: '先解释论证。' }
    const old = { ...session(bookId, 1), persona: first, turns: [{ id: randomUUID(), action: 'ask' as const, actionLabel: '提问', question: '问题', answer: '回答', model: 'fixture', status: 'completed' as const, persona: first }] }
    database.upsertBookSession(old)
    const current = { ...old, persona: second, updatedAt: session(bookId, 2).updatedAt }
    database.upsertBookSession(current)
    const archived = database.insertInsight(randomUUID(), { bookId, selection: null, question: '问题', answer: '回答', model: 'fixture', persona: first }, new Date().toISOString())
    database.close(); database = new AppDatabase(join(root, 'reader.sqlite'))
    expect(database.getBookSession(bookId)?.persona).toEqual(second)
    expect(database.getRecentBookSession(bookId, old.conversationId)?.turns[0].persona).toEqual(first)
    expect(database.listInsights(bookId)[0]).toMatchObject({ id: archived.id, persona: first, history: [{ role: 'user' }, { role: 'assistant', persona: first }] })
    const history = database.listInsights(bookId)[0].history
    const updated = database.updateInsightHistory(archived.id, { bookId, id: archived.id, history, persona: second })
    expect(updated?.persona).toEqual(second)
    expect(updated?.history[1].persona).toEqual(first)
  } finally { database.close(); rmSync(root, { recursive: true, force: true }) }
})
