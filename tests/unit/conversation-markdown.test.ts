import { afterEach, expect, it } from 'vitest'
import { CONVERSATION_EXPORT_MAX_LENGTH, type ContextSnapshot } from '../../src/shared/contracts'
import { setCopyLanguage } from '../../src/shared/copy'
import { buildConversationMarkdown, ConversationMarkdownError } from '../../src/renderer/src/conversation-markdown'
import type { ConversationTurn } from '../../src/renderer/src/conversation-session'

const book = { title: '复杂系统', author: '作者' }
const context = (text: string): ContextSnapshot => ({
  bookId: 'book', scope: 'book', selection: null, passages: [{ id: 'P1', text, anchor: 'txt:0:10', chapterTitle: '章节' }],
  background: '不应导出的背景笔记', coverage: { covered: 1, total: 1 }
})
const turn = (id = 'one', answer = '回答 [P1]'): ConversationTurn => ({
  id, requestId: '', selection: null, action: 'ask', actionLabel: '提问', question: '问题\n第二行',
  answer, model: 'actual-model', status: 'completed', context: context('原文\n\n  缩进')
})
afterEach(() => setCopyLanguage('zh'))

it('keeps multiline quotes, Markdown, per-turn evidence and web records without using background', () => {
  const first = turn(), second = turn('two', '第二轮 [P1] [W1]')
  second.context = { ...context('第二轮独立原文'), webSearch: { status: 'searched', reason: 'searched', query: '实际检索词',
    searchedAt: '2026-11-08T00:00:00Z', sources: [{ id: 'W1', title: '网页 [标题]', url: 'https://example.test/source', excerpt: '网页摘录\n第二行' }] } }
  const code = String.fromCharCode(96).repeat(3)
  first.answer += '\n\n' + code + 'ts\nconst x = 1\n' + code
  const output = buildConversationMarkdown(book, [first, second]).markdown
  expect(output).toContain('问题\n第二行')
  expect(output).toContain(code + 'ts\nconst x = 1\n' + code)
  expect(output).toContain('> 原文\n> \n>   缩进')
  const [a, b] = output.split('## 第 2 轮')
  expect(a).not.toContain('第二轮独立原文')
  expect(b).toContain('第二轮独立原文')
  expect(output).toContain('https://example.test/source')
  expect(output).toContain('> 网页摘录\n> 第二行')
  expect(output).not.toContain('不应导出的背景笔记')
})

it('copies all in-memory turns and long answers rather than the 20-turn/20k persistence payload', () => {
  const long = '保留长回答'.repeat(5_001)
  const turns = Array.from({ length: 24 }, (_, index) => turn(String(index), long + '结尾-' + index))
  const all = buildConversationMarkdown(book, turns)
  expect(all.markdown).toContain('第 24 轮')
  expect(all.markdown).toContain(long + '结尾-23')
  expect((all.markdown.match(/## 第 \d+ 轮/gu) ?? []).length).toBe(24)
  const single = buildConversationMarkdown(book, turns, '23')
  expect(single.markdown).toContain('第 24 轮')
  expect(single.markdown).not.toContain('结尾-22')
})

it('marks only unmatched answer citations outside code and leaves their original IDs intact', () => {
  const tick = String.fromCharCode(96), fence = tick.repeat(3)
  const value = turn('one', '[P1] [P99] **[W99]**\n\n' + tick + '[P88]' + tick + '\n\n' + fence + '\n[W88]\n' + fence)
  const text = buildConversationMarkdown(book, [value]).markdown
  expect(text).toContain('未验证的引用编号：[P99], [W99]。')
  expect(text).not.toContain('未验证的引用编号：[P88]')
  expect(text).not.toContain('未验证的引用编号：[W88]')
  expect(text).toContain(fence + '\n[W88]\n' + fence)
})

it('does not promote legacy selection passages into actual evidence when context is missing', () => {
  const value = turn()
  value.context = undefined
  value.selection = { bookId: 'book', quote: '旧选区', anchor: 'txt:0:3', chapterTitle: '旧章',
    passages: [{ id: 'P1', text: '不应作为实际证据', anchor: 'txt:0:9' }] }
  const text = buildConversationMarkdown(book, [value]).markdown
  expect(text).toContain('旧选区')
  expect(text).toContain('旧章')
  expect(text).toContain('未保存本轮实际来源快照')
  expect(text).toContain('未验证的引用编号：[P1]')
  expect(text).not.toContain('不应作为实际证据')
})

it('records image page and exact rectangle without inventing text or exporting background images', () => {
  const value = turn('image', '图片回答 [P1]')
  value.selection = { kind: 'pdf-image-region', bookId: 'book', pageNumber: 7, left: 0.123456, top: 0.2, right: 0.8, bottom: 0.9, anchor: 'pdf:7' }
  value.context = { ...context('不能当图片原文'), selection: value.selection }
  const text = buildConversationMarkdown(book, [value]).markdown
  expect(text).toContain('PDF 第 7 页区域')
  expect(text).toContain('0.123456, 0.2, 0.8, 0.9')
  expect(text).not.toContain('不能当图片原文')
  expect(text).toContain('未验证的引用编号：[P1]')
})

it('labels interrupted output, retains partial text, and freezes the resulting document', () => {
  const value = { ...turn('partial', '部分回答'), status: 'error' as const, error: '已停止', model: '' }
  const output = buildConversationMarkdown(book, [value])
  value.answer = '后来的回答'
  value.context!.passages[0].text = '后来的原文'
  expect(output.markdown).toContain('未完成的回答')
  expect(output.markdown).toContain('部分回答')
  expect(output.markdown).toContain('已停止')
  expect(output.markdown).not.toContain('后来的')
  expect(output.markdown).not.toContain('actual-model')
})

it('rejects empty, in-flight and oversized content without silently dropping turns', () => {
  expect(() => buildConversationMarkdown(book, [])).toThrow(ConversationMarkdownError)
  expect(() => buildConversationMarkdown(book, [{ ...turn(), status: 'streaming' }])).toThrow('busy')
  expect(() => buildConversationMarkdown(book, [{ ...turn(), status: 'queued' }])).toThrow('busy')
  expect(() => buildConversationMarkdown(book, [turn()], 'missing')).toThrow('empty')
  expect(() => buildConversationMarkdown(book, [turn('large', 'x'.repeat(CONVERSATION_EXPORT_MAX_LENGTH + 1))])).toThrow('tooLarge')
})

it('localizes labels without translating the original book, questions or answers', () => {
  setCopyLanguage('en')
  const text = buildConversationMarkdown(book, [turn()]).markdown
  expect(text).toContain('Turn 1')
  expect(text).toContain('复杂系统')
  expect(text).toContain('问题\n第二行')
  expect(text).toContain('回答 [P1]')
})
