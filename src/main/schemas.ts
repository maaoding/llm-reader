import { z } from 'zod'
import { validateDocument } from '@shared/document-structure'

const shortText = (maximum: number) => z.string().trim().min(1).max(maximum)
const idSchema = z.string().uuid()

export const bookIdSchema = idSchema
export const bookImportPathsSchema = z.array(z.string().min(1).max(32_768)).min(1).max(300)
export const insightIdSchema = idSchema
export const highlightIdSchema = idSchema
export const metadataSchema = z.object({
  bookId: idSchema,
  title: shortText(500),
  author: z.string().trim().max(500).nullable()
})
export const progressSchema = z.object({
  bookId: idSchema,
  locator: shortText(16_384),
  progress: z.number().finite().min(0).max(1)
})

export const highlightSchema = z.object({
  bookId: idSchema,
  quote: z.string().min(1).max(20_000),
  anchor: shortText(16_384),
  chapterTitle: z.string().trim().max(1_000)
})

const structureId = z.string().min(1).max(128).regex(/^[\w.:/-]+$/u)
export const sourceRangeSchema = z.object({
  anchor: shortText(16_384), page: z.number().int().min(1).max(600).optional(),
  bbox: z.object({ left: z.number().finite().nonnegative(), top: z.number().finite().nonnegative(), right: z.number().finite().nonnegative(), bottom: z.number().finite().nonnegative(),
    origin: z.enum(['TOPLEFT', 'BOTTOMLEFT']), width: z.number().finite().positive().optional(), height: z.number().finite().positive().optional() }).optional(),
  start: z.number().int().nonnegative().optional(), end: z.number().int().nonnegative().optional(),
  textStart: z.number().int().nonnegative().optional(), textEnd: z.number().int().nonnegative().optional(),
  precision: z.enum(['text', 'block', 'table'])
}).refine((source) => (source.start === undefined || source.end === undefined || source.start <= source.end) &&
  (source.textStart === undefined || source.textEnd === undefined || source.textStart <= source.textEnd), '来源范围无效')
const tableSliceSchema = z.object({ rows: z.array(z.number().int().nonnegative()).max(100_000),
  cells: z.array(z.object({ id: structureId, start: z.number().int().nonnegative(), end: z.number().int().nonnegative(),
    textStart: z.number().int().nonnegative(), textEnd: z.number().int().nonnegative(), header: z.boolean(), rows: z.array(z.number().int().nonnegative()).max(100_000).optional() })).max(100_000) })
const unitKindSchema = z.enum(['heading', 'paragraph', 'list', 'note', 'table', 'caption', 'formula', 'header', 'footer', 'unknown'])
export const normalizedDocumentSchema = z.object({
  version: z.literal(2), pageCount: z.number().int().min(1).max(600).optional(),
  nodes: z.array(z.object({ id: structureId, parentId: structureId.nullable(), title: z.string().max(1_000), level: z.number().int().min(0).max(64),
    order: z.number().int().nonnegative(), anchor: shortText(16_384), kind: z.enum(['section', 'group']) })).max(100_000),
  units: z.array(z.object({ id: structureId, nodeId: structureId, order: z.number().int().nonnegative(), kind: unitKindSchema,
    text: z.string().max(80_000_000), sources: z.array(sourceRangeSchema).min(1).max(10_000), relatedIds: z.array(structureId).max(100_000), searchable: z.boolean(),
    table: z.object({ rows: z.number().int().min(1).max(100_000), columns: z.number().int().min(1).max(100_000),
      captionIds: z.array(structureId).max(100_000), noteIds: z.array(structureId).max(100_000),
      cells: z.array(z.object({ id: structureId, row: z.number().int().nonnegative(), column: z.number().int().nonnegative(),
        rowSpan: z.number().int().min(1).max(100_000), columnSpan: z.number().int().min(1).max(100_000), header: z.boolean(), rowHeader: z.boolean().optional(),
        text: z.string().max(80_000_000), sources: z.array(sourceRangeSchema).max(600).optional() })).max(100_000) }).optional()
  })).max(100_000),
  diagnostics: z.array(z.object({ code: z.enum(['missing-body', 'unknown-structure', 'unlinked-note', 'table-degraded', 'suspected-duplicate']),
    page: z.number().int().min(1).max(600).optional(), unitId: structureId.optional() })).max(100_000)
}).superRefine((value, context) => {
  try { validateDocument(value) } catch { context.addIssue({ code: 'custom', message: '文档结构或来源无效' }) }
})

