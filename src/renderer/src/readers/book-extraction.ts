import ePub, { type Contents } from 'epubjs'
import type { BookPayload, DocumentNode, DocumentSection, DocumentUnit, NormalizedDocument } from '@shared/contracts'
import { characters, paragraphSlices } from '@shared/book-context'
import { documentSections, DOCUMENT_STRUCTURE_VERSION } from '@shared/document-structure'
import { copy } from '@shared/copy'
import { extractParagraphs, flattenToc, rangeForElementSlice, sanitizeContents } from './epub-reader'
import { cleanHeading, makeTextAnchor, navigationalHeadingIndexes, parseTextParagraphs } from './text-reader'

function explicitTextLevel(text: string): number | null {
  const markdown = /^(#{1,6})\s/u.exec(text)
  if (markdown) return markdown[1].length
  if (/^第.{1,12}[卷部篇](?:\s|$)|^part\s+(?:\d+|[ivxlcdm]+)(?:\s|[.:：-]|$)/iu.test(text)) return 1
  if (/^第.{1,12}章(?:\s|$)|^chapter\s+(?:\d+|[ivxlcdm]+)(?:\s|[.:：-]|$)/iu.test(text)) return 2
  if (/^第.{1,12}节(?:\s|$)/u.test(text)) return 3
  return null
}

export function extractTextDocument(text: string): NormalizedDocument {
  text = text.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n')
  const paragraphs = parseTextParagraphs(text), headings = navigationalHeadingIndexes(paragraphs)
  const nodes: DocumentNode[] = [], units: DocumentUnit[] = [], stack: DocumentNode[] = []
  for (const paragraph of paragraphs) {
    const heading = headings.has(paragraph.index)
    if (!nodes.length || heading) {
      const level = heading ? explicitTextLevel(paragraph.text) : null
      if (level === null) stack.length = 0
      else while (stack.length && stack.at(-1)!.level >= level) stack.pop()
      const node: DocumentNode = { id: `txt-n${nodes.length}`, title: heading ? cleanHeading(paragraph.text) : copy('analysis.textSection'),
        parentId: stack.at(-1)?.id ?? null, level: level ?? 1, order: nodes.length, anchor: makeTextAnchor(paragraph.start, paragraph.end), kind: 'section' }
      nodes.push(node)
      if (level !== null) stack.push(node)
    }
    units.push({ id: `txt-u${paragraph.index}`, nodeId: nodes.at(-1)!.id, order: units.length, text: paragraph.text,
      kind: heading ? 'heading' : /^\[\^[^\]]+\]:/u.test(paragraph.text) ? 'note' : /^(?:[-*+] |\d+[.)] )/u.test(paragraph.text) ? 'list' : 'paragraph',
      sources: [{ anchor: makeTextAnchor(paragraph.start, paragraph.end), precision: 'text', start: paragraph.start, end: paragraph.end }], relatedIds: [], searchable: true })
  }
  const definitions = new Map<string, DocumentUnit[]>()
  for (const unit of units) {
    const label = /^\[\^([^\]]+)\]:/u.exec(unit.text)?.[1]
    if (label) definitions.set(label, [...(definitions.get(label) ?? []), unit])
  }
  for (const unit of units.filter((item) => item.kind !== 'note')) for (const match of unit.text.matchAll(/\[\^([^\]]+)\]/gu)) {
    const targets = definitions.get(match[1])
    if (targets?.length === 1) { unit.relatedIds.push(targets[0].id); targets[0].relatedIds.push(unit.id) }
  }
  return finishDocument({ version: DOCUMENT_STRUCTURE_VERSION, nodes, units, diagnostics: [] })
}

export function extractTextSections(text: string): DocumentSection[] {
  const document = extractTextDocument(text)
  return document.units.length ? documentSections(document) : []
}

function finishDocument(document: NormalizedDocument): NormalizedDocument {
  const seen = new Set<string>()
  for (const unit of document.units) {
    unit.relatedIds = [...new Set(unit.relatedIds)]
    if (unit.kind === 'note' && !unit.relatedIds.length) document.diagnostics.push({ code: 'unlinked-note', unitId: unit.id })
    if (characters(unit.text) >= 30 && seen.has(unit.text)) document.diagnostics.push({ code: 'suspected-duplicate', unitId: unit.id })
    seen.add(unit.text)
  }
  return document
}

function internalLocation(href: string, base = 'https://reader.invalid/'): string {
  try { return decodeURI(new URL(href, base).pathname) } catch { return href.split('#')[0] }
}

