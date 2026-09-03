import type { BookCoverPayload } from '@shared/contracts'

interface CoverCacheEntry {
  promise: Promise<string | null>
  url: string | null
  removed: boolean
}

type CoverLoader = (bookId: string) => Promise<BookCoverPayload | null>

interface CoverObserverGroup {
  observer: IntersectionObserver
  callbacks: Map<Element, () => void>
}

const coverObserverGroups = new WeakMap<Element, CoverObserverGroup>()

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
  const root = element.closest('.library-list')
  if (!root || typeof IntersectionObserver === 'undefined') {
    onVisible()
    return () => undefined
  }

  let group = coverObserverGroups.get(root)
  if (!group) {
    const callbacks = new Map<Element, () => void>()
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const callback = callbacks.get(entry.target)
        if (!callback) continue
        callbacks.delete(entry.target)
        observer.unobserve(entry.target)
        callback()
      }
      if (callbacks.size === 0) {
        observer.disconnect()
        coverObserverGroups.delete(root)
      }
    }, { root, rootMargin: '200px 0px' })
    group = { observer, callbacks }
    coverObserverGroups.set(root, group)
  }

  group.callbacks.set(element, onVisible)
  group.observer.observe(element)
  return () => {
    const current = coverObserverGroups.get(root)
    if (!current) return
    current.callbacks.delete(element)
    current.observer.unobserve(element)
    if (current.callbacks.size === 0) {
      current.observer.disconnect()
      coverObserverGroups.delete(root)
    }
  }
}
