import { CONVERSATION_EXPORT_MAX_LENGTH, isPdfImageRegion, type BookRecord, type ReaderSource } from '@shared/contracts'
import { copy } from '@shared/copy'
import { parseMarkdown, type AnswerInline, type MarkdownBlock } from './answer-markdown'
import { createCitationResolver } from './citations'
import type { ConversationTurn } from './conversation-session'

export interface ConversationMarkdownSnapshot { markdown: string; title: string; single: boolean }
export type MarkdownBook = Pick<BookRecord, 'title' | 'author'>

export class ConversationMarkdownError extends Error {
  constructor(readonly reason: 'empty' | 'busy' | 'tooLarge') { super(reason) }
}

const metadata = (value: string): string => value.replace(/\s+/gu, ' ').replace(/[\\\x60*_{}[\]<>#]/gu, '\\$&').trim()
const quote = (value: string): string => value.replace(/\r\n?/gu, '\n').split('\n').map((line) => '> ' + line).join('\n')

function unverified(answer: string, resolve: ReturnType<typeof createCitationResolver>): string[] {
  if (!/\[(?:P|W)\d+\]/u.test(answer)) return []
  const ids = new Set<string>()
  const inline = (nodes: AnswerInline[]): void => {
    for (const node of nodes) {
      if (node.type === 'text') {
        for (const id of node.text.match(/\[(?:P|W)\d+\]/gu) ?? []) {
          if (resolve(id).some((part) => part.type === 'unverified')) ids.add(id)
        }
      } else if (node.type === 'strong' || node.type === 'emphasis') inline(node.children)
    }
  }
  const blocks = (items: MarkdownBlock[]): void => {
    for (const block of items) {
      if (block.type === 'paragraph' || block.type === 'heading') inline(block.inlines)
      else if (block.type === 'blockquote') blocks(block.blocks)
      else if (block.type === 'list') for (const item of block.items) { inline(item.inlines); blocks(item.children) }
    }
  }
  blocks(parseMarkdown(answer))
  return [...ids]
}

function selectionLines(source: ReaderSource | null): string[] {
  if (!source) return [copy('analysis.bookSource')]
  if (isPdfImageRegion(source)) return [
    copy('visual.source', { page: source.pageNumber }),
    copy('conversationMarkdown.region') + ': ' + [source.left, source.top, source.right, source.bottom].join(', '),
    copy('conversationMarkdown.location') + ': ' + metadata(source.anchor)
  ]
  return [...(source.chapterTitle ? [copy('export.chapterLabel') + ': ' + metadata(source.chapterTitle), ''] : []),
    quote(source.quote), '', copy('conversationMarkdown.location') + ': ' + metadata(source.anchor)]
}

/** Only live in-memory turns: never pass them through the capped persistence payload. */
export function buildConversationMarkdown(book: MarkdownBook, turns: readonly ConversationTurn[], turnId?: string): ConversationMarkdownSnapshot {
  const selected = turns.map((turn, index) => ({ turn, index })).filter(({ turn }) => turnId === undefined || turn.id === turnId)
  if (!selected.length) throw new ConversationMarkdownError('empty')
  if (selected.some(({ turn }) => turn.status === 'queued' || turn.status === 'streaming')) throw new ConversationMarkdownError('busy')
  const single = turnId !== undefined
  const label = single ? copy('conversationMarkdown.turnTitle', { index: selected[0].index + 1 }) : copy('conversationMarkdown.sessionTitle')
  const title = book.title + '-' + label
  const lines: string[] = []
  let length = 0
  const add = (...parts: string[]): void => {
    for (const part of parts) {
      length += part.length + (lines.length ? 1 : 0)
      if (length > CONVERSATION_EXPORT_MAX_LENGTH) throw new ConversationMarkdownError('tooLarge')
      lines.push(part)
    }
  }
  add('# ' + metadata(book.title) + ' · ' + label, '')
  if (book.author) add(copy('bookDetails.authorLabel') + ': ' + metadata(book.author), '')
  for (const { turn, index } of selected) {
    if (turn.answer.length > CONVERSATION_EXPORT_MAX_LENGTH) throw new ConversationMarkdownError('tooLarge')
    const context = turn.context
    const source = turn.selection ?? context?.selection ?? null
    const image = isPdfImageRegion(source)
    // Only context records what was actually sent; selection.passages is not evidence.
    const passages = !image ? context?.passages ?? [] : []
    const web = !image ? context?.webSearch?.sources ?? [] : []
    add('## ' + copy('conversationMarkdown.turnTitle', { index: index + 1 }), '',
      '- ' + copy('export.modelLabel') + ': ' + metadata(turn.model || copy('assistant.modelUnavailable')), '',
      '**' + copy('export.quoteLabel') + '**', '', ...selectionLines(source), '',
      '**' + copy('export.questionLabel') + '**', '', turn.question, '',
      '**' + copy('export.answerLabel') + '**', '', turn.answer || copy('conversationMarkdown.noAnswer'), '')
    if (turn.status === 'error') add(quote(copy('conversationMarkdown.incomplete')), ...(turn.error ? [quote(turn.error)] : []), '')
    if (!image) {
      add('**' + copy('conversationMarkdown.sources') + '**', '')
      if (!context) add(quote(copy('conversationMarkdown.missingSources')), '')
      else if (!passages.length) add(quote(copy('conversationMarkdown.noSources')), '')
      for (const passage of passages) {
        const pages = [...new Set(passage.sources?.flatMap((item) => item.page ? [item.page] : []) ?? [])]
        const heading = [passage.bookTitle, passage.headingPath?.join(' / ') || passage.chapterTitle].filter(Boolean).map((part) => metadata(part!)).join(' · ')
        add('### [' + metadata(passage.id) + '] ' + heading, '',
          copy('conversationMarkdown.location') + ': ' + metadata(passage.anchor),
          ...(pages.length ? [copy('knowledge.pdfPage', { page: pages.join(', ') })] : []), '', quote(passage.text), '')
      }
      if (context?.webSearch) {
        add('**' + copy('webSearch.exportTitle') + '**', '')
        if (context.webSearch.query) add(copy('webSearch.queryLabel', { query: metadata(context.webSearch.query) }))
        if (context.webSearch.searchedAt) add(copy('webSearch.searchedAt', { time: context.webSearch.searchedAt }))
        for (const item of web) {
          const url = item.url.replace(/[<>\s]/gu, (character) => encodeURIComponent(character))
          add('', '- [' + metadata(item.id) + '] [' + metadata(item.title) + '](<' + url + '>)', '', quote(item.excerpt), '')
        }
      }
    }
    const unknown = unverified(turn.answer, createCitationResolver(passages, web))
    if (unknown.length) add(quote(copy('conversationMarkdown.unverified', { ids: unknown.join(', ') })), '')
  }
  const markdown = lines.join('\n').trimEnd() + '\n'
  if (markdown.length > CONVERSATION_EXPORT_MAX_LENGTH) throw new ConversationMarkdownError('tooLarge')
  return { markdown, title, single }
}
