import type { Passage, WebSearchSource } from '@shared/contracts'
import { copy } from '@shared/copy'

const CITATION_TOKEN = /(\[[\w.:/-]{1,128}\])/gu
const CITATION_ID = /^\[([\w.:/-]{1,128})\]$/u
const INTERNAL_PASSAGE_ID = /^(?:P|W)\d+$/u
const CITATION_EXCERPT_LENGTH = 24

export type CitationSegment =
  | { type: 'text'; text: string }
  | { type: 'valid'; label: string; title: string; anchor: string; bookId?: string }
  | { type: 'web'; source: WebSearchSource }
  | { type: 'unverified'; label: string; title: string }

function excerptText(text: string): string {
  let excerpt = '', length = 0, space = false
  for (const character of text) {
    if (/\s/u.test(character)) { space = length > 0; continue }
    if (space) {
      if (length === CITATION_EXCERPT_LENGTH) return `${excerpt}…`
      excerpt += ' '
      length += 1
      space = false
    }
    if (length === CITATION_EXCERPT_LENGTH) return `${excerpt}…`
    excerpt += character
    length += 1
  }
  return excerpt
}

export function citationExcerpt(text: string): string {
  return excerptText(text) || copy('assistant.citationSourceFallback')
}

export function withoutIncompleteCitationMarker(text: string): string {
  return text.replace(/\[(?:P|W)\d*$/u, '')
}

export function citationSegments(text: string, passages: Passage[], webSources: WebSearchSource[] = []): CitationSegment[] {
  return createCitationResolver(passages, webSources)(text)
}

/** One index per answer context. Excerpts are computed only for cited passages;
 * translated labels are resolved at render time, so language changes stay fresh. */
export function createCitationResolver(passages: Passage[], webSources: WebSearchSource[] = []): (text: string) => CitationSegment[] {
  const passageMap = new Map(passages.map((passage) => [passage.id, passage]))
  const webMap = new Map<string, WebSearchSource>()
  for (const source of webSources) if (!webMap.has(source.id)) webMap.set(source.id, source)
  const excerpts = new Map<string, string>()
  return (text) => text.split(CITATION_TOKEN).map((part) => {
    const match = CITATION_ID.exec(part)
    if (!match) return { type: 'text', text: part }
    const web = /^W\d+$/u.test(match[1]) ? webMap.get(match[1]) : undefined
    if (web) return { type: 'web', source: web }
    const passage = passageMap.get(match[1])
    if (passage) {
      if (!excerpts.has(passage.id)) excerpts.set(passage.id, excerptText(passage.text))
      const excerpt = excerpts.get(passage.id) || copy('assistant.citationSourceFallback')
      return {
        type: 'valid',
        label: `${passage.bookTitle ? `《${passage.bookTitle}》 ` : ''}${copy('assistant.citationExcerpt', { excerpt })}`,
        title: `${passage.bookTitle ? `《${passage.bookTitle}》 ` : ''}${copy('assistant.citationJumpTitle', { excerpt })}`,
        anchor: passage.anchor,
        ...(passage.bookId ? { bookId: passage.bookId } : {})
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
