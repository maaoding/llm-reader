import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { pdfImageRegionAnchor, validPdfImageRegion } from '../../src/shared/pdf-image-region'
import type { LlmEvent, LlmRequest, PdfImageRegionSource } from '../../src/shared/contracts'
import { bookSessionSchema, insightSchema, llmRequestSchema, selectionSchema } from '../../src/main/schemas'
import { LlmService } from '../../src/main/llm-service'

const imageDataUrl = 'data:image/jpeg;base64,/9j/2Q=='
const bookId = randomUUID()
const rectangle = { pageNumber: 2, left: 0.125, top: 0.2, right: 0.8, bottom: 0.75 }
const selection: PdfImageRegionSource = {
  kind: 'pdf-image-region', bookId, ...rectangle, anchor: pdfImageRegionAnchor(rectangle)
}

function visualRequest(): Extract<LlmRequest, { scope: 'visual' }> {
  return { requestId: randomUUID(), conversationId: randomUUID(), action: 'ask', question: '图中有什么？',
    scope: 'visual', selection, imageDataUrl, history: [{ role: 'user', content: '上一个问题' }, { role: 'assistant', content: '上一个回答' }] }
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

describe('PDF image region', () => {
  it('uses canonical page rectangles and rejects invalid or image-bearing persistent selections', () => {
    expect(selection.anchor).toBe('pdfrect:2:0.125:0.2:0.8:0.75')
    expect(validPdfImageRegion(selection)).toBe(true)
    expect(selectionSchema.safeParse(selection).success).toBe(true)
    expect(selectionSchema.safeParse({ ...selection, right: selection.left }).success).toBe(false)
    expect(selectionSchema.safeParse({ ...selection, anchor: 'pdfrect:3:0.125:0.2:0.8:0.75' }).success).toBe(false)
    expect(selectionSchema.safeParse({ ...selection, imageDataUrl }).success).toBe(false)
  })

  it('keeps page edges canonical and rejects out-of-range, non-integer or reversed regions', () => {
    const bounded = (overrides: Partial<typeof rectangle>): PdfImageRegionSource => {
      const fields = { ...rectangle, ...overrides }
      return { ...selection, ...fields, anchor: pdfImageRegionAnchor(fields) }
    }
    const fullPage = bounded({ left: 0, top: 0, right: 1, bottom: 1 })
    expect(fullPage.anchor).toBe('pdfrect:2:0:0:1:1')
    expect(validPdfImageRegion(fullPage)).toBe(true)
    expect(selectionSchema.safeParse(fullPage).success).toBe(true)
    expect(validPdfImageRegion(bounded({ pageNumber: 1 }))).toBe(true)
    expect(validPdfImageRegion(bounded({ pageNumber: 600 }))).toBe(true)
    expect(bounded({ left: 0.5, right: 0.5 }).anchor).toBe('pdfrect:2:0.5:0.2:0.5:0.75')
    for (const overrides of [
      { pageNumber: 0 }, { pageNumber: 601 }, { pageNumber: 2.5 },
      { left: -0.001 }, { right: 1.001 }, { top: Number.NaN }, { bottom: Number.POSITIVE_INFINITY },
      { top: 0.8, bottom: 0.2 }, { left: 0.5, right: 0.5 }
    ]) {
      expect(validPdfImageRegion(bounded(overrides))).toBe(false)
      expect(selectionSchema.safeParse(bounded(overrides)).success).toBe(false)
    }
    expect(selectionSchema.safeParse({ ...selection, anchor: 'pdfrect:2:0.125:0.2:0.8:0.75 ' }).success).toBe(false)
  })

  it('allows image data only in a bounded transient visual request', () => {
    const request = visualRequest()
    expect(llmRequestSchema.safeParse(request).success).toBe(true)
    expect(llmRequestSchema.safeParse({ ...request, imageDataUrl: 'data:text/plain;base64,QQ==' }).success).toBe(false)
    expect(llmRequestSchema.safeParse({ ...request, imageDataUrl: 'data:image/jpeg;base64,QUJD' }).success).toBe(false)
    expect(llmRequestSchema.safeParse({ ...request, imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=' }).success).toBe(false)
    expect(llmRequestSchema.safeParse({ ...request, imageDataUrl: `data:image/jpeg;base64,${'A'.repeat(6_000_000)}` }).success).toBe(false)
    const session = { bookId, conversationId: randomUUID(), scope: 'selection', selection,
      draft: '', turns: [{ id: randomUUID(), action: 'ask', actionLabel: '提问', question: '图中有什么？',
        answer: '一幅图', model: 'vision-model', status: 'completed', selection }] }
    const parsed = bookSessionSchema.parse(session)
    expect(JSON.stringify(parsed)).not.toContain('data:image')
    expect(bookSessionSchema.safeParse({ ...session, imageDataUrl }).success).toBe(false)
    expect(bookSessionSchema.safeParse({ ...session, turns: [{ ...session.turns[0], imageDataUrl }] }).success).toBe(false)
    const insight = insightSchema.parse({ bookId, selection, question: '图中有什么？', answer: '一幅图', model: 'vision-model' })
    expect(JSON.stringify(insight)).not.toContain('data:image')
  })

  it.each(['openai', 'anthropic'] as const)('sends image plus question and history over %s without text passages', async (protocol) => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(init?.redirect).toBe('manual')
      expect(body.model).toBe('vision-model')
      expect(JSON.stringify(body)).not.toContain('passage')
      if (protocol === 'openai') {
        const messages = body.messages as Array<{ role: string; content: unknown }>
        expect(messages.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user'])
        expect(messages.at(-1)?.content).toEqual([
          { type: 'text', text: expect.stringContaining('图中有什么？') },
          { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } }
        ])
      } else {
        const messages = body.messages as Array<{ role: string; content: unknown }>
        expect(typeof body.system).toBe('string')
        expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user'])
        expect(messages.at(-1)?.content).toEqual([
          { type: 'text', text: expect.stringContaining('图中有什么？') },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/2Q==' } }
        ])
      }
      return Response.json(protocol === 'openai'
        ? { model: 'vision-model', choices: [{ message: { content: '一幅图' } }] }
        : { type: 'message', model: 'vision-model', stop_reason: 'end_turn', content: [{ type: 'text', text: '一幅图' }] })
    }) as typeof fetch
    const service = new LlmService({ getCredentials: () => ({ baseUrl: 'https://example.test/v1',
      model: 'vision-model', apiKey: 'secret', protocol, compatibility: 'auto' }) }, fetcher)
    const events = await run(service, visualRequest())
    expect(events.find((event) => event.type === 'context')).toMatchObject({ context: { passages: [], background: '', selection } })
    expect(events.at(-1)).toMatchObject({ type: 'completed', model: 'vision-model' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('reports image capability rejection without switching models', async () => {
    const fetcher = vi.fn(async () => new Response('{"error":"image unsupported"}', { status: 415 })) as typeof fetch
    const service = new LlmService({ getCredentials: () => ({ baseUrl: 'https://example.test/v1',
      model: 'text-only', apiKey: 'secret', compatibility: 'auto' }) }, fetcher)
    const events = await run(service, visualRequest())
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'VISUAL_UNSUPPORTED' })
  })
})
