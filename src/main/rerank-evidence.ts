import type { LlmRequest, Passage, SelectionContext } from '@shared/contracts'
import { characters, limitText } from '@shared/book-context'
import { actionPrompt } from './llm-service'

export const evidenceKey = (passage: Passage): string => passage.blockId ? `block:${passage.blockId}` : `local:${passage.anchor}\n${passage.text}`
export function uniqueEvidence(passages: Passage[]): Passage[] {
  return [...new Map(passages.map((passage) => [evidenceKey(passage), passage])).values()]
}
export function rerankQuery(request: LlmRequest, terms: string[]): string {
  const suffix = [terms.slice(0, 8).map((term) => limitText(term, 80)).join(' '), request.scope === 'book' || request.scope === 'visual' ? '' : limitText(request.selection.quote, 600)].filter(Boolean).join('\n')
  return [limitText(actionPrompt(request), 2_000 - characters(suffix) - (suffix ? 1 : 0)), suffix].filter(Boolean).join('\n')
}
export function targetChapters(planned: string[], fused: Passage[]): string[] {
  return [...new Set(planned.length ? planned : fused.flatMap((item) => item.chapterId ? [item.chapterId] : []))].slice(0, 6)
}
/** Reserve valid representatives before truncation without changing the fusion order. */
export function rerankCandidates(fused: Passage[], notes: Passage[], chapters: string[], maximum = 60): Passage[] {
  const all = uniqueEvidence([...fused, ...notes])
  const reserved = new Set(chapters.flatMap((id) => {
    const representative = all.find((item) => item.chapterId === id)
    return representative ? [evidenceKey(representative)] : []
  }))
  let remaining = Math.max(0, maximum - reserved.size)
  return all.filter((item) => reserved.has(evidenceKey(item)) || remaining-- > 0)
}
export function nearbyEvidence(selection: SelectionContext | null, originals: Passage[]): Passage[] {
  if (!selection) return []
  const local = selection.passages
  const index = Math.max(0, local.findIndex((item) => item.anchor === selection.anchor || item.text.includes(selection.quote)))
  const result: Passage[] = []
  for (let distance = 1; distance < local.length && result.length < 2; distance++) {
    for (const position of [index - distance, index + distance]) {
      const item = local[position]
      if (!item || result.length === 2 || (item.anchor === selection.anchor && item.text === selection.quote)) continue
      const original = originals.find((block) => block.anchor === item.anchor && block.text === item.text)
      result.push({ ...(original ?? item), evidenceRole: 'nearby' })
    }
  }
  return uniqueEvidence(result)
}
/** Selected text is added by boundContext; at most twelve supplemental originals leave here. */
export function organizeEvidence(ranked: Passage[], nearby: Passage[], chapters: string[]): Passage[] {
  const result = uniqueEvidence(nearby).slice(0, 2)
  const seen = new Set(result.map(evidenceKey))
  const add = (item: Passage): void => {
    if (result.length < 12 && !seen.has(evidenceKey(item))) { result.push(item); seen.add(evidenceKey(item)) }
  }
  for (const id of chapters) {
    if (result.some((item) => item.chapterId === id)) continue
    const representative = ranked.find((item) => item.chapterId === id)
    if (representative) add({ ...representative, evidenceRole: 'chapter' })
  }
  ranked.forEach(add)
  return result
}
