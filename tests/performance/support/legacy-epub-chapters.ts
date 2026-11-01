import type { TocItem } from '../../../src/shared/contracts'

// Chapter reporting from 9ff41d9: chapterTitle calls chapterHref, then relocation calls it again.
function normalizeHref(value: string): string {
  const withoutFragment = value.split('#', 1)[0].replace(/^\.\//u, '')
  try {
    return decodeURIComponent(withoutFragment)
  } catch {
    return withoutFragment
  }
}

type Toc = ReadonlyArray<Pick<TocItem, 'href' | 'label'>>

function chapterHref(toc: Toc, sectionHref: string): string {
  const normalized = normalizeHref(sectionHref)
  const matches = toc.filter((item) => normalizeHref(item.href) === normalized)
  if (matches.length === 0) return sectionHref
  return (matches.find((item) => !item.href.includes('#')) ?? matches[0]).href
}

export function previousEpubChapter(toc: Toc, sectionHref: string): { title: string | undefined; href: string } {
  const normalized = normalizeHref(chapterHref(toc, sectionHref))
  const title = toc.find((item) => normalizeHref(item.href) === normalized)?.label
  return { title, href: chapterHref(toc, sectionHref) }
}
