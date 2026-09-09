import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ContextSnapshot, LlmEvent, LlmRequest, Passage, RerankRecord } from '../src/shared/contracts'
import { AppDatabase } from '../src/main/database'
import { BookContextStore } from '../src/main/book-context-store'
import { BookAnalysisService } from '../src/main/book-analysis'
import { LlmService, boundContext } from '../src/main/llm-service'
import type { ProviderService } from '../src/main/provider-service'
import { KnowledgeSettingsService } from '../src/main/knowledge-settings'
import { KnowledgeHttp } from '../src/main/knowledge-http'
import { SemanticIndexService } from '../src/main/semantic-index'
import { RerankService, type RerankConfigSnapshot } from '../src/main/rerank-service'
import { documentSections } from '../src/shared/document-structure'
import { createHardDocument, hardFacts, hardQuestions, hardFixtureVersion } from './knowledge-hard-fixture'

class MeasuredRanker extends RerankService {
  bypass = false
  candidates: Passage[] = []
  override async rank(config: RerankConfigSnapshot, query: string, candidates: Passage[], signal: AbortSignal) {
    this.candidates = candidates
    if (this.bypass) return { passages: candidates, record: { status: 'skipped', reason: 'disabled', model: config.model, candidateCount: candidates.length, elapsedMs: 0 } as RerankRecord }
    return super.rank(config, query, candidates, signal)
  }
}
export async function runHardEvaluation(options: { directory: string; label: string; fetcher: (kind: string) => typeof fetch; log: (text: string) => void }) {
  const { directory, label, log } = options
  await mkdir(join(directory, 'http-cache'), { recursive: true })
  // Only authored request bodies and public responses are cached; authentication is supplied by the main-process bridge.
  const cached = (kind: string): typeof fetch => async (input, init) => {
    const identity = createHash('sha256').update(String(input) + String(init?.body)).digest('hex')
    const path = join(directory, 'http-cache', identity + '.json')
    if (existsSync(path)) {
      const item = JSON.parse(await readFile(path, 'utf8'))
      return new Response(item.body, { status: item.status, headers: { 'content-type': item.contentType } })
    }
    const response = await options.fetcher(kind)(input, init)
    const body = await response.text(), contentType = response.headers.get('content-type') ?? ''
    if (response.ok) await writeFile(path, JSON.stringify({ kind, status: response.status, contentType, body }), 'utf8')
    return new Response(body, { status: response.status, headers: { 'content-type': contentType } })
  }
  const document = createHardDocument(), sections = documentSections(document)
  const db = new AppDatabase(join(directory, 'retrieval.sqlite3')), store = new BookContextStore(db)
  const bookId = '918b5716-a00e-4a11-beb5-cb1e9bb4d6bc'
  const credentials = { baseUrl: 'https://opencode.ai/zen/go', model: 'deepseek-v4-flash', apiKey: '', compatibility: 'auto' as const }
  const provider = { getCredentials: () => credentials }
  const planner = new LlmService(provider)
  planner.requestText = async () => { throw new Error('Fixed local fallback across all groups') }
  let lexical: Passage[] = []
  const retriever = { search: (...args: Parameters<BookContextStore['search']>) => { lexical = store.search(...args); return lexical } }
  const analysis = new BookAnalysisService(store, provider as unknown as ProviderService, planner, retriever)
  const settings = new KnowledgeSettingsService(db, { isAvailable: () => true, encrypt: (text) => Buffer.from(text), decrypt: (bytes) => Buffer.from(bytes).toString() })
  if (!db.getStoredBook(bookId)) {
    db.insertBook({ id: bookId, sha256: createHash('sha256').update(JSON.stringify(document)).digest('hex'), title: '站点资料管理手册（虚构评测）', author: null,
      format: 'txt', sourceFormat: 'txt', storedName: 'authored.txt', originalName: 'authored.txt', importedAt: new Date().toISOString(), lastOpenedAt: null, lastLocator: null, progress: 0 })
    store.prepare(bookId, randomUUID(), hardFixtureVersion); store.cacheDocument(bookId, document, sections.length); store.append(bookId, sections)
    store.db.prepare("UPDATE book_documents SET status = 'ready' WHERE book_id = ?").run(bookId)
    settings.save({ embedding: { enabled: true, baseUrl: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3' },
      rerank: { enabled: true, baseUrl: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-reranker-v2-m3' }, document: { processor: 'none', baseUrl: '', ocr: true, language: 'ch' } })
  }
  const semantic = new SemanticIndexService(store, settings, new KnowledgeHttp(cached('embedding'), '0.4.0'))
  const ranker = new MeasuredRanker(settings, new KnowledgeHttp(cached('rerank'), '0.4.0'))
  try {
    if (semantic.state(bookId).status !== 'ready') semantic.start({ bookId, rebuild: false })
    let reported = -1
    while (semantic.state(bookId).status === 'indexing') {
      const state = semantic.state(bookId)
      if (state.completed !== reported) { log(`embedding ${state.completed}/${state.total}`); reported = state.completed }
      await delay(500)
    }
    if (semantic.state(bookId).status !== 'ready') throw new Error('Live embedding index did not finish: ' + semantic.state(bookId).message)
    const reportPath = join(directory, label + '.json')
    const baselinePath = join(directory, 'baseline.json')
    const baseline = label !== 'baseline' && existsSync(baselinePath) ? JSON.parse(await readFile(baselinePath, 'utf8')) : undefined
    const report = existsSync(reportPath) ? JSON.parse(await readFile(reportPath, 'utf8')) : {
      fixtureVersion: hardFixtureVersion, label, date: new Date().toISOString(), blocks: sections.flatMap((section) => section.blocks).length,
      characters: document.units.reduce((sum, unit) => sum + Array.from(unit.text).length, 0), questions: hardQuestions, facts: hardFacts,
      planning: 'fixed production local fallback; no gold terms or notes', responseCache: 'real embedding and reranking outputs reused identically between runs', results: [] }
    await writeFile(join(directory, 'fixture.json'), JSON.stringify(document, null, 2), 'utf8')
    for (const item of hardQuestions) for (const group of ['fts', 'hybrid', 'expanded', 'rerank']) {
      if (report.results.some((row: { id: string; group: string }) => row.id === item.id && row.group === group)) continue
      analysis.semantic = group === 'fts' ? undefined : semantic
      analysis.rerank = group === 'fts' || group === 'hybrid' ? undefined : ranker
      ranker.bypass = group === 'expanded'
      const request: LlmRequest = { bookId, scope: 'book', requestId: randomUUID(), conversationId: randomUUID(), action: 'ask', question: item.question, history: [] }
      const source = await analysis.context(request, credentials, new AbortController().signal)
      const normal = boundContext(request, source, 6_000).context, reduced = boundContext(request, source, 3_000).context
      const hit = (passages: Passage[]) => item.expected.filter((id) => passages.some((passage) => passage.text.includes(hardFacts.find((fact) => fact[2] === id)![1])))
      const row = { id: item.id, group, split: item.split, expected: item.expected, finalHits: hit(normal.passages), reducedHits: hit(reduced.passages),
        poolHits: hit(group === 'expanded' || group === 'rerank' ? ranker.candidates : lexical), context: normal, reduced,
        answer: '', error: '', citationsValid: null as boolean | null, events: [] as LlmEvent[], answerSource: 'live' }
      const prior = baseline?.results.find((row: { id: string; group: string }) => row.id === item.id && row.group === group)
      const promptEvidence = (context: ContextSnapshot) => JSON.stringify({ ...context, rerank: undefined, planningUsage: undefined })
      if (prior && group !== 'expanded' && !prior.error && promptEvidence(prior.context) === promptEvidence(normal)) {
        row.answer = prior.answer; row.error = prior.error; row.citationsValid = prior.citationsValid; row.events = prior.events
        row.answerSource = 'baseline replay: identical sent evidence and question'
      } else if (group !== 'expanded') {
        const answerer = new LlmService(provider, options.fetcher('qa'), '0.4.0')
        answerer.contextProvider = async () => normal
        await new Promise<void>((resolve) => answerer.start({ ...request, question: item.question + '\n请在150字内作答，保留必要的原文引用；没有依据请明确说明。' }, (event) => {
          if (event.type === 'delta') row.answer += event.delta
          else row.events.push(event)
          if (event.type === 'error') row.error = event.code
          if (event.type === 'completed' || event.type === 'error') resolve()
        }))
        const sent = row.events.filter((event) => event.type === 'context').at(-1) as { context: ContextSnapshot } | undefined
        const citations = [...row.answer.matchAll(/\[P(\d+)\]/gu)].map((match) => 'P' + match[1])
        row.citationsValid = citations.every((id) => sent?.context.passages.some((passage) => passage.id === id))
      }
      report.results.push(row)
      await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
      log(`${label} ${item.id} ${group}: evidence ${row.finalHits.length}/${item.expected.length}, answer ${row.error || (group === 'expanded' ? 'control' : 'ok')}`)
    }
    return { questions: hardQuestions.length, blocks: report.blocks, characters: report.characters, rows: report.results.length }
  } finally { semantic.dispose(); analysis.dispose(); db.close() }
}
