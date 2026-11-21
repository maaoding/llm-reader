import { codePointLength } from './context'

const CONTENT_BLOCK_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,figcaption,dd,dt'

interface EpubParagraph {
  index: number
  element: Element
  text: string
  leadingCharacters: number
}

type ParagraphPosition = Omit<EpubParagraph, 'text'>
type ParagraphContents = { content: Element }

export function extractParagraphs(contents: ParagraphContents): EpubParagraph[] {
  const candidates = Array.from(contents.content.querySelectorAll(CONTENT_BLOCK_SELECTOR)).filter(
    (element) => !element.querySelector(CONTENT_BLOCK_SELECTOR)
  )
  const source = candidates.length > 0 ? candidates : [contents.content]

  return source.flatMap((element, index) => {
    const raw = element.textContent ?? ''
    const text = raw.trim()
    if (text.length === 0) return []
    const leadingUtf16 = raw.indexOf(text)
    return [{ index, element, text, leadingCharacters: codePointLength(raw.slice(0, Math.max(0, leadingUtf16))) }]
  })
}

/** Index only the last selected chapter; keep its text outside the retained cache. */
export class EpubParagraphIndex {
  private root: Element | null = null
  private observer: MutationObserver | null = null
  private paragraphs: ParagraphPosition[] = []
  private dirty = true

  get(contents: ParagraphContents): readonly ParagraphPosition[] {
    if (this.root !== contents.content) {
      this.clear()
      this.root = contents.content
      const Observer = this.root.ownerDocument.defaultView?.MutationObserver
      if (Observer) {
        this.observer = new Observer(() => { this.dirty = true })
        this.observer.observe(this.root, { subtree: true, childList: true, characterData: true })
      }
    }
    // Observe synchronous edits too, before the observer callback's microtask runs.
    const changed = (this.observer?.takeRecords().length ?? 0) > 0
    if (this.dirty || changed || !this.observer) {
      this.paragraphs = extractParagraphs(contents).map(({ index, element, leadingCharacters }) => ({ index, element, leadingCharacters }))
      this.dirty = false
    }
    return this.paragraphs
  }

  clear(): void {
    this.observer?.disconnect()
    this.observer = null
    this.root = null
    this.paragraphs = []
    this.dirty = true
  }
}
