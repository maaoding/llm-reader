import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { AppError } from '../../src/main/errors'
import { BookContextStore, searchTokens } from '../../src/main/book-context-store'
import { BookAnalysisService, parseNote } from '../../src/main/book-analysis'
import { boundContext, LlmService, selectContextPassages } from '../../src/main/llm-service'
import type { ProviderService } from '../../src/main/provider-service'
import { bookExtractionBatchSchema, insightHistorySchema, insightSchema, startBookAnalysisSchema } from '../../src/main/schemas'
import type { BookAnalysisState, ContextSnapshot, DocumentSection, LlmEvent, LlmRequest } from '../../src/shared/contracts'
import type { SectionNote } from '../../src/shared/book-context'

const resources: Array<{ database: AppDatabase; service: BookAnalysisService }> = []
afterEach(async () => {
  for (const { service } of resources) service.dispose()
  await new Promise((resolve) => setTimeout(resolve, 120))
  for (const { database } of resources.splice(0)) database.close()
  vi.restoreAllMocks()
})

function section(order: number, text = '从众是个体受到群体压力而改变判断。'): DocumentSection {
  return { id: `c${order}-s0`, chapterId: `c${order}`, chapterTitle: `第${order + 1}章`, order,
    blocks: [{ id: `c${order}-p0`, text, anchor: `txt:${order * 200}:${order * 200 + Array.from(text).length}`, kind: 'paragraph' }] }
}
function note(input: DocumentSection): SectionNote {
  const sourceIds = [input.blocks[0].id]
  return { summary: '本节说明群体压力影响判断，并区分自主判断。', claims: [{ text: input.blocks[0].text, sourceIds }], conditions: [], exceptions: [],
    concepts: input.blocks[0].text.includes('从众') ? [{ term: '从众', aliases: ['随大流', 'conformity'], text: input.blocks[0].text, sourceIds }] : [] }
}
function setup() {
  const database = new AppDatabase(':memory:')
  const bookId = randomUUID()
  const profileId = randomUUID()
  database.insertBook({ id: bookId, sha256: 'a'.repeat(64), title: '全书样本', author: null, format: 'txt', sourceFormat: 'txt',
    originalName: '全书样本.txt', storedName: 'sample.txt', importedAt: '2026-01-01', lastOpenedAt: null, lastLocator: null, progress: 0 })
  database.createProviderProfile({ id: profileId, name: '分析配置', base_url: 'http://127.0.0.1', model: 'analysis-model', compatibility: 'auto', is_active: 0, created_at: '1', updated_at: '1' })
  const credentials = { baseUrl: 'http://127.0.0.1', model: 'question-model', apiKey: 'test-only', compatibility: 'auto' as const }
  const provider = { getCredentials: vi.fn((id?: string) => ({ ...credentials, model: id ? 'analysis-model' : 'question-model' })) }
  const llm = new LlmService(provider)
  const generate = vi.spyOn(llm, 'requestText').mockImplementation(async (_credentials, messages) => {
    if (messages[0].content.includes('为阅读问题')) return { text: JSON.stringify({ chapters: ['c0'], terms: ['随大流'] }) }
    const input = JSON.parse(messages[1].content) as DocumentSection | string[]
    return { text: Array.isArray(input) ? '全书通过定义、对照与限制解释群体判断。' : JSON.stringify(note(input)), usage: { totalTokens: 10 } }
  })
  const store = new BookContextStore(database)
  const service = new BookAnalysisService(store, provider as unknown as ProviderService, llm, store, 0)
  resources.push({ database, service })
  return { database, bookId, profileId, credentials, provider, llm, generate, store, service }
}
async function prepare(state: ReturnType<typeof setup>, sections = [section(0), section(1, '独立判断强调对证据的自主检验。')]) {
  const job = { jobId: state.service.prepare({ bookId: state.bookId }).document!.jobId }
  state.service.append({ bookId: state.bookId, jobId: job.jobId, sections })
  state.service.finish({ bookId: state.bookId, jobId: job.jobId })
  state.service.start({ bookId: state.bookId, profileId: state.profileId })
  await vi.waitFor(() => expect(state.service.state(state.bookId).status).toBe('ready'))
}

