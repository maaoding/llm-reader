import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { LlmEvent, LlmRequest, SelectionContext } from '../../src/shared/contracts'
import { copy } from '../../src/shared/copy'
import { buildChatCompletionsUrl, buildModelsUrl, LlmService, selectContextPassages } from '../../src/main/llm-service'

const credentials = {
  getCredentials: () => ({ baseUrl: 'https://models.example.test', model: 'reader-model', apiKey: 'secret', compatibility: 'auto' as const })
}

type SelectionRequest = Extract<LlmRequest, { selection: SelectionContext }>
function request(overrides: Partial<SelectionRequest> = {}): SelectionRequest {
  return {
    requestId: randomUUID(),
    conversationId: randomUUID(),
    action: 'explain',
    question: '',
    selection: {
      bookId: randomUUID(),
      quote: 'selected phrase',
      anchor: 'txt:100-115',
      chapterTitle: 'Chapter',
      passages: [{ id: 'p-1', text: 'Context around selected phrase.', anchor: 'txt:90-130' }]
    },
    history: [],
    ...overrides
  }
}

function run(service: LlmService, value: LlmRequest): Promise<LlmEvent[]> {
  return new Promise((resolve) => {
    const events: LlmEvent[] = []
    service.start(value, (event) => {
      events.push(event)
      if (event.type === 'completed' || event.type === 'error') resolve(events)
    })
  })
}

