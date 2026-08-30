export interface MatchSegment {
  text: string
  hit: boolean
}

export function normalizeNeedle(query: string): string {
  return query.trim().toLocaleLowerCase('zh-CN')
}

export function splitMatches(value: string, needle: string): MatchSegment[] {
  if (!needle) return [{ text: value, hit: false }]
  const lower = value.toLocaleLowerCase('zh-CN')
  const segments: MatchSegment[] = []
  let cursor = 0
  let index = lower.indexOf(needle)
  while (index !== -1) {
    if (index > cursor) segments.push({ text: value.slice(cursor, index), hit: false })
    segments.push({ text: value.slice(index, index + needle.length), hit: true })
    cursor = index + needle.length
    index = lower.indexOf(needle, cursor)
  }
  if (cursor < value.length) segments.push({ text: value.slice(cursor), hit: false })
  return segments
}
