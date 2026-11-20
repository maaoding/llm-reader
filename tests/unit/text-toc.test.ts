import { expect, it } from 'vitest'
import { navigationalHeadingIndexes, parseTextParagraphs } from '../../src/renderer/src/readers/text-reader'

const body = '用于说明这一章的正文与适用条件。'.repeat(40)
function retained(source: string): string[] {
  const paragraphs = parseTextParagraphs(source)
  const indexes = navigationalHeadingIndexes(paragraphs)
  return paragraphs.filter((p) => indexes.has(p.index)).map((p) => p.text)
}

it('normalizes heading labels once without conflating sibling titles', () => {
  const source = ['# 共用前缀', '# 共用前缀A', '# 共用前缀B', '# 另一标题', '# 共用前缀B拓展', body].join('\n\n')
  expect(retained(source)).toEqual(['# 共用前缀A', '# 另一标题', '# 共用前缀B拓展'])
})

it('preserves NFKC, whitespace, case and the existing four-UTF-16-unit prefix threshold', () => {
  const source = ['# ＡＢＣＤ', '# abcde', '# xy', '# 𠮷😀', '# abcdf', body, '# xyzz', body, '# 𠮷😀延伸', body].join('\n\n')
  expect(retained(source)).toEqual(['# abcde', '# xy', '# abcdf', '# xyzz', '# 𠮷😀延伸'])
})

it('removes shorter exact duplicates but retains short titles that only share a prefix', () => {
  const source = ['# ABC', '# AB', '# 其他标题', '# 最后标题', '# ABC', body, '# ABCD', body].join('\n\n')
  expect(retained(source)).toEqual(['# AB', '# 其他标题', '# 最后标题', '# ABC', '# ABCD'])
})

it('retains equal-span duplicates in original order', () => {
  const paragraphs = [0, 1, 2, 3].map((index) => ({ index, text: '# 同名章节', heading: true, start: index * 16, end: index * 16 + 6 }))
  const tail = { index: 4, text: '尾声', heading: false, start: 62, end: 64 }
  expect([...navigationalHeadingIndexes([...paragraphs, tail])]).toEqual([0, 1, 2, 3])
})
