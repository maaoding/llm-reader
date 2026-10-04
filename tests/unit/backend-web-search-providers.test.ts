import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebSearchProvider } from '../../src/shared/contracts'
import { parseSearchDomains } from '../../src/shared/web-search-settings'
import { AppDatabase } from '../../src/main/database'
import { KnowledgeSettingsService, type WebSearchCredentials } from '../../src/main/knowledge-settings'
import { KnowledgeHttp } from '../../src/main/knowledge-http'
import { searchWeb, WebSearchService } from '../../src/main/web-search-service'
import { knowledgeSettingsSchema } from '../../src/main/schemas'

const databases: AppDatabase[] = []
afterEach(() => { databases.splice(0).forEach((database) => database.close()); vi.restoreAllMocks() })
const oldSettings = { embedding: { enabled: false, baseUrl: '', model: '' }, document: { processor: 'none' as const, baseUrl: '', ocr: true, language: 'ch' as const } }
const protector = { isAvailable: () => true, encrypt: (text: string) => Buffer.from(`protected:${text}`), decrypt: (bytes: Uint8Array) => Buffer.from(bytes).toString().slice(10) }
const signal = () => new AbortController().signal
const providers = ['tavily', 'brave', 'exa'] as const
const items = [
  { title: '主站', url: 'https://example.com/main', content: '主站摘录' },
  { title: '子站', url: 'https://docs.example.com/article', content: '子站摘录' },
  { title: '排除子站', url: 'https://blocked.example.com/article', content: '排除摘录' },
  { title: '假子站', url: 'https://notexample.com/article', content: '边界摘录' },
  { title: '无效地址', url: 'https://user:password@example.com/article', content: '敏感地址' },
  { title: '第六条', url: 'https://example.com/last', content: '末条摘录' }
]
function responseFor(provider: WebSearchProvider, results = items) {
  if (provider === 'brave') return { web: { results: results.map((item) => ({ ...item, description: item.content, extra_snippets: ['补充摘录', '第三片段不可用'] })) } }
  if (provider === 'exa') return { results: results.map((item) => ({ ...item, highlights: [item.content, '补充摘录', '第三片段不可用'], text: '完整网页不可用', summary: '服务端答案不可用' })) }
  return { results, answer: '服务端答案不可用' }
}
function config(provider: WebSearchProvider): WebSearchCredentials {
  return { provider, enabled: true, baseUrl: 'https://search.example', apiKey: 'synthetic-search-key', revision: '1',
    maxResults: 2, includeDomains: ['example.com'], excludeDomains: ['blocked.example.com'], customHeaders: { 'X-Project': 'reader' } }
}
function settingsService() {
  const database = new AppDatabase(':memory:'); databases.push(database)
  return { database, settings: new KnowledgeSettingsService(database, protector) }
}

describe.each(providers)('%s search adapter', (provider) => {
  it('uses one bounded request, provider authentication and native domain filters, then checks returned hostnames', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(responseFor(provider)))
    const sources = await searchWeb(new KnowledgeHttp(fetcher), config(provider), '问题😀', signal())
    expect(sources.map((source) => [source.id, source.url])).toEqual([['W1', items[0].url], ['W2', items[1].url]])
    expect(sources[0].excerpt).toContain('主站摘录')
    expect(JSON.stringify(sources)).not.toMatch(/第三片段|完整网页|服务端答案/u)
    expect(fetcher).toHaveBeenCalledOnce()
    const [url, request] = fetcher.mock.calls[0], headers = new Headers(request?.headers), body = JSON.parse(String(request?.body))
    expect(request).toMatchObject({ method: 'POST', redirect: 'manual' })
    expect(headers.get('X-Project')).toBe('reader')
    if (provider === 'brave') {
      expect(url).toBe('https://search.example/web/search'); expect(headers.get('X-Subscription-Token')).toBe('synthetic-search-key')
      expect(headers.has('Authorization')).toBe(false)
      expect(body).toMatchObject({ q: '问题😀', count: 2, result_filter: ['web'], summary: false, text_decorations: false })
      expect(body.goggles).toBe('$discard\n$boost,site=example.com\n$discard,site=blocked.example.com')
    } else if (provider === 'exa') {
      expect(url).toBe('https://search.example/search'); expect(headers.get('x-api-key')).toBe('synthetic-search-key')
      expect(headers.has('Authorization')).toBe(false)
      expect(body).toMatchObject({ query: '问题😀', numResults: 2, contents: { highlights: true }, includeDomains: ['example.com'], excludeDomains: ['blocked.example.com'] })
    } else {
      expect(headers.get('Authorization')).toBe('Bearer synthetic-search-key')
      expect(body).toMatchObject({ query: '问题😀', max_results: 2, include_domains: ['example.com'], exclude_domains: ['blocked.example.com'], include_domains_mode: 'restrict' })
    }
  })
  it('drops excluded domains before assigning IDs, applies the configured count, and caps excerpts', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(responseFor(provider, [{ ...items[0], url: 'https://blocked.example.com./first' }, { ...items[0], content: '😀'.repeat(4000) }, ...items.slice(1)])))
    const sources = await searchWeb(new KnowledgeHttp(fetcher), { ...config(provider), maxResults: 5 }, '😀'.repeat(500), signal())
    expect(sources.map((item) => item.id)).toEqual(['W1', 'W2', 'W3'])
    expect(Array.from(sources[0].excerpt)).toHaveLength(1200)
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
    expect(Array.from(provider === 'brave' ? body.q : body.query)).toHaveLength(400)
    const all = await searchWeb(new KnowledgeHttp(fetcher), { ...config(provider), maxResults: 1, includeDomains: [], excludeDomains: [] }, 'query', signal())
    expect(all).toHaveLength(1)
  })
  it('ignores response material and reports empty, invalid, authentication, redirect and deadline failures safely', async () => {
    const { settings } = settingsService()
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(responseFor(provider, [])))
    const service = new WebSearchService(settings, new KnowledgeHttp(fetcher)), snapshot = config(provider)
    expect(await service.search(snapshot, 'query', signal())).toMatchObject({ status: 'empty', sources: [] })
    fetcher.mockResolvedValueOnce(Response.json({ results: 'wrong', web: 'wrong', private: 'private-provider-body' }))
    expect(await service.search(snapshot, 'query', signal())).toMatchObject({ status: 'failed', reason: 'invalid-response' })
    for (const [status, reason] of [[401, 'authentication'], [429, 'rate-limit'], [302, 'redirect']] as const) {
      fetcher.mockResolvedValueOnce(new Response('private-provider-body', { status }))
      const record = await service.search(snapshot, 'query', signal())
      expect(record).toMatchObject({ status: 'failed', reason }); expect(JSON.stringify(record)).not.toContain('private-provider-body')
    }
    fetcher.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')) } })))
    expect(await service.search({ ...snapshot, timeoutMs: 20 }, 'query', signal())).toMatchObject({ status: 'failed', reason: 'timeout' })
    fetcher.mockImplementation(() => new Promise(() => undefined))
    const controller = new AbortController(), pending = service.search(snapshot, 'query', controller.signal)
    controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).toHaveBeenCalledTimes(7)
  })
})

