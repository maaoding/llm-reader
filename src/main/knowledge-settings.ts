import { randomUUID } from 'node:crypto'
import type { DocumentSettings, EmbeddingSettings, RerankSettings, KnowledgeSettings, SaveKnowledgeSettingsInput } from '@shared/contracts'
import { copy } from '@shared/copy'
import { AppDatabase } from './database'
import { AppError } from './errors'
import type { KeyProtector } from './provider-service'
import { knowledgeSettingsSchema } from './schemas'

type Kind = 'embedding' | 'rerank' | 'document'
interface SettingRow { config_json: string; secret: Uint8Array | null; revision: string }
export type EmbeddingCredentials = EmbeddingSettings & { apiKey: string; revision: string }
export type RerankCredentials = RerankSettings & { apiKey: string; revision: string }
export type DocumentCredentials = DocumentSettings & { apiKey: string; revision: string }
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
      if (row) Object.assign(result[kind], JSON.parse(row.config_json), { hasApiKey: Boolean(row.secret) })
    }
    return result
  }
  private secret(kind: Kind, value: { baseUrl: string; apiKey?: string | null }, processor?: string): string {
    if (value.apiKey !== undefined) return value.apiKey ?? ''
    const row = this.row(kind)
    const saved = this.get()[kind]
    // Never send a saved credential to a new endpoint or a different processing provider.
    if (!row?.secret || normalizeUrl(saved.baseUrl) !== normalizeUrl(value.baseUrl) ||
        (kind === 'document' && processor !== this.get().document.processor)) return ''
    try { return this.protector.decrypt(row.secret) }
    catch { throw new AppError('KNOWLEDGE_SECRET', copy('knowledge.secretError')) }
  }
  embedding(draft?: SaveKnowledgeSettingsInput['embedding']): EmbeddingCredentials {
    const value = draft ?? this.get().embedding
    return { enabled: value.enabled, baseUrl: normalizeUrl(value.baseUrl), model: value.model,
      apiKey: this.secret('embedding', value), revision: this.row('embedding')?.revision ?? '' }
  }
  document(draft?: SaveKnowledgeSettingsInput['document']): DocumentCredentials {
    const value = draft ?? this.get().document
    return { processor: value.processor, baseUrl: normalizeUrl(value.baseUrl), ocr: value.ocr, language: value.language,
      apiKey: this.secret('document', value, value.processor), revision: this.row('document')?.revision ?? '' }
  }
  rerank(draft?: SaveKnowledgeSettingsInput['rerank']): RerankCredentials {
    const value = draft ?? this.get().rerank
    return { enabled: value.enabled, baseUrl: normalizeUrl(value.baseUrl), model: value.model,
      apiKey: this.secret('rerank', value), revision: this.row('rerank')?.revision ?? '' }
  }
  save(raw: SaveKnowledgeSettingsInput): KnowledgeSettings {
    const input = knowledgeSettingsSchema.parse(raw)
    const values = { embedding: this.embedding(input.embedding), document: this.document(input.document),
      rerank: input.rerank ? this.rerank(input.rerank) : undefined }
    const kinds: Kind[] = input.rerank ? ['embedding', 'rerank', 'document'] : ['embedding', 'document']
    const rows = kinds.map((kind) => {
      const { apiKey, revision: previousRevision, ...config } = values[kind]!
      const oldRow = this.row(kind)
      const previous = oldRow ? JSON.parse(oldRow.config_json) as Record<string, unknown> : {}
      let oldKey: string | undefined
      try { oldKey = oldRow?.secret ? this.protector.decrypt(oldRow.secret) : '' }
      catch { oldKey = undefined } // A newly supplied key can replace an unreadable old secret.
      const identity = (object: object): string => JSON.stringify(Object.entries(object).filter(([key]) => key !== 'enabled'))
      const revision = identity(config) === identity(previous) && oldKey === apiKey ? previousRevision : randomUUID()
      if (apiKey && !this.protector.isAvailable()) throw new AppError('KNOWLEDGE_SECRET', copy('knowledge.secretError'))
      return { kind, config: JSON.stringify(config), secret: apiKey ? this.protector.encrypt(apiKey) : null, revision }
    })
    const db = this.database.connection
    db.exec('BEGIN')
    try {
      for (const row of rows) db.prepare('INSERT OR REPLACE INTO knowledge_settings(kind, config_json, secret, revision) VALUES (?, ?, ?, ?)')
        .run(row.kind, row.config, row.secret, row.revision)
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    return this.get()
  }
}

export function normalizeUrl(value: string): string { return value.trim().replace(/\/+$/u, '') }
