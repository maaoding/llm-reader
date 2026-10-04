import { z } from 'zod'
import { mergeRequestHeaders } from '@shared/request-settings'
import type { WebSearchReason, WebSearchRecord, WebSearchSource } from '@shared/contracts'
import { copy } from '@shared/copy'
import { searchDomainAllowed } from '@shared/web-search-settings'
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

const resultTitle = z.string().max(500).catch('')
const resultUrl = z.string().max(2_048)
const excerptText = z.string().max(40_000).catch('')
const responseSchema = z.object({
  results: z.array(z.object({
    title: resultTitle, url: resultUrl, content: excerptText
  })).max(100)
})
const braveResponseSchema = z.object({ web: z.object({ results: z.array(z.object({
  title: resultTitle, url: resultUrl, description: excerptText,
  extra_snippets: z.array(excerptText).max(20).optional()
})).max(100) }).optional(), query: z.object({ original: z.string().max(10_000) }).optional() })
  .refine((value) => Boolean(value.web || value.query))
const exaResponseSchema = z.object({ results: z.array(z.object({
  title: resultTitle, url: resultUrl, highlights: z.array(excerptText).max(100).optional().default([])
})).max(100) })

function unicodeSlicePoints(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join('')
}

function httpUrl(value: string, config: WebSearchCredentials): boolean {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && searchDomainAllowed(url.hostname.toLowerCase().replace(/\.$/u, ''), config)
  } catch {
    return false
  }
}

/** Only the planned query is sent to search; no book/context payload is attached. */
export async function searchWeb(http: KnowledgeHttp, config: WebSearchCredentials, query: string, signal: AbortSignal): Promise<WebSearchSource[]> {
  signal.throwIfAborted()
  const trimmed = query.trim()
  if (!config.baseUrl || !trimmed) throw new AppError('WEB_SEARCH_CONFIG', copy('webSearch.required'))
  const provider = config.provider ?? 'tavily'
  const maximum = config.maxResults ?? WEB_SEARCH_MAX_RESULTS
  const shortQuery = unicodeSlicePoints(trimmed, WEB_SEARCH_QUERY_CHARACTERS)
  const include = config.includeDomains ?? [], exclude = config.excludeDomains ?? []
  const goggles = [...(include.length ? ['$discard', ...include.map((domain) => `$boost,site=${domain}`)] : []), ...exclude.map((domain) => `$discard,site=${domain}`)].join('\n')
  const authentication: Record<string, string> = config.apiKey ? provider === 'brave' ? { 'X-Subscription-Token': config.apiKey }
    : provider === 'exa' ? { 'x-api-key': config.apiKey } : { Authorization: `Bearer ${config.apiKey}` } : {}
  const body = provider === 'brave' ? {
    ...config.extraBody, q: shortQuery, count: maximum, result_filter: ['web'], extra_snippets: true,
    text_decorations: false, summary: false, enable_rich_callback: false, ...(goggles ? { goggles } : { goggles: undefined })
  } : provider === 'exa' ? {
    ...config.extraBody, query: shortQuery, type: 'auto', numResults: maximum,
    contents: { highlights: true }, output: undefined, ...(include.length ? { includeDomains: include } : { includeDomains: undefined }),
    ...(exclude.length ? { excludeDomains: exclude } : { excludeDomains: undefined })
  } : {
      ...config.extraBody,
      query: shortQuery,
      search_depth: 'basic',
      max_results: maximum,
      chunks_per_source: WEB_SEARCH_MAX_SNIPPETS,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      auto_parameters: false,
      ...(include.length ? { include_domains: include } : { include_domains: undefined }),
      ...(exclude.length ? { exclude_domains: exclude } : { exclude_domains: undefined }),
      // Do not permit an old extraBody to weaken a newly configured domain restriction.
      ...(include.length ? { include_domains_mode: 'restrict' } : { include_domains_mode: undefined })
  }
  const raw = await http.json(`${config.baseUrl}${provider === 'brave' ? '/web/search' : '/search'}`, { method: 'POST',
    headers: mergeRequestHeaders({ 'Content-Type': 'application/json', ...authentication }, config.customHeaders),
    body: JSON.stringify(body)
  }, signal, WEB_SEARCH_MAX_BYTES, config.timeoutMs ?? WEB_SEARCH_TIMEOUT_MS)
  signal.throwIfAborted()
  let results: Array<{ title: string; url: string; content: string }>
  if (provider === 'brave') {
    const parsed = braveResponseSchema.safeParse(raw)
    if (!parsed.success) throw new AppError('WEB_SEARCH_INVALID', copy('webSearch.invalid'))
    results = (parsed.data.web?.results ?? []).map((item) => ({ ...item, content: [item.description, ...(item.extra_snippets ?? [])].filter(Boolean).slice(0, WEB_SEARCH_MAX_SNIPPETS).join(' ') }))
  } else if (provider === 'exa') {
    const parsed = exaResponseSchema.safeParse(raw)
    if (!parsed.success) throw new AppError('WEB_SEARCH_INVALID', copy('webSearch.invalid'))
    results = parsed.data.results.map((item) => ({ ...item, content: item.highlights.filter(Boolean).slice(0, WEB_SEARCH_MAX_SNIPPETS).join(' ') }))
  } else {
    const parsed = responseSchema.safeParse(raw)
    if (!parsed.success) throw new AppError('WEB_SEARCH_INVALID', copy('webSearch.invalid'))
    results = parsed.data.results
  }
  const sources: WebSearchSource[] = []
  for (const item of results) {
    if (sources.length >= maximum) break
    if (!httpUrl(item.url, config)) continue
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
      const sources = await searchWeb(this.http, config, query, signal)
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
