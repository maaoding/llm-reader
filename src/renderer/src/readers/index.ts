import type { BookFormat } from '@shared/contracts'
import { EpubReaderAdapter } from './epub-reader'
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
  }
}

export { EpubReaderAdapter } from './epub-reader'
export { TextReaderAdapter } from './text-reader'
export {
  fontFamilyStack,
  MAX_READING_FONT_SCALE,
  MIN_READING_FONT_SCALE,
  normalizeReadingPreferences,
  READING_CONTENT_WIDTH_PIXELS,
  READING_PARAGRAPH_SPACING_EM
} from './reading-preferences'
export type {
  ReadingContentWidth,
  ReadingIndent,
  ReadingLineHeight,
  ReadingParagraphSpacing,
  ReadingPreferences,
  ReaderAdapter,
  ReaderCallbacks,
  ReaderDocumentInfo,
  ReaderMetadata,
  ReaderRelocation
} from './types'
export { DEFAULT_READING_PREFERENCES } from './types'
