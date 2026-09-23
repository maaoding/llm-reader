import { randomUUID } from 'node:crypto'
import type { DocumentSettings, EmbeddingSettings, RerankSettings, KnowledgeSettings, SaveKnowledgeSettingsInput, RequestSettingsInput } from '@shared/contracts'
import { copy } from '@shared/copy'
import { customHeadersSchema, publicRequestSettings } from '@shared/request-settings'
import { AppDatabase } from './database'
import { AppError } from './errors'
import type { KeyProtector } from './provider-service'
import { knowledgeSettingsSchema } from './schemas'

type Kind = 'embedding' | 'rerank' | 'document'
interface SettingRow { config_json: string; secret: Uint8Array | null; headers_secret: Uint8Array | null; revision: string }
export type EmbeddingCredentials = EmbeddingSettings & { customHeaders?: Record<string, string>; apiKey: string; revision: string }
export type RerankCredentials = RerankSettings & { customHeaders?: Record<string, string>; apiKey: string; revision: string }
export type DocumentCredentials = DocumentSettings & { customHeaders?: Record<string, string>; apiKey: string; revision: string }
const defaults: KnowledgeSettings = {
  embedding: { enabled: false, baseUrl: '', model: '', hasApiKey: false },
  rerank: { enabled: false, baseUrl: '', model: '', hasApiKey: false },
  document: { processor: 'none', baseUrl: '', ocr: true, language: 'ch', hasApiKey: false }
}

