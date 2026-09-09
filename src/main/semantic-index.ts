import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import type { Passage, SemanticIndexState, StartSemanticIndexInput } from '@shared/contracts'
import { copy } from '@shared/copy'
import { BookContextStore } from './book-context-store'
import { AppError, toPublicError } from './errors'
import { KnowledgeSettingsService, type EmbeddingCredentials } from './knowledge-settings'
import { KnowledgeHttp } from './knowledge-http'

const MAX_DIMENSION = 4_096
const MAX_VECTOR_BYTES = 128 * 1024 * 1024
const embeddingResponse = z.object({ data: z.array(z.object({ index: z.number().int().nonnegative(), embedding: z.array(z.number().finite()).min(1).max(MAX_DIMENSION) })).min(1).max(16) })
interface IndexRow { fingerprint: string; model: string; status: SemanticIndexState['status']; dimension: number | null; message: string | null }

export async function embed(http: KnowledgeHttp, config: EmbeddingCredentials, texts: string[], signal: AbortSignal): Promise<Float32Array[]> {
  if (!config.baseUrl || !config.model) throw new AppError('EMBEDDING_CONFIG', copy('knowledge.embeddingRequired'))
  const raw = await http.json(`${config.baseUrl}/embeddings`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
    body: JSON.stringify({ model: config.model, input: texts, encoding_format: 'float' }) }, signal, 4_000_000)
  const parsed = embeddingResponse.safeParse(raw)
  if (!parsed.success || parsed.data.data.length !== texts.length) throw new AppError('EMBEDDING_INVALID', copy('knowledge.vectorInvalid'))
  const items = parsed.data.data.sort((a, b) => a.index - b.index)
  return items.map((item, index) => {
    const norm = Math.hypot(...item.embedding)
    if (item.index !== index || item.embedding.length !== items[0].embedding.length || !Number.isFinite(norm) || norm === 0) {
      throw new AppError('EMBEDDING_INVALID', copy('knowledge.vectorInvalid'))
    }
    return Float32Array.from(item.embedding, (value) => value / norm)
  })
}

