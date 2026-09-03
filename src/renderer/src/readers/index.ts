import type { BookFormat } from '@shared/contracts'
import { EpubReaderAdapter } from './epub-reader'
import { PdfReaderAdapter } from './pdf-reader'
import { TextReaderAdapter } from './text-reader'
import type { ReaderAdapter, ReaderCallbacks } from './types'

export function createReaderAdapter(
  format: BookFormat,
  host: HTMLElement,
  callbacks: ReaderCallbacks
): ReaderAdapter {
  switch (format) {
    case 'epub':
      return new EpubReaderAdapter(host, callbacks)
    case 'txt':
      return new TextReaderAdapter(host, callbacks)
    case 'pdf':
      return new PdfReaderAdapter(host, callbacks)
  }
}

export { EpubReaderAdapter } from './epub-reader'
export { PdfReaderAdapter } from './pdf-reader'
export { TextReaderAdapter } from './text-reader'
export {
  fontFamilyStack,
  isPaperThemePreference,
  MAX_READING_FONT_SCALE,
  MIN_READING_FONT_SCALE,
  normalizePaperThemePreference,
  normalizeReadingPreferences,
  READING_CONTENT_WIDTH_PIXELS,
  READING_PARAGRAPH_SPACING_EM,
  READING_PAPER_THEME_TOKENS,
  resolveEffectivePaperTheme
} from './reading-preferences'
export type {
  PaperThemePreference,
  ReadingContentWidth,
  ReadingIndent,
  ReadingLineHeight,
  ReadingParagraphSpacing,
  ReadingPaperTheme,
  ReadingPreferences,
  ReadingTextAlign,
  ReaderAdapter,
  ReaderCallbacks,
  ReaderDocumentInfo,
  ReaderHighlightAnchor,
  ReaderMetadata,
  ReaderRelocation,
  ReaderRelocationReason,
  ReaderSearchResult,
  ReaderSelectionDraft
} from './types'
export {
  DEFAULT_READING_PREFERENCES,
  READER_SEARCH_QUERY_MAX_LENGTH,
  READER_SEARCH_RESULT_LIMIT
} from './types'
export { splitSearchExcerpt, type SearchExcerptSegment } from './search'
