import { z } from 'zod'

const shortText = (maximum: number) => z.string().trim().min(1).max(maximum)
const idSchema = z.string().uuid()

export const bookIdSchema = idSchema
export const insightIdSchema = idSchema
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

const passageSchema = z.object({
  id: z.string().trim().min(1).max(128).regex(/^[\w.:/-]+$/u),
  text: z.string().min(1).max(100_000),
  anchor: shortText(16_384)
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

export const insightSchema = z
  .object({
    bookId: idSchema,
    selection: selectionSchema,
    question: z.string().max(20_000),
    answer: z.string().min(1).max(2_000_000),
    model: shortText(256)
  })
  .refine((insight) => insight.bookId === insight.selection.bookId, {
    message: '收藏与选区必须属于同一本书',
    path: ['selection', 'bookId']
  })

export const providerSettingsSchema = z.object({
  baseUrl: z
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
    }, '接口地址必须是 HTTP(S) 地址'),
  model: shortText(256),
  apiKey: z.string().trim().min(1).max(10_000).optional()
})

export const llmRequestSchema = z
  .object({
    requestId: z.string().min(1).max(128).regex(/^[\w.-]+$/u),
    action: z.enum(['explain', 'context', 'ask']),
    question: z.string().max(20_000),
    selection: selectionSchema,
    history: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string().min(1).max(20_000)
        })
      )
      .max(30)
  })
  .refine((request) => request.action !== 'ask' || request.question.trim().length > 0, {
    message: '自由提问不能为空',
    path: ['question']
  })

export const requestIdSchema = z.string().min(1).max(128).regex(/^[\w.-]+$/u)
