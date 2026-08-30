import { describe, expect, it } from 'vitest'
import { normalizeNeedle, splitMatches } from '../../src/renderer/src/highlight'

describe('splitMatches', () => {
  it('marks every occurrence of a Chinese needle', () => {
    expect(splitMatches('复杂系统的行为来自复杂系统', '复杂系统')).toEqual([
      { text: '复杂系统', hit: true },
      { text: '的行为来自', hit: false },
      { text: '复杂系统', hit: true }
    ])
  })

  it('matches case-insensitively and keeps the original casing', () => {
    expect(splitMatches('The Model decides. MODEL is ready.', 'model')).toEqual([
      { text: 'The ', hit: false },
      { text: 'Model', hit: true },
      { text: ' decides. ', hit: false },
      { text: 'MODEL', hit: true },
      { text: ' is ready.', hit: false }
    ])
  })

  it('returns a single plain segment without matches', () => {
    expect(splitMatches('普通文本', '不存在')).toEqual([{ text: '普通文本', hit: false }])
  })

  it('passes through untouched for an empty needle', () => {
    expect(splitMatches('普通文本', '')).toEqual([{ text: '普通文本', hit: false }])
  })

  it('handles leading and trailing matches', () => {
    expect(splitMatches('边界条件决定走向', '走向')).toEqual([
      { text: '边界条件决定', hit: false },
      { text: '走向', hit: true }
    ])
  })
})

describe('normalizeNeedle', () => {
  it('trims and lowercases with the same collation as the filter', () => {
    expect(normalizeNeedle('  Model  ')).toBe('model')
    expect(normalizeNeedle('')).toBe('')
  })
})
