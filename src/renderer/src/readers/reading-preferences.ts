import {
  DEFAULT_READING_PREFERENCES,
  type ReadingIndent,
  type ReadingLineHeight,
  type ReadingPreferences
} from './types'

export const MIN_READING_FONT_SCALE = 80
export const MAX_READING_FONT_SCALE = 140

const LINE_HEIGHTS = new Set<ReadingLineHeight>(['original', '1.5', '1.7', '1.9'])
const INDENTS = new Set<ReadingIndent>(['original', 'none', '2em'])

export function normalizeReadingPreferences(
  preferences: ReadingPreferences
): ReadingPreferences {
  const finiteScale = Number.isFinite(preferences.fontScale)
    ? Math.round(preferences.fontScale)
    : DEFAULT_READING_PREFERENCES.fontScale

  return {
    fontScale: Math.min(MAX_READING_FONT_SCALE, Math.max(MIN_READING_FONT_SCALE, finiteScale)),
    lineHeight: LINE_HEIGHTS.has(preferences.lineHeight)
      ? preferences.lineHeight
      : DEFAULT_READING_PREFERENCES.lineHeight,
    indent: INDENTS.has(preferences.indent)
      ? preferences.indent
      : DEFAULT_READING_PREFERENCES.indent
  }
}

export function readingPreferencesEqual(
  left: ReadingPreferences,
  right: ReadingPreferences
): boolean {
  return (
    left.fontScale === right.fontScale &&
    left.lineHeight === right.lineHeight &&
    left.indent === right.indent
  )
}
