export interface ReaderSearchResult {
  anchor: string
  excerpt: string
  chapterTitle: string
}

export const READER_SEARCH_RESULT_LIMIT = 200
export const READER_SEARCH_QUERY_MAX_LENGTH = 100
const codePointLength = (text: string): number => Array.from(text).length

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

function moveCodePoints(text: string, offset: number, count: number): number {
  while (count > 0 && offset < text.length) {
    offset += text.codePointAt(offset)! > 0xffff ? 2 : 1
    count--
  }
  while (count < 0 && offset > 0) {
    const last = text.charCodeAt(--offset)
    if (last >= 0xdc00 && last <= 0xdfff && offset > 0) {
      const previous = text.charCodeAt(offset - 1)
      if (previous >= 0xd800 && previous <= 0xdbff) offset--
    }
    count++
  }
  return offset
}

export function searchExcerpt(text: string, startUtf16: number, endUtf16: number): string {
  // Only inspect the excerpt's neighborhood, even for many hits in a long paragraph.
  const matchEnd = Math.min(endUtf16, moveCodePoints(text, startUtf16, SEARCH_EXCERPT_LENGTH))
  const matchLength = Math.max(1, codePointLength(text.slice(startUtf16, matchEnd)))
  const surrounding = Math.max(0, SEARCH_EXCERPT_LENGTH - matchLength)
  const excerptStart = moveCodePoints(text, startUtf16, -Math.floor(surrounding / 2))
  const excerptEnd = moveCodePoints(text, excerptStart, SEARCH_EXCERPT_LENGTH)
  const adjustedStart = moveCodePoints(text, excerptEnd, -SEARCH_EXCERPT_LENGTH)
  const excerpt = text
    .slice(adjustedStart, excerptEnd)
    .replace(/\s+/gu, ' ')
    .trim()
  return `${adjustedStart > 0 ? '…' : ''}${excerpt}${excerptEnd < text.length ? '…' : ''}`
}

export interface SearchExcerptSegment {
  text: string
  hit: boolean
}

/**
 * 把摘录按命中词切成片段,供渲染层用 <mark> 标出匹配位置。
 * 摘录中的空白已被折叠,查询词可能因此匹配不到,此时原样返回单段。
 */
export function splitSearchExcerpt(excerpt: string, query: string): SearchExcerptSegment[] {
  const normalized = query.trim()
  if (normalized.length === 0) return [{ text: excerpt, hit: false }]
  const segments: SearchExcerptSegment[] = []
  let cursor = 0
  for (const match of excerpt.matchAll(literalSearchExpression(normalized))) {
    const index = match.index ?? 0
    if (index > cursor) segments.push({ text: excerpt.slice(cursor, index), hit: false })
    segments.push({ text: match[0], hit: true })
    cursor = index + match[0].length
  }
  if (cursor < excerpt.length) segments.push({ text: excerpt.slice(cursor), hit: false })
  return segments.length > 0 ? segments : [{ text: excerpt, hit: false }]
}

export async function yieldSearchWork(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}