const passageSchema = z.object({
  id: z.string().trim().min(1).max(128).regex(/^[\w.:/-]+$/u),
  text: z.string().min(1).max(100_000),
  anchor: shortText(16_384),
  chapterTitle: z.string().max(1_000).optional(),
  blockId: z.string().max(128).optional(),
  chapterId: z.string().max(128).optional(),
  evidenceRole: z.enum(['nearby', 'chapter', 'extension']).optional(),
  nodeId: structureId.optional(), unitId: structureId.optional(), headingPath: z.array(z.string().max(1_000)).max(64).optional(),
  sources: z.array(sourceRangeSchema).max(10_000).optional(),
  unitRange: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).optional(),
  tableSlice: tableSliceSchema.optional()
})

export const selectionSchema = z
  .object({
    bookId: idSchema,
    quote: z.string().min(1).max(20_000),
    anchor: shortText(16_384),
    chapterTitle: z.string().trim().max(1_000),
    passages: z.array(passageSchema).min(1).max(200)
  })
  .superRefine((selection, context) => {
    const ids = new Set(selection.passages.map((passage) => passage.id))
    if (ids.size !== selection.passages.length) {
      context.addIssue({ code: 'custom', message: 'passage id 必须唯一', path: ['passages'] })
    }
    const totalCharacters = selection.passages.reduce((sum, passage) => sum + passage.text.length, 0)
    if (totalCharacters > 1_000_000) {
      context.addIssue({ code: 'custom', message: '上下文过大', path: ['passages'] })
    }
  })

export const contextSnapshotSchema = z.object({
  scope: z.enum(['selection', 'book']),
  bookId: idSchema,
  selection: selectionSchema.nullable(),
  passages: z.array(passageSchema).max(200),
  background: z.string().max(30_000),
  coverage: z.object({ covered: z.number().int().min(0).max(10_000), total: z.number().int().min(0).max(10_000) }),
  rerank: z.object({
    status: z.enum(['applied', 'skipped', 'fallback']), model: z.string().max(256),
    candidateCount: z.number().int().min(0).max(60), elapsedMs: z.number().int().nonnegative().max(90_000),
    reason: z.enum(['ranked', 'disabled', 'not-ready', 'insufficient-candidates', 'configuration', 'timeout',
      'rate-limit', 'authentication', 'server', 'http', 'redirect', 'too-large', 'invalid-response', 'network'])
  }).strict().optional(),
  planningUsage: z.object({
    promptTokens: z.number().int().nonnegative().optional(),
    completionTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional()
  }).optional()
}).superRefine((snapshot, context) => {
  if ((snapshot.scope === 'selection') !== Boolean(snapshot.selection) || (snapshot.selection && snapshot.selection.bookId !== snapshot.bookId)) {
    context.addIssue({ code: 'custom', message: '上下文来源不匹配' })
  }
  if (new Set(snapshot.passages.map((item) => item.id)).size !== snapshot.passages.length ||
      snapshot.passages.reduce((sum, item) => sum + item.text.length, 0) > 100_000 || snapshot.coverage.covered > snapshot.coverage.total) {
    context.addIssue({ code: 'custom', message: '上下文来源无效' })
  }
})

export const insightSchema = z
  .object({
    bookId: idSchema,
    conversationId: z.uuid({ version: 'v4' }).optional(),
    selection: selectionSchema.nullable(),
    context: contextSnapshotSchema.optional(),
    question: z.string().max(20_000),
    answer: z.string().min(1).max(2_000_000),
    model: shortText(256)
  })
    .refine((insight) => (insight.selection ? insight.bookId === insight.selection.bookId : insight.context?.scope === 'book') &&
      (!insight.context || insight.context.bookId === insight.bookId), {
    message: '归档与选区必须属于同一本书',
    path: ['selection', 'bookId']
  })

export const archivedMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(2_000_000),
  model: shortText(256).optional(),
  context: contextSnapshotSchema.optional()
})

export const insightHistorySchema = z.object({
  bookId: idSchema,
  id: idSchema,
  history: z.array(archivedMessageSchema).min(2).max(200)
}).refine((input) => input.history.every((message) => !message.context || message.context.bookId === input.bookId), {
  message: '归档历史必须属于同一本书', path: ['history']
})

export const insightExportScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('book'), bookId: idSchema }),
  z.object({ kind: z.literal('insight'), insightId: idSchema })
])

const providerBaseUrlSchema = z
    .string()
    .trim()
    .min(1)
    .max(2_048)
    .refine((value) => {
      try {
        const url = new URL(value)
        const hostname = url.hostname.toLowerCase()
        const localHttp = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)
        return (
          ['http:', 'https:'].includes(url.protocol) &&
          (url.protocol === 'https:' || localHttp) &&
          !url.username &&
          !url.password
        )
      } catch {
        return false
      }
    }, '接口地址必须是 HTTP(S) 地址')

export const providerProfileIdSchema = z.string().trim().min(1).max(128).regex(/^[\w-]+$/u)

const providerProfileFields = {
  compatibility: z.enum(['auto', 'opencode-go']).default('auto'),
  name: z.string().trim().min(1).max(60),
  baseUrl: providerBaseUrlSchema,
  model: shortText(256),
  apiKey: z.string().trim().min(1).max(10_000).optional()
}

