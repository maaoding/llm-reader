import { AppError } from './errors'
import { copy } from '@shared/copy'

/** Bound even transports or response streams that do not implement signal cancellation. */
async function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort: () => void = () => undefined
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
  try { return await Promise.race([pending, cancelled]) }
  finally { signal.removeEventListener('abort', abort) }
}

export class KnowledgeHttp {
  constructor(private readonly fetchImpl: typeof fetch = fetch, private readonly version = '0.0.0') {}
  async request(url: string, init: RequestInit, signal: AbortSignal, maximumBytes = 16_000_000, timeoutMs = 60_000): Promise<Uint8Array> {
    const headers = init.headers instanceof Headers || Array.isArray(init.headers)
      ? Object.fromEntries(new Headers(init.headers)) : { ...init.headers }
    if (!Object.keys(headers).some((name) => name.toLowerCase() === 'user-agent')) headers['User-Agent'] = `LLM-Reader/${this.version}`
    const timeout = AbortSignal.timeout(timeoutMs)
    const combined = AbortSignal.any([signal, timeout])
    try {
      combined.throwIfAborted()
      const response = await abortable(this.fetchImpl(url, { ...init, headers, redirect: 'manual', signal: combined }).then((value) => {
        if (combined.aborted) { void value.body?.cancel().catch(() => undefined); combined.throwIfAborted() }
        return value
      }), combined)
      if (response.status >= 300 && response.status < 400) {
        void response.body?.cancel().catch(() => undefined)
        throw new AppError('KNOWLEDGE_REDIRECT', copy('knowledge.redirect'))
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined)
        throw new AppError(`KNOWLEDGE_HTTP_${response.status}`, copy('knowledge.httpError', { status: response.status }))
      }
      if (Number(response.headers.get('content-length')) > maximumBytes) {
        void response.body?.cancel().catch(() => undefined)
        throw new AppError('KNOWLEDGE_TOO_LARGE', copy('knowledge.tooLarge'))
      }
      const reader = response.body?.getReader()
      if (!reader) return new Uint8Array()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          combined.throwIfAborted()
          const { done, value } = await abortable(reader.read(), combined)
          if (done) break
          size += value.byteLength
          if (size > maximumBytes) throw new AppError('KNOWLEDGE_TOO_LARGE', copy('knowledge.tooLarge'))
          chunks.push(value)
        }
      } finally { void reader.cancel().catch(() => undefined); reader.releaseLock() }
      combined.throwIfAborted()
      return Buffer.concat(chunks, size)
    } catch (error) {
      // Explicit caller cancellation must win even when the local deadline also expired.
      if (signal.aborted && !(signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError')) signal.throwIfAborted()
      if (timeout.aborted || (signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError')) throw new AppError('KNOWLEDGE_TIMEOUT', copy('knowledge.timeout'))
      signal.throwIfAborted()
      if (error instanceof AppError) throw error
      throw new AppError('KNOWLEDGE_NETWORK', copy('knowledge.network'))
    }
  }
  async json(url: string, init: RequestInit, signal: AbortSignal, limit?: number, timeoutMs?: number): Promise<unknown> {
    const bytes = await this.request(url, init, signal, limit, timeoutMs)
    try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown }
    catch { throw new AppError('KNOWLEDGE_INVALID', copy('knowledge.invalid')) }
  }
}