it('accepts Brave empty web results and Exa sources without highlights without inventing excerpts', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ query: { original: 'query' } }))
  expect(await searchWeb(new KnowledgeHttp(fetcher), config('brave'), 'query', signal())).toEqual([])
  fetcher.mockResolvedValueOnce(Response.json({ results: [{ title: '无摘录', url: items[0].url, text: '不可用全文' }] }))
  expect(await searchWeb(new KnowledgeHttp(fetcher), config('exa'), 'query', signal())).toEqual([])
  fetcher.mockResolvedValueOnce(Response.json({}))
  await expect(searchWeb(new KnowledgeHttp(fetcher), config('brave'), 'query', signal())).rejects.toMatchObject({ code: 'WEB_SEARCH_INVALID' })
})

it('normalizes hostname lists, rejects URL/Goggles injection and validates result-count boundaries at IPC', () => {
  expect(parseSearchDomains(' Example.COM.，docs.example.com\nexample.com\n例子.测试').data).toEqual(['example.com', 'docs.example.com', 'xn--fsqu00a.xn--0zwm56d'])
  for (const invalid of ['https://example.com', 'example.com/path', 'example.com:443', '*.example.com', 'user@example.com', '$discard', 'example.com%0a', 'bad..example']) expect(parseSearchDomains(invalid).success).toBe(false)
  expect(parseSearchDomains(Array.from({ length: 21 }, (_, index) => `${index}.example.com`).join(',')).success).toBe(false)
  const validSettings = { enabled: true, baseUrl: 'https://search.example', provider: 'tavily', maxResults: 2 }
  expect(knowledgeSettingsSchema.safeParse({ ...oldSettings, webSearch: validSettings }).success).toBe(true)
  for (const maxResults of [0, 6, 1.5]) expect(knowledgeSettingsSchema.safeParse({ ...oldSettings, webSearch: { ...validSettings, maxResults } }).success).toBe(false)
  const invalidDomains = { enabled: true, baseUrl: 'https://search.example', includeDomains: ['example.com/path'] }
  expect(knowledgeSettingsSchema.safeParse({ ...oldSettings, webSearch: invalidDomains }).success).toBe(false)
})

it('preserves legacy defaults, encrypts headers, isolates protocol changes at the same URL and fixes each round to its snapshot', async () => {
  const { database, settings } = settingsService()
  settings.save({ ...oldSettings, target: 'webSearch', webSearch: { enabled: true, baseUrl: 'https://search.example', apiKey: 'old-key', customHeaders: { 'X-Secret': 'old-header' } } })
  expect(settings.get().webSearch.provider ?? 'tavily').toBe('tavily')
  expect(settings.get().webSearch.maxResults ?? 5).toBe(5)
  expect(JSON.stringify(settings.get())).not.toMatch(/old-key|old-header/u)
  expect(String(database.connection.prepare("SELECT config_json FROM knowledge_settings WHERE kind = 'webSearch'").get()?.config_json)).not.toMatch(/old-key|old-header/u)
  const changedProtocol = settings.webSearch({ enabled: true, provider: 'brave', baseUrl: 'https://search.example' })
  expect(changedProtocol.apiKey).toBe(''); expect(changedProtocol.customHeaders).toEqual({})
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ results: [items[0]] }))
  const service = new WebSearchService(settings, new KnowledgeHttp(fetcher)), snapshot = service.snapshot()
  settings.save({ ...oldSettings, target: 'webSearch', webSearch: { enabled: true, provider: 'exa', baseUrl: 'https://other.example', apiKey: 'new-key', maxResults: 1, includeDomains: ['docs.example.com'] } })
  expect((await service.search(snapshot, 'query', signal())).sources).toHaveLength(1)
  expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer old-key')
  expect(settings.get().webSearch).toMatchObject({ provider: 'exa', maxResults: 1, includeDomains: ['docs.example.com'] })
  expect(settings.webSearch().customHeaders).toEqual({})
})
