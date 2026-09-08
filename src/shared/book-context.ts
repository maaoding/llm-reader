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
  return Array.from(value).length
}

export function limitText(value: string, limit: number): string {
  return Array.from(value).slice(0, Math.max(0, limit)).join('')
}

/** Slices retain offsets into the original paragraph, never into normalized text. */
export function paragraphSlices(text: string, maximum = MAX_BLOCK_CHARACTERS): Array<{ text: string; start: number; end: number }> {
  const points = Array.from(text)
  const result: Array<{ text: string; start: number; end: number }> = []
  for (let start = 0; start < points.length;) {
    let end = Math.min(start + maximum, points.length)
    if (end < points.length) {
      for (let candidate = end; candidate > start + maximum / 2; candidate--) {
        if (/[。！？.!?；;\n]/u.test(points[candidate - 1])) { end = candidate; break }
      }
    }
    result.push({ text: points.slice(start, end).join(''), start, end })
    start = end
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
