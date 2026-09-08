import type { ProviderCompatibility } from '@shared/contracts'
import { copy } from '@shared/copy'
import { AppError } from './errors'

export interface ProviderRequestContext {
  sessionId: string
}

export function usesGoCompatibility(endpoint: string, compatibility: ProviderCompatibility = 'auto'): boolean {
  if (compatibility === 'opencode-go') return true
  const url = new URL(endpoint)
  return url.origin === 'https://opencode.ai' && url.pathname.startsWith('/zen/go/v1/')
}

/** All inference and configuration probes use the same identity and routing policy. */
export class ProviderTransport {
  constructor(private readonly fetchImplementation: typeof fetch, private readonly applicationVersion: string) {}

  async send(
    endpoint: string,
    credentials: { apiKey: string; compatibility?: ProviderCompatibility },
    context: ProviderRequestContext,
    request: { method: 'GET' | 'POST'; body?: string; accept: string; signal: AbortSignal }
  ): Promise<Response> {
    if (!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu.test(context.sessionId)) {
      throw new AppError('INVALID_SESSION_ID', copy('error.invalidInput'))
    }
    const go = usesGoCompatibility(endpoint, credentials.compatibility)
    const response = await this.fetchImplementation(endpoint, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        'User-Agent': `LLM-Reader/${this.applicationVersion}`,
        Accept: request.accept,
        ...(request.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(go ? { 'x-opencode-session': context.sessionId } : {})
      },
      ...(request.body !== undefined ? { body: request.body } : {}),
      signal: request.signal,
      redirect: go ? 'manual' : 'follow'
    })
    if (go && response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined)
      throw new AppError('PROVIDER_REDIRECT', copy('error.providerRedirect'))
    }
    return response
  }
}
