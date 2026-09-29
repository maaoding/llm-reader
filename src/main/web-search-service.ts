import { z } from 'zod'
import { mergeRequestHeaders } from '@shared/request-settings'
import type { WebSearchReason, WebSearchRecord, WebSearchSource } from '@shared/contracts'
import { copy } from '@shared/copy'
import { AppError } from './errors'
import { KnowledgeHttp } from './knowledge-http'
import { KnowledgeSettingsService, type WebSearchCredentials } from './knowledge-settings'

export const WEB_SEARCH_TIMEOUT_MS = 10_000
export const WEB_SEARCH_MAX_BYTES = 256 * 1024
export const WEB_SEARCH_MAX_RESULTS = 5
export const WEB_SEARCH_MAX_SNIPPETS = 2
/** Excerpts are cropped again against the input budget; this is only a sanity cap per source. */
export const WEB_SEARCH_EXCERPT_CHARACTERS = 1_200
export const WEB_SEARCH_QUERY_CHARACTERS = 400

const responseSchema = z.object({
  results: z.array(z.object({
    title: z.string().max(500).catch(''),
    url: z.string().max(2_048),
    content: z.string().max(40_000).catch('')
  })).max(WEB_SEARCH_MAX_RESULTS)
})

function unicodeSlicePoints(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join('')
}

function httpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}

/** Only the planned query is sent to search; no book/context payload is attached. */
export async function tavilySearch(http: KnowledgeHttp, config: WebSearchCredentials, query: string, signal: AbortSignal): Promise<WebSearchSource[]> {
  signal.throwIfAborted()
  const trimmed = query.trim()
  if (!config.baseUrl || !trimmed) throw new AppError('WEB_SEARCH_CONFIG', copy('webSearch.required'))
  const raw = await http.json(`${config.baseUrl}/search`, { method: 'POST',
    headers: mergeRequestHeaders({ 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) }, config.customHeaders),
    body: JSON.stringify({
      ...config.extraBody,
      query: unicodeSlicePoints(trimmed, WEB_SEARCH_QUERY_CHARACTERS),
      search_depth: 'basic',
      max_results: WEB_SEARCH_MAX_RESULTS,
      chunks_per_source: WEB_SEARCH_MAX_SNIPPETS,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      auto_parameters: false
    })
  }, signal, WEB_SEARCH_MAX_BYTES, config.timeoutMs ?? WEB_SEARCH_TIMEOUT_MS)
  signal.throwIfAborted()
  const parsed = responseSchema.safeParse(raw)
  if (!parsed.success) throw new AppError('WEB_SEARCH_INVALID', copy('webSearch.invalid'))
  const sources: WebSearchSource[] = []
  for (const item of parsed.data.results) {
    if (!httpUrl(item.url)) continue
    const excerpt = unicodeSlicePoints(item.content.replace(/\s+/gu, ' ').trim(), WEB_SEARCH_EXCERPT_CHARACTERS)
    if (!excerpt) continue
    sources.push({
      id: `W${sources.length + 1}`,
      title: unicodeSlicePoints(item.title.replace(/\s+/gu, ' ').trim() || item.url, 200),
      url: item.url,
      excerpt
    })
  }
  return sources
}

export function webSearchFailureReason(error: unknown): WebSearchReason {
  const code = error instanceof AppError ? error.code : ''
  if (['WEB_SEARCH_CONFIG', 'KNOWLEDGE_SECRET'].includes(code)) return 'configuration'
  if (code === 'KNOWLEDGE_TIMEOUT') return 'timeout'
  if (code === 'KNOWLEDGE_HTTP_429') return 'rate-limit'
  if (['KNOWLEDGE_HTTP_401', 'KNOWLEDGE_HTTP_403'].includes(code)) return 'authentication'
  if (/^KNOWLEDGE_HTTP_5\d\d$/u.test(code)) return 'server'
  if (code.startsWith('KNOWLEDGE_HTTP_')) return 'http'
  if (code === 'KNOWLEDGE_REDIRECT') return 'redirect'
  if (code === 'KNOWLEDGE_TOO_LARGE') return 'too-large'
  if (['WEB_SEARCH_INVALID', 'KNOWLEDGE_INVALID'].includes(code)) return 'invalid-response'
  return 'network'
}

export type WebSearchConfigSnapshot = WebSearchCredentials & { unavailable?: boolean }
export class WebSearchService {
  constructor(private readonly settings: KnowledgeSettingsService, private readonly http: KnowledgeHttp) {}
  /** Disabled settings skip secret access entirely and never disrupt local answers. */
  snapshot(): WebSearchConfigSnapshot {
    const { enabled, baseUrl } = this.settings.get().webSearch
    const config = { enabled, baseUrl }
    if (!config.enabled) return { ...config, apiKey: '', revision: '' }
    try { return this.settings.webSearch() }
    catch { return { ...config, apiKey: '', revision: '', unavailable: true } }
  }
  /** One bounded search per round; failures are reported on the record and never abort the answer. */
  async search(config: WebSearchConfigSnapshot, query: string, signal: AbortSignal): Promise<WebSearchRecord> {
    signal.throwIfAborted()
    query = unicodeSlicePoints(query.trim(), WEB_SEARCH_QUERY_CHARACTERS)
    const started = performance.now()
    const searchedAt = new Date().toISOString()
    try {
      if (config.unavailable) throw new AppError('KNOWLEDGE_SECRET', copy('knowledge.secretError'))
      const sources = await tavilySearch(this.http, config, query, signal)
      const elapsedMs = Math.round(performance.now() - started)
      return sources.length
        ? { status: 'searched', reason: 'searched', query, searchedAt, elapsedMs, sources }
        : { status: 'empty', reason: 'searched', query, searchedAt, elapsedMs, sources: [] }
    } catch (error) {
      signal.throwIfAborted()
      return { status: 'failed', reason: webSearchFailureReason(error), query, searchedAt, elapsedMs: Math.round(performance.now() - started), sources: [] }
    }
  }
}
