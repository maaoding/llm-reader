import type { DocumentBlock, DocumentSection, LlmUsage } from './contracts'

export const BOOK_EXTRACTION_VERSION = 1
export const BOOK_ANALYSIS_VERSION = 1
export const MAX_BLOCK_CHARACTERS = 1_800
export const MAX_SECTION_CHARACTERS = 6_000
export const MAX_BOOK_SECTIONS = 10_000
export const MAX_BOOK_CHARACTERS = 40_000_000

export interface GroundedPoint {
  text: string
  sourceIds: string[]
}

export interface BookConcept extends GroundedPoint {
  term: string
  aliases: string[]
}

export interface SectionNote {
  summary: string
  claims: GroundedPoint[]
  conditions: GroundedPoint[]
  exceptions: GroundedPoint[]
  concepts: BookConcept[]
}

export function characters(value: string): number {
  let length = 0
  for (let offset = 0; offset < value.length; length += 1) {
    offset += value.codePointAt(offset)! > 0xffff ? 2 : 1
  }
  return length
}

export function limitText(value: string, limit: number): string {
  const maximum = Math.trunc(limit)
  if (!(maximum > 0)) return ''
  let end = value.length
  // UTF-16 length is an upper bound; short text already fits without scanning.
  if (end > maximum) {
    end = 0
    for (let count = 0; count < maximum && end < value.length; count += 1) {
      end += value.codePointAt(end)! > 0xffff ? 2 : 1
    }
  }
  // Copy only the bounded prefix so retained context does not keep a large source string alive.
  return Array.from(value.slice(0, end)).join('')
}

/** Fit a prefix or suffix to the code point length of its JSON string, including the two quotes. */
export function fitEncodedText(value: string, budget: number, fromEnd = false): string {
  let remaining = budget - 2
  if (!(remaining > 0)) return ''
  let offset = fromEnd ? value.length : 0
  while (fromEnd ? offset > 0 : offset < value.length) {
    const point = value.codePointAt(fromEnd ? offset - 1 : offset)!
    let width = point > 0xffff ? 2 : 1
    if (fromEnd && point >= 0xdc00 && point <= 0xdfff && offset > 1) {
      const previous = value.charCodeAt(offset - 2)
      if (previous >= 0xd800 && previous <= 0xdbff) width = 2
    }
    // JSON uses short escapes for these characters and six characters for other controls/lone surrogates.
    const size = width === 2 ? 1
      : point === 0x22 || point === 0x5c || point === 0x08 || point === 0x09 || point === 0x0a || point === 0x0c || point === 0x0d ? 2
        : point < 0x20 || point >= 0xd800 && point <= 0xdfff ? 6 : 1
    if (size > remaining) break
    remaining -= size
    offset += fromEnd ? -width : width
  }
  // Copy only the retained text, so a short context does not keep a large source string alive.
  return Array.from(fromEnd ? value.slice(offset) : value.slice(0, offset)).join('')
}

/** Slices retain original code point offsets. The maximum is a positive integer or Infinity. */
export function paragraphSlices(text: string, maximum = MAX_BLOCK_CHARACTERS): Array<{ text: string; start: number; end: number }> {
  if (maximum !== Infinity && (!Number.isInteger(maximum) || maximum < 1)) throw new RangeError('Paragraph size must be a positive integer.')
  const result: Array<{ text: string; start: number; end: number }> = []
  // Short paragraphs already fit; avoid a second array copy.
  if (text.length <= maximum) {
    const points = Array.from(text)
    if (points.length) result.push({ text: points.join(''), start: 0, end: points.length })
    return result
  }
  // Keep a bounded window with room for a complete block and one code point of lookahead.
  const windowSize = Math.max(32_768, (maximum + 1) * 2)
  for (let start = 0, offset = 0; offset < text.length;) {
    const windowEnd = Math.min(offset + windowSize, text.length)
    const points = Array.from(text.slice(offset, windowEnd))
    for (let localStart = 0; localStart < points.length;) {
      let end = Math.min(localStart + maximum, points.length)
      // Refill from the first unconsumed character: the tail may be incomplete or split a surrogate pair.
      if (end === points.length && windowEnd < text.length) break
      if (end < points.length) {
        for (let candidate = end; candidate > localStart + maximum / 2; candidate--) {
          if (/[。！？.!?；;\n]/u.test(points[candidate - 1])) { end = candidate; break }
        }
      }
      const part = points.slice(localStart, end).join('')
      const length = end - localStart
      result.push({ text: part, start, end: start + length })
      start += length
      offset += part.length
      localStart = end
    }
  }
  return result
}

export function chapterSections(
  chapterId: string,
  chapterTitle: string,
  blocks: DocumentBlock[],
  firstOrder: number
): DocumentSection[] {
  const result: DocumentSection[] = []
  let current: DocumentBlock[] = []
  let size = 0
  const flush = (): void => {
    if (!current.length) return
    result.push({ id: `${chapterId}-s${result.length}`, chapterId, chapterTitle, order: firstOrder + result.length, blocks: current })
    current = []
    size = 0
  }
  for (const block of blocks) {
    const length = characters(block.text)
    if (size + length > MAX_SECTION_CHARACTERS || current.length >= 48) flush()
    current.push(block)
    size += length
  }
  flush()
  return result
}

export function addUsage(left: LlmUsage | undefined, right: LlmUsage | undefined): LlmUsage | undefined {
  if (!right) return left
  const result = { ...left }
  for (const key of ['promptTokens', 'completionTokens', 'totalTokens'] as const) {
    if (right[key] !== undefined) result[key] = (result[key] ?? 0) + right[key]!
  }
  return result
}
