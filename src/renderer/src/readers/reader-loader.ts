import type { BookFormat } from '@shared/contracts'
import type { ReaderAdapter, ReaderCallbacks } from './types'

export type ReaderAdapterConstructor = new (host: HTMLElement, callbacks: ReaderCallbacks) => ReaderAdapter

/** Loading a constructor has no DOM side effects. The caller checks its open
 * revision after awaiting it, before creating a reader on the shared host. */
export async function loadReaderAdapter(format: BookFormat): Promise<ReaderAdapterConstructor> {
  switch (format) {
    case 'epub': return (await import('./epub-reader')).EpubReaderAdapter
    case 'txt': return (await import('./text-reader')).TextReaderAdapter
    case 'pdf': return (await import('./pdf-reader')).PdfReaderAdapter
  }
}
