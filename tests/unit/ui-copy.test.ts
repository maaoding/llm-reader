import { afterEach, describe, expect, it } from 'vitest'
import { COPY_KEYS, COPY_PLACEHOLDERS, copy, formatCopy, parseCopySource, setCopyLanguage } from '../../src/shared/copy'
import copyEnSource from '../../src/shared/copy.en.md?raw'
import copyZhSource from '../../src/shared/copy.md?raw'

describe('shared Markdown copy mapping', () => {
  afterEach(() => {
    setCopyLanguage('zh')
  })

  it('loads required copy and formats named placeholders', () => {
    expect(copy('reader.opening', { title: '复杂系统' })).toBe('正在打开《复杂系统》')
    expect(formatCopy('{count} tokens', { count: 32 })).toBe('32 tokens')
  })

  it('parses the English table with the same keys and placeholders', () => {
    const zh = parseCopySource(copyZhSource, COPY_KEYS, COPY_PLACEHOLDERS)
    const en = parseCopySource(copyEnSource, COPY_KEYS, COPY_PLACEHOLDERS)
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    for (const key of COPY_KEYS) expect(en[key].length).toBeGreaterThan(0)
  })

  it('switches the active UI language at runtime', () => {
    expect(copy('workspace.reading')).toBe('阅读')
    setCopyLanguage('en')
    expect(copy('workspace.reading')).toBe('Reading')
    expect(copy('reader.opening', { title: 'Complex Systems' })).toBe('Opening “Complex Systems”')
    expect(copy('settings.languageLabel')).toBe('Interface language')
    setCopyLanguage('zh')
    expect(copy('workspace.reading')).toBe('阅读')
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
