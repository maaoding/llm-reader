import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import JSZip from 'jszip'
import { z } from 'zod'
import type { BookPagePreview, BookPagePreviewInput, DocumentSection, NormalizedDocument } from '@shared/contracts'
import { copy } from '@shared/copy'
import { AppDatabase } from './database'
import { AppError } from './errors'
import { KnowledgeHttp } from './knowledge-http'
import { KnowledgeSettingsService, type DocumentCredentials } from './knowledge-settings'
import { documentSectionSchema, normalizedDocumentSchema } from './schemas'
import { normalizeDoclingDocument, normalizeMineruDocument } from './document-normalizer'
import { documentSections, MAX_DOCUMENT_CACHE_BYTES } from '@shared/document-structure'
import { VisionOcrService, type PdfPageRenderer } from './vision-ocr'
import { isPageProcessor, mergeRequestHeaders } from '@shared/request-settings'
import { appendFormOptions } from './page-ocr-provider'

const object = z.record(z.string(), z.unknown())
const identifier = z.string().min(1).max(128).regex(/^[\w-]+$/u)
const MAX_RESULT = 48_000_000
interface JobRow { fingerprint: string; task_id: string; result_json: string | null; raw_json?: string | null; structure_json?: string | null }
function invalid(): never { throw new AppError('DOCUMENT_INVALID', copy('knowledge.invalid')) }
function failed(): never { throw new AppError('DOCUMENT_FAILED', copy('knowledge.documentFailed')) }
function parse(value: unknown): Record<string, unknown> { const result = object.safeParse(value); return result.success ? result.data : invalid() }
function cloudData(value: unknown): Record<string, unknown> { const result = parse(value); if (result.code !== 0) failed(); return parse(result.data) }

export function cloudAssetUrl(raw: unknown, baseUrl: string): string {
  if (typeof raw !== 'string' || raw.length > 8_192) invalid()
  let url: URL
  try { url = new URL(raw) } catch { return invalid() }
  const base = new URL(baseUrl)
  const localFixture = ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) && url.origin === base.origin
  const official = url.protocol === 'https:' && (url.hostname.endsWith('.aliyuncs.com') || url.hostname === 'cdn-mineru.openxlab.org.cn')
  if ((!official && !localFixture) || url.username || url.password || url.hash) invalid()
  return url.href
}

function validateZipDirectory(bytes: Uint8Array): void {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) { end = offset; break }
  }
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) invalid()
  const count = buffer.readUInt16LE(end + 10), size = buffer.readUInt32LE(end + 12), start = buffer.readUInt32LE(end + 16)
  if (!count || count > 20_000 || size > 8_000_000 || start + size > end || buffer.readUInt16LE(end + 8) !== count) invalid()
  let offset = start, found = 0
  while (offset < start + size) {
    if (offset + 46 > start + size || buffer.readUInt32LE(offset) !== 0x02014b50 || ++found > count) invalid()
    const nameSize = buffer.readUInt16LE(offset + 28), extra = buffer.readUInt16LE(offset + 30), comment = buffer.readUInt16LE(offset + 32)
    const next = offset + 46 + nameSize + extra + comment
    if (next > start + size) invalid()
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameSize)
    if (/(?:^|\/)(?:.*_)?content_list\.json$/u.test(name) && buffer.readUInt32LE(offset + 24) > MAX_RESULT) {
      throw new AppError('DOCUMENT_TOO_LARGE', copy('knowledge.tooLarge'))
    }
    offset = next
  }
  if (found !== count) invalid()
}

async function contentListFromZip(bytes: Uint8Array): Promise<unknown> {
  try {
    validateZipDirectory(bytes)
    const zip = await JSZip.loadAsync(bytes)
    const files = Object.values(zip.files)
    if (files.length > 20_000) invalid()
    const candidates = files.filter((entry) => !entry.dir && /(?:^|\/)(?:.*_)?content_list\.json$/u.test(entry.name))
    if (candidates.length !== 1) invalid()
    const entry = candidates[0]
    // Streaming bounds protect against an oversized inflated JSON entry; no ZIP path is written to disk.
    const content = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Uint8Array[] = []
      let total = 0
      const stream = entry.nodeStream()
      stream.on('data', (chunk: Uint8Array) => {
        total += chunk.length
        if (total > MAX_RESULT) { stream.pause(); reject(new AppError('DOCUMENT_TOO_LARGE', copy('knowledge.tooLarge'))); return }
        chunks.push(chunk)
      }).on('error', reject).on('end', () => resolve(Buffer.concat(chunks)))
    })
    return JSON.parse(content.toString('utf8')) as unknown
  } catch (error) { if (error instanceof AppError) throw error; return invalid() }
}

