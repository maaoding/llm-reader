export const HIGHLIGHT_NOTE_MAX_LENGTH = 10_000
export const HIGHLIGHT_TAG_MAX_COUNT = 12
export const HIGHLIGHT_TAG_MAX_LENGTH = 32

export function highlightTagKey(tag: string): string {
  return tag.trim().normalize('NFKC').toLowerCase()
}

export function normalizeHighlightTags(tags: readonly string[]): string[] {
  const distinct = new Map<string, string>()
  for (const value of tags) {
    const tag = value.trim()
    const key = highlightTagKey(tag)
    if (key && !distinct.has(key)) distinct.set(key, tag)
  }
  return [...distinct.values()]
}

export function validHighlightNote(note: string): boolean {
  return note.length <= HIGHLIGHT_NOTE_MAX_LENGTH && !note.includes('\0')
}

/** Tags remain representable in the comma-separated editor after reading them back. */
export function validHighlightTags(tags: readonly string[]): boolean {
  return tags.length <= HIGHLIGHT_TAG_MAX_COUNT && tags.every((tag) =>
    tag.length <= HIGHLIGHT_TAG_MAX_LENGTH && !tag.includes('\0') && !/[,，\r\n]/u.test(tag)
  )
}
