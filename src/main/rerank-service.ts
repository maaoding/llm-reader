import { z } from 'zod'
import { mergeRequestHeaders } from '@shared/request-settings'
import type { Passage, RerankReason, RerankRecord } from '@shared/contracts'
import { copy } from '@shared/copy'
import { AppError } from './errors'
import { KnowledgeHttp } from './knowledge-http'
import { KnowledgeSettingsService, type RerankCredentials } from './knowledge-settings'

export const RERANK_TIMEOUT_MS = 5_000
export const RERANK_MAX_BYTES = 1024 * 1024
export const RERANK_MAX_CANDIDATES = 60
const responseSchema = z.object({ results: z.array(z.object({
  index: z.number().int().nonnegative(), relevance_score: z.number().finite()
})).min(1).max(RERANK_MAX_CANDIDATES) })

/** Provider documents and IDs are never trusted; only local array indices can select evidence. */
export async function rerank(http: KnowledgeHttp, config: RerankCredentials, query: string, candidates: Passage[], signal: AbortSignal): Promise<Passage[]> {
  signal.throwIfAborted()
  if (!config.baseUrl || !config.model || !query.trim() || !candidates.length || candidates.length > RERANK_MAX_CANDIDATES) {
    throw new AppError('RERANK_CONFIG', copy('rerank.required'))
  }
  const raw = await http.json(`${config.baseUrl}/rerank`, { method: 'POST',
    headers: mergeRequestHeaders({ 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) }, config.customHeaders),
    body: JSON.stringify({ ...config.extraBody, model: config.model, query, documents: candidates.map((item) => `${item.headingPath?.join(' / ') ?? item.chapterTitle ?? ''}\n${item.text}`),
      top_n: candidates.length, return_documents: false })
  }, signal, RERANK_MAX_BYTES, config.timeoutMs ?? RERANK_TIMEOUT_MS)
  signal.throwIfAborted()
  const parsed = responseSchema.safeParse(raw)
  if (!parsed.success || parsed.data.results.some((item) => item.index >= candidates.length) ||
      new Set(parsed.data.results.map((item) => item.index)).size !== parsed.data.results.length) {
    throw new AppError('RERANK_INVALID', copy('rerank.invalid'))
  }
  const ranked = parsed.data.results.sort((a, b) => b.relevance_score - a.relevance_score || a.index - b.index)
  const returned = new Set(ranked.map((item) => item.index))
  return [...ranked.map((item) => candidates[item.index]), ...candidates.filter((_item, index) => !returned.has(index))]
}

function failureReason(error: unknown): RerankReason {
  const code = error instanceof AppError ? error.code : ''
  if (['RERANK_CONFIG', 'KNOWLEDGE_SECRET'].includes(code)) return 'configuration'
  if (code === 'KNOWLEDGE_TIMEOUT') return 'timeout'
  if (code === 'KNOWLEDGE_HTTP_429') return 'rate-limit'
  if (['KNOWLEDGE_HTTP_401', 'KNOWLEDGE_HTTP_403'].includes(code)) return 'authentication'
  if (/^KNOWLEDGE_HTTP_5\d\d$/u.test(code)) return 'server'
  if (code.startsWith('KNOWLEDGE_HTTP_')) return 'http'
  if (code === 'KNOWLEDGE_REDIRECT') return 'redirect'
  if (code === 'KNOWLEDGE_TOO_LARGE') return 'too-large'
  if (['RERANK_INVALID', 'KNOWLEDGE_INVALID'].includes(code)) return 'invalid-response'
  return 'network'
}

export type RerankConfigSnapshot = RerankCredentials & { unavailable?: boolean }
export class RerankService {
  constructor(private readonly settings: KnowledgeSettingsService, private readonly http: KnowledgeHttp) {}
  snapshot(): RerankConfigSnapshot {
    const { enabled, baseUrl, model } = this.settings.get().rerank
    const config = { enabled, baseUrl, model }
    // Disabled settings do not need secret access and cannot disrupt local explanations.
    if (!config.enabled) return { ...config, apiKey: '', revision: '' }
    try { return this.settings.rerank() }
    catch { return { ...config, apiKey: '', revision: '', unavailable: true } }
  }
  async rank(config: RerankConfigSnapshot, query: string, candidates: Passage[], signal: AbortSignal): Promise<{ passages: Passage[]; record: RerankRecord }> {
    signal.throwIfAborted()
    const record: RerankRecord = { status: 'skipped', model: config.model, candidateCount: candidates.length, elapsedMs: 0,
      reason: config.enabled ? 'insufficient-candidates' : 'disabled' }
    if (!config.enabled || candidates.length < 2) return { passages: candidates, record }
    const started = performance.now()
    try {
      if (config.unavailable) throw new AppError('KNOWLEDGE_SECRET', copy('knowledge.secretError'))
      const passages = await rerank(this.http, config, query, candidates, signal)
      return { passages, record: { ...record, status: 'applied', reason: 'ranked', elapsedMs: Math.round(performance.now() - started) } }
    } catch (error) {
      signal.throwIfAborted()
      return { passages: candidates, record: { ...record, status: 'fallback', reason: failureReason(error), elapsedMs: Math.round(performance.now() - started) } }
    }
  }
}
