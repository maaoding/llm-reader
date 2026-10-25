import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { BookContextStore } from '../../src/main/book-context-store'
import { BookAnalysisService } from '../../src/main/book-analysis'
import { LlmService } from '../../src/main/llm-service'
import type { ProviderService } from '../../src/main/provider-service'
import type { ContextSnapshot, LlmEvent, LlmRequest } from '../../src/shared/contracts'

const credentials = { baseUrl: 'http://127.0.0.1', model: 'retrieval-fixture', apiKey: 'synthetic-only', compatibility: 'auto' as const }
const originals = [
  'This handbook reports no measured percentage improvement in germination.',
  'The annual survival estimate is unavailable.'
]
const resources: Array<{ database: AppDatabase; analysis: BookAnalysisService }> = []

afterEach(() => {
  for (const { database, analysis } of resources.splice(0)) { analysis.dispose(); database.close() }
  vi.restoreAllMocks()
})

function setup() {
  const database = new AppDatabase(':memory:')
  const store = new BookContextStore(database)
  const provider = { getCredentials: () => credentials }
  const llm = new LlmService(provider)
  const planner = vi.spyOn(llm, 'requestText').mockResolvedValue({ text: JSON.stringify({ chapters: [], terms: [] }) })
  const analysis = new BookAnalysisService(store, provider as unknown as ProviderService, llm)
  resources.push({ database, analysis })
  const addBook = (texts: string[]) => {
    const id = randomUUID()
    database.insertBook({ id, sha256: id.replaceAll('-', '').repeat(2), title: 'English handbook', author: null, format: 'txt', sourceFormat: 'txt',
      originalName: 'handbook.txt', storedName: `${id}.txt`, importedAt: '2026-01-01', lastOpenedAt: null, lastLocator: null, progress: 0 })
    const jobId = analysis.prepare({ bookId: id }).document!.jobId
    analysis.append({ bookId: id, jobId, sections: texts.map((text, index) => ({ id: `s${index}`, chapterId: `c${index}`, chapterTitle: `Chapter ${index + 1}`, order: index,
      blocks: [{ id: `p${index}`, text, anchor: `txt:${index * 200}:${index * 200 + text.length}`, kind: 'paragraph' as const }] })) })
    analysis.finish({ bookId: id, jobId })
    return id
  }
  const bookId = addBook(originals)
  const request: Extract<LlmRequest, { scope: 'book' }> = { requestId: randomUUID(), conversationId: randomUUID(), bookId,
    scope: 'book', action: 'ask', question: '发芽率提高了百分之多少？', history: [] }
  return { database, store, analysis, planner, bookId, request, addBook }
}

function run(service: LlmService, request: LlmRequest): Promise<LlmEvent[]> {
  return new Promise((resolve) => {
    const events: LlmEvent[] = []
    service.start(request, (event) => {
      events.push(event)
      if (event.type === 'completed' || event.type === 'error') resolve(events)
    })
  })
}

