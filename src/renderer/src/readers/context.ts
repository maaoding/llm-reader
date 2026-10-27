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
  blocks: ContextBlock[],
  focus: ContextFocus,
  maximumCharacters = MAX_CONTEXT_CHARACTERS
): Passage[] {
  if (blocks.length === 0 || maximumCharacters <= 0) {
    return []
  }

  let cursor = 0
  const positioned: PositionedBlock[] = blocks.map((block, index) => {
    const positioned = {
      ...block,
      start: cursor,
      end: cursor + codePointLength(block.text)
    }
    cursor = positioned.end + (index === blocks.length - 1 ? 0 : 2)
    return positioned
  })

  const startBlockIndex = clamp(focus.startBlock, 0, positioned.length - 1)
  const endBlockIndex = clamp(focus.endBlock, startBlockIndex, positioned.length - 1)
  const startBlock = positioned[startBlockIndex]
  const endBlock = positioned[endBlockIndex]
  const focusStart = startBlock.start + clamp(focus.startOffset, 0, startBlock.end - startBlock.start)
  const focusEnd = endBlock.start + clamp(focus.endOffset, 0, endBlock.end - endBlock.start)
  const orderedFocusEnd = Math.max(focusStart, focusEnd)

  const documentLength = positioned[positioned.length - 1].end
  const selectedLength = orderedFocusEnd - focusStart
  let windowStart: number

  if (selectedLength >= maximumCharacters) {
    windowStart = focusStart
  } else {
    const surroundingBudget = maximumCharacters - selectedLength
    windowStart = focusStart - Math.floor(surroundingBudget / 2)
  }

  windowStart = clamp(windowStart, 0, Math.max(0, documentLength - maximumCharacters))
  const windowEnd = Math.min(documentLength, windowStart + maximumCharacters)

  return positioned.flatMap((block) => {
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
