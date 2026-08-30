import type { InsightArchiveRecord, InsightExportScope } from '@shared/contracts'
import { copy } from '@shared/copy'

function singleLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function blockquote(value: string): string {
  return value
    .split(/\r?\n/u)
    .map((line) => `> ${line}`)
    .join('\n')
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function exportStamp(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes())
  ].join('')
}

export function sanitizeExportFileName(value: string): string {
  const sanitized = value
    .replace(/[<>:"/\\|?*]/gu, '_')
    .split('')
    .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 120)
  return sanitized || copy('export.fileNameAll')
}

export function ensureMarkdownExtension(path: string): string {
  return /\.md$/iu.test(path) ? path : `${path}.md`
}

export function selectInsightExportRecords(
  records: ReadonlyArray<InsightArchiveRecord>,
  scope: InsightExportScope
): InsightArchiveRecord[] {
  if (scope.kind === 'all') return [...records]
  if (scope.kind === 'book') return records.filter((record) => record.bookId === scope.bookId)
  return records.filter((record) => record.id === scope.insightId)
}

export function buildInsightExportDefaultName(
  records: ReadonlyArray<InsightArchiveRecord>,
  fallbackTitle?: string
): string {
  const uniqueBooks = new Set(records.map((record) => record.bookId))
  const title =
    records.length > 0 && uniqueBooks.size === 1
      ? copy('export.fileNameBook', { title: records[0].book.title })
      : fallbackTitle
        ? copy('export.fileNameBook', { title: fallbackTitle })
        : copy('export.fileNameAll')
  return `${sanitizeExportFileName(title)}-${exportStamp()}.md`
}

export function buildInsightExportMarkdown(records: ReadonlyArray<InsightArchiveRecord>): string {
  const groups = new Map<string, { book: InsightArchiveRecord['book']; insights: InsightArchiveRecord[] }>()
  for (const record of records) {
    const existing = groups.get(record.bookId)
    if (existing) {
      existing.insights.push(record)
    } else {
      groups.set(record.bookId, { book: record.book, insights: [record] })
    }
  }

  const lines: string[] = [
    `# ${copy('export.title')}`,
    '',
    blockquote(copy('export.generatedAt', { datetime: formatDateTime(new Date().toISOString()) })),
    blockquote(copy('export.summary', { books: groups.size, insights: records.length })),
    ''
  ]

  let bookIndex = 0
  for (const { book, insights } of groups.values()) {
    bookIndex += 1
    lines.push(`## ${copy('export.bookHeading', { title: singleLine(book.title) || copy('export.untitledBook') })}`)
    if (book.author) lines.push(`> ${copy('bookDetails.authorLabel')}：${singleLine(book.author)}`)
    lines.push('')

    insights.forEach((insight, insightIndex) => {
      lines.push(`### ${copy('export.entryHeading', { index: `${bookIndex}.${insightIndex + 1}` })}`)
      lines.push('')
      lines.push(`- ${copy('export.chapterLabel')}：${singleLine(insight.selection.chapterTitle || copy('common.currentChapter'))}`)
      lines.push(`- ${copy('export.dateLabel')}：${formatDateTime(insight.createdAt)}`)
      lines.push(`- ${copy('export.modelLabel')}：${singleLine(insight.model)}`)
      lines.push('')
      lines.push(`**${copy('export.quoteLabel')}**`)
      lines.push('')
      lines.push(blockquote(insight.selection.quote))
      lines.push('')
      lines.push(`**${copy('export.questionLabel')}**`)
      lines.push('')
      lines.push(insight.question)
      lines.push('')
      lines.push(`**${copy('export.answerLabel')}**`)
      lines.push('')
      lines.push(insight.answer)
      lines.push('')

      const followups = insight.history.slice(2)
      if (followups.length > 0) {
        lines.push(`**${copy('export.followupsLabel')}**`)
        lines.push('')
        let turnIndex = 0
        for (let index = 0; index < followups.length; index += 2) {
          turnIndex += 1
          const question = followups[index]
          const answer = followups[index + 1]
          if (!question || question.role !== 'user') continue
          lines.push(`#### ${copy('export.followupLabel', { index: turnIndex })}`)
          lines.push('')
          lines.push(`- ${copy('export.userLabel')}：${question.content}`)
          if (answer?.role === 'assistant') {
            lines.push(`- ${copy('export.assistantLabel')}：${answer.content}`)
          }
          lines.push('')
        }
      }

      lines.push(`> ${copy('export.citationsNote')}`)
      lines.push('')
    })
  }

  return lines.join('\n').trimEnd() + '\n'
}