function cachedOverview(state: ReturnType<typeof setup>) {
  const job = { jobId: state.service.prepare({ bookId: state.bookId }).document!.jobId }
  const sections = Array.from({ length: 45 }, (_, index) => ({ ...section(index), chapterId: `c${index % 17}`, chapterTitle: `第${index % 17 + 1}章` }))
  state.service.append({ bookId: state.bookId, jobId: job.jobId, sections })
  state.service.finish({ bookId: state.bookId, jobId: job.jobId })
  state.service.start({ bookId: state.bookId, profileId: state.profileId })
  state.service.cancel(state.bookId)
  for (const input of sections) {
    state.store.saveNote(state.bookId, input.id, note(input))
    state.store.saveSummary(state.bookId, `chapter-${input.chapterId}-final`, '本章讨论判断及限制。'.repeat(50))
  }
  state.store.saveSummary(state.bookId, 'book-0-0', '第一组章节综合笔记。')
  state.store.saveSummary(state.bookId, 'book-0-1', '第二组章节综合笔记。')
  return job
}

describe('analysis failure recovery', () => {
  it('repairs an oversized final overview with the original inputs, preserving cached chapters, IDs and usage', async () => {
    const state = setup()
    cachedOverview(state)
    const before = state.store.record(state.bookId)!
    const progress: BookAnalysisState[] = []
    state.service.onState = (value) => progress.push(value)
    state.generate.mockResolvedValueOnce({ text: '😀'.repeat(1601), usage: { totalTokens: 11 } })
      .mockResolvedValueOnce({ text: '完整的核心论点、概念关系及重要限制。', usage: { totalTokens: 13 } })
    state.service.start({ bookId: state.bookId, profileId: state.profileId })
    await vi.waitFor(() => expect(state.service.state(state.bookId).status).toBe('ready'))
    expect(state.generate).toHaveBeenCalledTimes(2)
    expect(state.generate.mock.calls[0][1][1]).toEqual(state.generate.mock.calls[1][1][1])
    expect(state.generate.mock.calls[1][1][0].content).toContain('返回1601字符')
    expect(state.generate.mock.calls.every(([, , context, , , timeout]) => context.sessionId === before.session_id && timeout === 180_000)).toBe(true)
    expect(state.store.record(state.bookId)).toMatchObject({ fingerprint: before.fingerprint, session_id: before.session_id, overview: '完整的核心论点、概念关系及重要限制。' })
    expect(state.store.summary(state.bookId, 'book-0-0')).toBe('第一组章节综合笔记。')
    expect(progress.some((value) => value.progress?.stage === 'chapters' && value.progress.completed === 17)).toBe(true)
    expect(progress.some((value) => value.progress?.stage === 'overview' && value.progress.round === 2 && value.progress.retryAttempt === 2)).toBe(true)
    expect(state.service.state(state.bookId)).toMatchObject({ completedSections: 45, usage: { totalTokens: 24 },
      failures: [{ code: 'ANALYSIS_SUMMARY_TOO_LONG', responseCharacters: 1601, stage: 'overview', attempt: 1 }] })
    expect(JSON.stringify(state.service.state(state.bookId).failures)).not.toContain('😀')
  })

  it('stops after three invalid summaries and preserves diagnostics through restart and a cache-only resume', async () => {
    const state = setup()
    cachedOverview(state)
    const sessionId = state.store.record(state.bookId)!.session_id
    state.generate.mockResolvedValue({ text: '超'.repeat(1700) })
    state.service.start({ bookId: state.bookId, profileId: state.profileId })
    await vi.waitFor(() => expect(state.service.state(state.bookId).status).toBe('error'))
    expect(state.generate).toHaveBeenCalledTimes(3)
    expect(state.service.state(state.bookId).message).toContain('1700 字符')
    expect(state.service.state(state.bookId).failures).toHaveLength(3)
    expect(state.store.summary(state.bookId, 'book-1-0')).toBeNull()
    state.service.dispose()
    const restarted = new BookAnalysisService(state.store, state.provider as unknown as ProviderService, state.llm, state.store, 0)
    resources.push({ database: state.database, service: restarted })
    resources.splice(resources.findIndex((resource) => resource.service === state.service), 1)
    expect(restarted.state(state.bookId).failures).toHaveLength(3)
    expect(state.generate).toHaveBeenCalledTimes(3)
    state.generate.mockResolvedValue({ text: '修复后的全书笔记。' })
    restarted.start({ bookId: state.bookId, profileId: state.profileId })
    await vi.waitFor(() => expect(restarted.state(state.bookId).status).toBe('ready'))
    expect(state.generate).toHaveBeenCalledTimes(4)
    expect(restarted.state(state.bookId).failures).toHaveLength(3)
    expect(state.store.record(state.bookId)?.session_id).toBe(sessionId)
    state.database.deleteBook(state.bookId)
    expect(state.database.connection.prepare('SELECT count(*) AS n FROM book_analysis_failures').get()).toMatchObject({ n: 0 })
  })

  it('retries timeout and rate-limit errors within one attempt budget, but stops immediately for credentials', async () => {
    const state = setup()
    cachedOverview(state)
    state.generate.mockRejectedValueOnce(new AppError('TIMEOUT', 'timeout', true))
      .mockRejectedValueOnce(new AppError('RATE_LIMITED', '服务繁忙', true))
      .mockResolvedValueOnce({ text: '已恢复的全书笔记。' })
    state.service.start({ bookId: state.bookId, profileId: state.profileId })
    await vi.waitFor(() => expect(state.service.state(state.bookId).status).toBe('ready'))
    expect(state.generate).toHaveBeenCalledTimes(3)
    expect(state.service.state(state.bookId).failures?.map((failure) => failure.code)).toEqual(['RATE_LIMITED', 'TIMEOUT'])
    expect(state.service.state(state.bookId).failures?.[1].message).toContain('3 分钟')
    state.store.db.prepare("DELETE FROM book_summaries WHERE book_id = ? AND node_id = 'book-1-0'").run(state.bookId)
    state.store.status(state.bookId, 'error')
    state.generate.mockClear().mockRejectedValue(new AppError('HTTP_401', 'API 密钥无效'))
    state.service.start({ bookId: state.bookId, profileId: state.profileId })
    await vi.waitFor(() => expect(state.service.state(state.bookId).status).toBe('error'))
    expect(state.generate).toHaveBeenCalledTimes(1)
  })

  it('cancels a retry before another paid request and resumes with the same analysis session', async () => {
    const state = setup()
    cachedOverview(state)
    const sessionId = state.store.record(state.bookId)!.session_id
    state.generate.mockResolvedValueOnce({ text: '  \n  ' }).mockResolvedValue({ text: '有效全书笔记。' })
    state.service.onState = (value) => { if (value.progress?.retryAttempt === 2 && value.status === 'analyzing') state.service.cancel(state.bookId) }
    state.service.start({ bookId: state.bookId, profileId: state.profileId })
    await vi.waitFor(() => expect(state.service.state(state.bookId).status).toBe('paused'))
    expect(state.generate).toHaveBeenCalledTimes(1)
    expect(state.service.state(state.bookId).failures?.[0].code).toBe('ANALYSIS_SUMMARY_EMPTY')
    state.service.onState = () => undefined
    state.service.start({ bookId: state.bookId, profileId: state.profileId })
    await vi.waitFor(() => expect(state.service.state(state.bookId).status).toBe('ready'))
    expect(state.generate).toHaveBeenCalledTimes(2)
    expect(state.generate.mock.calls.every(([, , context]) => context.sessionId === sessionId)).toBe(true)
  })
})

