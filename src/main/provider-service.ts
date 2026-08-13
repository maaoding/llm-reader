import type {
  ProviderSettings,
  ProviderTestResult,
  SaveProviderSettingsInput
} from '@shared/contracts'
import { copy } from '@shared/copy'
import { AppDatabase } from './database'
import { AppError } from './errors'
import { buildChatCompletionsUrl, readSafeErrorStatus } from './llm-service'
import type { SecretStore } from './secret-store'

export interface KeyProtector {
  isAvailable(): boolean
  encrypt(value: string): Uint8Array
  decrypt(value: Uint8Array): string
}

export type FetchImplementation = typeof fetch

export class ProviderService {
  constructor(
    private readonly database: AppDatabase,
    private readonly keyProtector: KeyProtector,
    private readonly secretStore: SecretStore,
    private readonly fetchImplementation: FetchImplementation = fetch
  ) {}

  getSettings(): ProviderSettings {
    const stored = this.database.getProvider()
    return stored
      ? { baseUrl: stored.baseUrl, model: stored.model, hasApiKey: this.secretStore.has() }
      : { baseUrl: 'https://api.openai.com', model: 'gpt-4.1-mini', hasApiKey: false }
  }

  saveSettings(input: SaveProviderSettingsInput): ProviderSettings {
    buildChatCompletionsUrl(input.baseUrl)
    if (input.apiKey !== undefined) {
      if (!this.keyProtector.isAvailable()) {
        throw new AppError('KEY_STORAGE_UNAVAILABLE', copy('error.keyStorageUnavailable'))
      }
      this.secretStore.write(this.keyProtector.encrypt(input.apiKey))
    }
    this.database.saveProvider(input.baseUrl, input.model)
    return this.getSettings()
  }

  getCredentials(): { baseUrl: string; model: string; apiKey: string } {
    const stored = this.database.getProvider()
    const encryptedApiKey = this.secretStore.read()
    if (!stored || !encryptedApiKey) {
      throw new AppError('PROVIDER_NOT_CONFIGURED', copy('error.providerNotConfigured'))
    }
    if (!this.keyProtector.isAvailable()) {
      throw new AppError('KEY_STORAGE_UNAVAILABLE', copy('error.keyReadUnavailable'))
    }
    try {
      return {
        baseUrl: stored.baseUrl,
        model: stored.model,
        apiKey: this.keyProtector.decrypt(encryptedApiKey)
      }
    } catch (error) {
      throw new AppError('KEY_DECRYPT_FAILED', copy('error.keyDecryptFailed'), false, { cause: error })
    }
  }

  async testConnection(): Promise<ProviderTestResult> {
    try {
      const credentials = this.getCredentials()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15_000)
      try {
        const response = await this.fetchImplementation(buildChatCompletionsUrl(credentials.baseUrl), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${credentials.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: credentials.model,
            stream: false,
            max_tokens: 1,
            messages: [{ role: 'user', content: '回复 OK' }]
          }),
          signal: controller.signal
        })
        if (!response.ok) {
          return { ok: false, message: await readSafeErrorStatus(response) }
        }
        return { ok: true, message: copy('provider.testConnected') }
      } finally {
        clearTimeout(timer)
      }
    } catch (error) {
      if (error instanceof AppError) return { ok: false, message: error.message }
      if ((error as Error).name === 'AbortError') return { ok: false, message: copy('provider.testTimeout') }
      return { ok: false, message: copy('provider.testFailed') }
    }
  }
}
