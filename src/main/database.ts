import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite'
import type {
  ArchivedChatMessage,
  BookFormat,
  BookRecord,
  BookSourceFormat,
  HighlightRecord,
  SavedInsight,
  SaveHighlightInput,
  SaveInsightInput,
  UpdateInsightHistoryInput
} from '@shared/contracts'

interface BookRow {
  id: string
  sha256: string
  title: string
  author: string | null
  format: BookFormat
  source_format: BookSourceFormat
  original_name: string
  stored_name: string
  imported_at: string
  last_opened_at: string | null
  last_locator: string | null
  progress: number
}

interface InsightRow {
  id: string
  book_id: string
  selection_json: string
  question: string
  answer: string
  model: string
  created_at: string
  history_json: string
}

interface HighlightRow {
  id: string
  book_id: string
  quote: string
  anchor: string
  chapter_title: string
  created_at: string
}

interface ProviderRow {
  base_url: string
  model: string
}

const migrations = [
  `
    CREATE TABLE books (
      id TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL UNIQUE CHECK(length(sha256) = 64),
      title TEXT NOT NULL,
      author TEXT,
      format TEXT NOT NULL CHECK(format IN ('epub', 'txt')),
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL UNIQUE,
      imported_at TEXT NOT NULL,
      last_opened_at TEXT,
      last_locator TEXT,
      progress REAL NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 1)
    ) STRICT;

    CREATE TABLE insights (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      selection_json TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX insights_book_created_idx ON insights(book_id, created_at DESC);

    CREATE TABLE provider_settings (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      base_url TEXT NOT NULL,
      model TEXT NOT NULL
    ) STRICT;
  `,
  `
    CREATE TABLE provider_settings_v2 (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      base_url TEXT NOT NULL,
      model TEXT NOT NULL
    ) STRICT;
    INSERT INTO provider_settings_v2(singleton, base_url, model)
      SELECT singleton, base_url, model FROM provider_settings;
    DROP TABLE provider_settings;
    ALTER TABLE provider_settings_v2 RENAME TO provider_settings;
  `,
    `
      CREATE TABLE bookmarks (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        locator TEXT NOT NULL,
        chapter_title TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(book_id, locator)
      ) STRICT;

      CREATE INDEX bookmarks_book_created_idx ON bookmarks(book_id, created_at DESC);
    `,
    `
      DROP TABLE bookmarks;

      CREATE TABLE highlights (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        quote TEXT NOT NULL,
        anchor TEXT NOT NULL,
        chapter_title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(book_id, anchor)
      ) STRICT;

      CREATE INDEX highlights_book_created_idx ON highlights(book_id, created_at DESC);
    `,
    `
      ALTER TABLE insights ADD COLUMN history_json TEXT NOT NULL DEFAULT '[]';
    `,
    `
      ALTER TABLE books ADD COLUMN source_format TEXT NOT NULL DEFAULT 'epub'
        CHECK(source_format IN ('epub', 'txt', 'mobi', 'azw3'));
      UPDATE books SET source_format = format;
    `
] as const

function asBookRow(row: Record<string, SQLOutputValue> | undefined): BookRow | undefined {
  return row as unknown as BookRow | undefined
}

function mapBook(row: BookRow): BookRecord {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    format: row.format,
    sourceFormat: row.source_format,
    originalName: row.original_name,
    importedAt: row.imported_at,
    lastOpenedAt: row.last_opened_at,
    lastLocator: row.last_locator,
    progress: row.progress
  }
}

function publicBook(book: StoredBook): BookRecord {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    format: book.format,
    sourceFormat: book.sourceFormat,
    originalName: book.originalName,
    importedAt: book.importedAt,
    lastOpenedAt: book.lastOpenedAt,
    lastLocator: book.lastLocator,
    progress: book.progress
  }
}

