import { describe, expect, it } from 'vitest'
import { searchExcerpt } from '../../src/shared/reader-search'

function excerptFor(text: string, query: string): string {
  const start = text.indexOf(query)
  expect(start).toBeGreaterThanOrEqual(0)
  return searchExcerpt(text, start, start + query.length)
}

describe('search excerpts', () => {
  it('keeps short text intact and collapses whitespace', () => {
    expect(excerptFor('  前文 😀\n\t命中  尾文  ', '命中')).toBe('前文 😀 命中 尾文')
  })

  it('centers matches within 80 code points without splitting surrogate pairs', () => {
    expect(excerptFor('前'.repeat(100) + '😀' + '后'.repeat(100), '😀'))
      .toBe('…' + '前'.repeat(39) + '😀' + '后'.repeat(40) + '…')
    expect(excerptFor('😀'.repeat(100) + '命中' + '𠀀'.repeat(100), '命中'))
      .toBe('…' + '😀'.repeat(39) + '命中' + '𠀀'.repeat(39) + '…')
  })

  it('fills excerpts at either edge and only adds ellipses for omitted text', () => {
    expect(excerptFor('😀目标' + '后'.repeat(100), '目标'))
      .toBe('😀目标' + '后'.repeat(77) + '…')
    expect(excerptFor('前'.repeat(100) + '目标😀', '目标'))
      .toBe('…' + '前'.repeat(77) + '目标😀')
    const exact = '😀'.repeat(39) + '目标' + '𠀀'.repeat(39)
    expect(excerptFor(exact, '目标')).toBe(exact)
  })

  it('bounds excerpts even when the match itself exceeds 80 code points', () => {
    const query = '𠀀'.repeat(100)
    expect(excerptFor('前'.repeat(50) + query + '后'.repeat(50), query))
      .toBe('…' + '𠀀'.repeat(80) + '…')
  })

  it('handles matches deep inside a long paragraph', () => {
    expect(excerptFor('😀'.repeat(100_000) + '目标' + '𠀀'.repeat(100_000), '目标'))
      .toBe('…' + '😀'.repeat(39) + '目标' + '𠀀'.repeat(39) + '…')
  })
})
