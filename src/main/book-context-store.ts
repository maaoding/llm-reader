import type { BookAnalysisFailure, BookAnalysisProgress, BookAnalysisState, BookDocumentState, DocumentDiagnostic, DocumentSection, NormalizedDocument, Passage } from '@shared/contracts'
import { randomUUID } from 'node:crypto'
import type { SectionNote } from '@shared/book-context'
import { characters } from '@shared/book-context'
import { AppDatabase } from './database'
import { DOCUMENT_STRUCTURE_VERSION, MAX_DOCUMENT_CACHE_BYTES, validateDocument } from '@shared/document-structure'

export interface AnalysisRecord {
  session_id: string
  book_id: string; job_id: string; fingerprint: string; profile_id: string; model: string
  status: BookAnalysisState['status']; extraction_done: number; characters: number
  usage_json: string | null; message: string | null; overview: string | null
  progress_json: string | null
}

export interface StoredSection { section: DocumentSection; note: SectionNote | null }
export interface DocumentRecord {
  book_id: string; job_id: string; fingerprint: string; embedding_identity: string; version: number
  status: BookDocumentState['status']; characters: number; completed: number; total: number
  message: string | null; document_json: string | null; diagnostics_json: string
}

/** A future hybrid retriever can implement this interface without changing context assembly. */
export interface BookRetriever {
  search(bookId: string, text: string, limit?: number, chapterIds?: string[]): Passage[]
}

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
export function searchTokens(text: string): string {
  const normalized = text.normalize('NFKC').toLocaleLowerCase()
  const terms = [...segmenter.segment(normalized)].filter((part) => part.isWordLike).map((part) => part.segment)
  for (const run of normalized.match(/\p{Script=Han}{2,}/gu) ?? []) {
    const points = Array.from(run)
    for (let index = 0; index < points.length - 1; index++) terms.push(points[index] + points[index + 1])
  }
  return terms.join(' ')
}

function mapPassage(row: Record<string, unknown>): Passage {
  return { ...(row.metadata_json ? JSON.parse(String(row.metadata_json)) as Passage : {}), id: String(row.block_id), blockId: String(row.block_id), text: String(row.text), anchor: String(row.anchor), chapterTitle: String(row.chapter_title), chapterId: String(row.chapter_id) }
}

export class BookContextStore implements BookRetriever {
  constructor(readonly database: AppDatabase) {}
  get db() { return this.database.connection }

  record(bookId: string): AnalysisRecord | undefined {
    return this.db.prepare('SELECT * FROM book_analysis WHERE book_id = ?').get(bookId) as unknown as AnalysisRecord | undefined
  }

  document(bookId: string): DocumentRecord | undefined {
    return this.db.prepare('SELECT * FROM book_documents WHERE book_id = ?').get(bookId) as unknown as DocumentRecord | undefined
  }

  documentState(bookId: string): BookDocumentState {
    const row = this.document(bookId)
    return row ? { status: row.status, jobId: row.job_id, version: row.version, characters: row.characters,
      completed: row.completed, total: row.total, diagnostics: JSON.parse(row.diagnostics_json) as DocumentDiagnostic[],
      ...(row.message ? { message: row.message } : {}) }
      : { status: 'empty', jobId: '', version: DOCUMENT_STRUCTURE_VERSION, characters: 0, completed: 0, total: 0, diagnostics: [] }
  }

  prepare(bookId: string, jobId: string, fingerprint: string, version = DOCUMENT_STRUCTURE_VERSION): void {
    const notes = this.record(bookId)
    const index = this.db.prepare('SELECT fingerprint, model FROM semantic_indexes WHERE book_id = ?').get(bookId)
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM book_analysis WHERE book_id = ?').run(bookId)
      this.db.prepare('DELETE FROM book_documents WHERE book_id = ?').run(bookId)
      this.db.prepare("INSERT INTO book_documents(book_id, job_id, fingerprint, embedding_identity, version, status) VALUES (?, ?, ?, ?, ?, 'preparing')")
        .run(bookId, jobId, fingerprint, fingerprint, version)
      if (notes) this.db.prepare(`INSERT INTO book_analysis(book_id, job_id, fingerprint, profile_id, model, status, session_id, extraction_done)
        VALUES (?, ?, ?, ?, ?, 'stale', ?, 1)`).run(bookId, jobId, notes.fingerprint, notes.profile_id, notes.model, randomUUID())
      if (index) this.db.prepare("INSERT INTO semantic_indexes(book_id, fingerprint, model, status) VALUES (?, ?, ?, 'stale')").run(bookId, index.fingerprint, index.model)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  cacheDocument(bookId: string, document: NormalizedDocument, total: number): void {
    validateDocument(document)
    const serialized = JSON.stringify(document)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_DOCUMENT_CACHE_BYTES) throw new Error('文档结构缓存超过上限。')
    this.db.prepare('UPDATE book_documents SET document_json = ?, diagnostics_json = ?, total = ? WHERE book_id = ?')
      .run(serialized, JSON.stringify(document.diagnostics), total, bookId)
  }

