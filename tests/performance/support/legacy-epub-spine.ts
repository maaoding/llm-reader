// Href-to-spine lookup from 9ff41d9, with the opened book's section accessor supplied by the caller.
export function previousEpubSpineIndex(length: number, hrefAt: (index: number) => string | undefined, href: string): number | null {
  if (!href) return null
  const normalize = (value: string): string => {
    const withoutFragment = value.split('#', 1)[0].replace(/^\.\//u, '')
    try { return decodeURIComponent(withoutFragment) } catch { return withoutFragment }
  }
  const normalized = normalize(href)
  for (let index = 0; index < length; index++) {
    const sectionHref = hrefAt(index)
    if (sectionHref && normalize(sectionHref) === normalized) return index
  }
  return null
}