export const createProviderProfileSchema = z.object(providerProfileFields)

export const updateProviderProfileSchema = z.object({
  id: providerProfileIdSchema,
  ...providerProfileFields
})

export const providerConfigurationSchema = z.object({
  compatibility: z.enum(['auto', 'opencode-go']).default('auto'),
  profileId: providerProfileIdSchema.optional(),
  baseUrl: providerBaseUrlSchema,
  model: shortText(256),
  apiKey: z.string().trim().min(1).max(10_000).optional()
})

export const providerModelListSchema = z.object({
  compatibility: z.enum(['auto', 'opencode-go']).default('auto'),
  profileId: providerProfileIdSchema.optional(),
  baseUrl: providerBaseUrlSchema,
  apiKey: z.string().trim().min(1).max(10_000).optional()
})

const llmRequestBase = {
    conversationId: z.uuid({ version: 'v4' }),
    requestId: z.string().min(1).max(128).regex(/^[\w.-]+$/u),
    action: z.enum(['explain', 'context', 'ask']),
    question: z.string().max(20_000),
    history: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string().min(1).max(20_000)
        })
      )
      .max(30)
  }
export const llmRequestSchema = z.union([
  z.object({ ...llmRequestBase, scope: z.literal('selection').optional(), selection: selectionSchema }),
  z.object({ ...llmRequestBase, scope: z.literal('book'), bookId: idSchema })
])
  .refine((request) => request.action !== 'ask' || request.question.trim().length > 0, {
    message: '自由提问不能为空',
    path: ['question']
  })

export const requestIdSchema = z.string().min(1).max(128).regex(/^[\w.-]+$/u)

const knowledgeUrl = z.union([z.literal(''), providerBaseUrlSchema]).refine((value) => {
  if (!value) return true
  const url = new URL(value)
  return !url.search && !url.hash
}, '接口地址不能包含查询参数或片段')
const knowledgeKey = z.string().trim().min(1).max(10_000).regex(/^[^\r\n]+$/u).nullable().optional()
export const knowledgeSettingsSchema = z.object({
  rerank: z.object({ enabled: z.boolean(), baseUrl: knowledgeUrl, model: z.string().trim().max(256), apiKey: knowledgeKey }).strict()
    .refine((value) => !value.enabled || Boolean(value.baseUrl && value.model), '请填写重排地址和模型').optional(),
  embedding: z.object({ enabled: z.boolean(), baseUrl: knowledgeUrl, model: z.string().trim().max(256), apiKey: knowledgeKey }).strict()
    .refine((value) => !value.enabled || Boolean(value.baseUrl && value.model), '请填写 Embedding 地址和模型'),
  document: z.object({ processor: z.enum(['none', 'mineru-local', 'mineru-cloud', 'docling']), baseUrl: knowledgeUrl,
    ocr: z.boolean(), language: z.enum(['ch', 'en']), apiKey: knowledgeKey }).strict()
    .refine((value) => value.processor === 'none' || Boolean(value.baseUrl), '请填写文档处理服务地址')
}).strict()
export const testKnowledgeSettingsSchema = knowledgeSettingsSchema.extend({ target: z.enum(['embedding', 'rerank', 'document']) })
  .refine((value) => value.target !== 'rerank' || Boolean(value.rerank?.baseUrl && value.rerank.model), '请填写重排地址和模型')
export const startSemanticIndexSchema = z.object({ bookId: idSchema, rebuild: z.boolean().optional() }).strict()
export const prepareBookDocumentSchema = startSemanticIndexSchema

export const startBookAnalysisSchema = z.object({ bookId: idSchema, profileId: providerProfileIdSchema, rebuild: z.boolean().optional() })
export const bookExtractionSchema = z.object({ bookId: idSchema, jobId: idSchema })
export const pdfExtractionSchema = bookExtractionSchema.extend({ pageCount: z.number().int().min(1).max(600) }).strict()
export const documentSectionSchema = z.object({
  id: shortText(128).regex(/^[\w.-]+$/u),
  chapterId: shortText(128).regex(/^[\w.-]+$/u),
  chapterTitle: z.string().max(1_000),
  order: z.number().int().min(0).max(9_999),
  blocks: z.array(passageSchema.extend({ kind: unitKindSchema, searchable: z.boolean().optional() })).min(1).max(48)
}).superRefine((section, context) => {
  if (section.blocks.some((block) => Array.from(block.text).length > 1_800) ||
      section.blocks.reduce((sum, block) => sum + Array.from(block.text).length, 0) > 6_000) {
    context.addIssue({ code: 'custom', message: '分节过大' })
  }
})
export const bookExtractionBatchSchema = bookExtractionSchema.extend({ sections: z.array(documentSectionSchema).min(1).max(8), document: normalizedDocumentSchema.optional() })
