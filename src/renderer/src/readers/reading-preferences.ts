import {
  DEFAULT_READING_PREFERENCES,
  type ReadingIndent,
  type ReadingLineHeight,
  type ReadingPreferences
} from './types'

export const MIN_READING_FONT_SCALE = 80
export const MAX_READING_FONT_SCALE = 140
export const MAX_FONT_FAMILY_LENGTH = 128

const LINE_HEIGHTS = new Set<ReadingLineHeight>(['original', '1.5', '1.7', '1.9'])
const INDENTS = new Set<ReadingIndent>(['original', 'none', '2em'])

export function normalizeFontFamily(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_FONT_FAMILY_LENGTH) return null
  return trimmed
}

export function cssFontFamily(value: string): string {
  return `'${value.replace(/\\/gu, '\\\\').replace(/'/gu, "\\'")}'`
}

/**
 * Registry display names and the family names stored inside font files can
 * disagree about spaces (e.g. "仓耳今楷05 W04" vs "仓耳今楷 05 W04"). List
 * both variants so at least one always matches DirectWrite's family record.
 */
export function fontFamilyStack(family: string): string[] {
  const compact = family.replace(/\s+/gu, '')
  return family === compact ? [family] : [family, compact]
}

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
      : DEFAULT_READING_PREFERENCES.indent,
    fontFamily: normalizeFontFamily(preferences.fontFamily)
  }
}

export function readingPreferencesEqual(
  left: ReadingPreferences,
  right: ReadingPreferences
): boolean {
  return (
    left.fontScale === right.fontScale &&
    left.lineHeight === right.lineHeight &&
    left.indent === right.indent &&
    left.fontFamily === right.fontFamily
  )
}
