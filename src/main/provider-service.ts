import { randomUUID } from 'node:crypto'
import type {
  CreateProviderProfileInput,
  ProviderConfigurationInput,
  ProviderModelList,
  ProviderModelListInput,
  ProviderOverview,
  ProviderProfile,
  ProviderSettings,
  ProviderTestResult,
  UpdateProviderProfileInput
} from '@shared/contracts'
import { copy } from '@shared/copy'
import { AppDatabase, type ProviderProfileRecord } from './database'
import { AppError } from './errors'
import {
  buildChatCompletionsUrl,
  buildModelsUrl,
  readResponseTextBounded,
  readSafeErrorStatus
} from './llm-service'
import { ProfileSecretStore } from './secret-store'

const MAX_PROFILE_COUNT = 10
const PROVIDER_TIMEOUT_MS = 15_000
const MAX_MODEL_LIST_BYTES = 2 * 1024 * 1024
const MAX_MODEL_COUNT = 2_000
const MAX_MODEL_ID_LENGTH = 256

export interface KeyProtector {
  isAvailable(): boolean
  encrypt(value: string): Uint8Array
  decrypt(value: Uint8Array): string
}

export type FetchImplementation = typeof fetch

function publicProfile(row: ProviderProfileRecord, hasApiKey: boolean): ProviderProfile {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    model: row.model,
    hasApiKey,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class ProviderService {
  constructor(
    private readonly database: AppDatabase,
    private readonly keyProtector: KeyProtector,
    private readonly secretStore: ProfileSecretStore,
    private readonly fetchImplementation: FetchImplementation = fetch
  ) {
    this.secretStore.reconcile(new Set(this.database.listProviderProfiles().map((profile) => profile.id)))
  }

  getOverview(): ProviderOverview {
    const profiles = this.database
      .listProviderProfiles()
      .map((profile) => publicProfile(profile, this.secretStore.has(profile.id)))
    return {
      profiles,
      activeProfileId: profiles.find((profile) => profile.isActive)?.id ?? null
    }
  }

  getSettings(): ProviderSettings {
    const active = this.database.getActiveProviderProfile()
    return active
      ? { baseUrl: active.base_url, model: active.model, hasApiKey: this.secretStore.has(active.id) }
      : { baseUrl: 'https://api.openai.com', model: 'gpt-4.1-mini', hasApiKey: false }
  }

  private assertUniqueName(name: string, excludedId?: string): void {
    const normalized = name.toLocaleLowerCase()
    const duplicate = this.database
      .listProviderProfiles()
      .some((profile) => profile.id !== excludedId && profile.name.toLocaleLowerCase() === normalized)
    if (duplicate) throw new AppError('PROVIDER_PROFILE_NAME_EXISTS', copy('error.providerProfileNameExists'))
  }

  private writeKey(profileId: string, apiKey: string | undefined): void {
    if (apiKey === undefined) return
    if (!this.keyProtector.isAvailable()) {
      throw new AppError('KEY_STORAGE_UNAVAILABLE', copy('error.keyStorageUnavailable'))
    }
    this.secretStore.write(profileId, this.keyProtector.encrypt(apiKey))
  }

  createProfile(input: CreateProviderProfileInput): ProviderOverview {
    if (this.database.listProviderProfiles().length >= MAX_PROFILE_COUNT) {
      throw new AppError('PROVIDER_PROFILE_LIMIT', copy('error.providerProfileLimit'))
    }
    buildChatCompletionsUrl(input.baseUrl)
    this.assertUniqueName(input.name)
    const id = randomUUID()
    const now = new Date().toISOString()
    this.writeKey(id, input.apiKey)
    try {
      this.database.createProviderProfile({
        id,
        name: input.name,
        base_url: input.baseUrl,
        model: input.model,
        is_active: 0,
        created_at: now,
        updated_at: now
      })
    } catch (error) {
      if (this.secretStore.prepareDelete(id)) this.secretStore.commitDelete(id)
      throw error
    }
    return this.getOverview()
  }

  updateProfile(input: UpdateProviderProfileInput): ProviderOverview {
    if (!this.database.getProviderProfile(input.id)) {
      throw new AppError('PROVIDER_PROFILE_NOT_FOUND', copy('error.providerProfileNotFound'))
    }
    buildChatCompletionsUrl(input.baseUrl)
    this.assertUniqueName(input.name, input.id)
    this.writeKey(input.id, input.apiKey)
    if (!this.database.updateProviderProfile(input.id, input.name, input.baseUrl, input.model, new Date().toISOString())) {
      throw new AppError('PROVIDER_PROFILE_NOT_FOUND', copy('error.providerProfileNotFound'))
    }
    return this.getOverview()
  }

  activateProfile(id: string): ProviderOverview {
    if (!this.database.getProviderProfile(id)) {
      throw new AppError('PROVIDER_PROFILE_NOT_FOUND', copy('error.providerProfileNotFound'))
    }
    if (!this.secretStore.has(id)) {
      throw new AppError('PROVIDER_PROFILE_KEY_REQUIRED', copy('error.providerProfileKeyRequired'))
    }
    if (!this.database.activateProviderProfile(id, new Date().toISOString())) {
      throw new AppError('PROVIDER_PROFILE_NOT_FOUND', copy('error.providerProfileNotFound'))
    }
    return this.getOverview()
  }

  deleteProfile(id: string): ProviderOverview {
    if (!this.database.getProviderProfile(id)) {
      throw new AppError('PROVIDER_PROFILE_NOT_FOUND', copy('error.providerProfileNotFound'))
    }
    const stagedKey = this.secretStore.prepareDelete(id)
    try {
      if (!this.database.deleteProviderProfile(id)) {
        if (stagedKey) this.secretStore.rollbackDelete(id)
        throw new AppError('PROVIDER_PROFILE_NOT_FOUND', copy('error.providerProfileNotFound'))
      }
      if (stagedKey) this.secretStore.commitDelete(id)
    } catch (error) {
      if (this.database.getProviderProfile(id) && stagedKey) this.secretStore.rollbackDelete(id)
      throw error
    }
    return this.getOverview()
  }

  private decryptKey(profileId: string): string {
    const encryptedApiKey = this.secretStore.read(profileId)
    if (!encryptedApiKey) {
      throw new AppError('PROVIDER_PROFILE_KEY_REQUIRED', copy('error.providerProfileKeyRequired'))
    }
    if (!this.keyProtector.isAvailable()) {
      throw new AppError('KEY_STORAGE_UNAVAILABLE', copy('error.keyReadUnavailable'))
    }
    try {
      return this.keyProtector.decrypt(encryptedApiKey)
    } catch (error) {
      throw new AppError('KEY_DECRYPT_FAILED', copy('error.keyDecryptFailed'), false, { cause: error })
    }
  }

  private resolveKey(profileId: string | undefined, apiKey: string | undefined): string {
    if (apiKey !== undefined) return apiKey
    if (!profileId || !this.database.getProviderProfile(profileId)) {
      throw new AppError('PROVIDER_PROFILE_KEY_REQUIRED', copy('error.providerProfileKeyRequired'))
    }
    return this.decryptKey(profileId)
  }

  getCredentials(): { baseUrl: string; model: string; apiKey: string } {
    const active = this.database.getActiveProviderProfile()
    if (!active) throw new AppError('PROVIDER_NOT_CONFIGURED', copy('error.providerNotConfigured'))
    return { baseUrl: active.base_url, model: active.model, apiKey: this.decryptKey(active.id) }
  }

  private async testCredentials(credentials: { baseUrl: string; model: string; apiKey: string }): Promise<ProviderTestResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS)
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
      if (!response.ok) return { ok: false, message: await readSafeErrorStatus(response) }
      return { ok: true, message: copy('provider.testConnected') }
    } finally {
      clearTimeout(timer)
    }
  }

  async testConnection(): Promise<ProviderTestResult> {
    try {
      return await this.testCredentials(this.getCredentials())
    } catch (error) {
      if (error instanceof AppError) return { ok: false, message: error.message }
      if ((error as Error).name === 'AbortError') return { ok: false, message: copy('provider.testTimeout') }
      return { ok: false, message: copy('provider.testFailed') }
    }
  }

  async testConfiguration(input: ProviderConfigurationInput): Promise<ProviderTestResult> {
    try {
      return await this.testCredentials({
        baseUrl: input.baseUrl,
        model: input.model,
        apiKey: this.resolveKey(input.profileId, input.apiKey)
      })
    } catch (error) {
      if (error instanceof AppError) return { ok: false, message: error.message }
      if ((error as Error).name === 'AbortError') return { ok: false, message: copy('provider.testTimeout') }
      return { ok: false, message: copy('provider.testFailed') }
    }
  }

  async listModels(input: ProviderModelListInput): Promise<ProviderModelList> {
    const apiKey = this.resolveKey(input.profileId, input.apiKey)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS)
    try {
      const response = await this.fetchImplementation(buildModelsUrl(input.baseUrl), {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: controller.signal
      })
      if (!response.ok) throw new AppError('PROVIDER_MODELS_FAILED', await readSafeErrorStatus(response))
      const text = await readResponseTextBounded(response, MAX_MODEL_LIST_BYTES)
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch (error) {
        throw new AppError('PROVIDER_MODELS_INVALID', copy('error.providerModelsInvalid'), false, { cause: error })
      }
      const data = parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data)
        ? (parsed as { data: unknown[] }).data
        : null
      if (!data) throw new AppError('PROVIDER_MODELS_INVALID', copy('error.providerModelsInvalid'))
      const unique = new Set<string>()
      for (const item of data) {
        if (!item || typeof item !== 'object') continue
        const id = (item as { id?: unknown }).id
        if (typeof id !== 'string') continue
        const normalized = id.trim()
        if (!normalized || normalized.length > MAX_MODEL_ID_LENGTH) continue
        unique.add(normalized)
      }
      if (unique.size === 0) throw new AppError('PROVIDER_MODELS_EMPTY', copy('error.providerModelsEmpty'))
      const models = [...unique].sort((left, right) => left.localeCompare(right))
      return { models: models.slice(0, MAX_MODEL_COUNT), truncated: models.length > MAX_MODEL_COUNT }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new AppError('PROVIDER_MODELS_TIMEOUT', copy('provider.testTimeout'))
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}
