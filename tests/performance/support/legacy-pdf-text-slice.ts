import type { PdfTextModel } from '../../../src/renderer/src/readers/pdf-text'

/** Bounded PDF slicing from 9ff41d9, before sparse prefix positions were retained. */
export function previousBoundedPdfSlice(model: PdfTextModel, rawStart: number, rawEnd: number): string {
  const valid = (offset: number) => Number.isSafeInteger(offset) && offset >= 0 && offset <= model.rawLength
  if (!valid(rawStart) || !valid(rawEnd) || rawEnd < rawStart || rawStart === rawEnd) return ''
  const value = model.readableText
  if (rawStart === 0 && rawEnd === model.rawLength) return Array.from(value).join('')
  const start = model.readableOffsetForRaw(rawStart, 'start')
  const end = Math.max(start, model.readableOffsetForRaw(rawEnd, 'end'))
  let point = 0, offset = 0
  while (point < start && offset < value.length) {
    offset += value.codePointAt(offset)! > 0xffff ? 2 : 1
    point++
  }
  const from = offset
  while (point < end && offset < value.length) {
    offset += value.codePointAt(offset)! > 0xffff ? 2 : 1
    point++
  }
  return Array.from(value.slice(from, offset)).join('')
}
