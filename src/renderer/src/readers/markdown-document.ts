import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { decodeString } from 'micromark-util-decode-string'
import type { Nodes, Root } from 'mdast'

export const MAX_MARKDOWN_CHARACTERS = 2_000_000
const MAX_MARKDOWN_NODES = 50_000
const MAX_MARKDOWN_DEPTH = 64

interface Run { node: Text; start: number[]; end: number[]; offset: number }
export interface MarkdownParagraph {
  index: number
  text: string
  start: number
  end: number
  heading: boolean
  label?: string
  level?: number
  element: HTMLElement
  visibleText: string
  sourceOffset: (visibleOffset: number, end?: boolean) => number
  sourceOffsetForPoint: (node: Node, offset: number, end?: boolean) => number
  point: (sourceOffset: number, end?: boolean) => { node: Text; offset: number } | null
}
export interface MarkdownDocument { fragment: DocumentFragment; paragraphs: MarkdownParagraph[] }

/** Plain prose is valid Markdown too; automatic detection deliberately needs structural evidence. */
export function looksLikeMarkdown(text: string): boolean {
  if (text.length > MAX_MARKDOWN_CHARACTERS) return false
  let open: string | undefined
  let headings = 0, list = false, quote = false, previousList = false, previousQuote = false
  const lines = text.split('\n')
  for (const [index, line] of lines.entries()) {
    const fence = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1]
    if (open) {
      if (new RegExp(`^ {0,3}${open[0]}{${open.length},}[ \\t]*$`, 'u').test(line)) return true
      continue
    }
    if (fence) { open = fence; continue }
    // Test only the delimiter row. A header-wide .* before repeated pipes can
    // backtrack quadratically on long, ordinary TXT lines containing '|'.
    if (index > 0 && lines[index - 1].includes('|') && /^ {0,3}\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/u.test(line)) return true
    if (/^ {0,3}#{1,6}[ \t]+\S/u.test(line)) headings++
    const isList = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+\S/u.test(line)
    const isQuote = /^ {0,3}>/u.test(line)
    list ||= previousList && isList
    quote ||= previousQuote && isQuote
    previousList = isList; previousQuote = isQuote
  }
  const emphasis = /(?:\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`)/u.test(text)
  return headings >= 2 || headings > 0 && (list || quote || emphasis) || list && (quote || emphasis)
}

function codePointMap(text: string): Uint32Array {
  const result = new Uint32Array(text.length + 1)
  let offset = 0, count = 0
  for (const character of text) {
    result[offset] = count
    if (character.length === 2) result[offset + 1] = count
    offset += character.length
    result[offset] = ++count
  }
  return result
}

function checkedTree(text: string): Root {
  if (text.length > MAX_MARKDOWN_CHARACTERS) throw new Error('MARKDOWN_TOO_LARGE')
  const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  let count = 0
  const visit = (node: Nodes, depth: number): void => {
    if (++count > MAX_MARKDOWN_NODES || depth > MAX_MARKDOWN_DEPTH) throw new Error('MARKDOWN_TOO_LARGE')
    if ('children' in node) node.children.forEach((child) => visit(child, depth + 1))
  }
  visit(tree, 0)
  return tree
}

/** Safe DOM plus source maps. Never creates authored HTML, URLs, images or editable controls. */
export function renderMarkdownDocument(text: string, document: Document): MarkdownDocument {
  const tree = checkedTree(text)
  const cp = codePointMap(text)
  const fragment = document.createDocumentFragment()
  const paragraphs: MarkdownParagraph[] = []
  const runsByNode = new WeakMap<Node, Run>()
  let active: { runs: Run[]; visible: string } | null = null
  let quoteDepth = 0

  const append = (parent: Node, value: string, rawStart: number, rawEnd: number, decode: boolean, inlineCode = false, stripContainers = decode): void => {
    if (!value || !active) return
    const node = document.createTextNode(value)
    const start: number[] = [], end: number[] = []
    let cursor = rawStart, visible = 0
    const skipQuotePrefixes = (): void => {
      for (let depth = 0; depth < quoteDepth; depth++) {
        const prefix = /^ {0,3}>[ \t]?/u.exec(text.slice(cursor, rawEnd))?.[0]
        if (!prefix) break
        cursor += prefix.length
      }
    }
    const emit = (rendered: string, left: number, right: number): void => {
      for (const character of rendered) {
        for (let unit = 0; unit < character.length; unit++) start[visible + unit] = cp[left]
        visible += character.length
        end[visible] = cp[right]
        if (character.length === 2) end[visible - 1] = cp[right]
      }
    }
    while (visible < value.length) {
      const reference = decode && text[cursor] === '&' ? /^&(?:#[xX][\da-fA-F]+|#\d+|[A-Za-z][\dA-Za-z]*);/u.exec(text.slice(cursor, Math.min(rawEnd, cursor + 64)))?.[0] : undefined
      if (reference) {
        const decoded = decodeString(reference)
        if (decoded !== reference && value.startsWith(decoded, visible)) { emit(decoded, cursor, cursor + reference.length); cursor += reference.length; continue }
      }
      if (decode && text[cursor] === '\\' && /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/u.test(text[cursor + 1] ?? '') && value[visible] === text[cursor + 1]) cursor++
      const character = String.fromCodePoint(value.codePointAt(visible)!)
      if (inlineCode && character === ' ' && text[cursor] === '\n') { emit(character, cursor, cursor + 1); cursor++; skipQuotePrefixes(); continue }
      if (!text.startsWith(character, cursor)) {
        const found = text.indexOf(character, cursor)
        if (found < 0 || found + character.length > rawEnd) throw new Error('MARKDOWN_SOURCE_MAPPING_FAILED')
        cursor = found
      }
      if (cursor + character.length > rawEnd) throw new Error('MARKDOWN_SOURCE_MAPPING_FAILED')
      emit(character, cursor, cursor + character.length)
      cursor += character.length
      if (character === '\n' && stripContainers) skipQuotePrefixes()
    }
    end[0] = start[0]
    start[value.length] = end[value.length]
    const run = { node, start, end, offset: active.visible.length }
    active.runs.push(run)
    runsByNode.set(node, run)
    active.visible += value
    parent.appendChild(node)
  }
  const bounds = (node: Nodes): [number, number] => [node.position?.start.offset ?? 0, node.position?.end.offset ?? 0]
  const inline = (node: Nodes, parent: HTMLElement): void => {
    const [start, end] = bounds(node)
    if (node.type === 'text') { append(parent, node.value, start, end, true); return }
    if (node.type === 'html') { append(parent, node.value, start, end, false, false, true); return }
    if (node.type === 'inlineCode') {
      const element = document.createElement('code')
      const width = /^`+/u.exec(text.slice(start, end))?.[0].length ?? 0
      let left = start + width, right = end - width
      const body = text.slice(left, right).replace(/\n/gu, ' ')
      if (body.startsWith(' ') && body.endsWith(' ') && /[^ ]/u.test(body)) { left++; right-- }
      append(element, node.value, left, right, false, true)
      parent.append(element); return
    }
    if (node.type === 'break') { append(parent, '\n', Math.max(start, end - 1), end, false); return }
    if (node.type === 'strong' || node.type === 'emphasis' || node.type === 'delete') {
      const element = document.createElement(node.type === 'strong' ? 'strong' : node.type === 'emphasis' ? 'em' : 's')
      node.children.forEach((child) => inline(child, element)); parent.append(element); return
    }
    // These nodes stay literal, including their source syntax; no URL is activated.
    append(parent, text.slice(start, end), start, end, false)
  }
  const block = (node: Nodes, parent: Node): void => {
    const [rawStart, rawEnd] = bounds(node)
    if (node.type === 'blockquote' || node.type === 'list' || node.type === 'listItem') {
      const element = document.createElement(node.type === 'blockquote' ? 'blockquote' : node.type === 'listItem' ? 'li' : node.ordered ? 'ol' : 'ul')
      if (node.type === 'list' && node.ordered && node.start) element.setAttribute('start', String(node.start))
      if (node.type === 'listItem' && node.checked !== null && node.checked !== undefined) element.dataset.checked = String(node.checked)
      if (node.type === 'blockquote') quoteDepth++
      node.children.forEach((child) => block(child, element))
      if (node.type === 'blockquote') quoteDepth--
      parent.appendChild(element); return
    }
    if (node.type === 'table') {
      const wrapper = document.createElement('div'); wrapper.className = 'reader-markdown-table'
      const table = document.createElement('table'); const head = document.createElement('thead'), body = document.createElement('tbody')
      node.children.forEach((row, index) => {
        const tr = document.createElement('tr')
        row.children.forEach((cell, column) => {
          const container = document.createElement(index === 0 ? 'th' : 'td')
          if (node.align?.[column]) container.style.textAlign = node.align[column]!
          paragraph(cell, container, tr)
        })
        ;(index === 0 ? head : body).append(tr)
      })
      table.append(head, body); wrapper.append(table); parent.appendChild(wrapper); return
    }
    if (node.type === 'definition') {
      const element = document.createElement('p'); paragraph(node, element, parent); return
    }
    const element = document.createElement(node.type === 'heading' ? `h${node.depth}` : node.type === 'code' ? 'pre' : node.type === 'thematicBreak' ? 'hr' : 'p')
    if (rawEnd > rawStart) paragraph(node, element, parent)
  }
  const paragraph = (node: Nodes, element: HTMLElement, parent: Node): void => {
    const [rawStart, rawEnd] = bounds(node)
    active = { runs: [], visible: '' }
    if (node.type === 'code') {
      const code = document.createElement('code')
      const raw = text.slice(rawStart, rawEnd)
      const fenced = /^ {0,3}(?:`{3,}|~{3,})/u.test(raw)
      let cursor = fenced ? rawStart + raw.indexOf('\n') + 1 : rawStart
      node.value.split('\n').forEach((line, index, lines) => {
        const lineEnd = text.indexOf('\n', cursor)
        const end = lineEnd < 0 ? rawEnd : Math.min(lineEnd, rawEnd)
        const rawLine = text.slice(cursor, end)
        const found = rawLine.endsWith(line) ? end - line.length : cursor + rawLine.indexOf(line)
        if (found < cursor) throw new Error('MARKDOWN_SOURCE_MAPPING_FAILED')
        append(code, line, found, found + line.length, false)
        if (index + 1 < lines.length) append(code, '\n', end, end + 1, false)
        cursor = end + 1
      })
      element.append(code)
    } else if (node.type === 'html') append(element, node.value, rawStart, rawEnd, false, false, true)
    else if ('children' in node && node.type !== 'footnoteDefinition') node.children.forEach((child) => inline(child, element))
    else if (node.type !== 'thematicBreak') append(element, text.slice(rawStart, rawEnd), rawStart, rawEnd, false)
    const { runs, visible } = active
    const offset = (position: number, last = false): number => {
      const value = Math.max(0, Math.min(visible.length, position))
      if (value === 0) return runs[0]?.start[0] ?? cp[rawStart]
      if (value === visible.length) return runs.at(-1)?.end.at(-1) ?? cp[rawEnd]
      let low = 0, high = runs.length
      while (low < high) {
        const middle = low + Math.floor((high - low) / 2), item = runs[middle]
        // A shared boundary belongs to the preceding run only for an end offset.
        if (last ? value <= item.offset + item.node.length : value < item.offset + item.node.length) high = middle
        else low = middle + 1
      }
      const run = runs[low]
      if (run) return (last ? run.end : run.start)[value - run.offset]
      return last ? runs.at(-1)?.end.at(-1) ?? cp[rawEnd] : runs[0]?.start[0] ?? cp[rawStart]
    }
    const sourceOffsetForPoint = (node: Node, position: number, last = false): number => {
      const run = runsByNode.get(node)
      const value = run && Number.isInteger(position) && position >= 0 && position <= run.node.length && element.contains(node)
        ? run.offset + position
        : visibleOffset(element, node, position)
      return offset(value, last)
    }
    const point = (position: number, last = false): { node: Text; offset: number } | null => {
      let low = 0, high = runs.length
      while (low < high) {
        const middle = low + Math.floor((high - low) / 2), run = runs[middle]
        const matches = last ? run.start[0] < position : run.end[run.node.length] > position
        if (last ? matches : !matches) low = middle + 1
        else high = middle
      }
      const found = runs[last ? low - 1 : low]
      if (found) {
        let left = 0, right = found.node.length
        while (left < right) {
          const middle = left + Math.floor((right - left) / 2)
          const matches = last ? found.start[middle] < position : found.end[middle + 1] > position
          if (last ? matches : !matches) left = middle + 1
          else right = middle
        }
        return { node: found.node, offset: left }
      }
      const run = last ? runs[0] : runs.at(-1)
      return run ? { node: run.node, offset: last ? 0 : run.node.length } : null
    }
    paragraphs.push({ index: paragraphs.length, text: text.slice(rawStart, rawEnd), start: cp[rawStart], end: cp[rawEnd], heading: node.type === 'heading',
      ...(node.type === 'heading' ? { label: visible, level: node.depth } : {}), element, visibleText: visible, sourceOffset: offset, sourceOffsetForPoint, point })
    active = null
    parent.appendChild(element)
  }
  tree.children.forEach((node) => block(node, fragment))
  return { fragment, paragraphs }
}

export function visibleOffset(element: HTMLElement, node: Node, offset: number): number {
  const range = element.ownerDocument.createRange()
  range.selectNodeContents(element); range.setEnd(node, offset)
  return range.toString().length
}

export function markdownAnchor(block: MarkdownParagraph, start: number, end: number): string {
  return `txt:${block.sourceOffset(start)}:${block.sourceOffset(end, true)}`
}
