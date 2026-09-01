import {
  DEFAULT_READING_PREFERENCES,
  type ReadingContentWidth,
  type ReadingIndent,
  type ReadingLineHeight,
  type ReadingPageMargin,
  type ReadingParagraphSpacing,
  type ReadingPaperTheme,
  type ReadingPreferences,
  type ReadingTextAlign
} from './types'

export const MIN_READING_FONT_SCALE = 80
export const MAX_READING_FONT_SCALE = 140
export const MAX_FONT_FAMILY_LENGTH = 128

const LINE_HEIGHTS = new Set<ReadingLineHeight>(['original', '1.5', '1.7', '1.9'])
const INDENTS = new Set<ReadingIndent>(['original', 'none', '2em'])
const CONTENT_WIDTHS = new Set<ReadingContentWidth>(['original', 'narrow', 'standard', 'wide'])
const PARAGRAPH_SPACINGS = new Set<ReadingParagraphSpacing>(['original', 'compact', 'standard', 'relaxed'])
const PAPER_THEMES = new Set<ReadingPaperTheme>(['light', 'sepia', 'dark'])
const PAGE_MARGINS = new Set<ReadingPageMargin>(['original', 'compact', 'standard', 'wide'])
const TEXT_ALIGNS = new Set<ReadingTextAlign>(['original', 'justify', 'left'])

export interface ReadingPaperTokens {
  background: string
  color: string
  colorScheme: 'light' | 'dark'
}

export const READING_PAPER_THEME_TOKENS: Readonly<Record<ReadingPaperTheme, ReadingPaperTokens>> = Object.freeze({
  light: Object.freeze({ background: '#fdfcf9', color: '#29363c', colorScheme: 'light' }),
  sepia: Object.freeze({ background: '#f6ecd8', color: '#433c2e', colorScheme: 'light' }),
  dark: Object.freeze({ background: '#22292d', color: '#e7e9e6', colorScheme: 'dark' })
})

export const READING_CONTENT_WIDTH_PIXELS: Readonly<Record<Exclude<ReadingContentWidth, 'original'>, number>> = Object.freeze({
  narrow: 640,
  standard: 760,
  wide: 920
})

export const READING_PARAGRAPH_SPACING_EM: Readonly<Record<Exclude<ReadingParagraphSpacing, 'original'>, number>> = Object.freeze({
  compact: 0.8,
  standard: 1.35,
  relaxed: 1.8
})

export interface ReadingPageMarginValues {
  block: number
  inline: string
}

export const READING_PAGE_MARGIN_VALUES: Readonly<Record<Exclude<ReadingPageMargin, 'original'>, ReadingPageMarginValues>> = Object.freeze({
  compact: Object.freeze({ block: 24, inline: 'clamp(16px, 3vw, 40px)' }),
  standard: Object.freeze({ block: 48, inline: 'clamp(28px, 6vw, 72px)' }),
  wide: Object.freeze({ block: 72, inline: 'clamp(40px, 7vw, 96px)' })
})

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
    fontFamily: normalizeFontFamily(preferences.fontFamily),
    contentWidth: CONTENT_WIDTHS.has(preferences.contentWidth)
      ? preferences.contentWidth
      : DEFAULT_READING_PREFERENCES.contentWidth,
    paragraphSpacing: PARAGRAPH_SPACINGS.has(preferences.paragraphSpacing)
      ? preferences.paragraphSpacing
      : DEFAULT_READING_PREFERENCES.paragraphSpacing,
    paperTheme: PAPER_THEMES.has(preferences.paperTheme)
      ? preferences.paperTheme
      : DEFAULT_READING_PREFERENCES.paperTheme,
    pageMargin: PAGE_MARGINS.has(preferences.pageMargin)
      ? preferences.pageMargin
      : DEFAULT_READING_PREFERENCES.pageMargin,
    textAlign: TEXT_ALIGNS.has(preferences.textAlign)
      ? preferences.textAlign
      : DEFAULT_READING_PREFERENCES.textAlign
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
    left.fontFamily === right.fontFamily &&
    left.contentWidth === right.contentWidth &&
    left.paragraphSpacing === right.paragraphSpacing &&
    left.paperTheme === right.paperTheme &&
    left.pageMargin === right.pageMargin &&
    left.textAlign === right.textAlign
  )
}
