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
  characters: string[]
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
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
    const characters = Array.from(block.text)
    const positioned = {
      ...block,
      start: cursor,
      end: cursor + characters.length,
      characters
    }
    cursor = positioned.end + (index === blocks.length - 1 ? 0 : 2)
    return positioned
  })

  const startBlockIndex = clamp(focus.startBlock, 0, positioned.length - 1)
  const endBlockIndex = clamp(focus.endBlock, startBlockIndex, positioned.length - 1)
  const startBlock = positioned[startBlockIndex]
  const endBlock = positioned[endBlockIndex]
  const focusStart = startBlock.start + clamp(focus.startOffset, 0, startBlock.characters.length)
  const focusEnd = endBlock.start + clamp(focus.endOffset, 0, endBlock.characters.length)
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
    const text = block.characters.slice(localStart, localEnd).join('')
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
  return Array.from(value).length
}
