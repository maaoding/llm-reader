import type { Passage } from '@shared/contracts'
import { copy } from '@shared/copy'

const CITATION_TOKEN = /(\[[\w.:/-]{1,128}\])/gu
const CITATION_ID = /^\[([\w.:/-]{1,128})\]$/u
const INTERNAL_PASSAGE_ID = /^P\d+$/u
const CITATION_EXCERPT_LENGTH = 24

export type CitationSegment =
  | { type: 'text'; text: string }
  | { type: 'valid'; label: string; title: string; anchor: string }
  | { type: 'unverified'; label: string; title: string }

export function citationExcerpt(text: string): string {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  if (!normalized) return copy('assistant.citationSourceFallback')
  const characters = Array.from(normalized)
  return characters.length > CITATION_EXCERPT_LENGTH
    ? `${characters.slice(0, CITATION_EXCERPT_LENGTH).join('')}…`
    : normalized
}

export function withoutIncompleteCitationMarker(text: string): string {
  return text.replace(/\[P\d*$/u, '')
}

export function citationSegments(text: string, passages: Passage[]): CitationSegment[] {
  const passageMap = new Map(passages.map((passage) => [passage.id, passage]))
  return text.split(CITATION_TOKEN).map((part) => {
    const match = CITATION_ID.exec(part)
    if (!match) return { type: 'text', text: part }
    const passage = passageMap.get(match[1])
    if (passage) {
      const excerpt = citationExcerpt(passage.text)
      return {
        type: 'valid',
        label: copy('assistant.citationExcerpt', { excerpt }),
        title: copy('assistant.citationJumpTitle', { excerpt }),
        anchor: passage.anchor
      }
    }
    if (INTERNAL_PASSAGE_ID.test(match[1])) {
      return {
        type: 'unverified',
        label: copy('assistant.citationUnverified'),
        title: copy('assistant.citationUnknownTitle')
      }
    }
    return { type: 'text', text: part }
  })
}
