import { describe, expect, it, vi } from 'vitest'
import { buildBoundedPassages, codePointLength, type ContextFocus } from '../../src/renderer/src/readers/context'

function blocks(texts = ['甲😀乙丙', '', '𠮷丁戊己庚', '辛壬癸']) {
  return texts.map((text, index) => ({ id: `P${index + 1}`, text,
    anchorForSlice: vi.fn((start: number, end: number) => `P${index + 1}:${start}:${end}`) }))
}

describe('reader context Unicode offsets', () => {
  it.each([
    { text: '', length: 0 },
    { text: '中文 ABC', length: 6 },
    { text: '😀𠮷é', length: 4 },
    { text: '\uD800A\uDC00', length: 3 },
    { text: '👩🏽‍💻', length: 4 }
  ])('counts code points in $text without combining graphemes', ({ text, length }) => {
    expect(codePointLength(text)).toBe(length)
  })

  it.each<{
    name: string
    focus: ContextFocus
    expected: Array<{ id: string; text: string; anchor: string }>
  }>([
    { name: 'start', focus: { startBlock: 0, startOffset: 0, endBlock: 0, endOffset: 1 },
      expected: [{ id: 'P1', text: '甲😀乙丙', anchor: 'P1:0:4' }] },
    { name: 'middle', focus: { startBlock: 2, startOffset: 1, endBlock: 2, endOffset: 3 },
      expected: [{ id: 'P3', text: '𠮷丁戊己庚', anchor: 'P3:0:5' }] },
    { name: 'end', focus: { startBlock: 3, startOffset: 2, endBlock: 3, endOffset: 3 },
      expected: [{ id: 'P3', text: '己庚', anchor: 'P3:3:5' }, { id: 'P4', text: '辛壬癸', anchor: 'P4:0:3' }] }
  ])('fills the $name window while accounting for empty blocks and separators', ({ focus, expected }) => {
    const input = blocks()
    expect(buildBoundedPassages(input, focus, 7)).toEqual(expected)
    expect(input[1].anchorForSlice).not.toHaveBeenCalled()
    for (const block of input) expect(block.anchorForSlice).toHaveBeenCalledTimes(expected.some((passage) => passage.id === block.id) ? 1 : 0)
  })

  it('starts an oversized cross-block selection at its first character and preserves source offsets', () => {
    const input = blocks()
    expect(buildBoundedPassages(input, { startBlock: 0, startOffset: 3, endBlock: 2, endOffset: 2 }, 6)).toEqual([
      { id: 'P1', text: '丙', anchor: 'P1:3:4' },
      { id: 'P3', text: '𠮷', anchor: 'P3:0:1' }
    ])
    expect(input[0].anchorForSlice).toHaveBeenCalledExactlyOnceWith(3, 4)
    expect(input[2].anchorForSlice).toHaveBeenCalledExactlyOnceWith(0, 1)
    expect(input[1].anchorForSlice).not.toHaveBeenCalled()
    expect(input[3].anchorForSlice).not.toHaveBeenCalled()
  })

  it('clamps focus bounds and ignores unavailable context without creating anchors', () => {
    const input = blocks(['😀正文'])
    const focus = { startBlock: -10, startOffset: -1, endBlock: 10, endOffset: 100 }
    expect(buildBoundedPassages([], focus)).toEqual([])
    for (const maximum of [0, -1]) expect(buildBoundedPassages(input, focus, maximum)).toEqual([])
    expect(input[0].anchorForSlice).not.toHaveBeenCalled()
    expect(buildBoundedPassages(input, focus)).toEqual([{ id: 'P1', text: '😀正文', anchor: 'P1:0:3' }])
    const empty = blocks([''])
    expect(buildBoundedPassages(empty, focus)).toEqual([])
    expect(empty[0].anchorForSlice).not.toHaveBeenCalled()
  })

  it('extracts a 6,000-code-point window deep inside a long Unicode paragraph', () => {
    const input = blocks(['甲😀'.repeat(100_000)])
    expect(buildBoundedPassages(input, { startBlock: 0, startOffset: 100_000, endBlock: 0, endOffset: 100_001 })).toEqual([
      { id: 'P1', text: '😀甲'.repeat(3_000), anchor: 'P1:97001:103001' }
    ])
    expect(input[0].anchorForSlice).toHaveBeenCalledExactlyOnceWith(97_001, 103_001)
  })
})
