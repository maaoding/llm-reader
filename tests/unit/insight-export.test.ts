import { describe, expect, it } from 'vitest'
import type { InsightArchiveRecord, InsightBookRef } from '../../src/shared/contracts'
import {
  buildInsightExportDefaultName,
  buildInsightExportMarkdown,
  ensureMarkdownExtension,
  sanitizeExportFileName,
  selectInsightExportRecords
} from '../../src/main/insight-export'

const firstBook: InsightBookRef = {
  id: '00000000-0000-4000-8000-000000000001',
  title: '复杂系统',
  author: '测试作者',
  format: 'epub'
}

const secondBook: InsightBookRef = {
  id: '00000000-0000-4000-8000-000000000002',
  title: '设计模式',
  author: null,
  format: 'txt'
}

function makeInsight(book: InsightBookRef, id: string, question: string, answer: string): InsightArchiveRecord {
  return {
    id,
    bookId: book.id,
    book,
    selection: {
      bookId: book.id,
      quote: `${book.title}中的原文`,
      anchor: 'txt:0:8',
      chapterTitle: '第一章',
      passages: [{ id: 'p-1', text: `${book.title}的正文`, anchor: 'txt:0:12' }]
    },
    question,
    answer,
    model: 'test-model',
    createdAt: '2026-08-30T08:00:00.000Z',
    history: [
      { role: 'user', content: question },
      { role: 'assistant', content: answer, model: 'test-model' },
      { role: 'user', content: '追问一' },
      { role: 'assistant', content: '追问回答一', model: 'test-model' }
    ]
  }
}

const records = [
  makeInsight(secondBook, '00000000-0000-4000-8000-000000000101', '设计模式是什么？', '一组可复用的结构。'),
  makeInsight(firstBook, '00000000-0000-4000-8000-000000000102', '复杂系统如何理解？', '关注关系与边界。')
]

describe('insight markdown export', () => {
  it('groups records by book and preserves answers, questions and follow-ups', () => {
    const markdown = buildInsightExportMarkdown(records)
    expect(markdown).toContain('# LLM Reader 归档')
    expect(markdown).toContain('## 复杂系统')
    expect(markdown).toContain('## 设计模式')
    expect(markdown).toContain('复杂系统如何理解？')
    expect(markdown).toContain('关注关系与边界。')
    expect(markdown).toContain('> 复杂系统中的原文')
    expect(markdown).toContain('追问一')
    expect(markdown).toContain('追问回答一')
  })

  it('selects all, by book and by insight id', () => {
    expect(selectInsightExportRecords(records, { kind: 'all' })).toHaveLength(2)
    expect(selectInsightExportRecords(records, { kind: 'book', bookId: firstBook.id })).toEqual([records[1]])
    expect(selectInsightExportRecords(records, { kind: 'insight', insightId: records[0].id })).toEqual([records[0]])
  })

  it('builds a book-specific default name when only one book is exported', () => {
    const name = buildInsightExportDefaultName([records[1]])
    expect(name).toMatch(/^LLM-Reader-复杂系统-归档-\d{8}-\d{4}\.md$/u)
    expect(buildInsightExportDefaultName([])).toMatch(/^LLM-Reader-全部归档-\d{8}-\d{4}\.md$/u)
    expect(buildInsightExportDefaultName([], '复杂系统')).toMatch(/^LLM-Reader-复杂系统-归档-\d{8}-\d{4}\.md$/u)
  })

  it('sanitizes illegal Windows filename characters', () => {
    expect(sanitizeExportFileName('a<b>c:d"e/f\\g|h?i*j')).toBe('a_b_c_d_e_f_g_h_i_j')
    expect(ensureMarkdownExtension('notes')).toBe('notes.md')
    expect(ensureMarkdownExtension('notes.MD')).toBe('notes.MD')
    expect(ensureMarkdownExtension('notes.md')).toBe('notes.md')
  })
})
