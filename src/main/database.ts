import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite'
import { RECENT_BOOK_SESSION_LIMIT, type BookSessionSummary } from '@shared/contracts'
import type {
  ArchivedChatMessage,
  BookFormat,
  BookRecord,
  BookSessionRecord,
  BookSessionTurn,
  BookSourceFormat,
  HighlightRecord,
  InsightArchiveRecord,
  InsightBookRef,
  SavedInsight,
  SaveHighlightInput,
  ProviderCompatibility,
  ProviderProtocol,
  SaveInsightInput,
  SelectionContext,
  SessionTabRecord,
  SessionTabsState,
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
  conversation_id: string
  book_id: string
  selection_json: string
  question: string
  answer: string
  model: string
  created_at: string
  history_json: string
  context_json: string | null
}

interface InsightArchiveRow extends InsightRow {
  book_title: string
  book_author: string | null
  book_format: BookFormat
}

interface BookSessionRow {
  book_id: string
  conversation_id: string
  scope: 'selection' | 'book'
  selection_json: string | null
  draft: string
  turns_json: string
  updated_at: string
}

interface SessionTabRow {
  position: number
  kind: 'live' | 'archive'
  book_id: string
  insight_id: string | null
  draft: string
  is_active: number
}

interface HighlightRow {
  id: string
  book_id: string
  quote: string
  anchor: string
  chapter_title: string
  created_at: string
}