describe('LlmService', () => {
  it.each(['openai', 'anthropic'] as const)('includes a per-request persona in text and PDF image answers over %s', async (protocol) => {
    const bodies: Array<Record<string, unknown>> = []
    const service = new LlmService({ getCredentials: () => ({ ...credentials.getCredentials(), protocol }) }, async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return Response.json(protocol === 'anthropic'
        ? { type: 'message', model: 'reader-model', content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' }
        : { model: 'reader-model', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] })
    })
    const textRequest = request({ persona: '用简短的社会学例子解释。' })
    await run(service, textRequest)
    await run(service, { requestId: randomUUID(), conversationId: textRequest.conversationId, action: 'ask', question: '这张图的观点是什么？', history: [],
      persona: '像历史教师一样解释。', scope: 'visual',
      selection: { kind: 'pdf-image-region', bookId: textRequest.selection.bookId, anchor: 'pdf:1', pageNumber: 1, left: 0, top: 0, right: 1, bottom: 1 },
      imageDataUrl: 'data:image/png;base64,aGVsbG8=' })
    await run(service, request())
    const system = (body: Record<string, unknown>): string => protocol === 'anthropic'
      ? String(body.system)
      : String((body.messages as Array<{ role: string; content: string }>).find((message) => message.role === 'system')?.content)
    expect(system(bodies[0])).toContain('用简短的社会学例子解释。')
    expect(system(bodies[1])).toContain('像历史教师一样解释。')
    expect(system(bodies[1])).toContain('不得编造原文引文')
    expect(system(bodies[2])).not.toContain('像历史教师一样解释。')
    expect(system(bodies[2])).toContain('不得编造 id')
  })

  it.each(['explain', 'context'] as const)('sends the shared default for %s while preserving custom requests', async (action) => {
    const prompts: string[] = []
    const service = new LlmService(credentials, async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }
      prompts.push(body.messages.at(-1)!.content)
      return Response.json({ choices: [{ message: { content: '回答' } }] })
    })
    await run(service, request({ action }))
    const custom = '只解释这个词在句中的含义。'
    await run(service, request({ action, question: custom }))
    expect(prompts[0]).toContain(`读者请求：${copy(action === 'explain' ? 'assistant.questionExplain' : 'assistant.questionContext')}`)
    expect(prompts[1]).toContain(`读者请求：${custom}`)
    expect(prompts[1]).not.toContain(copy('assistant.questionExplain'))
    expect(prompts[1]).not.toContain(copy('assistant.questionContext'))
  })

  it('normalizes SSE deltas, usage, and completion', async () => {
    const stream = [
      'data: {"model":"reader-model","choices":[{"delta":{"content":"Hello "}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"world"},"finish_reason":"stop"}],"usage":{"total_tokens":9}}',
      '',
      'data: [DONE]',
      ''
    ].join('\n')
    const fetchMock = vi.fn(async () =>
      new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    ) as unknown as typeof fetch
    const events = await run(new LlmService(credentials, fetchMock), request())

    expect(events.filter((event) => event.type === 'delta')).toEqual([
      expect.objectContaining({ delta: 'Hello ' }),
      expect.objectContaining({ delta: 'world' })
    ])
    expect(events).toContainEqual(expect.objectContaining({ type: 'usage', usage: { totalTokens: 9 } }))
    expect(events.at(-1)).toEqual(expect.objectContaining({ type: 'completed', model: 'reader-model' }))
  })

  it('reports the history and passages actually sent, including an earlier-turn cap', async () => {
    const sent: Array<{ messages: Array<{ role: string; content: string }> }> = []
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)))
      return Response.json({ choices: [{ message: { content: '回答' } }] })
    }) as unknown as typeof fetch
    const history = [{ role: 'user' as const, content: '上个问题' }, { role: 'assistant' as const, content: '上个回答 [P1]' }]
    const service = new LlmService(credentials, fetchMock)
    const normal = await run(service, request({ history, historyCandidateMessages: 2 }))
    const capped = await run(service, request({ history, historyCandidateMessages: 4 }))
    const normalContext = normal.find((event) => event.type === 'context')
    const cappedContext = capped.find((event) => event.type === 'context')
    expect(normalContext).toMatchObject({ context: { historySummary: { includedMessages: 2, truncated: false } } })
    expect(cappedContext).toMatchObject({ context: { historySummary: { includedMessages: 2, truncated: true } } })
    if (normalContext?.type !== 'context') throw new Error('Missing context event')
    const reference = JSON.parse(sent[0].messages.at(-1)!.content.split('\n')[1]) as { passages: unknown[] }
    expect(normalContext.context.passages).toHaveLength(reference.passages.length)
    expect(sent[0].messages.slice(1, -1).map((message) => message.content)).toEqual(['上个问题', '上个回答 [P1]'.replace(/\[P\d+\]/gu, '')])
  })

  it('marks history cropped by the input budget', async () => {
    const sentHistory: string[][] = []
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }
      sentHistory.push(body.messages.slice(1, -1).map((message) => message.content))
      return Response.json({ choices: [{ message: { content: '回答' } }] })
    }) as unknown as typeof fetch
    const events = await run(new LlmService(credentials, fetchMock), request({
      history: [{ role: 'user', content: '甲'.repeat(20_000) }, { role: 'assistant', content: '乙'.repeat(20_000) }],
      historyCandidateMessages: 2
    }))
    const context = events.find((event) => event.type === 'context')
    expect(context).toMatchObject({ context: { historySummary: { truncated: true } } })
    if (context?.type !== 'context') throw new Error('Missing context event')
    expect(context.context.historySummary!.includedMessages).toBe(sentHistory[0].length)
    expect(sentHistory[0].join('').length).toBeLessThan(40_000)
  })

  it('falls back to a non-stream response when streaming is unsupported', async () => {
    const payloads: Array<{ stream: boolean }> = []
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      payloads.push(JSON.parse(String(init?.body)) as { stream: boolean })
      if (payloads.length === 1) return new Response('{"error":"stream unsupported"}', { status: 400 })
      return new Response(
        JSON.stringify({ model: 'fallback-model', choices: [{ message: { content: 'Fallback answer' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }) as unknown as typeof fetch
    const events = await run(new LlmService(credentials, fetchMock), request())

    expect(payloads.map((payload) => payload.stream)).toEqual([true, false])
    expect(events).toContainEqual(expect.objectContaining({ type: 'delta', delta: 'Fallback answer' }))
    expect(events.at(-1)).toEqual(expect.objectContaining({ type: 'completed', model: 'fallback-model' }))
  })

  it('shrinks context once after a context-length rejection', async () => {
    const userMessageLengths: number[] = []
    const sentHistoryLengths: number[] = []
    const sentHistoryCounts: number[] = []
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }
      userMessageLengths.push(body.messages.at(-1)?.content.length ?? 0)
      sentHistoryLengths.push(body.messages.slice(1, -1).reduce((total, message) => total + message.content.length, 0))
      sentHistoryCounts.push(body.messages.slice(1, -1).length)
      if (userMessageLengths.length === 1) {
        return new Response('{"error":{"message":"maximum context length exceeded"}}', { status: 400 })
      }
      return new Response(
        'data: {"choices":[{"delta":{"content":"Short enough"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      )
    }) as unknown as typeof fetch
    const longRequest = request()
    longRequest.selection.passages = [
      { id: 'p-1', text: `before ${'x'.repeat(8_000)} selected phrase ${'y'.repeat(8_000)}`, anchor: 'txt:0' }
    ]
    longRequest.history = [{ role: 'user', content: '先前的问题'.repeat(1_600) }]
    longRequest.historyCandidateMessages = 1
    const events = await run(new LlmService(credentials, fetchMock), longRequest)

    expect(userMessageLengths).toHaveLength(2)
    expect(userMessageLengths[1]).toBeLessThan(userMessageLengths[0])
    const contexts = events.filter((event) => event.type === 'context')
    expect(contexts).toHaveLength(2)
    for (const [index, context] of contexts.entries()) {
      expect(context.context.historySummary).toEqual({
        includedMessages: sentHistoryCounts[index],
        truncated: sentHistoryLengths[index] < longRequest.history[0].content.length
      })
    }
    expect(events.at(-1)?.type).toBe('completed')
  })

  it('reports an interrupted stream and can cancel an active request', async () => {
    const interrupted = new LlmService(
      credentials,
      (async () =>
        new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' }
        })) as unknown as typeof fetch
    )
    const interruptedEvents = await run(interrupted, request())
    expect(interruptedEvents.at(-1)).toEqual(expect.objectContaining({ type: 'error', code: 'STREAM_INTERRUPTED' }))

    const pendingFetch = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })) as typeof fetch
    const service = new LlmService(credentials, pendingFetch)
    const cancellable = request()
    const result = run(service, cancellable)
    service.cancel(cancellable.requestId)
    expect((await result).at(-1)).toEqual(expect.objectContaining({ type: 'error', code: 'CANCELLED' }))
  })

  it('rejects an oversized non-stream completion before emitting it', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'x'.repeat(2_000_001) } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    ) as unknown as typeof fetch
    const events = await run(new LlmService(credentials, fetchMock), request())

    expect(events.filter((event) => event.type === 'delta')).toHaveLength(0)
    expect(events.at(-1)).toEqual(expect.objectContaining({ type: 'error', code: 'RESPONSE_TOO_LARGE' }))
  })
})

describe('LLM request bounds', () => {
  it('keeps Unicode passage context within the requested budget', () => {
    const value = request().selection
    value.passages = [{ id: 'p-1', text: '🚀'.repeat(8_000), anchor: value.anchor }]
    const chosen = selectContextPassages(value, 6_000)
    expect(Array.from(chosen[0].text)).toHaveLength(6_000)
  })

  it('allows HTTPS and loopback HTTP but rejects remote plaintext HTTP', () => {
    expect(buildChatCompletionsUrl('https://api.example.test/v1')).toBe(
      'https://api.example.test/v1/chat/completions'
    )
    expect(buildChatCompletionsUrl('http://localhost:11434')).toBe(
      'http://localhost:11434/v1/chat/completions'
    )
    expect(() => buildChatCompletionsUrl('http://api.example.test')).toThrow()
    expect(buildModelsUrl('https://api.example.test')).toBe('https://api.example.test/v1/models')
    expect(buildModelsUrl('https://api.example.test/v1')).toBe('https://api.example.test/v1/models')
    expect(buildModelsUrl('https://api.example.test/v1/chat/completions?ignored=1')).toBe(
      'https://api.example.test/v1/models'
    )
  })
})