function parseInsightHistory(value: string | null | undefined): ArchivedChatMessage[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((message): message is ArchivedChatMessage => {
      if (!message || typeof message !== 'object') return false
      const candidate = message as Record<string, unknown>
      return (
        (candidate.role === 'user' || candidate.role === 'assistant') &&
        typeof candidate.content === 'string' &&
        candidate.content.length > 0 &&
        (candidate.model === undefined || typeof candidate.model === 'string')
      )
    })
  } catch {
    return []
  }
}

function insightHistory(question: string, answer: string, model: string): ArchivedChatMessage[] {
  return [
    { role: 'user', content: question },
    { role: 'assistant', content: answer, model }
  ]
}

export interface StoredBook extends BookRecord {
  sha256: string
  storedName: string
}

export class AppDatabase {
  readonly connection: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true })
    }

    this.connection = new DatabaseSync(path, {
      allowExtension: false,
      enableForeignKeyConstraints: true,
      timeout: 5_000
    })
    this.connection.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    this.migrate()
  }

  private migrate(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
    `)

    const current = this.connection
      .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
      .get()?.version
    const currentVersion = typeof current === 'number' ? current : 0

    migrations.forEach((sql, index) => {
      const version = index + 1
      if (version <= currentVersion) return

      this.connection.exec('BEGIN IMMEDIATE')
      try {
        this.connection.exec(sql)
        this.connection
          .prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
          .run(version, new Date().toISOString())
        this.connection.exec('COMMIT')
      } catch (error) {
        this.connection.exec('ROLLBACK')
        throw error
      }
    })
  }

  close(): void {
    this.connection.close()
  }

  listBooks(): BookRecord[] {
    const rows = this.connection
      .prepare('SELECT * FROM books ORDER BY COALESCE(last_opened_at, imported_at) DESC')
      .all() as unknown as BookRow[]
    return rows.map(mapBook)
  }

  findBookByHash(sha256: string): StoredBook | null {
    const row = asBookRow(this.connection.prepare('SELECT * FROM books WHERE sha256 = ?').get(sha256))
    return row ? { ...mapBook(row), sha256: row.sha256, storedName: row.stored_name } : null
  }

  getStoredBook(id: string): StoredBook | null {
    const row = asBookRow(this.connection.prepare('SELECT * FROM books WHERE id = ?').get(id))
    return row ? { ...mapBook(row), sha256: row.sha256, storedName: row.stored_name } : null
  }

  insertBook(book: StoredBook): BookRecord {
    this.connection
      .prepare(
        `INSERT INTO books(
          id, sha256, title, author, format, source_format, original_name, stored_name,
          imported_at, last_opened_at, last_locator, progress
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        book.id,
        book.sha256,
        book.title,
        book.author,
        book.format,
        book.sourceFormat,
        book.originalName,
        book.storedName,
        book.importedAt,
        book.lastOpenedAt,
        book.lastLocator,
        book.progress
      )
    return publicBook(book)
  }

  touchBook(id: string, openedAt: string): void {
    this.connection.prepare('UPDATE books SET last_opened_at = ? WHERE id = ?').run(openedAt, id)
  }

  updateBookMetadata(id: string, title: string, author: string | null): BookRecord | null {
    const result = this.connection
      .prepare('UPDATE books SET title = ?, author = ? WHERE id = ?')
      .run(title, author, id)
    if (result.changes === 0) return null
    const row = asBookRow(this.connection.prepare('SELECT * FROM books WHERE id = ?').get(id))
    return row ? mapBook(row) : null
  }

  updateBookProgress(id: string, locator: string, progress: number, openedAt: string): boolean {
    const result = this.connection
      .prepare('UPDATE books SET last_locator = ?, progress = ?, last_opened_at = ? WHERE id = ?')
      .run(locator, progress, openedAt, id)
    return result.changes > 0
  }

  listInsights(bookId: string): SavedInsight[] {
    const rows = this.connection
      .prepare('SELECT * FROM insights WHERE book_id = ? ORDER BY created_at DESC')
      .all(bookId) as unknown as InsightRow[]

    return rows.map((row) => ({
      id: row.id,
      bookId: row.book_id,
      selection: JSON.parse(row.selection_json) as SavedInsight['selection'],
      question: row.question,
      answer: row.answer,
      model: row.model,
      createdAt: row.created_at,
      history: parseInsightHistory(row.history_json)
    }))
  }

  insertInsight(id: string, input: SaveInsightInput, createdAt: string): SavedInsight {
    const history = insightHistory(input.question, input.answer, input.model)
    this.connection
      .prepare(
        `INSERT INTO insights(
          id, book_id, selection_json, question, answer, model, created_at, history_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.bookId,
        JSON.stringify(input.selection),
        input.question,
        input.answer,
        input.model,
        createdAt,
        JSON.stringify(history)
      )

    return { id, ...input, createdAt, history }
  }

  updateInsightHistory(id: string, input: UpdateInsightHistoryInput): SavedInsight | null {
    const result = this.connection
      .prepare('UPDATE insights SET history_json = ? WHERE id = ? AND book_id = ?')
      .run(JSON.stringify(input.history), id, input.bookId)
    if (result.changes === 0) return null
    const row = this.connection
      .prepare('SELECT * FROM insights WHERE id = ?')
      .get(id) as unknown as InsightRow | undefined
    if (!row) return null
    return {
      id: row.id,
      bookId: row.book_id,
      selection: JSON.parse(row.selection_json) as SavedInsight['selection'],
      question: row.question,
      answer: row.answer,
      model: row.model,
      createdAt: row.created_at,
      history: parseInsightHistory(row.history_json)
    }
  }

  deleteInsight(id: string): boolean {
    const result = this.connection.prepare('DELETE FROM insights WHERE id = ?').run(id)
    return result.changes > 0
  }

  listHighlights(bookId: string): HighlightRecord[] {
    const rows = this.connection
      .prepare('SELECT * FROM highlights WHERE book_id = ? ORDER BY created_at DESC')
      .all(bookId) as unknown as HighlightRow[]

    return rows.map((row) => ({
      id: row.id,
      bookId: row.book_id,
      quote: row.quote,
      anchor: row.anchor,
      chapterTitle: row.chapter_title,
      createdAt: row.created_at
    }))
  }

  findHighlightByAnchor(bookId: string, anchor: string): HighlightRecord | null {
    const row = this.connection
      .prepare('SELECT * FROM highlights WHERE book_id = ? AND anchor = ?')
      .get(bookId, anchor) as unknown as HighlightRow | undefined
    if (!row) return null
    return {
      id: row.id,
      bookId: row.book_id,
      quote: row.quote,
      anchor: row.anchor,
      chapterTitle: row.chapter_title,
      createdAt: row.created_at
    }
  }

  insertHighlight(id: string, input: SaveHighlightInput, createdAt: string): HighlightRecord {
    this.connection
      .prepare(
        `INSERT INTO highlights(
          id, book_id, quote, anchor, chapter_title, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.bookId, input.quote, input.anchor, input.chapterTitle, createdAt)

    return { id, ...input, createdAt }
  }

  deleteHighlight(id: string): boolean {
    const result = this.connection.prepare('DELETE FROM highlights WHERE id = ?').run(id)
    return result.changes > 0
  }

  getProvider(): { baseUrl: string; model: string } | null {
    const row = this.connection
      .prepare('SELECT base_url, model FROM provider_settings WHERE singleton = 1')
      .get() as unknown as ProviderRow | undefined
    if (!row) return null
    return {
      baseUrl: row.base_url,
      model: row.model
    }
  }

  saveProvider(baseUrl: string, model: string): void {
    this.connection
      .prepare(
        `INSERT INTO provider_settings(singleton, base_url, model)
         VALUES (1, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           base_url = excluded.base_url,
           model = excluded.model`
      )
      .run(baseUrl, model)
  }
}
