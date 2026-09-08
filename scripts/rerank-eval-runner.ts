import { randomUUID } from 'node:crypto'
import packageMetadata from '../package.json'
import type { LlmRequest, Passage, RerankRecord } from '../src/shared/contracts'
import { AppDatabase } from '../src/main/database'
import { BookContextStore } from '../src/main/book-context-store'
import { BookAnalysisService } from '../src/main/book-analysis'
import { LlmService, boundContext } from '../src/main/llm-service'
import type { ProviderService } from '../src/main/provider-service'
import { KnowledgeSettingsService } from '../src/main/knowledge-settings'
import { KnowledgeHttp } from '../src/main/knowledge-http'
import { RerankService, type RerankConfigSnapshot } from '../src/main/rerank-service'
import { uniqueEvidence } from '../src/main/rerank-evidence'
import { createRerankFixture, evaluationCases, fixtureVersion } from './rerank-fixture'

class EvaluationReranker extends RerankService {
  candidates: Passage[] = []
  bypass = false
  override async rank(config: RerankConfigSnapshot, query: string, candidates: Passage[], signal: AbortSignal) {
    this.candidates = candidates
    if (this.bypass) return { passages: candidates, record: { status: 'skipped', model: '', candidateCount: candidates.length, elapsedMs: 0, reason: 'disabled' } as RerankRecord }
    return super.rank(config, query, candidates, signal)
  }
}
export async function runRerankEvaluation(options: { live?: boolean; baseUrl?: string; model?: string; apiKey?: string } = {}) {
  const db = new AppDatabase(':memory:'), store = new BookContextStore(db), bookId = randomUUID()
  try {
    const sections = createRerankFixture()
    const originalText = new Map(sections.flatMap((section) => section.blocks.map((block) => [block.id, block.text] as const)))
    db.insertBook({ id: bookId, sha256: 'e'.repeat(64), title: '分证判断固定评测', author: null, format: 'txt', sourceFormat: 'txt', originalName: 'fixture.txt', storedName: 'fixture.txt', importedAt: '1', lastOpenedAt: null, lastLocator: null, progress: 0 })
    store.reset(bookId, randomUUID(), 'fixture', 'authored-notes', 'fixture-v1'); store.append(bookId, sections)
    for (const section of sections) store.saveNote(bookId, section.id, {
      summary: `本节属于${section.chapterTitle}。`, claims: [{ text: '本节起始原文', sourceIds: [section.blocks[0].id] }], conditions: [], exceptions: [], concepts: []
    })
    store.status(bookId, 'ready')
    const credentials = { baseUrl: 'http://127.0.0.1', model: 'unused', apiKey: '', compatibility: 'auto' as const }
    const provider = { getCredentials: () => credentials }, llm = new LlmService(provider)
    // Fix the planner to its production fallback in all groups. No extra planning calls or gold-label terms.
    llm.requestText = async () => { throw new Error('Fixed local planning fallback') }
    let lexical: Passage[] = []
    const retriever = { search: (...args: Parameters<BookContextStore['search']>) => { lexical = store.search(...args); return lexical } }
    const analysis = new BookAnalysisService(store, provider as unknown as ProviderService, llm, retriever)
    const settings = new KnowledgeSettingsService(db, { isAvailable: () => true, encrypt: (value) => Buffer.from(value), decrypt: (value) => Buffer.from(value).toString() })
    // The in-memory fixture has no persistent credentials. Real key is supplied only to the request snapshot below.
    settings.save({ embedding: { enabled: false, baseUrl: '', model: '' }, document: { processor: 'none', baseUrl: '', ocr: true, language: 'ch' },
      rerank: { enabled: true, baseUrl: options.baseUrl ?? 'https://api.siliconflow.cn/v1', model: options.model ?? 'BAAI/bge-reranker-v2-m3' } })
    const ranker = new EvaluationReranker(settings, new KnowledgeHttp(fetch, packageMetadata.version))
    if (options.apiKey) { const snapshot = ranker.snapshot(); ranker.snapshot = () => ({ ...snapshot, apiKey: options.apiKey! }) }
    const results = []
    for (const item of evaluationCases) {
      let expandedIds: string[] | undefined
      for (const group of ['current', 'expanded', 'reranked'] as const) {
        if (group === 'reranked' && !options.live) { results.push({ id: item.id, group, status: 'unverified' as const, metrics: null }); continue }
        analysis.rerank = group === 'current' ? undefined : ranker
        ranker.bypass = group === 'expanded'
        const request: LlmRequest = { scope: 'book', bookId, requestId: randomUUID(), conversationId: randomUUID(), action: 'ask', question: item.question, history: [] }
        const source = await analysis.context(request, credentials, new AbortController().signal)
        const pool = group === 'current' ? uniqueEvidence([...lexical, ...source.passages]) : ranker.candidates
        const ids = pool.map((item) => item.blockId!)
        if (group === 'expanded') expandedIds = ids
        if (group === 'reranked' && JSON.stringify(ids) !== JSON.stringify(expandedIds)) throw new Error('Comparison candidate pools differ')
        const final = boundContext(request, source, 6_000).context
        const reduced = boundContext(request, source, 3_000).context
        const hits = (passages: Passage[]) => item.expected.filter((id) => passages.some((passage) => passage.blockId === id && passage.text.includes(originalText.get(id)!)))
        const chapters = (passages: Passage[]) => item.chapters.filter((id) => passages.some((passage) => passage.chapterId === id))
        results.push({ id: item.id, group, status: source.rerank?.status === 'fallback' ? 'fallback' : 'measured',
          metrics: { expected: item.expected.length, candidateHits: hits(pool), finalHits: hits(final.passages), reducedHits: hits(reduced.passages),
            expectedChapters: item.chapters, coveredChapters: chapters(final.passages), reducedChapters: chapters(reduced.passages),
            candidateCount: pool.length, finalCount: final.passages.length, rerankMs: group === 'reranked' ? source.rerank?.elapsedMs ?? null : null },
          candidateIds: ids, finalIds: final.passages.map((item) => item.blockId), rerank: source.rerank,
          finalEvidence: final.passages.map(({ id, blockId, chapterId, text }) => ({ id, blockId, chapterId, text })) })
      }
    }
    return { fixtureVersion, questions: evaluationCases.length, blocks: sections.flatMap((section) => section.blocks).length,
      characters: sections.flatMap((section) => section.blocks).reduce((sum, block) => sum + Array.from(block.text).length, 0),
      planning: 'fixed local fallback', retrieval: 'SQLite FTS only; no embedding credentials or synthetic vectors',
      chapterNotes: 'fixed authored source pointers, identical across all groups', model: options.model ?? 'BAAI/bge-reranker-v2-m3',
      realRerankVerified: Boolean(options.live && results.filter((item) => item.group === 'reranked').every((item) => item.status === 'measured')),
      fullAnswerReview: 'unverified: requires authorized QA and rerank credentials; mock answers are not quality evidence',
      cases: evaluationCases, results }
  } finally { db.close() }
}
