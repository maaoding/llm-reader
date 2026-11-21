import { describe, expect, it } from 'vitest'
import { chapterSections, characters, fitEncodedText, limitText, paragraphSlices } from '../../src/shared/book-context'

describe('Unicode text budgets', () => {
  it.each<[string, number]>([
    ['', 0],
    ['text', 4],
    ['中文原文', 4],
    ['𠮷😀', 2],
    ['e\u0301', 2],
    ['✈️', 2],
    ['🇨🇳', 2],
    ['👩‍👩‍👧‍👦', 7],
    ['\ud800A\udc00😀', 4]
  ])('counts code points in %j as %i budget units', (text, expected) => {
    expect(characters(text)).toBe(expected)
  })

  it('truncates at the original code point boundary without splitting astral characters', () => {
    const text = '甲😀𠮷乙'
    expect(limitText(text, 1)).toBe('甲')
    expect(limitText(text, 2)).toBe('甲😀')
    expect(limitText(text, 3)).toBe('甲😀𠮷')
    expect(limitText(text, 4)).toBe(text)
    expect(limitText(text, 6)).toBe(text)
  })

  it('preserves lone surrogates and counts combining marks and emoji joiners separately', () => {
    expect(limitText('\ud800A\udc00😀', 3)).toBe('\ud800A\udc00')
    expect(limitText('e\u0301😀', 1)).toBe('e')
    expect(limitText('e\u0301😀', 2)).toBe('e\u0301')
    expect(limitText('👩‍👩‍👧‍👦', 3)).toBe('👩‍👩')
  })

  it.each([-Infinity, -1, -0, 0.9, NaN])('returns empty text for a nonpositive or invalid budget %s', (budget) => {
    expect(limitText('甲😀𠮷乙', budget)).toBe('')
  })

  it('truncates fractional budgets and accepts unbounded or empty input', () => {
    expect(limitText('甲😀𠮷乙', 2.9)).toBe('甲😀')
    expect(limitText('甲😀𠮷乙', Infinity)).toBe('甲😀𠮷乙')
    expect(limitText('', Infinity)).toBe('')
    expect(limitText('', 1)).toBe('')
  })

  it('keeps the exact bounded prefix of a long source', () => {
    const text = '甲😀𠮷乙'.repeat(50_000)
    expect(characters(text)).toBe(200_000)
    expect(limitText(text, 6_003)).toBe('甲😀𠮷乙'.repeat(1_500) + '甲😀𠮷')
  })

  it('groups sections by code point budgets with an exact 6000-character boundary', () => {
    const texts = ['😀'.repeat(1_800), '𠮷'.repeat(1_800), '甲'.repeat(1_800), 'e\u0301'.repeat(300), '乙']
    const blocks = texts.map((text, index) => ({ id: `p${index}`, text, anchor: `txt:${index}:${index + 1}`, kind: 'paragraph' as const }))
    const sections = chapterSections('chapter', '原文', blocks, 4)
    expect(sections.map((section) => section.blocks.map((block) => block.id))).toEqual([['p0', 'p1', 'p2', 'p3'], ['p4']])
    expect(sections.map((section) => section.order)).toEqual([4, 5])
    expect(sections.flatMap((section) => section.blocks)).toEqual(blocks)
  })
})

