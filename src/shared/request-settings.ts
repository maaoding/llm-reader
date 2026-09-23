import { z } from 'zod'
import type { JsonValue, ProviderSettings, RequestSettings } from './contracts'

export function providerIsConfigured(provider: Pick<ProviderSettings, 'baseUrl' | 'model' | 'hasApiKey' | 'hasCustomHeaders'>): boolean {
  return Boolean(provider.baseUrl.trim() && provider.model.trim() && (provider.hasApiKey || provider.hasCustomHeaders))
}

const forbiddenHeaders = new Set(['host', 'content-length', 'content-type', 'connection', 'transfer-encoding', 'upgrade', 'trailer', 'te', 'proxy-authorization', 'proxy-connection'])
export const customHeadersSchema = z.record(
  z.string().min(1).max(128).regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u),
  z.string().max(8_192).regex(/^[\t\x20-\x7e\x80-\xff]*$/u)
).refine((headers) => {
  const names = Object.keys(headers).map((name) => name.toLowerCase())
  return names.length <= 32 && new Set(names).size === names.length &&
    names.every((name) => !forbiddenHeaders.has(name)) && JSON.stringify(headers).length <= 24_000
})

// The reader owns source data, output formats and routing; extra options cannot replace them.
const reservedBody = new Set(['__proto__', 'prototype', 'constructor', 'model', 'messages', 'system', 'stream',
  'input', 'query', 'documents', 'document', 'files', 'file', 'sources', 'url', 'image_url', 'pages',
  'encoding_format', 'return_documents', 'top_n', 'output_format', 'to_formats', 'image_export_mode',
  'return_content_list', 'return_md', 'return_images', 'response_format_zip', 'include_image_base64', 'table_format'])
export const extraBodySchema = z.record(z.string().min(1).max(128), z.json()).refine((value) =>
  Object.keys(value).length <= 64 && !Object.keys(value).some((key) => reservedBody.has(key)) &&
  JSON.stringify(value).length <= 24_000
).transform((value) => value as Record<string, JsonValue>)

export const requestSettingsFields = {
  timeoutMs: z.number().int().min(1_000).max(600_000).optional(),
  extraBody: extraBodySchema.optional(),
  customHeaders: customHeadersSchema.nullable().optional(),
  hasCustomHeaders: z.boolean().optional()
}

export function publicRequestSettings(value: RequestSettings): RequestSettings {
  return {
    ...(value.timeoutMs !== undefined ? { timeoutMs: value.timeoutMs } : {}),
    ...(value.extraBody !== undefined ? { extraBody: value.extraBody } : {})
  }
}

/** Case-insensitive overrides, without duplicate Authorization / API key headers. */
export function mergeRequestHeaders(defaults: Record<string, string>, custom?: Record<string, string> | null): Record<string, string> {
  const result = { ...defaults }
  for (const [name, value] of Object.entries(customHeadersSchema.parse(custom ?? {}))) {
    for (const existing of Object.keys(result)) if (existing.toLowerCase() === name.toLowerCase()) delete result[existing]
    result[name] = value
  }
  return result
}

export function isPageProcessor(processor: string): boolean {
  return ['vision', 'mistral-ocr', 'unstructured'].includes(processor)
}