export class KnowledgeSettingsService {
  constructor(private readonly database: AppDatabase, private readonly protector: KeyProtector) {}
  private row(kind: Kind): SettingRow | undefined {
    return this.database.connection.prepare('SELECT * FROM knowledge_settings WHERE kind = ?').get(kind) as unknown as SettingRow | undefined
  }
  embeddingRevision(): string { return this.row('embedding')?.revision ?? '' }
  documentRevision(): string { return this.row('document')?.revision ?? '' }
  get(): KnowledgeSettings {
    const result = structuredClone(defaults)
    for (const kind of ['embedding', 'rerank', 'document'] as const) {
      const row = this.row(kind)
      if (row) Object.assign(result[kind], JSON.parse(row.config_json), { hasApiKey: Boolean(row.secret), ...(row.headers_secret ? { hasCustomHeaders: true } : {}) })
    }
    return result
  }
  private sameEndpoint(kind: Kind, value: { baseUrl: string; processor?: string; protocol?: string }): boolean {
    const saved = this.get()[kind]
    return normalizeUrl(saved.baseUrl) === normalizeUrl(value.baseUrl) && (kind !== 'document' ||
      value.processor === this.get().document.processor && (value.protocol ?? 'openai') === (this.get().document.protocol ?? 'openai'))
  }
  private secret(kind: Kind, value: { baseUrl: string; apiKey?: string | null; processor?: string; protocol?: string }): string {
    if (value.apiKey !== undefined) return value.apiKey ?? ''
    const row = this.row(kind)
    if (!row?.secret || !this.sameEndpoint(kind, value)) return ''
    try { return this.protector.decrypt(row.secret) }
    catch { throw new AppError('KNOWLEDGE_SECRET', copy('knowledge.secretError')) }
  }
  private requestSettings(kind: Kind, value: RequestSettingsInput & { baseUrl: string; processor?: string; protocol?: string }): RequestSettingsInput & { customHeaders: Record<string, string> } {
    let headers = value.customHeaders ?? {}
    const row = this.row(kind)
    if (value.customHeaders === undefined && row?.headers_secret && this.sameEndpoint(kind, value)) {
      try { headers = customHeadersSchema.parse(JSON.parse(this.protector.decrypt(row.headers_secret))) }
      catch { throw new AppError('KNOWLEDGE_SECRET', copy('knowledge.secretError')) }
    }
    return { ...publicRequestSettings(value), customHeaders: customHeadersSchema.parse(headers) }
  }
  embedding(draft?: SaveKnowledgeSettingsInput['embedding']): EmbeddingCredentials {
    const value = draft ?? this.get().embedding
    return { ...this.requestSettings('embedding', value), enabled: value.enabled, baseUrl: normalizeUrl(value.baseUrl), model: value.model,
      apiKey: this.secret('embedding', value), revision: this.row('embedding')?.revision ?? '' }
  }
  document(draft?: SaveKnowledgeSettingsInput['document']): DocumentCredentials {
    const value = draft ?? this.get().document
    return { ...this.requestSettings('document', value), processor: value.processor, baseUrl: normalizeUrl(value.baseUrl), ocr: value.ocr, language: value.language,
      ...(value.processor === 'vision' ? { model: value.model ?? '', compatibility: value.compatibility ?? 'auto', ...(value.protocol ? { protocol: value.protocol } : {}) } : {}),
      ...(value.processor === 'mistral-ocr' ? { model: value.model ?? 'mistral-ocr-latest' } : {}),
      apiKey: this.secret('document', value), revision: this.row('document')?.revision ?? '' }
  }
  rerank(draft?: SaveKnowledgeSettingsInput['rerank']): RerankCredentials {
    const value = draft ?? this.get().rerank
    return { ...this.requestSettings('rerank', value), enabled: value.enabled, baseUrl: normalizeUrl(value.baseUrl), model: value.model,
      apiKey: this.secret('rerank', value), revision: this.row('rerank')?.revision ?? '' }
  }
  save(raw: SaveKnowledgeSettingsInput): KnowledgeSettings {
    const input = knowledgeSettingsSchema.parse(raw)
    const values = { embedding: this.embedding(input.embedding), document: this.document(input.document),
      rerank: input.rerank ? this.rerank(input.rerank) : undefined }
    const kinds: Kind[] = input.rerank ? ['embedding', 'rerank', 'document'] : ['embedding', 'document']
    const rows = kinds.map((kind) => {
      const { apiKey, customHeaders = {}, revision: previousRevision, ...config } = values[kind]!
      const oldRow = this.row(kind)
      const previous = oldRow ? JSON.parse(oldRow.config_json) as Record<string, unknown> : {}
      let oldKey: string | undefined
      try { oldKey = oldRow?.secret ? this.protector.decrypt(oldRow.secret) : '' }
      catch { oldKey = undefined } // A newly supplied key can replace an unreadable old secret.
      let oldHeaders: string | undefined
      try { oldHeaders = oldRow?.headers_secret ? this.protector.decrypt(oldRow.headers_secret) : '{}' }
      catch { oldHeaders = undefined }
      const identity = (object: object): string => JSON.stringify(Object.entries(object).filter(([key]) => key !== 'enabled').sort(([a], [b]) => a.localeCompare(b)))
      const revision = identity(config) === identity(previous) && oldKey === apiKey && oldHeaders === JSON.stringify(customHeaders) ? previousRevision : randomUUID()
      if ((apiKey || Object.keys(customHeaders).length) && !this.protector.isAvailable()) throw new AppError('KNOWLEDGE_SECRET', copy('knowledge.secretError'))
      return { kind, config: JSON.stringify(config), headersSecret: Object.keys(customHeaders).length ? this.protector.encrypt(JSON.stringify(customHeaders)) : null, secret: apiKey ? this.protector.encrypt(apiKey) : null, revision }
    })
    const db = this.database.connection
    db.exec('BEGIN')
    try {
      for (const row of rows) db.prepare('INSERT OR REPLACE INTO knowledge_settings(kind, config_json, secret, revision, headers_secret) VALUES (?, ?, ?, ?, ?)')
        .run(row.kind, row.config, row.secret, row.revision, row.headersSecret)
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    return this.get()
  }
}

export function normalizeUrl(value: string): string { return value.trim().replace(/\/+$/u, '') }
