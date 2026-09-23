import { expect, it } from 'vitest'
import { makeOcrTextAnchor, parseOcrTextAnchor, pdfPageFromLocator } from '../../src/shared/ocr-reading'
import { ocrSelection } from '../../src/renderer/src/readers/ocr-selection'
import { selectionSchema } from '../../src/main/schemas'

const revision = '7157b869-f3e8-48f9-a62a-7a2747c10718'
const page = { status: 'ready' as const, pageNumber: 2, pageCount: 3, revision, text: '开头。\n  😀独立复核\n  结尾。' }

it('preserves Unicode offsets, separates OCR anchors from PDF text and supplies genuine page sources', () => {
  const context = ocrSelection(revision, page, 4, 13)!
  expect(context.quote).toBe('😀独立复核')
  expect(parseOcrTextAnchor(context.anchor)).toEqual({ pageNumber: 2, start: 6, end: 11, revision })
  expect(context.passages[0]).toMatchObject({ anchor: 'pdfpos:2:0', sources: [{ page: 2, anchor: 'pdfpos:2:0', precision: 'block' }] })
  expect(selectionSchema.safeParse(context).success).toBe(true)
  const rebuilt = ocrSelection(revision, { ...page, revision: 'a'.repeat(8) + revision.slice(8) }, 4, 13)!
  expect(rebuilt.anchor).not.toBe(context.anchor)
})

it('bounds surrounding evidence while retaining the selected text and rejects empty or excessive selections', () => {
  const long = { ...page, text: '前'.repeat(15000) + '😀独立复核' + '后'.repeat(16000) }
  const context = ocrSelection(revision, long, 15000, 15005)!
  expect(context.quote).toBe('😀独立复核')
  expect(context.passages[0].text).toContain(context.quote)
  expect(Array.from(context.passages[0].text)).toHaveLength(6000)
  expect(() => ocrSelection(revision, long, 0, 20001)).toThrow(/2 万/u)
  expect(ocrSelection(revision, { ...page, text: '  \n  ' }, 0, 5)).toBeNull()
  expect(ocrSelection(revision, page, -1, 4)).toBeNull()
  expect(ocrSelection(revision, page, 0, 100)).toBeNull()
})

it('validates saved OCR locations and resolves existing PDF locator types to the actual page', () => {
  const anchor = makeOcrTextAnchor(2, 0, 20, revision)
  expect(parseOcrTextAnchor(anchor, 3)?.pageNumber).toBe(2)
  for (const invalid of [anchor.replace('pdfocr:2:', 'pdfocr:0:'), anchor.replace(':0:20:', ':20:20:'), anchor.replace(':0:20:', ':0:40001:'), anchor.replace(revision, 'bad'), 'pdf:2:0:20']) expect(parseOcrTextAnchor(invalid)).toBeNull()
  expect(parseOcrTextAnchor(anchor, 1)).toBeNull()
  for (const value of ['pdf:4:0:10', 'pdfpos:4:0.5', 'pdfrect:4:0:0:1:1', makeOcrTextAnchor(4, 0, 10, revision)]) expect(pdfPageFromLocator(value)).toBe(4)
  expect(pdfPageFromLocator(null)).toBe(1)
  expect(pdfPageFromLocator('pdfpos:601:0')).toBe(1)
})
