import type { BookFormat, SelectionContext, TocItem } from '@shared/contracts'

export interface ReaderMetadata {
  title: string
  author: string | null
}

export interface ReaderDocumentInfo {
  metadata: ReaderMetadata
  toc: TocItem[]
}

export type ReaderRelocationReason = 'restore' | 'navigation' | 'natural'

export interface ReaderRelocation {
  locator: string
  progress: number
  chapterProgress: number
  chapterTitle: string
  chapterHref?: string | null
  reason: ReaderRelocationReason
}

export interface ReaderHighlightAnchor {
  anchor: string
}

export interface ReaderSearchResult {
  anchor: string
  excerpt: string
  chapterTitle: string
}

export const READER_SEARCH_RESULT_LIMIT = 200
export const READER_SEARCH_QUERY_MAX_LENGTH = 100

export interface ReaderSelectionDraft {
  quote: string
  confirm: (quote: string) => void
  cancel: () => void
}

export interface ReaderNotice {
  message: string
  tone: 'info' | 'error'
}

export interface ReaderCallbacks {
  bookId: string
  onRelocated?: (relocation: ReaderRelocation) => void
  onSelectionChanged?: (selection: SelectionContext | null) => void
  onSelectionDraftChanged?: (draft: ReaderSelectionDraft | null) => void
  onNotice?: (notice: ReaderNotice) => void
}

export type ReadingLineHeight = 'original' | '1.5' | '1.7' | '1.9'
export type ReadingIndent = 'original' | 'none' | '2em'
export type ReadingContentWidth = 'original' | 'narrow' | 'standard' | 'wide'
export type ReadingParagraphSpacing = 'original' | 'compact' | 'standard' | 'relaxed'
export type ReadingPaperTheme = 'light' | 'sepia' | 'dark' | 'dark-eye-care'
export type PaperThemePreference = 'default' | 'eye-care'
export type ReadingTextAlign = 'original' | 'justify' | 'left'

export interface ReadingPreferences {
  fontScale: number
  lineHeight: ReadingLineHeight
  indent: ReadingIndent
  fontFamily: string | null
  contentWidth: ReadingContentWidth
  paragraphSpacing: ReadingParagraphSpacing
  paperTheme: ReadingPaperTheme
  textAlign: ReadingTextAlign
}

export const DEFAULT_READING_PREFERENCES: Readonly<ReadingPreferences> = Object.freeze({
  fontScale: 100,
  lineHeight: 'original',
  indent: 'original',
  fontFamily: null,
  contentWidth: 'original',
  paragraphSpacing: 'original',
  paperTheme: 'light',
  textAlign: 'original'
})

/** Warm beige background for native text selection in the reading area (replaces the browser default blue). */
export const READER_SELECTION_BACKGROUND = 'rgba(240, 220, 160, 0.55)'

/** Same hue with lower opacity so selections stay gentle on the dark paper theme. */
export const READER_SELECTION_BACKGROUND_DARK_PAPER = 'rgba(240, 220, 160, 0.32)'

export function readerSelectionBackground(paperTheme: ReadingPaperTheme): string {
  return paperTheme === 'dark' || paperTheme === 'dark-eye-care'
    ? READER_SELECTION_BACKGROUND_DARK_PAPER
    : READER_SELECTION_BACKGROUND
}

export interface ReaderAdapter {
  readonly format: BookFormat

  open(bytes: Uint8Array, lastLocator?: string | null): Promise<ReaderDocumentInfo>
  destroy(): void
  search(query: string): Promise<ReadonlyArray<ReaderSearchResult>>
  goTo(anchor: string): Promise<void>
  getSelection(): SelectionContext | null
  clearSelection(): void
  selectAnchor(anchor: string): Promise<boolean>
  highlight(anchor: string): Promise<void>
  clearHighlight(): void
  setHighlights(highlights: ReadonlyArray<ReaderHighlightAnchor>): Promise<void>
  setPreferences(preferences: ReadingPreferences): Promise<void>
}
