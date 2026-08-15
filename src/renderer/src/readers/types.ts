import type { BookFormat, SelectionContext, TocItem } from '@shared/contracts'

export interface ReaderMetadata {
  title: string
  author: string | null
}

export interface ReaderDocumentInfo {
  metadata: ReaderMetadata
  toc: TocItem[]
}

export interface ReaderRelocation {
  locator: string
  progress: number
}

export interface ReaderCallbacks {
  bookId: string
  onRelocated?: (relocation: ReaderRelocation) => void
  onSelectionChanged?: (selection: SelectionContext | null) => void
}

export type ReadingLineHeight = 'original' | '1.5' | '1.7' | '1.9'
export type ReadingIndent = 'original' | 'none' | '2em'

export interface ReadingPreferences {
  fontScale: number
  lineHeight: ReadingLineHeight
  indent: ReadingIndent
  fontFamily: string | null
}

export const DEFAULT_READING_PREFERENCES: Readonly<ReadingPreferences> = Object.freeze({
  fontScale: 100,
  lineHeight: 'original',
  indent: 'original',
  fontFamily: null
})

/** Warm beige background for native text selection in the reading area (replaces the browser default blue). */
export const READER_SELECTION_BACKGROUND = 'rgba(240, 220, 160, 0.55)'

export interface ReaderAdapter {
  readonly format: BookFormat

  open(bytes: Uint8Array, lastLocator?: string | null): Promise<ReaderDocumentInfo>
  destroy(): void
  goTo(anchor: string): Promise<void>
  getSelection(): SelectionContext | null
  highlight(anchor: string): Promise<void>
  clearHighlight(): void
  setPreferences(preferences: ReadingPreferences): Promise<void>
}