describe('retrieval quality without chapter notes or optional services', () => {
  it('keeps translated planning terms when a long question exceeds the lexical token budget', async () => {
    const state = setup()
    state.planner.mockResolvedValue({ text: JSON.stringify({ chapters: [], terms: ['germination'] }) })
    const question = `${Array.from({ length: 80 }, (_, index) => `背景${index}`).join('，')}。发芽率提高了百分之多少？`
    const context = await state.analysis.context({ ...state.request, question }, credentials, new AbortController().signal)
    expect(context.passages.map((passage) => passage.text)).toContain(originals[0])
    expect(context.coverage.covered).toBe(0)
    expect(state.planner).toHaveBeenCalledTimes(1)
  })

  it('shares the token budget across the original question and every planned term', async () => {
    const state = setup()
    const terms = Array.from({ length: 7 }, (_, group) => Array.from({ length: 12 }, (_, index) => `x${group}${index}`).join(' '))
    state.planner.mockResolvedValue({ text: JSON.stringify({ chapters: [], terms: [...terms, 'germination'] }) })
    const context = await state.analysis.context({ ...state.request, question: 'survival' }, credentials, new AbortController().signal)
    expect(context.passages.map((passage) => passage.text)).toEqual(expect.arrayContaining(originals))
    expect(state.planner).toHaveBeenCalledTimes(1)
  })

  it.each(['objects', 'mixed', 'wrong-type'] as const)('retains useful terms when optional multi-book selection contains %s', async (mode) => {
    const state = setup()
    const secondText = 'The cohort arrival is recorded when the sealed lot is received.'
    const secondId = state.addBook([secondText])
    const outsideId = state.addBook(['An unselected handbook discusses germination and cohort arrival.'])
    const terms = ['germination', 'cohort arrival']
    const books = mode === 'objects' ? [{ id: state.bookId }, { id: secondId }]
      : mode === 'mixed' ? [state.bookId, { id: secondId }] : state.bookId
    const usage = { promptTokens: 10, completionTokens: 20, totalTokens: 30 }
    state.planner.mockResolvedValue({ text: JSON.stringify({ chapters: ['B0C0', 'B1C0'], terms, books }), usage })
    const search = vi.spyOn(state.store, 'search')
    const request: Extract<LlmRequest, { scope: 'books' }> = { requestId: randomUUID(), conversationId: randomUUID(),
      action: 'ask', scope: 'books', bookIds: [state.bookId, secondId], question: '比较两份资料中的发芽率和到达日期。', history: [] }

    const context = await state.analysis.context(request, credentials, new AbortController().signal)

    expect(context.passages.map((passage) => passage.text)).toEqual(expect.arrayContaining([originals[0], secondText]))
    expect(new Set(context.passages.map((passage) => passage.bookId))).toEqual(new Set(request.bookIds))
    expect(context.passages.some((passage) => passage.bookId === outsideId)).toBe(false)
    expect(context.planningUsage).toEqual(usage)
    expect(search.mock.calls.map((call) => ({ bookId: call[0], chapters: call[3], terms: call[4] })))
      .toEqual([{ bookId: state.bookId, chapters: ['c0'], terms }, { bookId: secondId, chapters: ['c0'], terms }])
    expect(state.planner).toHaveBeenCalledTimes(1)
    expect(state.planner.mock.calls[0][1][0].content).toContain('"books":["')
  })

  it.each(['empty', 'malformed', 'failed'] as const)('uses the original question after an %s plan without another planning call', async (mode) => {
    const state = setup()
    if (mode === 'malformed') state.planner.mockResolvedValue({ text: '{invalid JSON' })
    if (mode === 'failed') state.planner.mockRejectedValue(new Error('Synthetic unavailable planner'))
    const context = await state.analysis.context({ ...state.request, question: 'germination' }, credentials, new AbortController().signal)
    expect(context.passages.map((passage) => passage.text)).toEqual([originals[0]])
    expect(state.planner).toHaveBeenCalledTimes(1)
  })

  it('keeps a cross-language miss empty instead of inventing evidence or filling it from another book', async () => {
    const state = setup()
    state.addBook(['发芽率测得提高百分之十八。'])
    const context = await state.analysis.context(state.request, credentials, new AbortController().signal)
    expect(context.passages).toEqual([])
    expect(context.background).toBe('')
    expect(state.planner).toHaveBeenCalledTimes(1)
    state.planner.mockResolvedValue({ text: JSON.stringify({ chapters: [], terms: ['germination'] }) })
    const withEvidence = await state.analysis.context(state.request, credentials, new AbortController().signal)
    expect(withEvidence.passages.map((passage) => passage.text)).toEqual([originals[0]])
  })

  it('stops before local retrieval when planning is cancelled', async () => {
    const state = setup()
    const controller = new AbortController()
    const search = vi.spyOn(state.store, 'search')
    state.planner.mockImplementation(async () => { controller.abort(); controller.signal.throwIfAborted(); return { text: '' } })
    await expect(state.analysis.context(state.request, credentials, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(search).not.toHaveBeenCalled()
    expect(state.planner).toHaveBeenCalledTimes(1)
  })
})

describe('answer evidence boundaries', () => {
  it.each(['openai', 'anthropic'] as const)('states the zero-evidence boundary in the actual %s request', async (protocol) => {
    const state = setup()
    const bodies: Array<Record<string, unknown>> = []
    const llm = new LlmService({ getCredentials: () => ({ ...credentials, protocol }) }, async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json(protocol === 'anthropic'
        ? { type: 'message', content: [{ type: 'text', text: 'Synthetic response; not a quality score.' }], stop_reason: 'end_turn' }
        : { choices: [{ message: { content: 'Synthetic response; not a quality score.' } }] })
    })
    llm.contextProvider = (...parameters) => state.analysis.context(...parameters)
    const events = await run(llm, { ...state.request, history: [{ role: 'assistant', content: '旧回答声称提高了百分之十八。[P9]' }] })
    expect(events.at(-1)?.type).toBe('completed')
    expect(events.find((event) => event.type === 'context')).toMatchObject({ context: { passages: [] } })
    const system = protocol === 'anthropic' ? String(bodies[0].system)
      : (bodies[0].messages as Array<{ content: string }>)[0].content
    expect(system).toContain('本轮没有提供书内原文')
    expect(system).toContain('不能据此断言全书没有')
    expect(system).toContain('背景笔记和历史回答')
    expect(bodies).toHaveLength(1)
    expect(state.planner).toHaveBeenCalledTimes(1)
  })

  it('recomputes the empty-evidence instruction after context shrinking without repeating retrieval', async () => {
    const state = setup()
    const source: ContextSnapshot = { scope: 'book', bookId: state.bookId, selection: null,
      passages: [{ id: 'original', text: '证据'.repeat(3_500), anchor: 'txt:0:7000' }], background: '背景不能作为原文证据。', coverage: { covered: 1, total: 1 } }
    const bodies: Array<{ messages: Array<{ content: string }> }> = []
    const llm = new LlmService({ getCredentials: () => credentials }, async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return bodies.length === 1 ? new Response('maximum context length exceeded', { status: 400 })
        : Response.json({ choices: [{ message: { content: 'Synthetic response.' } }] })
    })
    llm.contextProvider = vi.fn(async () => source)
    const events = await run(llm, state.request)
    expect(events.at(-1)?.type).toBe('completed')
    const contexts = events.filter((event) => event.type === 'context')
    expect(contexts.map((event) => event.context.passages.length)).toEqual([1, 0])
    expect(bodies[0].messages[0].content).not.toContain('本轮没有提供书内原文')
    expect(bodies[1].messages[0].content).toContain('本轮没有提供书内原文')
    expect(llm.contextProvider).toHaveBeenCalledTimes(1)
  })
})