describe('JSON-encoded text budgets', () => {
  it.each([-Infinity, -1, 0, 1, 2, 2.9, NaN])('returns empty text when budget %s cannot fit a character and both quotes', (budget) => {
    expect(fitEncodedText('原文😀', budget)).toBe('')
    expect(fitEncodedText('原文😀', budget, true)).toBe('')
  })

  it('counts code points, including combining marks and joiners, in both directions', () => {
    expect(fitEncodedText('甲😀𠮷e\u0301', 5)).toBe('甲😀𠮷')
    expect(fitEncodedText('甲😀𠮷e\u0301', 5, true)).toBe('𠮷e\u0301')
    expect(fitEncodedText('👩‍👩‍👧‍👦', 5)).toBe('👩‍👩')
    expect(fitEncodedText('👩‍👩‍👧‍👦', 5, true)).toBe('👧‍👦')
  })

  it('budgets every ASCII control character by its actual JSON escape', () => {
    for (let code = 0; code < 32; code++) {
      const character = String.fromCharCode(code), budget = JSON.stringify(character).length
      expect(fitEncodedText(character + 'A', budget - 1)).toBe('')
      expect(fitEncodedText(character + 'A', budget)).toBe(character)
      expect(fitEncodedText(character + 'A', budget + 1)).toBe(character + 'A')
      expect(fitEncodedText('A' + character, budget - 1, true)).toBe('')
      expect(fitEncodedText('A' + character, budget, true)).toBe(character)
      expect(fitEncodedText('A' + character, budget + 1, true)).toBe('A' + character)
    }
  })

  it('escapes quotes and backslashes while leaving slashes, line separators and DEL literal', () => {
    for (const character of ['"', '\\']) {
      expect(fitEncodedText(character + 'A', 3)).toBe('')
      expect(fitEncodedText(character + 'A', 4)).toBe(character)
      expect(fitEncodedText('A' + character, 4, true)).toBe(character)
    }
    for (const character of ['/', '\u2028', '\u2029', '\u007f']) {
      expect(fitEncodedText(character + 'A', 3)).toBe(character)
      expect(fitEncodedText('A' + character, 3, true)).toBe(character)
    }
  })

  it('accounts for escaped lone surrogates without splitting a valid pair', () => {
    for (const character of ['\ud800', '\udbff', '\udc00', '\udfff']) {
      expect(fitEncodedText(character + 'A', 7)).toBe('')
      expect(fitEncodedText(character + 'A', 8)).toBe(character)
      expect(fitEncodedText('A' + character, 7, true)).toBe('')
      expect(fitEncodedText('A' + character, 8, true)).toBe(character)
    }
    expect(fitEncodedText('A\ud800\udc00B', 4)).toBe('A\ud800\udc00')
    expect(fitEncodedText('A\ud800\udc00B', 4, true)).toBe('\ud800\udc00B')
    expect(fitEncodedText('\udc00😀\ud800', 9)).toBe('\udc00😀')
    expect(fitEncodedText('\udc00😀\ud800', 9, true)).toBe('😀\ud800')
  })

  it('stops at an unaffordable escape instead of skipping it to include later characters', () => {
    expect(fitEncodedText('\u0000A', 3)).toBe('')
    expect(fitEncodedText('A\u0000', 3)).toBe('A')
    expect(fitEncodedText('A\u0000', 3, true)).toBe('')
    expect(fitEncodedText('\u0000A', 3, true)).toBe('A')
  })

  it('supports fractional and unbounded budgets and keeps empty input empty', () => {
    expect(fitEncodedText('甲😀𠮷', 4.5)).toBe('甲😀')
    expect(fitEncodedText('甲😀𠮷', 4.5, true)).toBe('😀𠮷')
    const text = '😀\ud800\t"\u0000'
    for (const fromEnd of [false, true]) {
      expect(fitEncodedText(text, Infinity, fromEnd)).toBe(text)
      expect(fitEncodedText('', Infinity, fromEnd)).toBe('')
    }
  })

  it('keeps the exact bounded prefix or suffix of a long source', () => {
    const prefix = '甲😀'.repeat(1_000), suffix = '乙𠮷'.repeat(1_000), middle = '中'.repeat(100_000)
    expect(fitEncodedText(prefix + middle + suffix, 2_002)).toBe(prefix)
    expect(fitEncodedText(prefix + middle + suffix, 2_002, true)).toBe(suffix)
  })
})

