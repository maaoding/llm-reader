import type { ReaderTitleCopy, ReaderTocItem } from './types'

export interface EpubChapter {
  readonly title: string
  readonly titleCopy?: ReaderTitleCopy
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
  private readonly sections = new Map<string, { index: number; href: string }>()
  private scanned = 0

  constructor(private readonly length: number, private readonly hrefAt: (index: number) => string | undefined) {}

  get(href: string): number | null {
    return href ? this.sectionAtPath(normalizeEpubHref(href))?.index ?? null : null
  }

  hrefForPath(path: string): string | undefined {
    return this.sectionAtPath(path)?.href
  }

  private sectionAtPath(path: string): { index: number; href: string } | undefined {
    const existing = this.sections.get(path)
    if (existing !== undefined) return existing
    while (this.scanned < this.length) {
      const index = this.scanned, candidate = this.hrefAt(index)
      this.scanned++
      if (!candidate) continue
      const normalized = normalizeEpubHref(candidate)
      // Repeated sections keep the first matching index, as in the original scan.
      if (!this.sections.has(normalized)) {
        const section = { index, href: candidate }
        this.sections.set(normalized, section)
        if (normalized === path) return section
      }
    }
    return undefined
  }
}

/** TOC metadata belongs to one opened book; keep its first title and first fragment-free link. */
export function indexEpubChapters(toc: ReadonlyArray<Pick<ReaderTocItem, 'href' | 'label' | 'labelCopy'>>): ReadonlyMap<string, EpubChapter> {
  const chapters = new Map<string, EpubChapter>()
  for (const item of toc) {
    const key = normalizeEpubHref(item.href)
    const previous = chapters.get(key)
    if (!previous) chapters.set(key, { title: item.label, href: item.href, ...(item.labelCopy ? { titleCopy: item.labelCopy } : {}) })
    else if (previous.href.includes('#') && !item.href.includes('#')) {
      chapters.set(key, { ...previous, href: item.href })
    }
  }
  return chapters
}
