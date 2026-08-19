export type AnswerInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: AnswerInline[] }
  | { type: 'emphasis'; children: AnswerInline[] }
  | { type: 'code'; text: string }

export interface MarkdownListItem {
  inlines: AnswerInline[]
  children: MarkdownBlock[]
}

export type MarkdownBlock =
  | { type: 'paragraph'; inlines: AnswerInline[] }
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; inlines: AnswerInline[] }
  | { type: 'code'; language: string; text: string }
  | { type: 'blockquote'; blocks: MarkdownBlock[] }
  | { type: 'list'; ordered: boolean; items: MarkdownListItem[] }

interface FenceOpen {
  char: '`' | '~'
  length: number
  info: string
}

const HEADING_PATTERN = /^ {0,3}(#{1,6})[ \t]+(.*)$/u
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/u
const BLOCKQUOTE_PATTERN = /^ {0,3}>[ \t]?(.*)$/u
const LIST_MARKER_PATTERN = /^(\s*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/u
const BLANK_LINE_PATTERN = /^[ \t]*$/u

function isBlank(line: string): boolean {
  return BLANK_LINE_PATTERN.test(line)
}

function matchFenceOpen(line: string): FenceOpen | null {
  const match = FENCE_PATTERN.exec(line)
  if (!match) return null
  return {
    char: match[1][0] as '`' | '~',
    length: match[1].length,
    info: match[2]?.trim() ?? ''
  }
}

function isFenceClose(line: string, open: FenceOpen): boolean {
  const pattern = new RegExp(`^ {0,3}${open.char}{${open.length},}[ \t]*$`, 'u')
  return pattern.test(line)
}

function matchHeading(line: string): { level: number; content: string } | null {
  const match = HEADING_PATTERN.exec(line)
  if (!match) return null
  const content = match[2].trim().replace(/[ \t]+#+[ \t]*$/u, '')
  return { level: match[1].length, content }
}

function matchBlockquote(line: string): string | null {
  const match = BLOCKQUOTE_PATTERN.exec(line)
  return match ? match[1] : null
}

function matchListMarker(line: string): { indent: number; ordered: boolean; content: string } | null {
  const match = LIST_MARKER_PATTERN.exec(line)
  if (!match) return null
  return {
    indent: match[1].length,
    ordered: /^\d/u.test(match[2]),
    content: match[3]
  }
}

function isBlockStart(line: string): boolean {
  return Boolean(matchFenceOpen(line) ?? matchHeading(line) ?? matchBlockquote(line) ?? matchListMarker(line))
}

function unescapeInline(value: string): string {
  return value.replace(/\\([\\`*_[\]])/gu, '$1')
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) slashes += 1
  return slashes % 2 === 1
}

function findUnescaped(text: string, token: string, start = 0): number {
  for (let index = start; index <= text.length - token.length; index += 1) {
    if (text.startsWith(token, index) && !isEscaped(text, index)) return index
  }
  return -1
}

function appendText(nodes: AnswerInline[], value: string): void {
  const text = unescapeInline(value)
  if (!text) return
  const last = nodes[nodes.length - 1]
  if (last?.type === 'text') last.text += text
  else nodes.push({ type: 'text', text })
}

export function parseInline(text: string): AnswerInline[] {
  const nodes: AnswerInline[] = []
  let cursor = 0
  while (cursor < text.length) {
    const codeStart = findUnescaped(text, '`', cursor)
    const strongStart = findUnescaped(text, '**', cursor)
    const emphasisStart = findUnescaped(text, '*', cursor)
    const starts = [codeStart, strongStart, emphasisStart].filter((index) => index >= 0)
    if (starts.length === 0) {
      appendText(nodes, text.slice(cursor))
      break
    }

    const first = Math.min(...starts)
    appendText(nodes, text.slice(cursor, first))
    if (first === codeStart) {
      const end = findUnescaped(text, '`', first + 1)
      if (end < 0) {
        appendText(nodes, text.slice(first))
        break
      }
      nodes.push({ type: 'code', text: text.slice(first + 1, end) })
      cursor = end + 1
      continue
    }
    if (first === strongStart) {
      const end = findUnescaped(text, '**', first + 2)
      if (end < 0) {
        appendText(nodes, text.slice(first))
        break
      }
      nodes.push({ type: 'strong', children: parseInline(text.slice(first + 2, end)) })
      cursor = end + 2
      continue
    }
    const end = findUnescaped(text, '*', first + 1)
    if (end < 0) {
      appendText(nodes, text.slice(first))
      break
    }
    nodes.push({ type: 'emphasis', children: parseInline(text.slice(first + 1, end)) })
    cursor = end + 1
  }
  return nodes
}

function parseParagraphLines(lines: string[], start: number): { block: MarkdownBlock; nextIndex: number } {
  const content: string[] = []
  let index = start
  while (index < lines.length && !isBlank(lines[index]) && !isBlockStart(lines[index])) {
    content.push(lines[index])
    index += 1
  }
  return {
    block: { type: 'paragraph', inlines: parseInline(content.join('\n')) },
    nextIndex: index
  }
}

function parseCodeBlock(lines: string[], start: number): { block: MarkdownBlock; nextIndex: number } {
  const open = matchFenceOpen(lines[start])
  if (!open) throw new Error('parseCodeBlock called without a fence opener')
  const content: string[] = []
  let index = start + 1
  while (index < lines.length && !isFenceClose(lines[index], open)) {
    content.push(lines[index])
    index += 1
  }
  if (index < lines.length) index += 1
  return {
    block: {
      type: 'code',
      language: open.info.split(/[ \t]+/u)[0] ?? '',
      text: content.join('\n')
    },
    nextIndex: index
  }
}

function parseBlockquote(lines: string[], start: number): { block: MarkdownBlock; nextIndex: number } {
  const content: string[] = []
  let index = start
  while (index < lines.length) {
    const line = matchBlockquote(lines[index])
    if (line === null) break
    content.push(line)
    index += 1
  }
  return {
    block: { type: 'blockquote', blocks: parseBlocks(content) },
    nextIndex: index
  }
}

function parseList(lines: string[], start: number): { block: MarkdownBlock; nextIndex: number } {
  const first = matchListMarker(lines[start])
  if (!first) throw new Error('parseList called without a list marker')
  const baseIndent = first.indent
  const ordered = first.ordered
  const rawItems: Array<{ content: string; childLines: string[] }> = []
  let index = start

  while (index < lines.length) {
    const line = lines[index]
    if (isBlank(line)) {
      let next = index + 1
      while (next < lines.length && isBlank(lines[next])) next += 1
      const following = next < lines.length ? matchListMarker(lines[next]) : null
      if (following && following.indent >= baseIndent && (following.indent > baseIndent || following.ordered === ordered)) {
        index = next
        continue
      }
      break
    }

    const marker = matchListMarker(line)
    if (!marker || marker.indent < baseIndent) break
    if (marker.indent === baseIndent) {
      rawItems.push({ content: marker.content, childLines: [] })
      index += 1
      continue
    }
    const current = rawItems[rawItems.length - 1]
    if (!current) break
    current.childLines.push(line)
    index += 1
  }

  const items = rawItems.map((item) => ({
    inlines: parseInline(item.content),
    children: item.childLines.length > 0 ? parseBlocks(item.childLines) : []
  }))

  return {
    block: { type: 'list', ordered, items },
    nextIndex: index
  }
}

function parseBlocks(lines: string[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (isBlank(line)) {
      index += 1
      continue
    }
    if (matchFenceOpen(line)) {
      const parsed = parseCodeBlock(lines, index)
      blocks.push(parsed.block)
      index = parsed.nextIndex
      continue
    }
    const heading = matchHeading(line)
    if (heading) {
      blocks.push({ type: 'heading', level: heading.level as 1 | 2 | 3 | 4 | 5 | 6, inlines: parseInline(heading.content) })
      index += 1
      continue
    }
    if (matchBlockquote(line) !== null) {
      const parsed = parseBlockquote(lines, index)
      blocks.push(parsed.block)
      index = parsed.nextIndex
      continue
    }
    if (matchListMarker(line)) {
      const parsed = parseList(lines, index)
      blocks.push(parsed.block)
      index = parsed.nextIndex
      continue
    }
    const parsed = parseParagraphLines(lines, index)
    blocks.push(parsed.block)
    index = parsed.nextIndex
  }
  return blocks
}

export function parseMarkdown(text: string): MarkdownBlock[] {
  return parseBlocks(text.replace(/\r\n?/gu, '\n').split('\n'))
}