describe('paragraph slices and original offsets', () => {
  it('preserves empty, short and exact-limit paragraphs without splitting the final sentence', () => {
    expect(paragraphSlices('')).toEqual([])
    expect(paragraphSlices('甲😀。乙', 4)).toEqual([{ text: '甲😀。乙', start: 0, end: 4 }])
    expect(paragraphSlices('甲😀。乙', 10)).toEqual([{ text: '甲😀。乙', start: 0, end: 4 }])
    expect(paragraphSlices('甲😀。乙', Infinity)).toEqual([{ text: '甲😀。乙', start: 0, end: 4 }])
  })

  it.each(['。', '！', '？', '.', '!', '?', '；', ';', '\n'])('prefers the last %j boundary in the latter half of a block', (punctuation) => {
    expect(paragraphSlices('甲'.repeat(4) + punctuation + '乙'.repeat(4), 8)).toEqual([
      { text: '甲'.repeat(4) + punctuation, start: 0, end: 5 },
      { text: '乙'.repeat(4), start: 5, end: 9 }
    ])
    expect(paragraphSlices('甲'.repeat(4) + punctuation + '乙' + punctuation + '丙丁', 8)).toEqual([
      { text: '甲'.repeat(4) + punctuation + '乙' + punctuation, start: 0, end: 7 },
      { text: '丙丁', start: 7, end: 9 }
    ])
  })

  it.each<[number, number, number]>([
    [8, 4, 8], [8, 5, 5], [8, 8, 8], [7, 3, 7], [7, 4, 4], [1, 1, 1]
  ])('keeps a strict half-block boundary for a %i-character block with punctuation at %i', (maximum, boundary, expectedEnd) => {
    const text = '甲'.repeat(boundary - 1) + '。' + '乙'.repeat(maximum + 1 - boundary)
    const parts = paragraphSlices(text, maximum)
    expect(parts[0]).toEqual({ text: Array.from(text).slice(0, expectedEnd).join(''), start: 0, end: expectedEnd })
    expect(parts.map((part) => part.text).join('')).toBe(text)
  })

  it('keeps commas, whitespace and carriage returns as original text without treating them as sentence boundaries', () => {
    const text = '甲乙丙丁， \r戊己'
    expect(paragraphSlices(text, 8)).toEqual([
      { text: '甲乙丙丁， \r戊', start: 0, end: 8 },
      { text: '己', start: 8, end: 9 }
    ])
  })

  it('counts astral characters once and preserves lone surrogates, combining marks and joiners', () => {
    const text = '\ud800A\udc00😀𠮷e\u0301👩‍👩'
    const points = Array.from(text)
    expect(paragraphSlices(text, 1)).toEqual(points.map((point, index) => ({ text: point, start: index, end: index + 1 })))
    const parts = paragraphSlices(text, 3)
    expect(parts.map(({ start, end }) => [start, end])).toEqual([[0, 3], [3, 6], [6, 9], [9, 10]])
    expect(parts.map((part) => part.text).join('')).toBe(text)
  })

  it.each([1_800, 20_000])('keeps complete source coverage across scanning windows with a %i-character budget', (maximum) => {
    // Both scan sizes end between the two UTF-16 units of an astral character.
    const text = '甲'.repeat(32_767) + '😀𠮷e\u0301\ud800X\udc00' + '乙'.repeat(7_225) + '😀' + '丙'.repeat(40_000)
    const points = Array.from(text)
    const parts = paragraphSlices(text, maximum)
    expect(parts).toHaveLength(Math.ceil(points.length / maximum))
    expect(parts.map((part) => part.text).join('')).toBe(text)
    for (const [index, part] of parts.entries()) {
      expect(part.start).toBe(index * maximum)
      expect(part.end).toBe(Math.min((index + 1) * maximum, points.length))
      expect(part.text).toBe(points.slice(part.start, part.end).join(''))
    }
  })

  it('preserves sentence boundaries and gapless code point ranges through repeated window refills', () => {
    const text = '甲😀𠮷乙e\u0301。 '.repeat(12_000)
    const points = Array.from(text)
    const parts = paragraphSlices(text)
    expect(parts.map((part) => part.text).join('')).toBe(text)
    expect(parts.at(-1)?.end).toBe(points.length)
    for (const [index, part] of parts.entries()) {
      expect(part.start).toBe(index ? parts[index - 1].end : 0)
      expect(part.end - part.start).toBeLessThanOrEqual(1_800)
      expect(part.text).toBe(points.slice(part.start, part.end).join(''))
      if (index < parts.length - 1) {
        expect(part.end - part.start).toBeGreaterThan(900)
        expect(part.text.endsWith('。')).toBe(true)
      }
    }
  })

  it.each([0, -1, 0.5, 1.5, NaN, -Infinity])('rejects an invalid block size %s before scanning', (maximum) => {
    expect(() => paragraphSlices('原文😀', maximum)).toThrow(RangeError)
  })
})
