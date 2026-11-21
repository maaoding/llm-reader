import { describe, expect, it } from 'vitest'
import {
  createPdfTextModel,
  extractPdfRegionText,
  makePdfRegionAnchor,
  makePdfTextAnchor,
  parsePdfRegionAnchor,
  parsePdfTextAnchor,
  type PdfRegionTextItem
} from '../../src/renderer/src/readers/pdf-text'

describe('PDF readable text mapping', () => {
  it('inserts a readable separator without changing legacy raw offsets', () => {
    const model = createPdfTextModel([
      { str: 'principle of', hasEOL: true },
      { str: 'software' }
    ])

    expect(model.rawText).toBe('principle ofsoftware')
    expect(model.readableText).toBe('principle of software')
    expect(model.readableSliceForRaw(0, model.rawLength)).toBe('principle of software')
    expect(model.readableOffsetForRaw(12, 'end')).toBe(12)
    expect(model.readableOffsetForRaw(12, 'start')).toBe(13)
    expect(model.rawOffsetForReadable(13, 'start')).toBe(12)
    expect(makePdfTextAnchor(4, 12, 20)).toBe('pdf:4:12:20')
  })

  it('keeps explicit whitespace and maps Unicode by code point', () => {
    const model = createPdfTextModel([
      { str: '星河 ', hasEOL: true },
      { str: 'Aurora' }
    ])

    expect(model.rawText).toBe('星河 Aurora')
    expect(model.readableText).toBe('星河 Aurora')
    expect(model.rawLength).toBe(9)
    expect(model.readableSliceForRaw(0, 2)).toBe('星河')
  })

  it('validates legacy and normalized region anchors', () => {
    expect(parsePdfTextAnchor('pdf:2:3:8', 3, 12)).toEqual({ pageNumber: 2, start: 3, end: 8 })
    expect(parsePdfTextAnchor('pdf:4:3:8', 3)).toBeNull()
    expect(parsePdfTextAnchor('pdf:2:8:3', 3)).toBeNull()

    const anchor = makePdfRegionAnchor({ pageNumber: 2, left: 0.1, top: 0.2, right: 0.8, bottom: 0.9 })
    expect(anchor).toBe('pdfrect:2:0.1:0.2:0.8:0.9')
    expect(parsePdfRegionAnchor(anchor, 3)).toEqual({
      pageNumber: 2,
      left: 0.1,
      top: 0.2,
      right: 0.8,
      bottom: 0.9
    })
    expect(parsePdfRegionAnchor('pdfrect:2:0.8:0.2:0.1:0.9', 3)).toBeNull()
    expect(parsePdfRegionAnchor('pdfrect:2:-0.1:0.2:0.8:0.9', 3)).toBeNull()
    expect(parsePdfRegionAnchor('pdfrect:2::0.2:0.8:0.9', 3)).toBeNull()
    expect(parsePdfRegionAnchor('pdfrect:2:1e-1:0.2:0.8:0.9', 3)).toBeNull()
  })
})

describe('PDF region text extraction', () => {
  const item = (
    text: string,
    rawStart: number,
    rawEnd: number,
    left: number,
    top: number,
    right: number,
    bottom: number
  ): PdfRegionTextItem => ({ text, rawStart, rawEnd, left, top, right, bottom })

  it('keeps the selected column and orders its rows visually', () => {
    const items = [
      item('右栏第一行', 20, 25, 0.57, 0.1, 0.9, 0.14),
      item('左栏第二行', 6, 11, 0.08, 0.18, 0.42, 0.22),
      item('左栏第一行', 0, 5, 0.08, 0.1, 0.42, 0.14),
      item('右栏第二行', 26, 31, 0.57, 0.18, 0.9, 0.22)
    ]

    expect(extractPdfRegionText(items, {
      pageNumber: 1,
      left: 0.05,
      top: 0.07,
      right: 0.46,
      bottom: 0.24
    })).toEqual({ text: '左栏第一行\n左栏第二行', rawStart: 0, rawEnd: 11 })
  })

  it('joins table cells from left to right and rows from top to bottom', () => {
    const items = [
      item('B2', 8, 10, 0.5, 0.3, 0.6, 0.34),
      item('A1', 0, 2, 0.1, 0.2, 0.2, 0.24),
      item('B1', 3, 5, 0.5, 0.2, 0.6, 0.24),
      item('A2', 6, 8, 0.1, 0.3, 0.2, 0.34)
    ]

    expect(extractPdfRegionText(items, {
      pageNumber: 1,
      left: 0.05,
      top: 0.15,
      right: 0.65,
      bottom: 0.38
    })?.text).toBe('A1 B1\nA2 B2')
  })

  it('returns null for an image-only region', () => {
    expect(extractPdfRegionText([], {
      pageNumber: 1,
      left: 0.1,
      top: 0.1,
      right: 0.9,
      bottom: 0.9
    })).toBeNull()
  })
})
