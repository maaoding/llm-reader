import { describe, expect, it } from 'vitest'
import { copy, formatCopy, parseCopySource } from '../../src/shared/copy'

describe('shared Markdown copy mapping', () => {
  it('loads required copy and formats named placeholders', () => {
    expect(copy('reader.opening', { title: '复杂系统' })).toBe('正在打开《复杂系统》')
    expect(formatCopy('{count} tokens', { count: 32 })).toBe('32 tokens')
  })

  it('rejects duplicate and missing keys', () => {
    expect(() => parseCopySource('| sample.key | 一 |\n| sample.key | 二 |', ['sample.key'] as const)).toThrow(
      'Duplicate copy key'
    )
    expect(() => parseCopySource('| another.key | 一 |', ['sample.key'] as const)).toThrow(
      'Missing copy key'
    )
  })

  it('rejects malformed placeholders and missing values', () => {
    expect(() => parseCopySource('| sample.key | {bad-name} |', ['sample.key'] as const)).toThrow(
      'Invalid copy placeholder'
    )
    expect(() => parseCopySource(
      '| sample.key | 你好，{person} |',
      ['sample.key'] as const,
      { 'sample.key': ['name'] }
    )).toThrow('Missing copy placeholder')
    expect(() => parseCopySource(
      '| sample.key | 你好，{name} {extra} |',
      ['sample.key'] as const,
      { 'sample.key': ['name'] }
    )).toThrow('Unknown copy placeholder')
    expect(() => formatCopy('你好，{name}')).toThrow('Missing copy value')
  })
})
