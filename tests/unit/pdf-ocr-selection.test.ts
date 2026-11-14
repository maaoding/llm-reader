import { describe, expect, it } from 'vitest'
import { makeOcrRegionAnchor, parseOcrRegionAnchor, pdfPageFromLocator } from '../../src/shared/ocr-reading'
import { hitOcrWord, positionedOcrSelection, selectedOcrWords, type PositionedOcrPage } from '../../src/renderer/src/readers/pdf-ocr-selection'

const page: PositionedOcrPage = {
  status: 'ready', pageNumber: 2, pageCount: 3, revision: 'a', text: '𠮷字 文本\n第二行',
  wordLines: [
    [{ start: 0, end: 2, left: 0.1, right: 0.25, top: 0.1, bottom: 0.12 },
      { start: 3, end: 5, left: 0.3, right: 0.45, top: 0.1, bottom: 0.12 }],
    [{ start: 6, end: 9, left: 0.12, right: 0.33, top: 0.15, bottom: 0.17 }]
  ]
}

describe('positioned PDF OCR selections', () => {
  it('hits only reported word boxes and preserves Unicode, line breaks and relative regions on reverse drags', () => {
    expect(hitOcrWord(page.wordLines, 0.18, 0.11)).toEqual({ line: 0, word: 0 })
    expect(hitOcrWord(page.wordLines, 0.275, 0.11)).toBeUndefined()
    expect(hitOcrWord(page.wordLines, 0.18, 0.13)).toBeUndefined()
    const range = selectedOcrWords(page, { line: 1, word: 0 }, { line: 0, word: 0 })!
    const selected = positionedOcrSelection('book', page, range)!
    expect(selected.quote).toBe(page.text)
    expect(parseOcrRegionAnchor(selected.anchor)).toEqual(range.regions)
    expect(pdfPageFromLocator(selected.anchor)).toBe(2)
    expect(positionedOcrSelection('book', page, selectedOcrWords(page, { line: 0, word: 1 }, { line: 0, word: 1 })!)?.quote).toBe('文本')
  })

  it('rejects selection between disjoint columns and rejects invalid saved coordinates', () => {
    const columns = { ...page, wordLines: [page.wordLines[0], [{ ...page.wordLines[1][0], left: 0.6, right: 0.8 }]] }
    expect(selectedOcrWords(columns, { line: 0, word: 0 }, { line: 1, word: 0 })).toBeUndefined()
    expect(parseOcrRegionAnchor('pdfocrrect:2:0.2:0.4:0.1:1')).toBeNull()
    expect(parseOcrRegionAnchor('pdfocrrect:2:0.1:0.2:0.3:0.4;0.5:0.6:1.2:0.8')).toBeNull()
    const region = { pageNumber: 2, left: 0.1, top: 0.1, right: 0.3, bottom: 0.2 }
    expect(parseOcrRegionAnchor(makeOcrRegionAnchor([region]), 1)).toBeNull()
    expect(parseOcrRegionAnchor(makeOcrRegionAnchor(Array.from({ length: 81 }, () => region)))).toBeNull()
  })
})
