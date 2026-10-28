import type { Passage } from '@shared/contracts'

export const MAX_CONTEXT_CHARACTERS = 6_000

export interface ContextBlock {
  id: string
  text: string
  anchorForSlice: (start: number, end: number) => string
}

export interface ContextFocus {
  startBlock: number
  startOffset: number
  endBlock: number
  endOffset: number
}

// Arrays and lazy chapter accessors share the same bounded traversal.
interface ContextBlocks {
  readonly length: number
  at(index: number): ContextBlock | undefined
}

interface PositionedBlock extends ContextBlock {
  start: number
  end: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function advanceCodePoints(value: string, start: number, count: number): number {
  let offset = start
  for (let remaining = Math.trunc(count); remaining > 0 && offset < value.length; remaining -= 1) {
    offset += value.codePointAt(offset)! > 0xffff ? 2 : 1
  }
  return offset
}

/**
 * Builds a balanced window around the selection. Character accounting uses
 * Unicode code points rather than UTF-16 code units, so emoji and astral CJK
 * characters consume one unit of the 6,000-character budget.
 */
export function buildBoundedPassages(
  blocks: readonly ContextBlock[] | ContextBlocks,
  focus: ContextFocus,
  maximumCharacters = MAX_CONTEXT_CHARACTERS
): Passage[] {
  if (blocks.length === 0 || maximumCharacters <= 0) {
    return []
  }

  const startBlockIndex = clamp(focus.startBlock, 0, blocks.length - 1)
  const endBlockIndex = clamp(focus.endBlock, startBlockIndex, blocks.length - 1)
  const block = blocks.at(startBlockIndex)!
  const startBlock: PositionedBlock = { ...block, start: 0, end: codePointLength(block.text) }
  const focusStart = startBlock.start + clamp(focus.startOffset, 0, startBlock.end - startBlock.start)
  // A full budget on either side is enough even when an edge shifts the window.
  // Keep coordinates relative to the first selected block; distant text is never read.
  const before: PositionedBlock[] = [], after: PositionedBlock[] = []
  let first = startBlock, last = startBlock
  for (let index = startBlockIndex - 1; index >= 0 && focusStart - first.start < maximumCharacters; index--) {
    const block = blocks.at(index)!
    const end = first.start - 2
    first = { ...block, start: end - codePointLength(block.text), end }
    before.push(first)
  }
  for (let index = startBlockIndex + 1; index < blocks.length && last.end - focusStart < maximumCharacters; index++) {
    const block = blocks.at(index)!
    const start = last.end + 2
    last = { ...block, start, end: start + codePointLength(block.text) }
    after.push(last)
  }
  const endBlock = endBlockIndex === startBlockIndex ? startBlock : after[endBlockIndex - startBlockIndex - 1]
  // A selection ending beyond the scanned window already fills the whole budget.
  const focusEnd = endBlock ? endBlock.start + clamp(focus.endOffset, 0, endBlock.end - endBlock.start) : last.end
  const orderedFocusEnd = Math.max(focusStart, focusEnd)

  const selectedLength = orderedFocusEnd - focusStart
  let windowStart: number

  if (selectedLength >= maximumCharacters) {
    windowStart = focusStart
  } else {
    const surroundingBudget = maximumCharacters - selectedLength
    windowStart = focusStart - Math.floor(surroundingBudget / 2)
  }

  windowStart = clamp(windowStart, first.start, Math.max(first.start, last.end - maximumCharacters))
  const windowEnd = Math.min(last.end, windowStart + maximumCharacters)

  return [...before.reverse(), startBlock, ...after].flatMap((block) => {
    const intersectionStart = Math.max(windowStart, block.start)
    const intersectionEnd = Math.min(windowEnd, block.end)
    if (intersectionEnd <= intersectionStart) {
      return []
    }

    const localStart = intersectionStart - block.start
    const localEnd = intersectionEnd - block.start
    // Only translate offsets for returned passages; keep the chapter as strings.
    const start = advanceCodePoints(block.text, 0, localStart)
    const end = advanceCodePoints(block.text, start, Math.trunc(localEnd) - Math.trunc(localStart))
    // Copy only the bounded result so saved passages do not retain a large source string.
    const text = Array.from(block.text.slice(start, end)).join('')
    if (text.length === 0) {
      return []
    }

    return [
      {
        id: block.id,
        text,
        anchor: block.anchorForSlice(localStart, localEnd)
      }
    ]
  })
}

export function codePointLength(value: string): number {
  let length = 0
  for (let offset = 0; offset < value.length; length += 1) {
    offset += value.codePointAt(offset)! > 0xffff ? 2 : 1
  }
  return length
}
