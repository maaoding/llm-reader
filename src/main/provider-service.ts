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
  RequestSettingsInput,
  ProviderProtocol,
  UpdateProviderProfileInput
} from '@shared/contracts'
import { copy } from '@shared/copy'
import { AppDatabase, type ProviderProfileRecord } from './database'
import { AppError } from './errors'
import { abortable } from './abortable'
import {
  buildModelsUrl,
  errorResponseDetails,
  readResponseTextBounded,
  readProviderCompletion,
  type ProviderCredentials
} from './llm-service'
import { ProfileSecretStore } from './secret-store'
import { ProviderTransport } from './provider-transport'
import { buildCompletionUrl, completionBody } from './provider-protocol'
import { customHeadersSchema, publicRequestSettings } from '@shared/request-settings'
import { createProviderProfileSchema, updateProviderProfileSchema, providerConfigurationSchema, providerModelListSchema } from './schemas'

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
    ...JSON.parse(row.request_json ?? '{}'),
    ...(row.headers_secret ? { hasCustomHeaders: true } : {}),
    protocol: row.protocol ?? 'openai',
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    model: row.model,
    compatibility: row.compatibility,
    hasApiKey,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class ProviderService {
  private readonly transport: ProviderTransport
  constructor(
    private readonly database: AppDatabase,
    private readonly keyProtector: KeyProtector,
    private readonly secretStore: ProfileSecretStore,
    fetchImplementation: FetchImplementation = fetch,
    applicationVersion = 'development'
  ) {
    this.transport = new ProviderTransport(fetchImplementation, applicationVersion)
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
      ? { ...publicRequestSettings(JSON.parse(active.request_json ?? '{}')), protocol: active.protocol ?? 'openai', ...(active.headers_secret ? { hasCustomHeaders: true } : {}), baseUrl: active.base_url, model: active.model, compatibility: active.compatibility, hasApiKey: this.secretStore.has(active.id) }
      : { baseUrl: 'https://api.openai.com', model: 'gpt-4.1-mini', compatibility: 'auto', hasApiKey: false }
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

  createProfile(raw: CreateProviderProfileInput): ProviderOverview {
    buildCompletionUrl(raw.baseUrl, raw.protocol)
    const input = createProviderProfileSchema.parse(raw)
    if (this.database.listProviderProfiles().length >= MAX_PROFILE_COUNT) {
      throw new AppError('PROVIDER_PROFILE_LIMIT', copy('error.providerProfileLimit'))
    }
    buildCompletionUrl(input.baseUrl, input.protocol)
    this.assertUniqueName(input.name)
    const id = randomUUID()
    const now = new Date().toISOString()
    const headersSecret = this.encryptHeaders(input.customHeaders ?? {})
    this.writeKey(id, input.apiKey)
    try {
      this.database.createProviderProfile({
        id,
        name: input.name,
        base_url: input.baseUrl,
        model: input.model,
        compatibility: input.compatibility ?? 'auto',
        protocol: input.protocol ?? 'openai',
        request_json: JSON.stringify(publicRequestSettings(input)),
        headers_secret: headersSecret,
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

  updateProfile(raw: UpdateProviderProfileInput): ProviderOverview {
    buildCompletionUrl(raw.baseUrl, raw.protocol)
    const input = updateProviderProfileSchema.parse(raw)
    const previous = this.database.getProviderProfile(input.id)
    if (!previous) throw new AppError('PROVIDER_PROFILE_NOT_FOUND', copy('error.providerProfileNotFound'))
    if (this.secretStore.has(input.id) && input.apiKey === undefined && !this.sameEndpoint(previous, input)) {
      throw new AppError('PROVIDER_KEY_SCOPE', copy('request.keyScope'))
    }
    buildCompletionUrl(input.baseUrl, input.protocol)
    this.assertUniqueName(input.name, input.id)
    const headersSecret = this.encryptHeaders(this.resolveHeaders(input, input.id))
    this.writeKey(input.id, input.apiKey)
    if (!this.database.updateProviderProfile(input.id, input.name, input.baseUrl, input.model, new Date().toISOString(), input.compatibility ?? 'auto', input.protocol ?? 'openai', JSON.stringify(publicRequestSettings(input)), headersSecret)) {
      throw new AppError('PROVIDER_PROFILE_NOT_FOUND', copy('error.providerProfileNotFound'))
    }
    return this.getOverview()
  }

  activateProfile(id: string): ProviderOverview {
    if (!this.database.getProviderProfile(id)) {
      throw new AppError('PROVIDER_PROFILE_NOT_FOUND', copy('error.providerProfileNotFound'))
    }
    if (!this.secretStore.has(id) && !this.database.getProviderProfile(id)?.headers_secret) {
      throw new AppError('PROVIDER_PROFILE_KEY_REQUIRED', copy('error.providerProfileKeyRequired'))
    }
    if (!this.database.activateProviderProfile(id)) {
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

  private sameEndpoint(row: ProviderProfileRecord, input: { baseUrl: string; protocol?: ProviderProtocol }): boolean {
    return (row.protocol ?? 'openai') === (input.protocol ?? 'openai') && buildCompletionUrl(row.base_url, row.protocol) === buildCompletionUrl(input.baseUrl, input.protocol)
  }

  private resolveKey(input: ProviderModelListInput, headers: Record<string, string>): string {
    if (input.apiKey !== undefined) return input.apiKey
    const row = input.profileId ? this.database.getProviderProfile(input.profileId) : null
    if (row && this.sameEndpoint(row, input) && this.secretStore.has(row.id)) return this.decryptKey(row.id)
    if (Object.keys(headers).length) return ''
    throw new AppError('PROVIDER_PROFILE_KEY_REQUIRED', copy(row && !this.sameEndpoint(row, input) ? 'request.keyScope' : 'error.providerProfileKeyRequired'))
  }

  private encryptHeaders(headers: Record<string, string>): Uint8Array | null {
    if (!Object.keys(headers).length) return null
    if (!this.keyProtector.isAvailable()) throw new AppError('KEY_STORAGE_UNAVAILABLE', copy('error.keyStorageUnavailable'))
    return this.keyProtector.encrypt(JSON.stringify(customHeadersSchema.parse(headers)))
  }

  private resolveHeaders(input: RequestSettingsInput & { baseUrl: string; protocol?: ProviderProtocol }, profileId?: string): Record<string, string> {
    if (input.customHeaders !== undefined) return customHeadersSchema.parse(input.customHeaders ?? {})
    const row = profileId ? this.database.getProviderProfile(profileId) : null
    if (!row?.headers_secret || !this.sameEndpoint(row, input)) return {}
    try { return customHeadersSchema.parse(JSON.parse(this.keyProtector.decrypt(row.headers_secret))) }
    catch { throw new AppError('KEY_DECRYPT_FAILED', copy('error.keyDecryptFailed')) }
  }

  getCredentials(profileId?: string): ProviderCredentials {
    const active = profileId ? this.database.getProviderProfile(profileId) : this.database.getActiveProviderProfile()
    if (!active) throw new AppError('PROVIDER_NOT_CONFIGURED', copy('error.providerNotConfigured'))
    const customHeaders = this.resolveHeaders({ baseUrl: active.base_url, protocol: active.protocol }, active.id)
    return { ...publicRequestSettings(JSON.parse(active.request_json ?? '{}')), baseUrl: active.base_url, model: active.model, compatibility: active.compatibility, protocol: active.protocol ?? 'openai', customHeaders, apiKey: this.resolveKey({ profileId: active.id, baseUrl: active.base_url, protocol: active.protocol }, customHeaders) }
  }

  private async testCredentials(credentials: ProviderCredentials, mode: 'text' | 'stream' = 'text'): Promise<ProviderTestResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), credentials.timeoutMs ?? PROVIDER_TIMEOUT_MS)
    try {
      const response = await abortable(this.transport.send(buildCompletionUrl(credentials.baseUrl, credentials.protocol), credentials, { sessionId: randomUUID() }, {
        method: 'POST',
        accept: mode === 'stream' ? 'text/event-stream' : 'application/json',
        body: JSON.stringify(completionBody({ ...credentials, extraBody: { max_tokens: 16, ...credentials.extraBody } }, [{ role: 'user', content: '回复 OK' }], mode === 'stream', 16)),
        signal: controller.signal
      }).then((value) => {
        if (controller.signal.aborted) { void value.body?.cancel().catch(() => undefined); controller.signal.throwIfAborted() }
        return value
      }), controller.signal)
      if (!response.ok) {
        const details = await errorResponseDetails(response, controller.signal)
        controller.signal.throwIfAborted()
        return { ok: false, message: details.error.message }
      }
      if (mode === 'stream' && !response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
        void response.body?.cancel().catch(() => undefined)
        return { ok: false, message: copy('provider.testStreamUnsupported') }
      }
      await readProviderCompletion(response, () => undefined, credentials.protocol, controller.signal)
      return { ok: true, message: copy(mode === 'stream' ? 'provider.testStreamConnected' : 'provider.testConnected') }
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

  async testConfiguration(raw: ProviderConfigurationInput): Promise<ProviderTestResult> {
    try {
      const input = providerConfigurationSchema.parse(raw)
      const customHeaders = this.resolveHeaders(input, input.profileId)
      return await this.testCredentials({
        ...publicRequestSettings(input),
        customHeaders,
        protocol: input.protocol,
        baseUrl: input.baseUrl,
        model: input.model,
        compatibility: input.compatibility ?? 'auto',
        apiKey: this.resolveKey(input, customHeaders)
      }, input.testMode)
    } catch (error) {
      if (error instanceof AppError) return { ok: false, message: error.message }
      if ((error as Error).name === 'AbortError') return { ok: false, message: copy('provider.testTimeout') }
      return { ok: false, message: copy('provider.testFailed') }
    }
  }

  async listModels(raw: ProviderModelListInput): Promise<ProviderModelList> {
    const input = providerModelListSchema.parse(raw)
    const customHeaders = this.resolveHeaders(input, input.profileId)
    const apiKey = this.resolveKey(input, customHeaders)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? PROVIDER_TIMEOUT_MS)
    try {
      const response = await this.transport.send(buildModelsUrl(input.baseUrl), { apiKey, protocol: input.protocol, customHeaders, compatibility: input.compatibility ?? 'auto' }, { sessionId: randomUUID() }, {
        method: 'GET',
        accept: 'application/json',
        signal: controller.signal
      })
      if (!response.ok) {
        const { error } = await errorResponseDetails(response)
        if (error.code === 'PROVIDER_SESSION_REJECTED') throw error
        throw new AppError('PROVIDER_MODELS_FAILED', error.message)
      }
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
      return { models: models.slice(0, MAX_MODEL_COUNT), truncated: models.length > MAX_MODEL_COUNT || responseHasMore(parsed) }
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

function responseHasMore(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && (value as { has_more?: unknown }).has_more === true)
}