export class SemanticIndexService {
  private active?: { bookId: string; controller: AbortController }
  onChange: (bookId: string) => void = () => undefined
  constructor(private readonly store: BookContextStore, private readonly settings: KnowledgeSettingsService,
    private readonly http: KnowledgeHttp, private readonly foregroundBusy: () => boolean = () => false) {
    store.db.prepare("UPDATE semantic_indexes SET status = 'paused' WHERE status = 'indexing'").run()
  }
  private row(bookId: string): IndexRow | undefined {
    return this.store.db.prepare('SELECT * FROM semantic_indexes WHERE book_id = ?').get(bookId) as unknown as IndexRow | undefined
  }
  private fingerprint(bookId: string, config: EmbeddingCredentials): string {
    return createHash('sha256').update(JSON.stringify([this.store.database.getStoredBook(bookId)?.sha256,
      this.store.document(bookId)?.embedding_identity, config.revision, config.baseUrl, config.model, 1])).digest('hex')
  }
  state(bookId: string): SemanticIndexState {
    const config = this.settings.get().embedding
    const row = this.row(bookId)
    const count = this.store.db.prepare('SELECT count(*) AS total FROM book_blocks WHERE book_id = ? AND searchable = 1').get(bookId)!
    const done = this.store.db.prepare('SELECT count(*) AS total FROM book_vectors WHERE book_id = ?').get(bookId)!
    let status: SemanticIndexState['status'] = config.enabled ? row?.status ?? 'empty' : 'disabled'
    // This identity check does not require decrypting the key just to render status.
    if (config.enabled && row) {
      const revision = this.store.db.prepare("SELECT revision FROM knowledge_settings WHERE kind = 'embedding'").get()?.revision
      if (row.fingerprint !== this.fingerprint(bookId, { ...config, revision: String(revision ?? ''), apiKey: '' })) status = 'stale'
    }
    return { status, completed: Number(done.total), total: Number(count.total), model: row?.model ?? config.model, ...(row?.message ? { message: row.message } : {}) }
  }
  start(input: StartSemanticIndexInput): void {
    if (this.active) throw new AppError('SEMANTIC_BUSY', copy('knowledge.indexBusy'))
    if (this.store.document(input.bookId)?.status !== 'ready') throw new AppError('SEMANTIC_NOT_READY', copy('analysis.needed'))
    const config = this.settings.embedding()
    if (!config.enabled) throw new AppError('EMBEDDING_CONFIG', copy('knowledge.embeddingRequired'))
    const old = this.row(input.bookId)
    const fingerprint = this.fingerprint(input.bookId, config)
    if (old && old.fingerprint !== fingerprint && !input.rebuild) throw new AppError('SEMANTIC_CHANGED', copy('knowledge.indexChanged'))
    if (old?.status === 'ready' && !input.rebuild) return
    if (!old || input.rebuild) {
      this.store.db.prepare('DELETE FROM semantic_indexes WHERE book_id = ?').run(input.bookId)
      this.store.db.prepare("INSERT INTO semantic_indexes(book_id, fingerprint, model, status) VALUES (?, ?, ?, 'paused')").run(input.bookId, fingerprint, config.model)
    }
    const active = { bookId: input.bookId, controller: new AbortController() }
    this.active = active
    this.store.db.prepare("UPDATE semantic_indexes SET status = 'indexing', message = NULL WHERE book_id = ?").run(input.bookId)
    this.onChange(input.bookId)
    void this.run(input.bookId, config, active.controller.signal).catch((error: unknown) => {
      if (this.active !== active) return
      this.store.db.prepare("UPDATE semantic_indexes SET status = 'error', message = ? WHERE book_id = ?").run(toPublicError(error).message, input.bookId)
      this.onChange(input.bookId)
    }).finally(() => { if (this.active === active) this.active = undefined })
  }
  cancel(bookId: string): void {
    if (this.active?.bookId !== bookId) return
    this.active.controller.abort()
    this.active = undefined
    this.store.db.prepare("UPDATE semantic_indexes SET status = 'paused' WHERE book_id = ? AND status = 'indexing'").run(bookId)
    this.onChange(bookId)
  }
  dispose(): void { if (this.active) this.cancel(this.active.bookId) }
  private async run(bookId: string, config: EmbeddingCredentials, signal: AbortSignal): Promise<void> {
    while (true) {
      signal.throwIfAborted()
      while (this.foregroundBusy()) await delay(100, undefined, { signal })
      const rows = this.store.db.prepare(`SELECT id, text, chapter_title, metadata_json FROM book_blocks b WHERE book_id = ? AND searchable = 1
        AND NOT EXISTS (SELECT 1 FROM book_vectors v WHERE v.block_rowid = b.id) ORDER BY ordinal LIMIT 16`).all(bookId)
      if (!rows.length) break
      const vectors = await embed(this.http, config, rows.map((row) => {
        const metadata = row.metadata_json ? JSON.parse(String(row.metadata_json)) as Passage : null
        return `${metadata?.headingPath?.join(' / ') ?? row.chapter_title}\n${row.text}`
      }), signal)
      signal.throwIfAborted()
      const dimension = vectors[0].length
      const previousDimension = this.row(bookId)?.dimension
      if (previousDimension && previousDimension !== dimension) throw new AppError('EMBEDDING_DIMENSION', copy('knowledge.vectorInvalid'))
      if (this.state(bookId).total * dimension * 4 > MAX_VECTOR_BYTES) throw new AppError('SEMANTIC_TOO_LARGE', copy('knowledge.tooLarge'))
      this.store.db.exec('BEGIN')
      try {
        for (const [index, row] of rows.entries()) this.store.db.prepare('INSERT INTO book_vectors(block_rowid, book_id, vector) VALUES (?, ?, ?)')
          .run(row.id, bookId, Buffer.from(vectors[index].buffer))
        this.store.db.prepare('UPDATE semantic_indexes SET dimension = ? WHERE book_id = ?').run(dimension, bookId)
        this.store.db.exec('COMMIT')
      } catch (error) { this.store.db.exec('ROLLBACK'); throw error }
      this.onChange(bookId)
    }
    this.store.db.prepare("UPDATE semantic_indexes SET status = 'ready', message = NULL WHERE book_id = ?").run(bookId)
    this.onChange(bookId)
  }
  async search(bookId: string, question: string, lexical: Passage[], signal: AbortSignal, limit = 24): Promise<Passage[]> {
    if (this.state(bookId).status !== 'ready') return lexical
    try {
      const config = this.settings.embedding()
      const fingerprint = this.row(bookId)!.fingerprint
      const [query] = await embed(this.http, config, [question], AbortSignal.any([signal, AbortSignal.timeout(12_000)]))
      if (this.state(bookId).status !== 'ready' || this.row(bookId)?.fingerprint !== fingerprint || this.row(bookId)?.dimension !== query.length) return lexical
      const ranked: { id: string; score: number }[] = []
      // Iterate blobs instead of materializing the whole vector matrix in memory.
      for (const row of this.store.db.prepare('SELECT b.block_id, v.vector FROM book_vectors v JOIN book_blocks b ON b.id = v.block_rowid WHERE v.book_id = ?').iterate(bookId)) {
        const bytes = row.vector as Uint8Array
        if (bytes.byteLength !== query.byteLength) return lexical
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        let score = 0
        for (let index = 0; index < query.length; index++) score += query[index] * view.getFloat32(index * 4, true)
        ranked.push({ id: String(row.block_id), score })
      }
      ranked.sort((a, b) => b.score - a.score)
      const semantic = this.store.passages(bookId, ranked.slice(0, limit).map((item) => item.id))
      const combined = new Map<string, { passage: Passage; score: number }>()
      for (const list of [lexical, semantic]) for (const [rank, passage] of list.entries()) {
        const id = passage.blockId ?? passage.id
        const entry = combined.get(id) ?? { passage, score: 0 }
        entry.score += 1 / (60 + rank + 1)
        combined.set(id, entry)
      }
      const fused = [...combined.values()].sort((a, b) => b.score - a.score).map((item) => item.passage)
      // Preserve leading matches from both paths. Shared, weaker matches receive two RRF votes and can
      // otherwise displace an exact lexical condition just as easily as semantic-only synonym evidence.
      return [...new Map([...fused.slice(0, 6), ...lexical.slice(0, 3), ...semantic.slice(0, 3), ...fused]
        .map((passage) => [passage.blockId ?? passage.id, passage])).values()].slice(0, limit === 24 ? 24 : limit * 2)
    } catch { signal.throwIfAborted(); return lexical }
  }
}
