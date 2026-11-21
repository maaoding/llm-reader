import { describe, expect, it } from 'vitest'
import { HIGHLIGHT_EXPORT_MAX_LENGTH, type HighlightRecord } from '../../src/shared/contracts'
import { buildHighlightMarkdown } from '../../src/main/highlight-export'
import { makeOcrTextAnchor } from '../../src/shared/ocr-reading'

const book = { title: '两段 [证据]', author: '作者', format: 'pdf' as const }
const sample: HighlightRecord = {
  id: 'extract', bookId: 'book', quote: '原文第一行\n```\n  原文第二行', anchor: 'pdf:5:0:15',
  chapterTitle: '第一章', createdAt: '2026-11-10T12:30:00.000Z',
  note: '批注第一行\n\n  批注第二行\n', tags: ['中文', 'Tag']
}

describe('extract Markdown', () => {
  it('keeps literal multiline text and uses only valid PDF page anchors', () => {
    const ocr = makeOcrTextAnchor(7, 0, 15, '51cd4491-87d9-4caf-99e5-1e80a31c5671')
    const records = [
      sample, { ...sample, anchor: 'pdfrect:6:0.1:0.2:0.6:0.9' },
      { ...sample, anchor: ocr }, { ...sample, anchor: 'pdf:1:99:0' }
    ]
    const markdown = buildHighlightMarkdown(book, records, records.length)
    expect(markdown).toContain('# 两段 \\[证据\\]')
    expect(markdown).toContain('摘录 · 4')
    expect(markdown).toContain('````text\n' + sample.quote + '\n````')
    expect(markdown).toContain('**个人批注**\n\n```text\n' + sample.note + '\n```')
    expect(markdown).toContain('标签 · ` 中文 `, ` Tag `')
    expect(markdown).toContain(sample.createdAt)
    expect(markdown).toContain(ocr)
    expect(markdown.match(/第 \d+ 页/gu)).toEqual(['第 5 页', '第 6 页', '第 7 页'])
  })

  it('rejects an aggregate above the UTF-16 limit without clipping the exported text', () => {
    const record = { ...sample, quote: '📚'.repeat(10_000), note: '', tags: [] }
    const count = Math.ceil(HIGHLIGHT_EXPORT_MAX_LENGTH / record.quote.length)
    const records = Array.from({ length: count }, () => record)
    expect(() => buildHighlightMarkdown(book, records, count)).toThrow('请缩小选择范围')
  })
})
