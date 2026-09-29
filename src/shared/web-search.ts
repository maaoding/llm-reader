import type { WebSearchRecord } from './contracts'
import { copy, type CopyKey } from './copy'

const failureCopy = {
  configuration: 'webSearch.reason.configuration', timeout: 'webSearch.reason.timeout',
  'rate-limit': 'webSearch.reason.rateLimit', authentication: 'webSearch.reason.authentication',
  server: 'webSearch.reason.server', http: 'webSearch.reason.http', redirect: 'webSearch.reason.redirect',
  'too-large': 'webSearch.reason.tooLarge', 'invalid-response': 'webSearch.reason.invalidResponse', network: 'webSearch.reason.network'
} as const satisfies Partial<Record<WebSearchRecord['reason'], CopyKey>>

export function webSearchStatus(record: WebSearchRecord): string {
  if (record.reason === 'budget') return copy('webSearch.budgetEmpty')
  if (record.status === 'searched') return copy('webSearch.searched', { count: record.sources.length })
  if (record.status === 'empty') return copy('webSearch.empty')
  if (record.reason === 'not-needed') return copy('webSearch.notNeeded')
  if (record.reason === 'planning-failed') return copy('webSearch.planningFailed')
  const key = failureCopy[record.reason as keyof typeof failureCopy]
  return key ? copy('webSearch.failedReason', { reason: copy(key) }) : copy('webSearch.failed')
}