export class DocumentProcessingService {
  private readonly vision: VisionOcrService
  private previewJob?: { bookId: string; requestId: string; controller: AbortController }
  constructor(private readonly database: AppDatabase, private readonly settings: KnowledgeSettingsService,
    private readonly http: KnowledgeHttp, private readonly pollMs = 2_000, private readonly foregroundBusy: () => boolean = () => false) {
    this.vision = new VisionOcrService(database, settings, http)
  }
  usesVision(): boolean { return isPageProcessor(this.settings.get().document.processor) }
  progress(bookId: string): { completed: number; total: number } | undefined { return this.vision.progress(bookId) }
  identity(): string {
    const config = this.settings.get().document
    const revision = this.database.connection.prepare("SELECT revision FROM knowledge_settings WHERE kind = 'document'").get()?.revision
    return JSON.stringify([config.processor, config.baseUrl, config.ocr, config.language, revision, 1])
  }
  enabled(): boolean { return this.settings.get().document.processor !== 'none' }
  cancelPreview(requestId?: string): void {
    if (!this.previewJob || (requestId && this.previewJob.requestId !== requestId)) return
    this.previewJob.controller.abort()
    this.previewJob = undefined
  }
  cancelBookPreview(bookId: string): void {
    if (this.previewJob?.bookId === bookId) this.cancelPreview()
  }

