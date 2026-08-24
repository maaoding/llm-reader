import { codePointLength } from './context'
import { READER_SEARCH_QUERY_MAX_LENGTH } from './types'

const SEARCH_EXCERPT_LENGTH = 80

export function normalizeReaderSearchQuery(value: string): string | null {
  const query = value.trim()
  const length = codePointLength(query)
  return length >= 1 && length <= READER_SEARCH_QUERY_MAX_LENGTH ? query : null
}

export function literalSearchExpression(query: string): RegExp {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(escaped, 'giu')
}

export function searchExcerpt(text: string, startUtf16: number, endUtf16: number): string {
  const characters = Array.from(text)
  const start = codePointLength(text.slice(0, startUtf16))
  const end = start + codePointLength(text.slice(startUtf16, endUtf16))
  const matchLength = Math.max(1, end - start)
  const surrounding = Math.max(0, SEARCH_EXCERPT_LENGTH - matchLength)
  const excerptStart = Math.max(0, start - Math.floor(surrounding / 2))
  const excerptEnd = Math.min(characters.length, excerptStart + SEARCH_EXCERPT_LENGTH)
  const adjustedStart = Math.max(0, excerptEnd - SEARCH_EXCERPT_LENGTH)
  const excerpt = characters
    .slice(adjustedStart, excerptEnd)
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()
  return `${adjustedStart > 0 ? '…' : ''}${excerpt}${excerptEnd < characters.length ? '…' : ''}`
}

export async function yieldSearchWork(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}