/** Uses the same sanitized DOM and range offsets as the visible reader. No rendition is created. */
export async function extractEpubDocument(payload: BookPayload, signal: AbortSignal): Promise<NormalizedDocument> {
  const book = ePub(Uint8Array.from(payload.bytes).buffer)
  const document: NormalizedDocument = { version: DOCUMENT_STRUCTURE_VERSION, nodes: [], units: [], diagnostics: [] }
  const targets = new Map<string, DocumentUnit[]>(), links = new Map<string, string[]>()
  try {
    await book.ready
    signal.throwIfAborted()
    const [spine, navigation] = await Promise.all([book.loaded.spine, book.loaded.navigation])
    const toc = flattenToc(navigation.toc).map((entry, index) => ({ ...entry, nodeId: `epub-t${index}` }))
    const tocParents = new Map<string, string | null>(), tocStack: typeof toc = []
    for (const entry of toc) {
      while (tocStack.length && tocStack.at(-1)!.depth >= entry.depth) tocStack.pop()
      tocParents.set(entry.nodeId, tocStack.at(-1)?.nodeId ?? null); tocStack.push(entry)
    }
    const aliases = new Map<string, string>()
    for (let index = 0; index < spine.length; index++) {
      signal.throwIfAborted()
      const section = book.spine.get(index)
      if (!section) continue
      try {
        await section.load(book.load.bind(book))
        signal.throwIfAborted()
        const contents = { content: section.contents } as Contents
        const authoredLinks = new Map(Array.from(contents.content.querySelectorAll('a[href]')).map((link) => [link, link.getAttribute('href') ?? '']))
        sanitizeContents(contents)
        const paragraphs = extractParagraphs(contents).filter(({ element }) => !element.closest('nav,style,noscript,template'))
        const path = internalLocation(section.href)
        const boundaries = new Map<number, typeof toc>()
        for (const entry of toc.filter((item) => internalLocation(item.href) === path)) {
          let fragment: string | undefined = entry.href.split('#')[1]
          try { fragment = fragment ? decodeURIComponent(fragment) : undefined } catch { continue }
          const target = fragment ? section.document.getElementById(fragment) : null
          let position = fragment ? paragraphs.findIndex(({ element }) => element === target || element.contains(target) || Boolean(target?.contains(element))) : 0
          // Empty authored anchors can stand immediately before a heading/paragraph.
          if (position < 0 && target) position = paragraphs.findIndex(({ element }) => Boolean(target.compareDocumentPosition(element) & 4))
          if (position >= 0) boundaries.set(position, [...(boundaries.get(position) ?? []), entry])
        }
        let current: DocumentNode | undefined
        const headingStack: DocumentNode[] = []
        for (const [position, paragraph] of paragraphs.entries()) {
          const tag = paragraph.element.tagName.toLowerCase()
          const heading = /^h[1-6]$/u.test(tag)
          const entries = boundaries.get(position)
          const anchor = section.cfiFromRange(rangeForElementSlice(paragraph.element, 0, characters(paragraph.text), paragraph.leadingCharacters))
          if (entries?.length || heading || !current) {
            const entry = entries?.[0]
            const level = entry ? entry.depth + 1 : heading ? Number(tag[1]) : 1
            while (headingStack.length && headingStack.at(-1)!.level >= level) headingStack.pop()
            current = { id: entry?.nodeId ?? `epub-f${index}-n${position}`, title: (entry?.label ?? (heading ? paragraph.text : `${copy('analysis.textSection')} ${index + 1}`)).slice(0, 1_000),
              parentId: entry ? tocParents.get(entry.nodeId) ?? null : headingStack.at(-1)?.id ?? null, level, order: document.nodes.length, anchor, kind: 'section' }
            document.nodes.push(current); headingStack.push(current)
            for (const duplicate of entries?.slice(1) ?? []) aliases.set(duplicate.nodeId, current.id)
          }
          const unit: DocumentUnit = { id: `epub-f${index}-u${paragraph.index}`, nodeId: current.id, order: document.units.length, text: paragraph.text,
            kind: heading ? 'heading' : paragraph.element.closest('aside,[epub\\:type="footnote"],[role="doc-footnote"]') ? 'note' : tag === 'li' ? 'list' : 'paragraph',
            sources: paragraphSlices(paragraph.text).map((part) => ({ anchor: section.cfiFromRange(rangeForElementSlice(paragraph.element, part.start, part.end, paragraph.leadingCharacters)),
              precision: 'text', textStart: part.start, textEnd: part.end })), relatedIds: [], searchable: true }
          document.units.push(unit)
          let element: Element | null = paragraph.element
          while (element && element !== contents.content.parentElement) {
            if (element.id) { const key = `${path}#${element.id}`; targets.set(key, [...(targets.get(key) ?? []), unit]) }
            element = element.parentElement
          }
          const hrefs = Array.from(paragraph.element.querySelectorAll('a')).flatMap((link) => {
            const href = authoredLinks.get(link) ?? ''
            if (!href.includes('#') || /^[a-z][\w+.-]*:/iu.test(href) || href.startsWith('//')) return []
            try { const url = new URL(href, `https://reader.invalid${path}`); return [`${decodeURI(url.pathname)}#${decodeURIComponent(url.hash.slice(1))}`] } catch { return [] }
          })
          links.set(unit.id, hrefs)
        }
      } finally { section.unload() }
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    const nodeIds = new Set(document.nodes.map((node) => node.id))
    for (const node of document.nodes) {
      if (node.parentId) node.parentId = aliases.get(node.parentId) ?? node.parentId
      if (node.parentId === node.id || node.parentId && !nodeIds.has(node.parentId)) node.parentId = null
    }
    for (const unit of document.units) for (const href of links.get(unit.id) ?? []) {
      for (const target of targets.get(href) ?? []) if (target.kind === 'note' && target.id !== unit.id) {
        unit.relatedIds.push(target.id); target.relatedIds.push(unit.id)
      }
    }
    return finishDocument(document)
  } finally { book.destroy() }
}

export async function extractBookSections(payload: BookPayload, signal: AbortSignal,
  append: (sections: DocumentSection[], document?: NormalizedDocument) => Promise<void>): Promise<void> {
  if (payload.book.format !== 'txt' && payload.book.format !== 'epub') throw new Error(copy('analysis.unsupported'))
  const document = payload.book.format === 'txt' ? extractTextDocument(new TextDecoder('utf-8', { fatal: true }).decode(payload.bytes)) : await extractEpubDocument(payload, signal)
  const sections = documentSections(document)
  for (let offset = 0; offset < sections.length; offset += 8) {
    signal.throwIfAborted()
    await append(sections.slice(offset, offset + 8), offset === 0 ? document : undefined)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}
