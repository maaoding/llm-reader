import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { LlmEvent, LlmRequest } from '../../src/shared/contracts'
import { buildChatCompletionsUrl, LlmService, selectContextPassages } from '../../src/main/llm-service'

const credentials = {
  getCredentials: () => ({ baseUrl: 'https://models.example.test', model: 'reader-model', apiKey: 'secret' })
}

function request(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    requestId: randomUUID(),
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
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }
      userMessageLengths.push(body.messages.at(-1)?.content.length ?? 0)
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
    const events = await run(new LlmService(credentials, fetchMock), longRequest)

    expect(userMessageLengths).toHaveLength(2)
    expect(userMessageLengths[1]).toBeLessThan(userMessageLengths[0])
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

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual(expect.objectContaining({ type: 'error', code: 'RESPONSE_TOO_LARGE' }))
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
  })
})
