/* global process, URL, window */
import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { createEvaluationSession } from './knowledge-eval-session.mjs'

const output = resolve('output/knowledge-hard-20260909')
await mkdir(output, { recursive: true })
const textLayer = process.argv.includes('--text-layer')
const fixedCmap = process.argv.includes('--fixed-cmap')
const suffix = textLayer ? fixedCmap ? '-text-layer-fixed' : '-text-layer' : ''
const session = await createEvaluationSession(textLayer ? `tmp/knowledge-hard-pdf-text${fixedCmap ? '-fixed' : ''}-20260909` : 'tmp/knowledge-hard-pdf-20260909')
const { application, page } = session
const reportPath = join(output, `pdf${suffix}-live.json`)
const report = existsSync(reportPath) ? JSON.parse(await readFile(reportPath, 'utf8')) : { startedAt: new Date().toISOString(), variants: [], personalContent: false }
try {
  await page.getByTestId('app-shell').waitFor({ state: 'visible' })
  if (textLayer) {
    await page.evaluate(async () => {
      const current = await window.readerApi.getKnowledgeSettings()
      const embedding = { enabled: current.embedding.enabled, baseUrl: current.embedding.baseUrl, model: current.embedding.model }
      const rerank = { enabled: current.rerank.enabled, baseUrl: current.rerank.baseUrl, model: current.rerank.model }
      const document = { processor: current.document.processor, baseUrl: current.document.baseUrl, language: current.document.language, ocr: false }
      await window.readerApi.saveKnowledgeSettings({ embedding, rerank, document })
    })
  }
  await application.evaluate(() => {
    const { channel } = process.getBuiltinModule('node:diagnostics_channel')
    globalThis.__pdfTrace = []
    const pending = new WeakMap()
    channel('undici:request:create').subscribe(({ request }) => {
      const url = new URL(request.path, request.origin)
      const relevant = url.hostname === 'mineru.net' || url.hostname.endsWith('.aliyuncs.com') || url.hostname === 'cdn-mineru.openxlab.org.cn'
      if (!relevant) return
      const item = { host: url.hostname, method: request.method, operation: url.hostname === 'mineru.net' ? url.pathname.includes('/file-urls/') ? 'create-batch' : 'poll' : request.method === 'PUT' ? 'upload' : 'download' }
      globalThis.__pdfTrace.push(item); pending.set(request, item)
    })
    channel('undici:request:headers').subscribe(({ request, response }) => { const item = pending.get(request); if (item) item.status = response.statusCode })
  })
  for (const variant of textLayer ? ['digital'] : ['digital', 'scanned']) {
    if (report.variants.some((item) => item.variant === variant && item.ready)) continue
    const path = resolve('output/pdf', 'knowledge-hard-' + variant + '.pdf')
    let books = await page.evaluate(() => window.readerApi.listBooks())
    let book = books.find((item) => item.originalName === 'knowledge-hard-' + variant + '.pdf' || item.title === 'knowledge-hard-' + variant)
    if (!book) {
      await application.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ filePaths: [path], canceled: false }) }, path)
      await page.evaluate(() => window.readerApi.importBooks())
      books = await page.evaluate(() => window.readerApi.listBooks())
      book = books.find((item) => item.id !== report.variants[0]?.bookId)
    }
    if (!book) throw new Error('Fixture import failed')
    const started = Date.now()
    await page.evaluate((bookId) => window.readerApi.prepareBookDocument({ bookId }), book.id)
    let state, last = ''
    while (Date.now() - started < 600_000) {
      state = await page.evaluate((bookId) => window.readerApi.getBookAnalysis(bookId), book.id)
      const status = state.document?.status ?? state.status
      if (status !== last) { process.stdout.write(`${variant}: ${status}\n`); last = status }
      if (status === 'ready' || status === 'error' || status === 'paused') break
      await delay(1500)
    }
    const database = new DatabaseSync(join(session.userData, 'reader.sqlite3'), { readOnly: true })
    let extracted
    try {
      const job = database.prepare('SELECT raw_json, structure_json, result_json FROM document_jobs WHERE book_id = ?').get(book.id)
      extracted = { raw: job?.raw_json ? JSON.parse(job.raw_json) : null, structure: job?.structure_json ? JSON.parse(job.structure_json) : null,
        blocks: database.prepare('SELECT block_id, text, anchor, metadata_json FROM book_blocks WHERE book_id = ? ORDER BY ordinal').all(book.id) }
    } finally { database.close() }
    await writeFile(join(output, `pdf-${variant}${suffix}-extraction.json`), JSON.stringify(extracted, null, 2), 'utf8')
    report.variants.push({ variant, bookId: book.id, sha256: createHash('sha256').update(await readFile(path)).digest('hex'), ready: state.document?.status === 'ready', elapsedMs: Date.now() - started, state,
      nodes: extracted.structure?.nodes.length ?? 0, units: extracted.structure?.units.length ?? 0, blocks: extracted.blocks.length })
    report.trace = await application.evaluate(() => globalThis.__pdfTrace)
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
    process.stdout.write(JSON.stringify(report.variants.at(-1)) + '\n')
  }
} finally { await session.close() }
