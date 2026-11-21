import { z } from 'zod'
import { copy } from '@shared/copy'
import { mergeRequestHeaders } from '@shared/request-settings'
import { OCR_MAX_PAGE_CHARACTERS } from '@shared/vision-ocr'
import { AppError } from './errors'
import type { DocumentCredentials } from './knowledge-settings'
import { KnowledgeHttp } from './knowledge-http'
import { buildProviderUrl, normalizedProviderUrl } from './provider-protocol'

export function appendFormOptions(form: FormData, options: DocumentCredentials['extraBody']): void {
  for (const [name, value] of Object.entries(options ?? {})) {
    form.delete(name)
    for (const item of Array.isArray(value) ? value : [value]) {
      form.append(name, typeof item === 'object' ? JSON.stringify(item) : String(item))
    }
  }
}

const text = z.string().max(OCR_MAX_PAGE_CHARACTERS)
const mistralResponse = z.object({ pages: z.array(z.object({ index: z.literal(0), markdown: text,
  header: text.nullable().optional(), footer: text.nullable().optional()
})).length(1) })
const partitionResponse = z.array(z.object({ text })).max(10_000)

/** Each service sees one rendered page, so source locations remain under the reader's control. */
export async function recognizeWithDocumentProvider(http: KnowledgeHttp, config: DocumentCredentials, image: string, signal: AbortSignal): Promise<string> {
  let result: string
  if (config.processor === 'mistral-ocr') {
    const raw = await http.json(buildProviderUrl(config.baseUrl, 'ocr'), { method: 'POST',
      headers: mergeRequestHeaders({ 'Content-Type': 'application/json', Accept: 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) }, config.customHeaders),
      body: JSON.stringify({ ...config.extraBody, model: config.model, document: { type: 'image_url', image_url: image }, include_image_base64: false, table_format: null })
    }, signal, 256_000, config.timeoutMs ?? 90_000)
    const parsed = mistralResponse.safeParse(raw)
    if (!parsed.success) throw new AppError('OCR_RESPONSE', copy('vision.invalidResponse'))
    const page = parsed.data.pages[0]
    result = [page.header, page.markdown, page.footer].filter(Boolean).join('\n\n')
  } else {
    const url = normalizedProviderUrl(config.baseUrl)
    if (!url.pathname.replace(/\/+$/u, '').endsWith('/general/v0/general')) {
      url.pathname = `${url.pathname.replace(/\/+$/u, '')}/general/v0/general`
    }
    const [prefix, data] = image.split(',')
    const mediaType = prefix.slice(5, prefix.indexOf(';'))
    const form = new FormData()
    form.append('files', new Blob([Buffer.from(data, 'base64')], { type: mediaType }), mediaType === 'image/png' ? 'page.png' : 'page.jpg')
    form.append('strategy', 'hi_res')
    form.append('languages', config.language === 'ch' ? 'chi_sim' : 'eng')
    form.append('output_format', 'application/json')
    appendFormOptions(form, config.extraBody)
    const raw = await http.json(url.toString(), { method: 'POST', body: form,
      headers: mergeRequestHeaders({ Accept: 'application/json', ...(config.apiKey ? { 'unstructured-api-key': config.apiKey } : {}) }, config.customHeaders)
    }, signal, 2_000_000, config.timeoutMs ?? 90_000)
    const parsed = partitionResponse.safeParse(raw)
    if (!parsed.success) throw new AppError('OCR_RESPONSE', copy('vision.invalidResponse'))
    result = parsed.data.map((element) => element.text).join('\n\n')
  }
  if (result.length > OCR_MAX_PAGE_CHARACTERS) throw new AppError('OCR_RESPONSE', copy('vision.invalidResponse'))
  return result.trim()
}
