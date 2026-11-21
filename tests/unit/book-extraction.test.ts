// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { extractTextSections } from '../../src/renderer/src/readers/book-extraction'
import { parseTextAnchor } from '../../src/renderer/src/readers/text-reader'
import { documentSectionSchema } from '../../src/main/schemas'

describe('document extraction', () => {
  it('preserves Unicode positions across Windows line endings, duplicate paragraphs and headings', () => {
    const original = '\uFEFF第一章 定义\r\n\r\n从众 😀 𠮷 é。\r\n\r\n从众 😀 𠮷 é。\r\n\r\n第二章 例外\r\n\r\n自主判断。'
    const normalized = Array.from(original.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n'))
    const sections = extractTextSections(original)
    const blocks = sections.flatMap((section) => section.blocks)
    expect(new Set(sections.map((section) => section.chapterId)).size).toBe(2)
    expect(new Set(blocks.map((block) => block.id)).size).toBe(blocks.length)
    for (const block of blocks) {
      const anchor = parseTextAnchor(block.anchor, normalized.length)!
      expect(normalized.slice(anchor.start, anchor.end).join('')).toBe(block.text)
    }
    expect(blocks.filter((block) => block.text.includes('😀'))).toHaveLength(2)
  })
  it('uses text sections without inventing headings and splits long semantic units with stable offsets', () => {
    const text = '没有标题的普通正文。\n\n' + '😀这是一个很长的段落。'.repeat(1800)
    const sections = extractTextSections(text)
    expect(sections.length).toBeGreaterThan(2)
    expect(new Set(sections.map((section) => section.chapterTitle))).toEqual(new Set(['文本分节']))
    for (const section of sections) expect(documentSectionSchema.safeParse(section).success).toBe(true)
    for (const block of sections.flatMap((section) => section.blocks)) {
      const anchor = parseTextAnchor(block.anchor, Array.from(text).length)!
      expect(Array.from(text).slice(anchor.start, anchor.end).join('')).toBe(block.text)
    }
    expect(extractTextSections(text)).toEqual(sections)
  })
  it('does not manufacture content for an empty document', () => {
    expect(extractTextSections(' \r\n\t ')).toEqual([])
  })
})