export interface ProviderProfileRecord {
  id: string
  name: string
  base_url: string
  model: string
  is_active: number
  created_at: string
  updated_at: string
  compatibility: ProviderCompatibility
  protocol?: ProviderProtocol
  request_json?: string
  headers_secret?: Uint8Array | null
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
    `,
    `
      CREATE TABLE books_v2 (
        id TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL UNIQUE CHECK(length(sha256) = 64),
        title TEXT NOT NULL,
        author TEXT,
        format TEXT NOT NULL CHECK(format IN ('epub', 'txt', 'pdf')),
        original_name TEXT NOT NULL,
        stored_name TEXT NOT NULL UNIQUE,
        imported_at TEXT NOT NULL,
        last_opened_at TEXT,
        last_locator TEXT,
        progress REAL NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 1),
        source_format TEXT NOT NULL DEFAULT 'epub'
          CHECK(source_format IN ('epub', 'txt', 'mobi', 'azw3', 'pdf'))
      ) STRICT;

      INSERT INTO books_v2(
        id, sha256, title, author, format, original_name, stored_name,
        imported_at, last_opened_at, last_locator, progress, source_format
      )
      SELECT
        id, sha256, title, author, format, original_name, stored_name,
        imported_at, last_opened_at, last_locator, progress, source_format
      FROM books;

      CREATE TABLE insights_v2 (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES books_v2(id) ON DELETE CASCADE,
        selection_json TEXT NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at TEXT NOT NULL,
        history_json TEXT NOT NULL DEFAULT '[]'
      ) STRICT;

      INSERT INTO insights_v2(
        id, book_id, selection_json, question, answer, model, created_at, history_json
      )
      SELECT id, book_id, selection_json, question, answer, model, created_at, history_json
      FROM insights;

      CREATE TABLE highlights_v2 (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES books_v2(id) ON DELETE CASCADE,
        quote TEXT NOT NULL,
        anchor TEXT NOT NULL,
        chapter_title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(book_id, anchor)
      ) STRICT;

      INSERT INTO highlights_v2(id, book_id, quote, anchor, chapter_title, created_at)
      SELECT id, book_id, quote, anchor, chapter_title, created_at FROM highlights;

      DROP TABLE insights;
      DROP TABLE highlights;
      DROP TABLE books;
      ALTER TABLE books_v2 RENAME TO books;
      ALTER TABLE insights_v2 RENAME TO insights;
      ALTER TABLE highlights_v2 RENAME TO highlights;
      CREATE INDEX insights_book_created_idx ON insights(book_id, created_at DESC);
      CREATE INDEX highlights_book_created_idx ON highlights(book_id, created_at DESC);
    `,
    `
      CREATE TABLE provider_profiles (
        id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
        name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(name) BETWEEN 1 AND 60),
        base_url TEXT NOT NULL,
        model TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX provider_profiles_single_active_idx
        ON provider_profiles(is_active) WHERE is_active = 1;

      INSERT INTO provider_profiles(
        id, name, base_url, model, is_active, created_at, updated_at
      )
      SELECT
        'legacy', '现有配置', base_url, model, 1,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM provider_settings
      WHERE singleton = 1;

      DROP TABLE provider_settings;
    `,
    `
      ALTER TABLE insights ADD COLUMN context_json TEXT;
      CREATE TABLE book_analysis (
        book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
        job_id TEXT NOT NULL, fingerprint TEXT NOT NULL, profile_id TEXT NOT NULL,
        model TEXT NOT NULL, status TEXT NOT NULL, extraction_done INTEGER NOT NULL DEFAULT 0,
        characters INTEGER NOT NULL DEFAULT 0, usage_json TEXT, message TEXT, overview TEXT
      ) STRICT;
      CREATE TABLE book_sections (
        book_id TEXT NOT NULL REFERENCES book_analysis(book_id) ON DELETE CASCADE,
        section_id TEXT NOT NULL, chapter_id TEXT NOT NULL, chapter_title TEXT NOT NULL,
        ordinal INTEGER NOT NULL, content_json TEXT NOT NULL, note_json TEXT,
        PRIMARY KEY(book_id, section_id), UNIQUE(book_id, ordinal)
      ) STRICT;
      CREATE TABLE book_blocks (
        id INTEGER PRIMARY KEY, book_id TEXT NOT NULL REFERENCES book_analysis(book_id) ON DELETE CASCADE,
        block_id TEXT NOT NULL, section_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
        chapter_title TEXT NOT NULL, ordinal INTEGER NOT NULL, text TEXT NOT NULL, anchor TEXT NOT NULL,
        UNIQUE(book_id, block_id)
      ) STRICT;
      CREATE VIRTUAL TABLE book_fts USING fts5(title, body, aliases, tokenize='unicode61');
      CREATE TRIGGER book_blocks_delete AFTER DELETE ON book_blocks BEGIN
        DELETE FROM book_fts WHERE rowid = old.id;
      END;
      CREATE TABLE book_summaries (
        book_id TEXT NOT NULL REFERENCES book_analysis(book_id) ON DELETE CASCADE,
        node_id TEXT NOT NULL, summary TEXT NOT NULL, PRIMARY KEY(book_id, node_id)
      ) STRICT;
    `,
    `
      ALTER TABLE provider_profiles ADD COLUMN compatibility TEXT NOT NULL DEFAULT 'auto'
        CHECK(compatibility IN ('auto', 'opencode-go'));
      ALTER TABLE insights ADD COLUMN conversation_id TEXT;
      ALTER TABLE book_analysis ADD COLUMN session_id TEXT;
    `,
    `
      ALTER TABLE book_analysis ADD COLUMN progress_json TEXT;
      CREATE TABLE book_analysis_failures (
        id INTEGER PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES book_analysis(book_id) ON DELETE CASCADE,
        node_id TEXT NOT NULL,
        failure_json TEXT NOT NULL
      ) STRICT;
      CREATE INDEX book_analysis_failures_book ON book_analysis_failures(book_id, id);
    `,
    `
      CREATE TABLE knowledge_settings (
        kind TEXT PRIMARY KEY CHECK(kind IN ('embedding', 'document')),
        config_json TEXT NOT NULL, secret BLOB, revision TEXT NOT NULL
      ) STRICT;
      CREATE TABLE semantic_indexes (
        book_id TEXT PRIMARY KEY REFERENCES book_analysis(book_id) ON DELETE CASCADE,
        fingerprint TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL,
        dimension INTEGER, message TEXT
      ) STRICT;
      CREATE TABLE book_vectors (
        block_rowid INTEGER PRIMARY KEY REFERENCES book_blocks(id) ON DELETE CASCADE,
        book_id TEXT NOT NULL REFERENCES semantic_indexes(book_id) ON DELETE CASCADE,
        vector BLOB NOT NULL
      ) STRICT;
      CREATE INDEX book_vectors_book ON book_vectors(book_id);
      CREATE TABLE document_jobs (
        book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
        fingerprint TEXT NOT NULL, task_id TEXT NOT NULL, result_json TEXT
      ) STRICT;
    `,
    `
      CREATE TABLE knowledge_settings_rerank (
        kind TEXT PRIMARY KEY CHECK(kind IN ('embedding', 'document', 'rerank')),
        config_json TEXT NOT NULL, secret BLOB, revision TEXT NOT NULL
      ) STRICT;
      INSERT INTO knowledge_settings_rerank(kind, config_json, secret, revision)
        SELECT kind, config_json, secret, revision FROM knowledge_settings;
      DROP TABLE knowledge_settings;
      ALTER TABLE knowledge_settings_rerank RENAME TO knowledge_settings;
    `,
    `
      CREATE TABLE IF NOT EXISTS book_documents (
        book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
        job_id TEXT NOT NULL, fingerprint TEXT NOT NULL, embedding_identity TEXT NOT NULL,
        version INTEGER NOT NULL, status TEXT NOT NULL, characters INTEGER NOT NULL DEFAULT 0,
        completed INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
        message TEXT, document_json TEXT, diagnostics_json TEXT NOT NULL DEFAULT '[]'
      ) STRICT;
      INSERT OR IGNORE INTO book_documents(book_id, job_id, fingerprint, embedding_identity, version, status, characters, completed, total)
        SELECT book_id, job_id, fingerprint, fingerprint, 1,
          CASE WHEN extraction_done = 1 THEN 'ready' ELSE 'paused' END, characters,
          (SELECT count(*) FROM book_sections s WHERE s.book_id = a.book_id),
          (SELECT count(*) FROM book_sections s WHERE s.book_id = a.book_id) FROM book_analysis a;
      CREATE TABLE book_sections_document (
        book_id TEXT NOT NULL REFERENCES book_documents(book_id) ON DELETE CASCADE,
        section_id TEXT NOT NULL, chapter_id TEXT NOT NULL, chapter_title TEXT NOT NULL,
        ordinal INTEGER NOT NULL, content_json TEXT NOT NULL, note_json TEXT,
        PRIMARY KEY(book_id, section_id), UNIQUE(book_id, ordinal)
      ) STRICT;
      INSERT INTO book_sections_document SELECT * FROM book_sections;
      CREATE TABLE book_blocks_document (
        id INTEGER PRIMARY KEY, book_id TEXT NOT NULL REFERENCES book_documents(book_id) ON DELETE CASCADE,
        block_id TEXT NOT NULL, section_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
        chapter_title TEXT NOT NULL, ordinal INTEGER NOT NULL, text TEXT NOT NULL, anchor TEXT NOT NULL,
        metadata_json TEXT, searchable INTEGER NOT NULL DEFAULT 1,
        UNIQUE(book_id, block_id)
      ) STRICT;
      INSERT INTO book_blocks_document(id, book_id, block_id, section_id, chapter_id, chapter_title, ordinal, text, anchor)
        SELECT id, book_id, block_id, section_id, chapter_id, chapter_title, ordinal, text, anchor FROM book_blocks;
      CREATE TABLE semantic_indexes_document (
        book_id TEXT PRIMARY KEY REFERENCES book_documents(book_id) ON DELETE CASCADE,
        fingerprint TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL,
        dimension INTEGER, message TEXT
      ) STRICT;
      INSERT INTO semantic_indexes_document SELECT * FROM semantic_indexes;
      CREATE TABLE book_vectors_document (
        block_rowid INTEGER PRIMARY KEY REFERENCES book_blocks_document(id) ON DELETE CASCADE,
        book_id TEXT NOT NULL REFERENCES semantic_indexes_document(book_id) ON DELETE CASCADE,
        vector BLOB NOT NULL
      ) STRICT;
      INSERT INTO book_vectors_document SELECT * FROM book_vectors;
      DROP TABLE book_vectors;
      DROP TABLE semantic_indexes;
      DROP TRIGGER book_blocks_delete;
      DROP TABLE book_blocks;
      DROP TABLE book_sections;
      ALTER TABLE book_sections_document RENAME TO book_sections;
      ALTER TABLE book_blocks_document RENAME TO book_blocks;
      ALTER TABLE semantic_indexes_document RENAME TO semantic_indexes;
      ALTER TABLE book_vectors_document RENAME TO book_vectors;
      CREATE INDEX book_vectors_book ON book_vectors(book_id);
      CREATE INDEX book_blocks_document_order ON book_blocks(book_id, ordinal);
      CREATE TRIGGER book_blocks_delete AFTER DELETE ON book_blocks BEGIN
        DELETE FROM book_fts WHERE rowid = old.id;
      END;
      ALTER TABLE document_jobs ADD COLUMN raw_json TEXT;
      ALTER TABLE document_jobs ADD COLUMN structure_json TEXT;
    `,
    `
      CREATE TABLE IF NOT EXISTS book_sessions (
        book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL,
        scope TEXT NOT NULL CHECK(scope IN ('selection', 'book')),
        selection_json TEXT,
        draft TEXT NOT NULL DEFAULT '',
        turns_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      ) STRICT;
    `,
    `
      CREATE TABLE IF NOT EXISTS session_tabs (
        position INTEGER PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('live', 'archive')),
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        insight_id TEXT REFERENCES insights(id) ON DELETE CASCADE,
        draft TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 0
      ) STRICT;
    `,
    `
      ALTER TABLE provider_profiles ADD COLUMN protocol TEXT NOT NULL DEFAULT 'openai' CHECK(protocol IN ('openai', 'anthropic'));
      ALTER TABLE provider_profiles ADD COLUMN request_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE provider_profiles ADD COLUMN headers_secret BLOB;
      ALTER TABLE knowledge_settings ADD COLUMN headers_secret BLOB;
    `,
    `
      CREATE TABLE book_session_history (
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL,
        scope TEXT NOT NULL CHECK(scope IN ('selection', 'book')),
        selection_json TEXT,
        draft TEXT NOT NULL DEFAULT '',
        turns_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (book_id, conversation_id)
      ) STRICT;
      CREATE INDEX book_session_history_recent ON book_session_history(book_id, updated_at DESC);
      INSERT INTO book_session_history SELECT * FROM book_sessions;
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

