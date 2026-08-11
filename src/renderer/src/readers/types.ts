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

export interface ReaderAdapter {
  readonly format: BookFormat

  open(bytes: Uint8Array, lastLocator?: string | null): Promise<ReaderDocumentInfo>
  destroy(): void
  goTo(anchor: string): Promise<void>
  getSelection(): SelectionContext | null
  highlight(anchor: string): Promise<void>
  clearHighlight(): void
}
