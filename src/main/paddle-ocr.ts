import { z } from 'zod'
import type { OcrWordBox } from '@shared/contracts'
import { copy } from '@shared/copy'
import { mergeRequestHeaders } from '@shared/request-settings'
import { OCR_MAX_IMAGE_EDGE, OCR_MAX_PAGE_CHARACTERS, OCR_MAX_WORD_BOXES } from '@shared/vision-ocr'
import { AppError } from './errors'
import type { KnowledgeHttp } from './knowledge-http'
import type { DocumentCredentials } from './knowledge-settings'
import { normalizedProviderUrl } from './provider-protocol'

export interface RecognizedOcrPage {
  text: string
  wordLines?: OcrWordBox[][]
}

const maxLines = 1_000
const imageEdge = z.number().int().min(1).max(OCR_MAX_IMAGE_EDGE)
const responseSchema = z.object({ errorCode: z.literal(0), result: z.object({
  dataInfo: z.object({ type: z.literal('image'), width: imageEdge, height: imageEdge }),
  ocrResults: z.array(z.object({ prunedResult: z.object({
    rec_texts: z.array(z.string().max(OCR_MAX_PAGE_CHARACTERS)).max(maxLines),
    text_word: z.unknown().optional(), text_word_boxes: z.unknown().optional(), rec_boxes: z.unknown().optional(),
    model_settings: z.object({ use_doc_preprocessor: z.boolean(), use_textline_orientation: z.boolean() }).optional()
  }) })).length(1)
}) })
const pixel = z.number().min(0).max(OCR_MAX_IMAGE_EDGE)
const box = z.tuple([pixel, pixel, pixel, pixel])
const lineBoxes = z.array(box).max(maxLines)
const wordTexts = z.array(z.array(z.string().max(256)).max(OCR_MAX_WORD_BOXES)).max(maxLines)
const wordBoxes = z.array(z.array(box).max(OCR_MAX_WORD_BOXES)).max(maxLines)

function imageSize(base64: string): { width: number; height: number } | undefined {
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length >= 24 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' && bytes.toString('ascii', 12, 16) === 'IHDR') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) return
  let offset = 2
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1]
    const length = bytes.readUInt16BE(offset + 2)
    if (length < 2 || offset + 2 + length > bytes.length) return
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (length < 8) return
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) }
    }
    if (marker === 0xda || marker === 0xd9) return
    offset += 2 + length
  }
}

function normalizeWordLines(lines: string[], result: z.infer<typeof responseSchema>['result']['ocrResults'][number]['prunedResult'],
  width: number, height: number): OcrWordBox[][] | undefined {
  if (result.model_settings?.use_doc_preprocessor !== false || result.model_settings.use_textline_orientation !== false) return
  const words = wordTexts.safeParse(result.text_word), boxes = wordBoxes.safeParse(result.text_word_boxes)
  const rows = lineBoxes.safeParse(result.rec_boxes)
  if (!words.success || !boxes.success || !rows.success ||
      [words.data, boxes.data, rows.data].some((values) => values.length !== lines.length)) return
  if (words.data.reduce((count, line) => count + line.length, 0) > OCR_MAX_WORD_BOXES) return

  const wordLines: OcrWordBox[][] = []
  let pageOffset = 0
  let previousCenterY = -1
  let previousRowHeight = 0
  for (const [index, line] of lines.entries()) {
    const tokens = words.data[index]
    const rowBoxes = boxes.data[index]
    const [left, top, right, bottom] = rows.data[index]
    const centerY = (top + bottom) / 2
    const rowHeight = bottom - top
    // Only expose coordinates for horizontal, non-interleaved text rows.
    if (!line || !tokens.length || tokens.length !== rowBoxes.length || rowHeight <= 0 ||
        right - left < rowHeight * 0.7 || right > width || bottom > height ||
        (index > 0 && centerY - previousCenterY < (rowHeight + previousRowHeight) * 0.35)) return
    previousCenterY = centerY
    previousRowHeight = rowHeight
    let offset = 0
    let characterOffset = pageOffset
    let previousCenterX = -1
    const wordLine: OcrWordBox[] = []
    for (const [wordIndex, rawToken] of tokens.entries()) {
      const token = rawToken.trim()
      if (!token) continue
      const start = line.indexOf(token, offset)
      const [x1, y1, x2, y2] = rowBoxes[wordIndex]
      const centerX = (x1 + x2) / 2
      // Use the reported token order only if the boxes and the transcription agree.
      if (start < 0 || line.slice(offset, start).trim() || x1 >= x2 || y1 >= y2 || x2 > width || y2 > height ||
          centerX <= previousCenterX || x1 < left - 2 || x2 > right + 2 || y1 < top - 2 || y2 > bottom + 2) return
      previousCenterX = centerX
      characterOffset += Array.from(line.slice(offset, start)).length
      offset = start + token.length
      const end = characterOffset + Array.from(token).length
      wordLine.push({ start: characterOffset, end, left: x1 / width,
        top: y1 / height, right: x2 / width, bottom: y2 / height })
      characterOffset = end
    }
    if (!wordLine.length || line.slice(offset).trim()) return
    wordLines.push(wordLine)
    pageOffset += Array.from(line).length + 1
  }
  return wordLines.length ? wordLines : undefined
}

export async function recognizeWithPaddleOcr(http: KnowledgeHttp, config: DocumentCredentials,
  image: string, signal: AbortSignal): Promise<RecognizedOcrPage> {
  const url = normalizedProviderUrl(config.baseUrl)
  const path = url.pathname.replace(/\/+$/u, '')
  url.pathname = path.endsWith('/ocr') ? path : `${path}/ocr`
  const file = image.slice(image.indexOf(',') + 1)
  const raw = await http.json(url.href, { method: 'POST',
    headers: mergeRequestHeaders({ 'Content-Type': 'application/json', Accept: 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) }, config.customHeaders),
    body: JSON.stringify({ ...config.extraBody, file, fileType: 1,
      useDocOrientationClassify: false, useDocUnwarping: false, useTextlineOrientation: false,
      returnWordBox: true, visualize: false })
  }, signal, 2_000_000, config.timeoutMs ?? 90_000)
  const parsed = responseSchema.safeParse(raw)
  if (!parsed.success) throw new AppError('OCR_RESPONSE', copy('vision.invalidResponse'))
  const { dataInfo, ocrResults } = parsed.data.result
  const result = ocrResults[0].prunedResult
  const lines = result.rec_texts.map((line) => line.trim())
  const text = lines.join('\n').trim()
  if (text.length > OCR_MAX_PAGE_CHARACTERS) throw new AppError('OCR_RESPONSE', copy('vision.invalidResponse'))
  const actualSize = imageSize(file)
  const matchingSize = actualSize?.width === dataInfo.width && actualSize.height === dataInfo.height
  const wordLines = matchingSize ? normalizeWordLines(lines, result, dataInfo.width, dataInfo.height) : undefined
  return wordLines ? { text, wordLines } : { text }
}