function parseSessionSelection(value: string | null): SelectionContext | null {
  if (!value) return null
  try {
    return JSON.parse(value) as SelectionContext
  } catch {
    return null
  }
}

function parseSessionTurns(value: string | null | undefined): BookSessionTurn[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((turn): turn is BookSessionTurn => {
      if (!turn || typeof turn !== 'object') return false
      const candidate = turn as Record<string, unknown>
      return (
        typeof candidate.id === 'string' &&
        (candidate.action === 'explain' || candidate.action === 'context' || candidate.action === 'ask') &&
        typeof candidate.actionLabel === 'string' &&
        typeof candidate.question === 'string' &&
        typeof candidate.answer === 'string' &&
        typeof candidate.model === 'string' &&
        (candidate.status === 'completed' || candidate.status === 'error')
      )
    })
  } catch {
    return []
  }
}

function mapBookSession(row: BookSessionRow): BookSessionRecord {
  return {
    bookId: row.book_id,
    conversationId: row.conversation_id,
    scope: row.scope,
    selection: parseSessionSelection(row.selection_json),
    draft: row.draft,
    turns: parseSessionTurns(row.turns_json),
    updatedAt: row.updated_at
  }
}

function mapSessionTab(row: SessionTabRow): SessionTabRecord {
  return {
    kind: row.kind,
    bookId: row.book_id,
    insightId: row.insight_id,
    draft: row.draft
  }
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
        if (version === 10) {
          for (const row of this.connection.prepare('SELECT id FROM insights WHERE conversation_id IS NULL').all()) {
            this.connection.prepare('UPDATE insights SET conversation_id = ? WHERE id = ?').run(randomUUID(), row.id)
          }
          for (const row of this.connection.prepare('SELECT book_id FROM book_analysis WHERE session_id IS NULL').all()) {
            this.connection.prepare('UPDATE book_analysis SET session_id = ? WHERE book_id = ?').run(randomUUID(), row.book_id)
          }
        }
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

  deleteBook(id: string): boolean {
    const result = this.connection.prepare('DELETE FROM books WHERE id = ?').run(id)
    return result.changes > 0
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
      conversationId: row.conversation_id,
      bookId: row.book_id,
      selection: JSON.parse(row.selection_json) as SavedInsight['selection'],
      context: row.context_json ? JSON.parse(row.context_json) as SavedInsight['context'] : undefined,
      question: row.question,
      answer: row.answer,
      model: row.model,
      createdAt: row.created_at,
      history: parseInsightHistory(row.history_json)
    }))
  }

  listAllInsights(): InsightArchiveRecord[] {
    const rows = this.connection
      .prepare(
        `SELECT insights.*, books.title AS book_title, books.author AS book_author, books.format AS book_format
         FROM insights
         JOIN books ON books.id = insights.book_id
         ORDER BY insights.created_at DESC`
      )
      .all() as unknown as InsightArchiveRow[]

    return rows.map((row) => {
      const book: InsightBookRef = {
        id: row.book_id,
        title: row.book_title,
        author: row.book_author,
        format: row.book_format
      }
      return {
        id: row.id,
        conversationId: row.conversation_id,
        bookId: row.book_id,
        book,
        selection: JSON.parse(row.selection_json) as SavedInsight['selection'],
        context: row.context_json ? JSON.parse(row.context_json) as SavedInsight['context'] : undefined,
        question: row.question,
        answer: row.answer,
        model: row.model,
        createdAt: row.created_at,
        history: parseInsightHistory(row.history_json)
      }
    })
  }

  insertInsight(id: string, input: SaveInsightInput, createdAt: string): SavedInsight {
    const conversationId = input.conversationId ?? randomUUID()
    const history = insightHistory(input.question, input.answer, input.model)
    if (input.context) history[1].context = input.context
    this.connection
      .prepare(
        `INSERT INTO insights(
          id, book_id, selection_json, question, answer, model, created_at, history_json, context_json, conversation_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.bookId,
        JSON.stringify(input.selection),
        input.question,
        input.answer,
        input.model,
        createdAt,
        JSON.stringify(history),
        input.context ? JSON.stringify(input.context) : null,
        conversationId
      )

    return { id, ...input, conversationId, createdAt, history }
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
      conversationId: row.conversation_id,
      bookId: row.book_id,
      selection: JSON.parse(row.selection_json) as SavedInsight['selection'],
      context: row.context_json ? JSON.parse(row.context_json) as SavedInsight['context'] : undefined,
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

  getBookSession(bookId: string): BookSessionRecord | null {
    const row = this.connection
      .prepare('SELECT * FROM book_sessions WHERE book_id = ?')
      .get(bookId) as unknown as BookSessionRow | undefined
    return row ? mapBookSession(row) : null
  }

  listRecentBookSessions(bookId: string): BookSessionSummary[] {
    const rows = this.connection.prepare(`SELECT conversation_id, scope, updated_at,
      substr(COALESCE(NULLIF(json_extract(selection_json, '$.quote'), ''), NULLIF(json_extract(turns_json, '$[0].question'), ''), draft), 1, 80) AS title,
      json_array_length(turns_json) AS turn_count
      FROM book_session_history WHERE book_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT ?`).all(bookId, RECENT_BOOK_SESSION_LIMIT)
    return rows.map((row) => ({ conversationId: String(row.conversation_id), scope: row.scope as 'selection' | 'book', title: String(row.title), turnCount: Number(row.turn_count), updatedAt: String(row.updated_at) }))
  }

  getRecentBookSession(bookId: string, conversationId: string): BookSessionRecord | null {
    const row = this.connection.prepare('SELECT * FROM book_session_history WHERE book_id = ? AND conversation_id = ?').get(bookId, conversationId) as unknown as BookSessionRow | undefined
    return row ? mapBookSession(row) : null
  }

  /** Atomically update the current session and a bounded, per-book history. */
  upsertBookSession(record: BookSessionRecord): BookSessionRecord {
    this.connection.exec('BEGIN')
    try {
      this.connection
      .prepare(
        `INSERT INTO book_sessions(book_id, conversation_id, scope, selection_json, draft, turns_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(book_id) DO UPDATE SET
           conversation_id = excluded.conversation_id,
           scope = excluded.scope,
           selection_json = excluded.selection_json,
           draft = excluded.draft,
           turns_json = excluded.turns_json,
           updated_at = excluded.updated_at`
      )
      .run(
        record.bookId,
        record.conversationId,
        record.scope,
        record.selection ? JSON.stringify(record.selection) : null,
        record.draft,
        JSON.stringify(record.turns),
        record.updatedAt
      )
      this.connection.prepare(`INSERT INTO book_session_history SELECT * FROM book_sessions WHERE book_id = ?
        ON CONFLICT(book_id, conversation_id) DO UPDATE SET scope = excluded.scope, selection_json = excluded.selection_json,
          draft = excluded.draft, turns_json = excluded.turns_json, updated_at = excluded.updated_at`).run(record.bookId)
      this.connection.prepare(`DELETE FROM book_session_history WHERE book_id = ? AND conversation_id != ? AND rowid NOT IN (
        SELECT rowid FROM book_session_history WHERE book_id = ? AND conversation_id != ? ORDER BY updated_at DESC, rowid DESC LIMIT ?
      )`).run(record.bookId, record.conversationId, record.bookId, record.conversationId, RECENT_BOOK_SESSION_LIMIT - 1)
      this.connection.exec('COMMIT')
    } catch (error) { this.connection.exec('ROLLBACK'); throw error }
    return record
  }

  deleteBookSession(bookId: string, conversationId = this.getBookSession(bookId)?.conversationId): boolean {
    if (!conversationId) return false
    this.connection.exec('BEGIN')
    try {
      const current = this.connection.prepare('DELETE FROM book_sessions WHERE book_id = ? AND conversation_id = ?').run(bookId, conversationId)
      const history = this.connection.prepare('DELETE FROM book_session_history WHERE book_id = ? AND conversation_id = ?').run(bookId, conversationId)
      this.connection.exec('COMMIT')
      return current.changes > 0 || history.changes > 0
    } catch (error) { this.connection.exec('ROLLBACK'); throw error }
  }

  listSessionTabs(): SessionTabsState {
    const rows = this.connection
      .prepare('SELECT * FROM session_tabs ORDER BY position')
      .all() as unknown as SessionTabRow[]
    const activeIndex = rows.findIndex((row) => row.is_active === 1)
    return {
      activeIndex: activeIndex >= 0 ? activeIndex : null,
      tabs: rows.map(mapSessionTab)
    }
  }

  /** 打开的标签整体替换：数组顺序即 position，最多一个激活项。 */
  replaceSessionTabs(state: SessionTabsState): SessionTabsState {
    const insert = this.connection.prepare(
      'INSERT INTO session_tabs(position, kind, book_id, insight_id, draft, is_active) VALUES (?, ?, ?, ?, ?, ?)'
    )
    this.connection.exec('BEGIN IMMEDIATE')
    try {
      this.connection.prepare('DELETE FROM session_tabs').run()
      state.tabs.forEach((tab, index) => {
        insert.run(index, tab.kind, tab.bookId, tab.insightId, tab.draft, index === state.activeIndex ? 1 : 0)
      })
      this.connection.exec('COMMIT')
    } catch (error) {
      this.connection.exec('ROLLBACK')
      throw error
    }
    return state
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

  listProviderProfiles(): ProviderProfileRecord[] {
    return this.connection
      .prepare(
        `SELECT id, name, base_url, model, is_active, created_at, updated_at, compatibility, protocol, request_json, headers_secret
         FROM provider_profiles ORDER BY created_at ASC, id ASC`
      )
      .all() as unknown as ProviderProfileRecord[]
  }

  getProviderProfile(id: string): ProviderProfileRecord | null {
    return (this.connection
      .prepare(
        `SELECT id, name, base_url, model, is_active, created_at, updated_at, compatibility, protocol, request_json, headers_secret
         FROM provider_profiles WHERE id = ?`
      )
      .get(id) as unknown as ProviderProfileRecord | undefined) ?? null
  }

  getActiveProviderProfile(): ProviderProfileRecord | null {
    return (this.connection
      .prepare(
        `SELECT id, name, base_url, model, is_active, created_at, updated_at, compatibility, protocol, request_json, headers_secret
         FROM provider_profiles WHERE is_active = 1`
      )
      .get() as unknown as ProviderProfileRecord | undefined) ?? null
  }

  createProviderProfile(record: ProviderProfileRecord): void {
    this.connection
      .prepare(
        `INSERT INTO provider_profiles(
           id, name, base_url, model, is_active, created_at, updated_at, compatibility, protocol, request_json, headers_secret
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.name,
        record.base_url,
        record.model,
        record.is_active,
        record.created_at,
        record.updated_at,
        record.compatibility,
        record.protocol ?? 'openai',
        record.request_json ?? '{}',
        record.headers_secret ?? null
      )
  }

  updateProviderProfile(id: string, name: string, baseUrl: string, model: string, updatedAt: string, compatibility: ProviderCompatibility = 'auto', protocol: ProviderProtocol = 'openai', requestJson = '{}', headersSecret: Uint8Array | null = null): boolean {
    const result = this.connection
      .prepare(
        `UPDATE provider_profiles
         SET name = ?, base_url = ?, model = ?, updated_at = ?, compatibility = ?, protocol = ?, request_json = ?, headers_secret = ?
         WHERE id = ?`
      )
      .run(name, baseUrl, model, updatedAt, compatibility, protocol, requestJson, headersSecret, id)
    return result.changes > 0
  }

  activateProviderProfile(id: string): boolean {
    this.connection.exec('BEGIN IMMEDIATE')
    try {
      const exists = this.connection.prepare('SELECT 1 FROM provider_profiles WHERE id = ?').get(id)
      if (!exists) {
        this.connection.exec('ROLLBACK')
        return false
      }
      this.connection.prepare('UPDATE provider_profiles SET is_active = 0 WHERE is_active = 1').run()
      this.connection
        .prepare('UPDATE provider_profiles SET is_active = 1 WHERE id = ?')
        .run(id)
      this.connection.exec('COMMIT')
      return true
    } catch (error) {
      this.connection.exec('ROLLBACK')
      throw error
    }
  }

  deleteProviderProfile(id: string): boolean {
    const result = this.connection.prepare('DELETE FROM provider_profiles WHERE id = ?').run(id)
    return result.changes > 0
  }
}