  structure(bookId: string): NormalizedDocument | null {
    const row = this.document(bookId)
    return row?.document_json ? JSON.parse(row.document_json) as NormalizedDocument : null
  }

  resetNotes(bookId: string, jobId: string, profileId: string, model: string, fingerprint: string, sessionId = randomUUID()): void {
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM book_analysis WHERE book_id = ?').run(bookId)
      this.db.prepare('UPDATE book_sections SET note_json = NULL WHERE book_id = ?').run(bookId)
      this.db.prepare("UPDATE book_fts SET aliases = '' WHERE rowid IN (SELECT id FROM book_blocks WHERE book_id = ?)").run(bookId)
      this.db.prepare(`INSERT INTO book_analysis(book_id, job_id, fingerprint, profile_id, model, status, session_id, extraction_done, characters)
        VALUES (?, ?, ?, ?, ?, 'analyzing', ?, 1, ?)`).run(bookId, jobId, fingerprint, profileId, model, sessionId, this.document(bookId)?.characters ?? 0)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  state(bookId: string): BookAnalysisState {
    const record = this.record(bookId)
    const document = this.documentState(bookId)
    if (!record) return { bookId, jobId: '', status: 'empty', profileId: '', model: '', sections: document.completed, completedSections: 0, characters: document.characters, document }
    const counts = this.db.prepare('SELECT count(*) AS total, count(note_json) AS done FROM book_sections WHERE book_id = ?').get(bookId)!
    const chapters = this.db.prepare(`SELECT count(DISTINCT chapter_id) AS total,
      count(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM book_summaries n WHERE n.book_id = s.book_id AND n.node_id = 'chapter-' || s.chapter_id || '-final') THEN chapter_id END) AS done
      FROM book_sections s WHERE book_id = ?`).get(bookId)!
    const inferred: BookAnalysisProgress = Number(counts.done) < Number(counts.total)
      ? { stage: 'sections', completed: Number(counts.done), total: Number(counts.total) }
      : Number(chapters.done) < Number(chapters.total)
        ? { stage: 'chapters', completed: Number(chapters.done), total: Number(chapters.total) }
        : { stage: 'overview', completed: record.status === 'ready' ? 1 : 0, total: 1 }
    const failures = this.db.prepare('SELECT failure_json FROM book_analysis_failures WHERE book_id = ? ORDER BY id DESC LIMIT 10').all(bookId)
      .map((row) => JSON.parse(String(row.failure_json)) as BookAnalysisFailure)
    return { bookId, jobId: record.job_id, status: record.status, profileId: record.profile_id, model: record.model, sections: Number(counts.total), completedSections: Number(counts.done), characters: document.characters, document,
      ...(record.extraction_done ? { progress: record.progress_json ? JSON.parse(record.progress_json) as BookAnalysisProgress : inferred } : {}),
      ...(failures.length ? { failures } : {}),
      ...(record.message ? { message: record.message } : {}), ...(record.usage_json ? { usage: JSON.parse(record.usage_json) as BookAnalysisState['usage'] } : {}) }
  }

  progress(bookId: string, progress: BookAnalysisProgress): void {
    this.db.prepare('UPDATE book_analysis SET progress_json = ? WHERE book_id = ?').run(JSON.stringify(progress), bookId)
  }

  recordFailure(bookId: string, nodeId: string, failure: BookAnalysisFailure): void {
    // Only safe diagnostics and counts are stored, never provider bodies or credentials.
    this.db.prepare('INSERT INTO book_analysis_failures(book_id, node_id, failure_json) VALUES (?, ?, ?)').run(bookId, nodeId, JSON.stringify(failure))
    this.db.prepare('DELETE FROM book_analysis_failures WHERE book_id = ? AND id NOT IN (SELECT id FROM book_analysis_failures WHERE book_id = ? ORDER BY id DESC LIMIT 10)').run(bookId, bookId)
  }

  reset(bookId: string, jobId: string, profileId: string, model: string, fingerprint: string, sessionId: string = randomUUID()): void {
    // Legacy fixture/import helper. Runtime operations use prepare() and resetNotes() independently.
    this.prepare(bookId, jobId, fingerprint, 1)
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM book_analysis WHERE book_id = ?').run(bookId)
      this.db.prepare('INSERT INTO book_analysis(book_id, job_id, profile_id, model, fingerprint, status, session_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(bookId, jobId, profileId, model, fingerprint, 'extracting', sessionId)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  status(bookId: string, status: BookAnalysisState['status'], message: string | null = null): void {
    this.db.prepare('UPDATE book_analysis SET status = ?, message = ? WHERE book_id = ?').run(status, message, bookId)
    if (status === 'ready') this.db.prepare("UPDATE book_documents SET status = 'ready' WHERE book_id = ? AND version = 1").run(bookId)
  }

  append(bookId: string, sections: DocumentSection[]): void {
    this.db.exec('BEGIN')
    try {
      let added = 0
      for (const section of sections) {
        this.db.prepare('INSERT INTO book_sections(book_id, section_id, chapter_id, chapter_title, ordinal, content_json) VALUES (?, ?, ?, ?, ?, ?)')
          .run(bookId, section.id, section.chapterId, section.chapterTitle, section.order, JSON.stringify(section))
        for (const [index, block] of section.blocks.entries()) {
          const result = this.db.prepare('INSERT INTO book_blocks(book_id, block_id, section_id, chapter_id, chapter_title, ordinal, text, anchor, metadata_json, searchable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(bookId, block.id, section.id, section.chapterId, section.chapterTitle, section.order * 48 + index, block.text, block.anchor, JSON.stringify(block), block.searchable === false ? 0 : 1)
          if (block.searchable !== false) this.db.prepare('INSERT INTO book_fts(rowid, title, body, aliases) VALUES (?, ?, ?, ?)').run(result.lastInsertRowid, searchTokens(block.headingPath?.join(' / ') ?? section.chapterTitle), searchTokens(block.text), '')
          added += characters(block.text)
        }
      }
      this.db.prepare('UPDATE book_analysis SET characters = characters + ? WHERE book_id = ?').run(added, bookId)
      this.db.prepare('UPDATE book_documents SET characters = characters + ?, completed = completed + ?, total = max(total, completed + ?) WHERE book_id = ?').run(added, sections.length, sections.length, bookId)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  sections(bookId: string): StoredSection[] {
    const rows = this.db.prepare('SELECT content_json, note_json FROM book_sections WHERE book_id = ? ORDER BY ordinal').all(bookId)
    return rows.map((row) => ({ section: JSON.parse(String(row.content_json)) as DocumentSection, note: row.note_json ? JSON.parse(String(row.note_json)) as SectionNote : null }))
  }

  saveNote(bookId: string, sectionId: string, note: SectionNote): void {
    this.db.exec('BEGIN')
    try {
      this.db.prepare('UPDATE book_sections SET note_json = ? WHERE book_id = ? AND section_id = ?').run(JSON.stringify(note), bookId, sectionId)
      for (const concept of note.concepts) {
        const aliases = searchTokens([concept.term, ...concept.aliases].join(' '))
        for (const id of concept.sourceIds) this.db.prepare('UPDATE book_fts SET aliases = aliases || ? WHERE rowid IN (SELECT id FROM book_blocks WHERE book_id = ? AND block_id = ?)').run(` ${aliases}`, bookId, id)
      }
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  search(bookId: string, text: string, limit = 24, chapterIds: string[] = []): Passage[] {
    const terms = [...new Set(searchTokens(text).split(' ').filter((term) => term.length > 1 || /\p{Script=Han}/u.test(term)))].slice(0, 64)
    if (!terms.length) return []
    const query = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ')
    const chapters = chapterIds.slice(0, 6)
    const boost = chapters.length ? `CASE WHEN b.chapter_id IN (${chapters.map(() => '?').join(',')}) THEN 1.25 ELSE 1 END` : '1'
    return this.db.prepare(`SELECT b.* FROM book_fts JOIN book_blocks b ON b.id = book_fts.rowid
      WHERE book_fts MATCH ? AND b.book_id = ? AND b.searchable = 1 ORDER BY bm25(book_fts, 3, 1, 3) * (${boost}), b.ordinal LIMIT ?`).all(query, bookId, ...chapters, limit).map(mapPassage)
  }

  passages(bookId: string, blockIds: string[]): Passage[] {
    const statement = this.db.prepare('SELECT * FROM book_blocks WHERE book_id = ? AND block_id = ? AND searchable = 1')
    return blockIds.slice(0, 100).flatMap((id) => { const row = statement.get(bookId, id); return row ? [mapPassage(row)] : [] })
  }

  originals(bookId: string): Passage[] {
    return this.db.prepare('SELECT * FROM book_blocks WHERE book_id = ? AND searchable = 1 ORDER BY ordinal').all(bookId).map(mapPassage)
  }

  related(bookId: string, hits: Passage[]): Passage[] {
    const document = this.structure(bookId)
    if (!document) return []
    const units = new Map(document.units.map((unit) => [unit.id, unit]))
    const originals = this.originals(bookId)
    const seen = new Set(hits.map((hit) => hit.blockId))
    const result: Passage[] = []
    for (const hit of hits) {
      const unit = units.get(hit.unitId ?? '')
      if (!unit) continue
      const index = originals.findIndex((item) => item.blockId === hit.blockId)
      const adjacent = [originals[index - 1], originals[index + 1]].filter((item) => item && item.unitId === unit.id)
      const linked = originals.filter((item) => unit.relatedIds.includes(item.unitId ?? ''))
      for (const item of [...linked, ...adjacent]) if (!seen.has(item.blockId)) {
        seen.add(item.blockId); result.push({ ...item, evidenceRole: 'extension' })
      }
    }
    return result.slice(0, 12)
  }

  summary(bookId: string, nodeId: string): string | null {
    const row = this.db.prepare('SELECT summary FROM book_summaries WHERE book_id = ? AND node_id = ?').get(bookId, nodeId)
    return row ? String(row.summary) : null
  }

  saveSummary(bookId: string, nodeId: string, summary: string): void {
    this.db.prepare('INSERT OR REPLACE INTO book_summaries(book_id, node_id, summary) VALUES (?, ?, ?)').run(bookId, nodeId, summary)
  }
}
