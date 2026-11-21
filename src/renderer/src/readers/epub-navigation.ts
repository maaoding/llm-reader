import type { TocItem } from '@shared/contracts'

export interface EpubChapter {
  readonly title: string
  readonly href: string
}

export function normalizeEpubHref(value: string): string {
  const withoutFragment = value.split('#', 1)[0].replace(/^\.\//u, '')
  try {
    return decodeURIComponent(withoutFragment)
  } catch {
    return withoutFragment
  }
}

/** Index only the prefix needed to resolve hrefs within one opened book's stable spine. */
export class EpubSpineIndex {
  private readonly indices = new Map<string, number>()
  private scanned = 0

  constructor(private readonly length: number, private readonly hrefAt: (index: number) => string | undefined) {}

  get(href: string): number | null {
    if (!href) return null
    const key = normalizeEpubHref(href)
    const existing = this.indices.get(key)
    if (existing !== undefined) return existing
    while (this.scanned < this.length) {
      const index = this.scanned, candidate = this.hrefAt(index)
      this.scanned++
      if (!candidate) continue
      const normalized = normalizeEpubHref(candidate)
      // Repeated sections keep the first matching index, as in the original scan.
      if (!this.indices.has(normalized)) this.indices.set(normalized, index)
      if (normalized === key) return index
    }
    return null
  }
}

/** TOC metadata belongs to one opened book; keep its first title and first fragment-free link. */
export function indexEpubChapters(toc: ReadonlyArray<Pick<TocItem, 'href' | 'label'>>): ReadonlyMap<string, EpubChapter> {
  const chapters = new Map<string, EpubChapter>()
  for (const item of toc) {
    const key = normalizeEpubHref(item.href)
    const previous = chapters.get(key)
    if (!previous) chapters.set(key, { title: item.label, href: item.href })
    else if (previous.href.includes('#') && !item.href.includes('#')) {
      chapters.set(key, { title: previous.title, href: item.href })
    }
  }
  return chapters
}
