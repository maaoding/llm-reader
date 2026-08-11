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
export type {
  ReaderAdapter,
  ReaderCallbacks,
  ReaderDocumentInfo,
  ReaderMetadata,
  ReaderRelocation
} from './types'
