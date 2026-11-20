import type { BookCoverPayload } from '@shared/contracts'
import { observeNearby } from './viewport-observer'

interface CoverCacheEntry {
  promise: Promise<string | null>
  url: string | null
  removed: boolean
}

type CoverLoader = (bookId: string) => Promise<BookCoverPayload | null>

function defaultCreateUrl(cover: BookCoverPayload): string {
  return URL.createObjectURL(new Blob([cover.bytes as BlobPart], { type: cover.mimeType }))
}

export class BookCoverCache {
  private readonly entries = new Map<string, CoverCacheEntry>()
  private disposed = false

  constructor(
    private readonly loadCover: CoverLoader,
    private readonly createUrl: (cover: BookCoverPayload) => string = defaultCreateUrl,
    private readonly revokeUrl: (url: string) => void = URL.revokeObjectURL.bind(URL)
  ) {}

  load(bookId: string): Promise<string | null> {
    if (this.disposed) return Promise.resolve(null)
    const cached = this.entries.get(bookId)
    if (cached) return cached.promise

    const entry: CoverCacheEntry = { promise: Promise.resolve(null), url: null, removed: false }
    entry.promise = this.loadCover(bookId)
      .then((cover) => {
        if (!cover || entry.removed || this.disposed) return null
        const url = this.createUrl(cover)
        if (entry.removed || this.disposed) {
          this.revokeUrl(url)
          return null
        }
        entry.url = url
        return url
      })
      .catch((error: unknown) => {
        if (this.entries.get(bookId) === entry) {
          this.entries.delete(bookId)
        }
        throw error
      })
    this.entries.set(bookId, entry)
    return entry.promise
  }

  remove(bookId: string): void {
    const entry = this.entries.get(bookId)
    if (!entry) return
    entry.removed = true
    if (entry.url) this.revokeUrl(entry.url)
    this.entries.delete(bookId)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const entry of this.entries.values()) {
      entry.removed = true
      if (entry.url) this.revokeUrl(entry.url)
    }
    this.entries.clear()
  }
}

export function observeBookCoverVisibility(element: Element, onVisible: () => void): () => void {
  return observeNearby(element, element.closest('.library-list, .workbench-book-picker'), onVisible)
}
