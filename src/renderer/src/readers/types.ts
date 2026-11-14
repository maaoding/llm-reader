import type { BookFormat, PdfImageRegionSource, PreparedOcrPage, ReaderSource, TextReadingMode, TocItem } from '@shared/contracts'
import { copyIn, getCopyLanguage, type UiLanguage } from '@shared/copy'

export interface ReaderMetadata {
  title: string
  author: string | null
}

export interface ReaderDocumentInfo {
  metadata: ReaderMetadata
  toc: ReaderTocItem[]
  textRendering?: 'plain' | 'markdown'
}

export type ReaderRelocationReason = 'restore' | 'navigation' | 'natural'

export type ReaderTitleCopy =
  | { key: 'reader.txtFullText' | 'reader.txtOpening' | 'reader.pdfWholeDocument' | 'reader.pdfUntitledSection' | 'reader.epubUntitledChapter' }
  | { key: 'reader.epubSection'; number: number }
  | { key: 'knowledge.pdfPage'; page: number }

export interface ReaderTocItem extends TocItem { labelCopy?: ReaderTitleCopy }

export function readerTitle(label: string | ReaderTitleCopy, language: UiLanguage = getCopyLanguage()): string {
  if (typeof label === 'string') return label
  if (label.key === 'reader.epubSection') return copyIn(language, label.key, { number: label.number })
  if (label.key === 'knowledge.pdfPage') return copyIn(language, label.key, { page: label.page })
  return copyIn(language, label.key)
}

export function readerRelocationTitle(label: string | ReaderTitleCopy): Pick<ReaderRelocation, 'chapterTitle' | 'chapterTitleCopy'> {
  return typeof label === 'string' ? { chapterTitle: label } : { chapterTitle: readerTitle(label), chapterTitleCopy: label }
}

export interface ReaderRelocation {
  locator: string
  progress: number
  chapterProgress: number
  chapterTitle: string
  chapterTitleCopy?: ReaderTitleCopy
  chapterHref?: string | null
  reason: ReaderRelocationReason
}

export interface ReaderHighlightAnchor {
  anchor: string
}

import type { ReaderSearchResult as SearchResult } from '@shared/reader-search'
export { READER_SEARCH_QUERY_MAX_LENGTH, READER_SEARCH_RESULT_LIMIT } from '@shared/reader-search'
export interface ReaderSearchResult extends SearchResult { chapterTitleCopy?: ReaderTitleCopy }

export interface ReaderSelectionDraft {
  quote: string
  ocrPreview?: string
  confirm: (quote: string) => void
  cancel: () => void
}
export interface ReaderImageRegionDraft {
  source: PdfImageRegionSource
  imageDataUrl: string
  confirm: () => void
  cancel: () => void
}

export interface ReaderNotice {
  message: string
  tone: 'info' | 'error'
}

export interface ReaderCallbacks {
  bookId: string
  readPreparedOcrPage?: (pageNumber: number) => Promise<PreparedOcrPage>
  onRelocated?: (relocation: ReaderRelocation) => void
  onSelectionChanged?: (selection: ReaderSource | null) => void
  onSelectionDraftChanged?: (draft: ReaderSelectionDraft | null) => void
  onImageRegionDraftChanged?: (draft: ReaderImageRegionDraft | null) => void
  onNotice?: (notice: ReaderNotice) => void
  onDisplaySettings?: (trigger: HTMLButtonElement) => void
  onInternalNavigation?: () => void
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
  getSelection(): ReaderSource | null
  captureImageRegion?(source: PdfImageRegionSource, signal?: AbortSignal): Promise<string>
  clearSelection(): void
  selectAnchor(anchor: string): Promise<boolean>
  highlight(anchor: string): Promise<void>
  clearHighlight(): void
  setHighlights(highlights: ReadonlyArray<ReaderHighlightAnchor>): Promise<void>
  setPreferences(preferences: ReadingPreferences): Promise<void>
  setTextMode?(mode: TextReadingMode): Promise<ReaderDocumentInfo | undefined>
}
