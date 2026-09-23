import type { ProviderProtocol, RequestSettingsInput, LlmUsage } from '@shared/contracts'
import { extraBodySchema } from '@shared/request-settings'
import { copy } from '@shared/copy'
import { AppError } from './errors'

export function normalizedProviderUrl(baseUrl: string): URL {
  let url: URL
  try { url = new URL(baseUrl) }
  catch { throw new AppError('INVALID_BASE_URL', copy('error.baseUrlInvalid')) }
  if (!['http:', 'https:'].includes(url.protocol) ||
    (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())) || url.username || url.password) {
    throw new AppError('INVALID_BASE_URL', copy('error.baseUrlUnsafe'))
  }
  url.search = ''; url.hash = ''
  return url
}

export function buildProviderUrl(baseUrl: string, resource: 'chat/completions' | 'messages' | 'models' | 'ocr'): string {
  const url = normalizedProviderUrl(baseUrl)
  let path = url.pathname.replace(/\/+$/, '')
  const explicitEndpoint = /\/(?:chat\/completions|messages|models|ocr)$/u.test(path)
  path = path.replace(/\/(?:chat\/completions|messages|models|ocr)$/u, '')
  if (!explicitEndpoint && !path.endsWith('/v1')) path += '/v1'
  url.pathname = `${path}/${resource}`.replace(/\/{2,}/gu, '/')
  return url.toString()
}
export function buildCompletionUrl(baseUrl: string, protocol: ProviderProtocol = 'openai'): string {
  return buildProviderUrl(baseUrl, protocol === 'anthropic' ? 'messages' : 'chat/completions')
}

type Message = { role: 'system' | 'user' | 'assistant'; content: string | Array<Record<string, unknown>> }
export function completionBody(config: RequestSettingsInput & { protocol?: ProviderProtocol; model: string }, messages: Message[], stream: boolean, maxTokens = 4_096): Record<string, unknown> {
  const options = extraBodySchema.parse(config.extraBody ?? {})
  if (config.protocol !== 'anthropic') return { ...options, model: config.model, messages, stream }
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n')
  const conversation = messages.filter((message) => message.role !== 'system').map((message) => ({
    role: message.role,
    content: typeof message.content === 'string' ? message.content : message.content.map((block) => {
      if (block.type !== 'image_url') return block
      const image = block.image_url as { url: string }
      const match = /^data:(image\/(?:png|jpeg));base64,(.+)$/u.exec(image.url)
      if (!match) throw new AppError('OCR_IMAGE', copy('vision.renderFailed'))
      return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }
    })
  }))
  return { max_tokens: maxTokens, ...options, model: config.model, stream, ...(system ? { system } : {}), messages: conversation }
}

export function anthropicUsage(value: unknown): LlmUsage | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const valid = (key: string): number | undefined => typeof raw[key] === 'number' && Number.isFinite(raw[key]) && raw[key] >= 0 ? raw[key] as number : undefined
  const input = valid('input_tokens'), output = valid('output_tokens')
  if (input === undefined && output === undefined) return null
  return { ...(input !== undefined ? { promptTokens: input + (valid('cache_creation_input_tokens') ?? 0) + (valid('cache_read_input_tokens') ?? 0) } : {}),
    ...(output !== undefined ? { completionTokens: output } : {}) }
}

export function parseAnthropicCompletion(value: unknown): { delta: string; model?: string; usage: LlmUsage | null; finished: boolean } {
  const empty = { delta: '', usage: null, finished: false }
  if (!value || typeof value !== 'object') return empty
  const raw = value as Record<string, unknown>
  if (raw.type === 'error') throw new AppError('PROVIDER_STREAM_ERROR', copy('request.streamError'), true)
  const stop = raw.type === 'message_delta' ? (raw.delta as Record<string, unknown> | undefined)?.stop_reason : raw.stop_reason
  if (typeof stop === 'string' && !['end_turn', 'stop_sequence', 'refusal'].includes(stop)) {
    throw new AppError('PROVIDER_INCOMPLETE', copy('request.incomplete'), true)
  }
  if (raw.type === 'message_start') {
    const message = raw.message as Record<string, unknown> | undefined
    return { ...empty, model: typeof message?.model === 'string' ? message.model : undefined, usage: anthropicUsage(message?.usage) }
  }
  if (raw.type === 'content_block_delta') {
    const delta = raw.delta as Record<string, unknown> | undefined
    return { ...empty, delta: delta?.type === 'text_delta' && typeof delta.text === 'string' ? delta.text : '' }
  }
  if (raw.type === 'content_block_start') {
    const block = raw.content_block as Record<string, unknown> | undefined
    return { ...empty, delta: block?.type === 'text' && typeof block.text === 'string' ? block.text : '' }
  }
  if (raw.type === 'message_delta') return { ...empty, usage: anthropicUsage(raw.usage) }
  if (raw.type === 'message_stop') return { ...empty, finished: true }
  if (raw.type !== 'message') return empty
  const blocks = Array.isArray(raw.content) ? raw.content : []
  return { delta: blocks.map((block: Record<string, unknown>) => block?.type === 'text' && typeof block.text === 'string' ? block.text : '').join(''),
    model: typeof raw.model === 'string' ? raw.model : undefined, usage: anthropicUsage(raw.usage), finished: typeof raw.stop_reason === 'string' }
}
