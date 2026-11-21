import type { BookRecord, WorkbenchRecord } from '@shared/contracts'
import { copy } from '@shared/copy'

const line = (value: string): string => value.replace(/\s+/gu, ' ').replace(/[\\`*_{}[\]<>]/gu, '\\$&').trim()
const quote = (value: string): string => value.split('\n').map((part) => `> ${part}`).join('\n')

export function buildWorkbenchMarkdown(record: WorkbenchRecord, books: BookRecord[]): string {
  const lines = [`# ${line(record.name)}`, '', `*${copy('workbench.books')}*`, '']
  for (const id of record.bookIds) lines.push(`- ${line(books.find((book) => book.id === id)?.title ?? copy('workbench.deletedBook'))}`)
  for (const [index, turn] of record.turns.entries()) {
    lines.push('', `## ${index + 1}. ${line(turn.question)}`, '',
      `${copy('workbench.books')}: ${(turn.context?.books?.map((book) => line(book.title)) ?? turn.bookIds.map((id) => line(books.find((book) => book.id === id)?.title ?? copy('workbench.deletedBook')))).join(' · ')}`,
      '', turn.answer, ...(turn.error ? ['', quote(turn.error)] : []))
    for (const passage of turn.context?.passages ?? []) {
      const pages = [...new Set(passage.sources?.flatMap((source) => source.page ? [source.page] : []) ?? [])]
      lines.push('', `- [${passage.id}] ${line(passage.bookTitle ?? '')} · ${line(passage.chapterTitle ?? '')}${pages.length ? ` · ${copy('knowledge.pdfPage', { page: pages.join(', ') })}` : ''}`, '', quote(passage.text))
    }
    for (const source of turn.context?.webSearch?.sources ?? []) lines.push('', `- [${source.id}] ${line(source.title)} · ${source.url}`, '', quote(source.excerpt))
  }
  return lines.join('\n') + '\n'
}