  /** A single explicit preview never creates or modifies a preparation checkpoint. */
  async previewPage(input: BookPagePreviewInput): Promise<BookPagePreview> {
    const book = this.database.getStoredBook(input.bookId)
    if (!book) throw new AppError('BOOK_NOT_FOUND', copy('error.bookNotFound'))
    const config = this.settings.document()
    if (book.format !== 'pdf' || !isPageProcessor(config.processor)) throw new AppError('OCR_CONFIG', copy('vision.previewUnsupported'))
    const preparing = this.database.connection.prepare("SELECT book_id FROM book_documents WHERE status = 'preparing' LIMIT 1").get()
    if (this.previewJob || preparing) throw new AppError('ANALYSIS_BUSY', copy('vision.previewBusy'))
    const job = { bookId: input.bookId, requestId: input.requestId, controller: new AbortController() }
    this.previewJob = job
    try {
      const text = await this.vision.recognize(config, input.imageDataUrl, input.requestId, job.controller.signal)
      job.controller.signal.throwIfAborted()
      if (this.settings.documentRevision() !== config.revision || !this.database.getStoredBook(input.bookId)) throw new AppError('DOCUMENT_CHANGED', copy('knowledge.documentChanged'))
      return { text, pageNumber: input.pageNumber, pageCount: input.pageCount, processor: config.processor, ...(config.model ? { model: config.model } : {}) }
    } finally { if (this.previewJob === job) this.previewJob = undefined }
  }
  reset(bookId: string): void { this.database.connection.prepare('DELETE FROM document_jobs WHERE book_id = ?').run(bookId) }
  rebuild(bookId: string): void {
    const row = this.database.connection.prepare('SELECT raw_json, structure_json, fingerprint FROM document_jobs WHERE book_id = ?').get(bookId)
    const fingerprint = createHash('sha256').update(JSON.stringify([this.database.getStoredBook(bookId)?.sha256, this.identity()])).digest('hex')
    if (row?.raw_json && row.structure_json && row.fingerprint === fingerprint) this.database.connection.prepare('UPDATE document_jobs SET result_json = NULL, structure_json = NULL WHERE book_id = ?').run(bookId)
    else this.reset(bookId)
  }
  structure(bookId: string): NormalizedDocument | undefined {
    const row = this.database.connection.prepare('SELECT structure_json FROM document_jobs WHERE book_id = ?').get(bookId)
    return row?.structure_json ? normalizedDocumentSchema.parse(JSON.parse(String(row.structure_json))) : undefined
  }
  private async yieldToQuestions(signal: AbortSignal): Promise<void> { while (this.foregroundBusy()) await delay(100, undefined, { signal }); signal.throwIfAborted() }
  private headers(config: DocumentCredentials): Record<string, string> {
    return mergeRequestHeaders(config.apiKey ? config.processor === 'docling' ? { 'X-Api-Key': config.apiKey } : { Authorization: `Bearer ${config.apiKey}` } : {}, config.customHeaders)
  }
  async test(config: DocumentCredentials, signal: AbortSignal): Promise<void> {
    if (isPageProcessor(config.processor)) return this.vision.test(config, signal)
    if (config.processor === 'none' || !config.baseUrl) throw new AppError('DOCUMENT_CONFIG', copy('knowledge.pdfRequired'))
    if (config.processor === 'mineru-cloud') {
      if (!config.apiKey) throw new AppError('DOCUMENT_KEY', copy('knowledge.cloudKey'))
      // Read-only query for a nonexistent random batch: checks auth without creating a paid job.
      const result = parse(await this.http.json(`${config.baseUrl}/api/v4/extract-results/batch/${randomUUID()}`, { headers: this.headers(config) }, signal, undefined, config.timeoutMs))
      // -60012 is task not found. Other application errors must not masquerade as success.
      if (result.code !== 0 && result.code !== -60012 && result.code !== '-60012') failed()
    } else {
      const spec = parse(await this.http.json(`${config.baseUrl}/openapi.json`, { headers: this.headers(config) }, signal, undefined, config.timeoutMs))
      const paths = parse(spec.paths)
      if (!paths[config.processor === 'docling' ? '/v1/convert/file/async' : '/tasks']) invalid()
    }
  }
  async extract(bookId: string, bytes: Uint8Array, pageCount: number, signal: AbortSignal,
    renderPage?: PdfPageRenderer, onProgress: () => void = () => undefined): Promise<DocumentSection[]> {
    if (!this.enabled()) throw new AppError('DOCUMENT_CONFIG', copy('knowledge.pdfRequired'))
    if (bytes.length > 200_000_000 || pageCount > 600) throw new AppError('DOCUMENT_TOO_LARGE', copy('knowledge.tooLarge'))
    const config = this.settings.document()
    const fingerprint = createHash('sha256').update(JSON.stringify([this.database.getStoredBook(bookId)?.sha256, this.identity()])).digest('hex')
    if (isPageProcessor(config.processor)) return this.vision.extract(bookId, pageCount, config, fingerprint, signal, renderPage, () => this.yieldToQuestions(signal), onProgress)
    let row = this.database.connection.prepare('SELECT * FROM document_jobs WHERE book_id = ?').get(bookId) as unknown as JobRow | undefined
    if (row && row.fingerprint !== fingerprint) throw new AppError('DOCUMENT_CHANGED', copy('knowledge.documentChanged'))
    if (row?.structure_json) return documentSections(normalizedDocumentSchema.parse(JSON.parse(row.structure_json)))
    if (row?.result_json && !row.raw_json) return z.array(documentSectionSchema).max(10_000).parse(JSON.parse(row.result_json))
    if (row?.task_id === 'submitting') failed()
    const headers = this.headers(config)
    const saveTask = (id: unknown): string => {
      signal.throwIfAborted()
      const taskId = identifier.parse(id)
      this.database.connection.prepare('UPDATE document_jobs SET task_id = ? WHERE book_id = ? AND fingerprint = ?').run(taskId, bookId, fingerprint)
      return taskId
    }
    if (!row) {
      await this.yieldToQuestions(signal)
      signal.throwIfAborted()
      this.database.connection.prepare("INSERT INTO document_jobs(book_id, fingerprint, task_id) VALUES (?, ?, 'submitting')").run(bookId, fingerprint)
      let taskId: string
      if (config.processor === 'mineru-cloud') {
        if (!config.apiKey) throw new AppError('DOCUMENT_KEY', copy('knowledge.cloudKey'))
        const data = cloudData(await this.http.json(`${config.baseUrl}/api/v4/file-urls/batch`, { method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ files: [{ name: 'document.pdf', is_ocr: config.ocr }],
            model_version: 'pipeline', language: config.language, enable_formula: true, enable_table: true, ...config.extraBody }) }, signal, undefined, config.timeoutMs))
        taskId = saveTask(data.batch_id)
        const urls = z.array(z.string()).length(1).parse(data.file_urls)
        await this.http.request(cloudAssetUrl(urls[0], config.baseUrl), { method: 'PUT', body: Buffer.from(bytes) }, signal, 1_000_000, 180_000)
      } else {
        const form = new FormData()
        form.append('files', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), 'document.pdf')
        const fields = config.processor === 'docling'
          ? { to_formats: 'json', image_export_mode: 'placeholder', do_ocr: String(config.ocr), ocr_preset: 'easyocr', ocr_engine: 'easyocr' }
          : { backend: 'pipeline', parse_method: config.ocr ? 'ocr' : 'txt', lang_list: config.language,
            return_content_list: 'true', return_md: 'false', return_images: 'false', response_format_zip: 'false' }
        for (const [key, value] of Object.entries(fields)) form.append(key, value)
        if (config.processor === 'docling') for (const language of config.language === 'ch' ? ['ch_sim', 'en'] : ['en']) form.append('ocr_lang', language)
        appendFormOptions(form, config.extraBody)
        const submitted = parse(await this.http.json(`${config.baseUrl}${config.processor === 'docling' ? '/v1/convert/file/async' : '/tasks'}`,
          { method: 'POST', headers, body: form }, signal, undefined, config.timeoutMs))
        taskId = saveTask(submitted.task_id)
      }
      row = { fingerprint, task_id: taskId, result_json: null }
    }
    let normalized: NormalizedDocument | undefined
    let rawArtifact: unknown
    const normalize = (raw: unknown): NormalizedDocument => {
      rawArtifact = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw
      if (Buffer.byteLength(JSON.stringify(rawArtifact), 'utf8') > MAX_RESULT) throw new AppError('DOCUMENT_TOO_LARGE', copy('knowledge.tooLarge'))
      return config.processor === 'docling' ? normalizeDoclingDocument(rawArtifact, pageCount) : normalizeMineruDocument(rawArtifact, pageCount)
    }
    if (row.raw_json) normalized = normalize(JSON.parse(row.raw_json))
    const deadline = Date.now() + 30 * 60_000
    while (!normalized) {
      signal.throwIfAborted()
      await this.yieldToQuestions(signal)
      if (Date.now() > deadline) throw new AppError('DOCUMENT_TIMEOUT', copy('knowledge.timeout'))
      if (config.processor === 'mineru-cloud') {
        const data = cloudData(await this.http.json(`${config.baseUrl}/api/v4/extract-results/batch/${row.task_id}`, { headers }, signal, undefined, config.timeoutMs))
        const results = z.array(object).length(1).parse(data.extract_result)
        const item = results[0]
        if (item.state === 'failed') failed()
        if (item.state === 'done') {
          const bytes = await this.http.request(cloudAssetUrl(item.full_zip_url, config.baseUrl), {}, signal, 100_000_000, 180_000)
          normalized = normalize(await contentListFromZip(bytes))
        // MinerU scans completed uploads asynchronously; waiting-file is also a normal queue state.
        } else if (!['waiting-file', 'pending', 'running', 'converting'].includes(String(item.state))) invalid()
      } else {
        const isDocling = config.processor === 'docling'
        const status = parse(await this.http.json(`${config.baseUrl}${isDocling ? '/v1/status/poll/' : '/tasks/'}${row.task_id}`, { headers }, signal, undefined, config.timeoutMs))
        const phase = isDocling ? status.task_status : status.status
        if (phase === 'failure' || phase === 'failed') failed()
        if (phase === 'success' || phase === 'completed') {
          const result = parse(await this.http.json(`${config.baseUrl}${isDocling ? '/v1/result/' : '/tasks/'}${row.task_id}${isDocling ? '' : '/result'}`, { headers }, signal, MAX_RESULT, config.timeoutMs))
          if (isDocling) {
            if (result.status !== 'success') failed()
            normalized = normalize(parse(result.document).json_content)
          } else {
            const results = Object.values(parse(result.results))
            if (results.length !== 1) invalid()
            normalized = normalize(parse(results[0]).content_list)
          }
        } else if (!['pending', 'started', 'processing'].includes(String(phase))) invalid()
      }
      if (!normalized) await delay(this.pollMs, undefined, { signal })
    }
    signal.throwIfAborted()
    const serialized = JSON.stringify(normalized)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_DOCUMENT_CACHE_BYTES) throw new AppError('DOCUMENT_TOO_LARGE', copy('knowledge.tooLarge'))
    const sections = documentSections(normalized)
    this.database.connection.prepare('UPDATE document_jobs SET result_json = ?, raw_json = ?, structure_json = ? WHERE book_id = ? AND fingerprint = ? AND task_id = ?')
      .run(JSON.stringify(sections), JSON.stringify(rawArtifact), serialized, bookId, fingerprint, row.task_id)
    return sections
  }
}
