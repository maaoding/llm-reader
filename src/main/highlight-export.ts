import { writeFile } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'
import { HIGHLIGHT_EXPORT_MAX_COUNT, HIGHLIGHT_EXPORT_MAX_LENGTH, type BookRecord, type HighlightRecord } from '@shared/contracts'
import { copy } from '@shared/copy'
import { parsePdfRegionAnchor, parsePdfTextAnchor } from '@shared/pdf-anchors'
import { parseOcrTextAnchor } from '@shared/ocr-reading'
import { AppError } from './errors'
import { ensureMarkdownExtension, exportStamp, sanitizeExportFileName } from './insight-export'

function backtickFence(value: string, minimum: number): string {
  let length = minimum
  for (const [run] of value.matchAll(/`+/gu)) length = Math.max(length, run.length + 1)
  return '`'.repeat(length)
}

function inlineCode(value: string): string {
  const fence = backtickFence(value, 1)
  return fence + ' ' + value + ' ' + fence
}

function textBlock(value: string): string {
  const fence = backtickFence(value, 3)
  return fence + 'text\n' + value + '\n' + fence
}

function headingText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().replace(/[\\`*_{}[\]<>#]/gu, '\\$&')
}

function pdfPage(anchor: string): number | undefined {
  return (parsePdfTextAnchor(anchor, Number.MAX_SAFE_INTEGER) ??
    parsePdfRegionAnchor(anchor, Number.MAX_SAFE_INTEGER) ?? parseOcrTextAnchor(anchor))?.pageNumber
}

export function buildHighlightMarkdown(
  book: Pick<BookRecord, 'title' | 'author' | 'format'>,
  records: Iterable<HighlightRecord>,
  count: number
): string {
  const tooLarge = (): AppError => new AppError('HIGHLIGHTS_EXPORT_TOO_LARGE', copy('highlights.exportTooLarge'))
  const missing = (): AppError => new AppError('HIGHLIGHTS_EXPORT_CHANGED', copy('highlights.exportChanged'))
  if (count < 1) throw missing()
  if (count > HIGHLIGHT_EXPORT_MAX_COUNT) throw tooLarge()

  const sections: string[] = []
  let length = 0
  const append = (section: string): void => {
    length += section.length
    if (length > HIGHLIGHT_EXPORT_MAX_LENGTH) throw tooLarge()
    sections.push(section)
  }
  append('# ' + headingText(book.title) + '\n\n')
  if (book.author) append(copy('bookDetails.authorLabel') + ' · ' + headingText(book.author) + '\n')
  append(copy('highlights.count', { count }) + '\n')

  let index = 0
  for (const record of records) {
    index += 1
    const page = book.format === 'pdf' ? pdfPage(record.anchor) : undefined
    const lines = [
      '', '## ' + copy('highlights.exportEntry', { index }), '',
      '- ' + copy('export.chapterLabel') + ' · ' + headingText(record.chapterTitle || copy('common.currentChapter')),
      ...(page === undefined ? [] : ['- ' + copy('knowledge.pdfPage', { page })]),
      '- ' + copy('conversationMarkdown.location') + ' · ' + inlineCode(record.anchor),
      '- ' + copy('highlights.createdAt') + ' · ' + headingText(record.createdAt)
    ]
    if (record.tags.length) lines.push('- ' + copy('highlights.tags') + ' · ' + record.tags.map(inlineCode).join(', '))
    lines.push('', '**' + copy('export.quoteLabel') + '**', '', textBlock(record.quote))
    if (record.note) lines.push('', '**' + copy('highlights.note') + '**', '', textBlock(record.note))
    append(lines.join('\n') + '\n')
  }
  if (index !== count) throw missing()
  return sections.join('')
}

export function highlightExportDefaultName(title: string): string {
  return 'LLM-Reader-' + sanitizeExportFileName(title) + '-' + copy('highlights.title') + '-' + exportStamp() + '.md'
}

export async function writeHighlightMarkdown(path: string, markdown: string): Promise<string> {
  const target = ensureMarkdownExtension(path)
  try {
    if (!isAbsolute(target)) throw new Error('Expected an absolute path from the save dialog')
    await writeFile(target, markdown, 'utf8')
  } catch {
    throw new AppError('HIGHLIGHTS_EXPORT_FAILED', copy('highlights.exportFailed'))
  }
  return basename(target)
}