describe('book preparation and retrieval', () => {
  it('indexes Chinese bigrams and concept aliases, and isolates books and cascaded deletion', async () => {
    const state = setup()
    await prepare(state)
    expect(searchTokens('从众')).toContain('从众')
    expect(state.store.search(state.bookId, 'conformity')[0].text).toContain('从众')
    expect(state.store.search(randomUUID(), '从众')).toEqual([])
    expect(state.store.search(state.bookId, '" OR * : ()')).toEqual([])
    expect(state.store.search(state.bookId, '量子纠缠')).toEqual([])
    expect(state.service.state(state.bookId)).toMatchObject({ completedSections: 2, sections: 2, usage: { totalTokens: 50 } })
    state.database.deleteBook(state.bookId)
    expect(state.store.db.prepare('SELECT count(*) AS n FROM book_fts').get()).toMatchObject({ n: 0 })
    expect(state.store.sections(state.bookId)).toEqual([])
  })

  it('uses the analysis profile without changing the active question profile; activation does not invalidate it', async () => {
    const state = setup()
    state.database.activateProviderProfile(state.profileId)
    expect(state.database.getProviderProfile(state.profileId)?.updated_at).toBe('1')
    await prepare(state)
    expect(state.generate.mock.calls.every(([credentials]) => credentials.model === 'analysis-model')).toBe(true)
    const sessionId = state.store.record(state.bookId)!.session_id
    expect(state.generate.mock.calls.every(([, , context]) => context.sessionId === sessionId)).toBe(true)
    const request: LlmRequest = { conversationId: randomUUID(), scope: 'book', bookId: state.bookId, requestId: 'question', action: 'ask', question: '随大流是什么意思', history: [] }
    const context = await state.service.context(request, state.credentials, new AbortController().signal)
    expect(state.generate.mock.lastCall?.[0].model).toBe('question-model')
    expect(state.generate.mock.lastCall?.[2].sessionId).toBe(request.conversationId)
    expect(request.conversationId).not.toBe(sessionId)
    expect(context.coverage).toEqual({ covered: 2, total: 2 })
    expect(context.passages.some((passage) => passage.text.includes('从众'))).toBe(true)
  })

  it('rejects forged note references and batches from stale extraction jobs', () => {
    const state = setup()
    const input = section(0)
    const forged = note(input)
    forged.claims[0].sourceIds = ['c1-p0']
    expect(() => parseNote(JSON.stringify(forged), input)).toThrow()
    const job = { jobId: state.service.prepare({ bookId: state.bookId }).document!.jobId }
    expect(() => state.service.append({ bookId: state.bookId, jobId: randomUUID(), sections: [input] })).toThrow()
    expect(() => state.service.append({ bookId: state.bookId, jobId: job.jobId, sections: [section(1)] })).toThrow()
    expect(state.store.sections(state.bookId)).toEqual([])
    const batch = { bookId: state.bookId, jobId: job.jobId, sections: [input] }
    expect(bookExtractionBatchSchema.safeParse(batch).success).toBe(true)
    state.service.append(batch)
    expect(() => state.service.append(batch)).toThrow()
    expect(state.store.sections(state.bookId)).toHaveLength(1)
  })

  it('pauses at a section boundary, retains completed work and resumes only on request', async () => {
    const state = setup()
    state.service.onState = (progress) => { if (progress.status === 'analyzing' && progress.completedSections === 1) state.service.cancel(state.bookId) }
    const job = { jobId: state.service.prepare({ bookId: state.bookId }).document!.jobId }
    state.service.append({ bookId: state.bookId, jobId: job.jobId, sections: [section(0), section(1)] })
    state.service.finish({ bookId: state.bookId, jobId: job.jobId })
  state.service.start({ bookId: state.bookId, profileId: state.profileId })
    await vi.waitFor(() => expect(state.service.state(state.bookId).status).toBe('paused'))
    expect(state.generate).toHaveBeenCalledTimes(1)
    const sessionId = state.store.record(state.bookId)!.session_id
    state.service.onState = () => undefined
    state.service.start({ bookId: state.bookId, profileId: state.profileId })
    await vi.waitFor(() => expect(state.service.state(state.bookId).status).toBe('ready'))
    expect(state.generate.mock.calls.filter(([, messages]) => messages[1].content.includes('"id":"c0-s0"'))).toHaveLength(1)
    expect(state.store.record(state.bookId)?.job_id).not.toBe(job.jobId)
    expect(state.generate.mock.calls.every(([, , context]) => context.sessionId === sessionId)).toBe(true)
  })

  it('yields analysis to foreground questions and pauses persisted active jobs on startup', async () => {
    const state = setup()
    const busy = vi.spyOn(state.llm, 'isBusy', 'get').mockReturnValue(true)
    const job = { jobId: state.service.prepare({ bookId: state.bookId }).document!.jobId }
    state.service.append({ bookId: state.bookId, jobId: job.jobId, sections: [section(0)] })
    state.service.finish({ bookId: state.bookId, jobId: job.jobId })
  state.service.start({ bookId: state.bookId, profileId: state.profileId })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(state.generate).not.toHaveBeenCalled()
    state.service.dispose()
    state.store.status(state.bookId, 'analyzing')
    const restarted = new BookAnalysisService(state.store, state.provider as unknown as ProviderService, state.llm)
    expect(restarted.state(state.bookId).status).toBe('paused')
    expect(state.generate).not.toHaveBeenCalled()
    busy.mockReturnValue(false)
    restarted.dispose()
  })

  it('rejects resume after model configuration changes and supports a clean rebuild', async () => {
    const state = setup()
    await prepare(state)
    const previousSession = state.store.record(state.bookId)!.session_id
    state.database.updateProviderProfile(state.profileId, '更改配置', 'http://127.0.0.1', 'changed-model', '2')
    expect(() => state.service.start({ bookId: state.bookId, profileId: state.profileId })).toThrow()
    state.service.start({ bookId: state.bookId, profileId: state.profileId, rebuild: true })
    expect(state.store.record(state.bookId)?.session_id).not.toBe(previousSession)
    expect(state.service.state(state.bookId)).toMatchObject({ status: 'analyzing', completedSections: 0, document: { status: 'ready' } })
    expect(state.store.search(state.bookId, '从众').length).toBeGreaterThan(0)
    state.service.profileChanged(state.profileId)
    expect(state.service.state(state.bookId).status).toBe('paused')
  })

  it('retains earlier notes after malformed output and recovers on resume', async () => {
    const state = setup()
    const normal = state.generate.getMockImplementation()!
    state.generate.mockImplementation(async (...args) => args[1][1].content.includes('"id":"c1-s0"') ? { text: '{invalid' } : normal(...args))
    const job = { jobId: state.service.prepare({ bookId: state.bookId }).document!.jobId }
    state.service.append({ bookId: state.bookId, jobId: job.jobId, sections: [section(0), section(1)] })
    state.service.finish({ bookId: state.bookId, jobId: job.jobId })
  state.service.start({ bookId: state.bookId, profileId: state.profileId })
    await vi.waitFor(() => expect(state.service.state(state.bookId).status).toBe('error'))
    expect(state.service.state(state.bookId).completedSections).toBe(1)
    const sessionId = state.store.record(state.bookId)!.session_id
    state.generate.mockImplementation(normal)
    state.service.start({ bookId: state.bookId, profileId: state.profileId })
    await vi.waitFor(() => expect(state.service.state(state.bookId).status).toBe('ready'))
    expect(state.generate.mock.calls.every(([, , context]) => context.sessionId === sessionId)).toBe(true)
  })

  it('restarts extraction without an analysis profile and detects compatibility-only note changes', async () => {
    const state = setup()
    const job = state.service.prepare({ bookId: state.bookId }).document!
    expect(state.store.record(state.bookId)).toBeUndefined()
    state.service.append({ bookId: state.bookId, jobId: job.jobId, sections: [section(0)] })
    state.service.cancelPreparation(state.bookId)
    const next = state.service.prepare({ bookId: state.bookId }).document!
    expect(next.jobId).not.toBe(job.jobId)
    state.service.append({ bookId: state.bookId, jobId: next.jobId, sections: [section(0)] })
    state.service.finish({ bookId: state.bookId, jobId: next.jobId })
    state.service.start({ bookId: state.bookId, profileId: state.profileId })
    await vi.waitFor(() => expect(state.service.state(state.bookId).status).toBe('ready'))
    state.database.updateProviderProfile(state.profileId, '分析配置', 'http://127.0.0.1', 'analysis-model', '1', 'opencode-go')
    expect(() => state.service.start({ bookId: state.bookId, profileId: state.profileId })).toThrow()
    expect(state.service.state(state.bookId).document?.status).toBe('ready')
  })

  it('falls back locally on a failed planner, plans once per turn, and never requires tool support', async () => {
    const state = setup()
    await prepare(state)
    state.generate.mockClear().mockRejectedValue(new Error('provider unavailable'))
    const request: LlmRequest = { conversationId: randomUUID(), scope: 'book', bookId: state.bookId, requestId: 'question', action: 'ask', question: 'conformity', history: [] }
    const context = await state.service.context(request, state.credentials, new AbortController().signal)
    expect(state.generate).toHaveBeenCalledTimes(1)
    expect(context.passages.some((passage) => passage.text.includes('从众'))).toBe(true)
    await state.service.context({ ...request, question: '下一问' }, state.credentials, new AbortController().signal)
    expect(state.generate).toHaveBeenCalledTimes(2)
  })

  it('retrieves remote definitions, synonyms and chapter comparisons beyond the old 6000-character window', async () => {
    const state = setup()
    const sections = [section(0), section(1, '独立判断强调对证据的自主检验。'), section(2, '只有存在群体压力且改变判断时，才属于这里讨论的从众。')]
    await prepare(state, sections)
    state.generate.mockRejectedValue(new Error('planner unavailable'))
    const selection = { bookId: state.bookId, quote: '这里应联系前文的定义。', anchor: 'txt:20000:20012', chapterTitle: '后记',
      passages: [{ id: 'P999', text: '这里应联系前文的定义。' + '后记中的无关文字。'.repeat(800), anchor: 'txt:20000:28000' }] }
    const cases = [
      { question: '从众的定义是什么？', evidence: ['从众是个体'] },
      { question: 'conformity 是什么意思？', evidence: ['从众是个体'] },
      { question: '比较从众与独立判断', evidence: ['从众是个体', '独立判断强调'] },
      { question: '全书如何论证判断与群体压力的关系？', evidence: ['从众是个体', '独立判断强调', '只有存在群体压力'] }
    ]
    const baseline = selectContextPassages(selection, 6000).map((passage) => passage.text).join('\n')
    for (const item of cases) {
      const request: LlmRequest = { conversationId: randomUUID(), scope: 'book', bookId: state.bookId, requestId: randomUUID(), action: 'ask', question: item.question, history: [] }
      const context = boundContext(request, await state.service.context(request, state.credentials, new AbortController().signal), 6000).context
      for (const evidence of item.evidence) {
        expect(baseline).not.toContain(evidence)
        expect(context.passages.some((passage) => passage.text.includes(evidence))).toBe(true)
      }
    }
    const paragraph: LlmRequest = { conversationId: randomUUID(), selection, requestId: randomUUID(), action: 'ask', question: '从众是什么？', history: [] }
    const enriched = boundContext(paragraph, await state.service.context(paragraph, state.credentials, new AbortController().signal), 6000).context
    expect(enriched.passages[0].text).toBe(selection.quote)
    expect(enriched.passages.some((passage) => passage.text.includes('从众是个体'))).toBe(true)
    // Intentional lexical baseline limitation: an unlisted, purely implicit paraphrase still misses.
    expect(state.store.search(state.bookId, '跟风')).toEqual([])
    expect(state.store.search(state.bookId, '量子纠缠')).toEqual([])
  })

  it('supplies the full chapter summary for a long chapter beyond the first eight section notes', async () => {
    const state = setup()
    const normal = state.generate.getMockImplementation()!
    state.generate.mockImplementation(async (...args) => {
      const messages = args[1]
      if (!messages[0].content.includes('综合这些笔记')) return normal(...args)
      const items = JSON.parse(messages[1].content) as string[]
      return { text: items[0].startsWith('长章节：') ? '全书概览。' : '章节结论：后半章补充了证据不足时的限制。' }
    })
    await prepare(state, Array.from({ length: 10 }, (_, index) => ({ ...section(index), chapterId: 'c0', chapterTitle: '长章节' })))
    const selection = { bookId: state.bookId, quote: '后半章的一句话', anchor: 'txt:1900:1907', chapterTitle: '长章节', passages: [{ id: 'P1', text: '后半章的一句话', anchor: 'txt:1900:1907' }] }
    const request: LlmRequest = { conversationId: randomUUID(), requestId: 'chapter-note', action: 'ask', question: '结合本章解释', history: [], selection }
    const context = boundContext(request, await state.service.context(request, state.credentials, new AbortController().signal), 6000).context
    expect(context.background).toContain('章节结论：后半章补充了证据不足时的限制。')
    expect(context.coverage).toEqual({ covered: 10, total: 10 })
  })

  it('cancels an in-flight analysis before deleting its book without recreating cache on late completion', async () => {
    const state = setup()
    let resolve!: (value: { text: string }) => void
    state.generate.mockImplementation(() => new Promise((done) => { resolve = done }))
    const job = { jobId: state.service.prepare({ bookId: state.bookId }).document!.jobId }
    state.service.append({ bookId: state.bookId, jobId: job.jobId, sections: [section(0)] })
    state.service.finish({ bookId: state.bookId, jobId: job.jobId })
  state.service.start({ bookId: state.bookId, profileId: state.profileId })
    await vi.waitFor(() => expect(state.generate).toHaveBeenCalled())
    state.service.cancel(state.bookId)
    state.database.deleteBook(state.bookId)
    resolve({ text: JSON.stringify(note(section(0))) })
    await new Promise((done) => setTimeout(done, 0))
    expect(state.store.record(state.bookId)).toBeUndefined()
    expect(state.store.db.prepare('SELECT count(*) AS n FROM book_fts').get()).toMatchObject({ n: 0 })
  })

  it('times out bounded background requests with a safe error', async () => {
    const state = setup()
    const fetchMock: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    })
    const llm = new LlmService(state.provider, fetchMock)
    await expect(llm.requestText(state.credentials, [{ role: 'user', content: 'fixture' }], { sessionId: randomUUID() }, new AbortController().signal, 4000, 10)).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('preserves archived snapshots through rebuild and validates book boundaries including legacy profiles', async () => {
    const state = setup()
    await prepare(state)
    const context: ContextSnapshot = { scope: 'book', bookId: state.bookId, selection: null, passages: [{ ...section(0).blocks[0], id: 'P1' }], background: '旧笔记', coverage: { covered: 2, total: 2 } }
    const input = { bookId: state.bookId, selection: null, context, question: '是什么', answer: '答案 [P1]', model: 'test-model' }
    expect(insightSchema.safeParse(input).success).toBe(true)
    const saved = state.database.insertInsight(randomUUID(), input, '2026-01-01')
    const history = [...saved.history, { role: 'user' as const, content: '追问' }, { role: 'assistant' as const, content: '答案', context: { ...context, passages: [{ ...section(1).blocks[0], id: 'P1' }] } }]
    state.database.updateInsightHistory(saved.id, { id: saved.id, bookId: state.bookId, history })
    state.service.start({ bookId: state.bookId, profileId: state.profileId, rebuild: true })
    expect(state.database.listInsights(state.bookId)[0].history).toEqual(history)
    expect(state.database.listInsights(state.bookId)[0].context).toEqual(context)
    expect(insightHistorySchema.safeParse({ id: saved.id, bookId: randomUUID(), history }).success).toBe(false)
    expect(startBookAnalysisSchema.safeParse({ bookId: state.bookId, profileId: 'legacy' }).success).toBe(true)
  })

  it('allocates request-local IDs within a shared budget and rebuilds snapshots on shrink retry', async () => {
    const state = setup()
    const source: ContextSnapshot = { scope: 'book', bookId: state.bookId, selection: null,
      passages: Array.from({ length: 12 }, (_, index) => ({ id: `block-${index}`, text: '证据'.repeat(800), anchor: `txt:${index}:2000` })), background: '背景'.repeat(3000), coverage: { covered: 12, total: 12 } }
    const request: LlmRequest = { conversationId: randomUUID(), scope: 'book', bookId: state.bookId, requestId: 'shrink', action: 'ask', question: '比较章节', history: [{ role: 'assistant', content: '旧回答 [P99]'.repeat(1000) }] }
    const first = boundContext(request, source, 6000)
    const small = boundContext(request, source, 3000)
    expect(small.context.passages.length).toBeLessThan(first.context.passages.length)
    expect(first.history.every((message) => !message.content.includes('[P99]'))).toBe(true)
    expect(small.context.passages.map((passage) => passage.id)).toEqual(small.context.passages.map((_, index) => `P${index + 1}`))
    const payloads: Array<{ messages: Array<{ content: string }> }> = []
    const fetchMock: typeof fetch = async (_url, init) => {
      payloads.push(JSON.parse(String(init?.body)))
      return payloads.length === 1 ? new Response('maximum context length exceeded', { status: 400 }) : new Response(JSON.stringify({ choices: [{ message: { content: '答案 [P1]' } }] }), { headers: { 'content-type': 'application/json' } })
    }
    const llm = new LlmService(state.provider, fetchMock)
    llm.contextProvider = async () => source
    const events = await new Promise<LlmEvent[]>((resolve) => {
      const result: LlmEvent[] = []
      llm.start(request, (event) => { result.push(event); if (event.type === 'completed' || event.type === 'error') resolve(result) })
    })
    const snapshots = events.filter((event) => event.type === 'context')
    expect(snapshots).toHaveLength(2)
    expect(snapshots[1].context).toEqual(small.context)
    expect(events.at(-1)?.type).toBe('completed')
    for (const [index, payload] of payloads.entries()) {
      expect(Array.from(payload.messages.map((message) => message.content).join('')).length).toBeLessThan(index ? 12000 : 24000)
      const reference = JSON.parse(payload.messages.at(-1)!.content.split('\n')[1]) as { passages: Array<{ id: string }> }
      expect(reference.passages.map((passage) => passage.id)).toEqual(snapshots[index].context.passages.map((passage) => passage.id))
    }
  })

  it('keeps a long selected original once in the budget and rejects a retry that cannot fit it', () => {
    const state = setup()
    const selection = { bookId: state.bookId, quote: '选区'.repeat(9500), anchor: 'txt:0:19000', chapterTitle: '长段落', passages: [{ id: 'old-P1', text: '附近原文', anchor: 'txt:19000:19004' }] }
    const request: LlmRequest = { conversationId: randomUUID(), requestId: 'large-selection', action: 'explain', question: '', selection, history: [] }
    const context = state.llm.localContext(request)
    expect(boundContext(request, context, 6000).context.passages[0]).toMatchObject({ id: 'P1', text: selection.quote })
    expect(() => boundContext(request, context, 3000)).toThrow()
  })
})
