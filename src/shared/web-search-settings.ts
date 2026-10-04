import { z } from 'zod'
import type { WebSearchProvider, WebSearchSettings } from './contracts'

export const WEB_SEARCH_BASE_URLS = {
  tavily: 'https://api.tavily.com',
  brave: 'https://api.search.brave.com/res/v1',
  exa: 'https://api.exa.ai'
} as const satisfies Record<WebSearchProvider, string>

/** Accept only hostnames, never paths, ports, URL credentials or Goggles syntax. */
export function normalizeSearchDomain(value: string): string | undefined {
  const text = value.trim().replace(/\.$/u, '')
  if (!text || /[^\p{L}\p{N}\p{M}.-]/u.test(text)) return undefined
  try {
    const hostname = new URL(`https://${text}`).hostname.toLowerCase()
    if (hostname.length > 253 || !hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))) return undefined
    return hostname
  } catch { return undefined }
}

const domainSchema = z.string().max(253).transform((value, context) => {
  const domain = normalizeSearchDomain(value)
  if (!domain) { context.addIssue({ code: 'custom', message: 'Invalid search domain' }); return z.NEVER }
  return domain
})
export const searchDomainsSchema = z.array(domainSchema).transform((domains) => [...new Set(domains)]).pipe(z.array(z.string()).max(20))

export function parseSearchDomains(text: string): ReturnType<typeof searchDomainsSchema.safeParse> {
  return searchDomainsSchema.safeParse(text.split(/[,，\r\n]/u).map((domain) => domain.trim()).filter(Boolean))
}

export function searchDomainAllowed(hostname: string, settings: Pick<WebSearchSettings, 'includeDomains' | 'excludeDomains'>): boolean {
  const matches = (domain: string): boolean => hostname === domain || hostname.endsWith(`.${domain}`)
  return !settings.excludeDomains?.some(matches) && (!settings.includeDomains?.length || settings.includeDomains.some(matches))
}
