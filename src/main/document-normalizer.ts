import { z } from 'zod'
import type { DocumentDiagnostic, DocumentNode, DocumentSection, DocumentTable, DocumentUnit, NormalizedDocument, SourceRange, TableCell } from '@shared/contracts'
import { characters, limitText } from '@shared/book-context'
import { documentSections, DOCUMENT_STRUCTURE_VERSION } from '@shared/document-structure'
import { copy } from '@shared/copy'
import { AppError } from './errors'
import { parseHtmlTable } from './table-parser'

const object = z.record(z.string(), z.unknown())
const list = z.array(z.unknown()).max(100_000)
function invalid(): never { throw new AppError('DOCUMENT_INVALID', copy('knowledge.invalid')) }
function record(value: unknown): Record<string, unknown> { return object.parse(value) }
function values(value: unknown): unknown[] { return value === undefined ? [] : list.parse(value) }
function text(value: unknown): string { return typeof value === 'string' ? value : '' }
function joinText(value: unknown): string { return Array.isArray(value) ? value.map(text).join('\n') : text(value) }
function pageNumber(value: unknown, count: number): number { return z.number().int().min(1).max(count).parse(value) }
function integer(value: unknown, fallback: number, min = 0): number { return value === undefined ? fallback : z.number().int().min(min).max(100_000).parse(value) }
function pageAnchor(page: number, fraction: number): string { return 'pdfpos:' + page + ':' + Number(fraction.toFixed(6)) }

class DocumentBuilder {
  readonly document: NormalizedDocument
  readonly nodes = new Map<string, DocumentNode>()
  private stack: DocumentNode[] = []
  private fallback?: DocumentNode
  constructor(readonly pageCount: number) {
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 600) invalid()
    this.document = { version: DOCUMENT_STRUCTURE_VERSION, pageCount, nodes: [], units: [], diagnostics: [] }
  }
  node(title: string, anchor: string, level?: number, parent?: string | null, kind: DocumentNode['kind'] = 'section'): DocumentNode {
    const depth = level === undefined ? 1 : z.number().int().min(1).max(64).parse(level)
    while (this.stack.length && this.stack.at(-1)!.level >= depth) this.stack.pop()
    const node: DocumentNode = { id: 'pdf-n' + this.document.nodes.length, title: limitText(title, 500), anchor, order: this.document.nodes.length,
      level: depth, parentId: parent === undefined ? this.stack.at(-1)?.id ?? null : parent, kind }
    this.document.nodes.push(node); this.nodes.set(node.id, node); this.stack.push(node); this.fallback = undefined
    return node
  }
  unit(input: Omit<DocumentUnit, 'order' | 'nodeId'>, nodeId?: string): DocumentUnit {
    const current = nodeId ?? this.stack.at(-1)?.id
    if (!current && (!this.fallback || this.fallback.anchor.split(':')[1] !== input.sources[0].anchor.split(':')[1])) {
      this.fallback = this.node(copy('knowledge.pdfPage', { page: input.sources[0].page! }), input.sources[0].anchor, 1, null)
      this.stack = []
    }
    const unit = { ...input, nodeId: current ?? this.fallback!.id, order: this.document.units.length }
    this.document.units.push(unit)
    return unit
  }
  diagnostic(code: DocumentDiagnostic['code'], unit: DocumentUnit): void {
    for (const page of new Set(unit.sources.map((source) => source.page))) this.document.diagnostics.push({ code, unitId: unit.id, ...(page ? { page } : {}) })
  }
  finish(): NormalizedDocument {
    const bodyPages = new Set<number>(), seen = new Set<string>()
    for (const unit of this.document.units) {
      unit.relatedIds = [...new Set(unit.relatedIds)]
      if (unit.searchable && !['heading', 'caption', 'note'].includes(unit.kind) && unit.text.trim()) for (const source of unit.sources) bodyPages.add(source.page!)
      if (unit.kind === 'unknown') this.diagnostic('unknown-structure', unit)
      if (unit.kind === 'note' && !unit.relatedIds.length) this.diagnostic('unlinked-note', unit)
      if (characters(unit.text) >= 20 && seen.has(unit.text)) this.diagnostic('suspected-duplicate', unit)
      seen.add(unit.text)
    }
    for (let page = 1; page <= this.pageCount; page++) if (!bodyPages.has(page)) this.document.diagnostics.push({ code: 'missing-body', page })
    if (!this.document.units.some((unit) => unit.text.trim())) invalid()
    documentSections(this.document) // Reject invalid links, sizes and hierarchy before caching.
    return this.document
  }
}

function mineruSources(item: Record<string, unknown>, pageCount: number): SourceRange[] {
  const page = pageNumber(z.number().int().parse(item.page_idx) + 1, pageCount)
  if (item.bbox === undefined) return [{ page, anchor: pageAnchor(page, 0), precision: 'block' }]
  const box = z.array(z.number().finite().min(0).max(1000)).length(4).parse(item.bbox)
  if (box[0] > box[2] || box[1] > box[3]) invalid()
  return [{ page, anchor: pageAnchor(page, box[1] / 1000), precision: 'block',
    bbox: { left: box[0], top: box[1], right: box[2], bottom: box[3], origin: 'TOPLEFT', width: 1000, height: 1000 } }]
}

export function normalizeMineruDocument(value: unknown, pageCount: number): NormalizedDocument {
  try {
    const builder = new DocumentBuilder(pageCount)
    const items = list.parse(typeof value === 'string' ? JSON.parse(value) as unknown : value)
    for (const [index, raw] of items.entries()) {
      const item = record(raw), type = text(item.type), id = 'mineru-u' + index
      const sources = mineruSources(item, pageCount)
      const heading = typeof item.text_level === 'number' && item.text_level > 0 || ['title', 'heading'].includes(type)
      let content = type === 'list' ? joinText(item.list_items) : type === 'code' ? joinText(item.code_body) : text(item.text)
      let table: DocumentTable | undefined, degraded = false
      if (type === 'table') { const parsed = parseHtmlTable(text(item.table_body), id); content = parsed.text; table = parsed.table; degraded = parsed.degraded }
      if (['image', 'chart'].includes(type)) content = joinText(item[type + '_caption'])
      const kind: DocumentUnit['kind'] = heading ? 'heading' : type === 'table' && table ? 'table' : type === 'table' ? 'paragraph' :
        ['page_header', 'header'].includes(type) ? 'header' : ['page_footer', 'footer', 'page_number'].includes(type) ? 'footer' :
          ['page_footnote', 'footnote'].includes(type) ? 'note' : ['equation', 'formula', 'interline_equation'].includes(type) ? 'formula' :
            type === 'list' ? 'list' : ['image', 'chart', 'caption'].includes(type) ? 'caption' : ['text', 'code'].includes(type) ? 'paragraph' : 'unknown'
      let unit: DocumentUnit | undefined
      if (content.trim()) {
        if (heading) builder.node(content.trim(), sources[0].anchor, typeof item.text_level === 'number' && item.text_level > 0 ? item.text_level : 1)
        unit = builder.unit({ id, text: content, kind, sources, relatedIds: [], searchable: !['header', 'footer'].includes(kind), ...(table ? { table } : {}) })
        if (degraded) builder.diagnostic('table-degraded', unit)
      }
      if (type === 'table' || type === 'code' || type === 'image' || type === 'chart') {
        const annotations: DocumentUnit[] = []
        for (const suffix of ['caption', 'footnote'] as const) {
          if (['image', 'chart'].includes(type) && suffix === 'caption') continue
          const pieces = Array.isArray(item[type + '_' + suffix]) ? values(item[type + '_' + suffix]).map(text) : [text(item[type + '_' + suffix])]
          for (const [offset, piece] of pieces.entries()) {
            if (!piece.trim()) continue
            const note = builder.unit({ id: id + '-' + suffix + offset, text: piece, kind: suffix === 'caption' ? 'caption' : 'note',
              sources: sources.map((source) => ({ ...source, precision: type === 'table' ? 'table' : 'block' })), relatedIds: unit ? [id] : [], searchable: true }, unit?.nodeId)
            annotations.push(note)
            unit?.relatedIds.push(note.id)
            if (unit && table) (suffix === 'caption' ? table.captionIds : table.noteIds).push(note.id)
          }
        }
        if (!unit && annotations.length) {
          // Retain annotations without inventing an empty body or dangling source links.
          const [first, ...rest] = annotations
          first.relatedIds = rest.map((note) => note.id)
          for (const note of rest) note.relatedIds = [first.id]
          if (type === 'table') builder.diagnostic('table-degraded', first)
        }
      }
    }
    return builder.finish()
  } catch (error) { if (error instanceof AppError) throw error; return invalid() }
}

function doclingSources(node: Record<string, unknown>, pages: Record<string, unknown>, pageCount: number): SourceRange[] {
  return values(node.prov).map((raw) => {
    const source = record(raw), page = pageNumber(source.page_no, pageCount)
    const size = record(record(pages[String(page)]).size)
    const height = z.number().finite().positive().parse(size.height)
    const width = size.width === undefined ? undefined : z.number().finite().positive().parse(size.width)
    const box = record(source.bbox)
    const top = z.number().finite().min(0).max(height).parse(box.t)
    const origin = z.enum(['TOPLEFT', 'BOTTOMLEFT']).parse(box.coord_origin)
    const fraction = origin === 'BOTTOMLEFT' ? (height - top) / height : top / height
    let bbox: SourceRange['bbox']
    if ([box.l, box.r, box.b].every((value) => value !== undefined)) {
      const left = z.number().finite().min(0).max(width ?? 1_000_000).parse(box.l)
      const right = z.number().finite().min(left).max(width ?? 1_000_000).parse(box.r)
      const bottom = z.number().finite().min(0).max(height).parse(box.b)
      if (origin === 'TOPLEFT' ? top > bottom : top < bottom) invalid()
      bbox = { left, right, top, bottom, origin, ...(width ? { width } : {}), height }
    }
    const charspan = source.charspan === undefined ? undefined : z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).parse(source.charspan)
    return { page, anchor: pageAnchor(page, fraction), precision: 'block' as const, ...(bbox ? { bbox } : {}),
      ...(charspan && charspan[1] > charspan[0] ? { start: charspan[0], end: charspan[1], textStart: charspan[0], textEnd: charspan[1] } : {}) }
  })
}

function doclingTable(node: Record<string, unknown>, id: string, pages: Record<string, unknown>, pageCount: number): { text: string; table?: DocumentTable; degraded: boolean } {
  let fallback = text(node.text)
  try {
    const data = record(node.data)
    const rawCells = values(data.table_cells).map(record)
    fallback = rawCells.map((cell) => text(cell.text)).filter(Boolean).join('\t') || fallback
    const cells: TableCell[] = rawCells.map((cell, index) => {
      const row = integer(cell.start_row_offset_idx, -1), column = integer(cell.start_col_offset_idx, -1)
      if (row < 0 || column < 0) invalid()
      const rowSpan = integer(cell.row_span, integer(cell.end_row_offset_idx, row + 1) - row, 1)
      const columnSpan = integer(cell.col_span, integer(cell.end_col_offset_idx, column + 1) - column, 1)
      if (rowSpan < 1 || columnSpan < 1 || cell.end_row_offset_idx !== undefined && Number(cell.end_row_offset_idx) !== row + rowSpan ||
          cell.end_col_offset_idx !== undefined && Number(cell.end_col_offset_idx) !== column + columnSpan) invalid()
      // A bare cell bbox supplies no page; do not attach it to a guessed page.
      const sources = cell.prov ? doclingSources(cell, pages, pageCount) : []
      return { id: id + '-c' + index, row, column, rowSpan, columnSpan, header: cell.column_header === true, rowHeader: cell.row_header === true,
        text: text(cell.text), ...(sources.length ? { sources } : {}) }
    }).sort((a, b) => a.row - b.row || a.column - b.column)
    if (!cells.length) invalid()
    const rows = integer(data.num_rows, Math.max(...cells.map((cell) => cell.row + cell.rowSpan)), 1)
    const columns = integer(data.num_cols, Math.max(...cells.map((cell) => cell.column + cell.columnSpan)), 1)
    const occupied = new Set<string>()
    for (const cell of cells) {
      if (cell.row + cell.rowSpan > rows || cell.column + cell.columnSpan > columns || cell.rowSpan * cell.columnSpan > 100_000) invalid()
      for (let row = cell.row; row < cell.row + cell.rowSpan; row++) for (let column = cell.column; column < cell.column + cell.columnSpan; column++) {
        const key = row + ':' + column
        if (occupied.has(key) || occupied.size > 200_000) invalid()
        occupied.add(key)
      }
    }
    const rowTexts = new Map<number, string[]>()
    for (const cell of cells) { const row = rowTexts.get(cell.row) ?? []; row.push(cell.text); rowTexts.set(cell.row, row) }
    return { text: [...rowTexts.values()].map((row) => row.join('\t')).join('\n'), table: { rows, columns, cells, captionIds: [], noteIds: [] }, degraded: false }
  } catch { return { text: fallback, degraded: true } }
}

export function normalizeDoclingDocument(value: unknown, pageCount: number): NormalizedDocument {
  try {
    const rawDocument = record(value), pages = record(rawDocument.pages)
    if (Object.keys(pages).length !== pageCount || Array.from({ length: pageCount }, (_, index) => String(index + 1)).some((page) => !Object.hasOwn(pages, page))) invalid()
    const collections = Object.fromEntries(['texts', 'tables', 'pictures', 'groups'].map((key) => [key, values(rawDocument[key])]))
    const builder = new DocumentBuilder(pageCount), visited = new Set<string>(), byRef = new Map<string, DocumentUnit>()
    const relations: { from: string; to: string; kind: 'captions' | 'footnotes' | 'references' }[] = []
    const contexts = new Map<string, string>()
    const resolve = (raw: unknown): { ref: string; key: string; node: Record<string, unknown> } => {
      const ref = text(record(raw).$ref)
      if (!/^#\/(?:texts|tables|pictures|groups)\/\d+$/u.test(ref)) invalid()
      const [, key, offset] = ref.split('/')
      return { ref, key, node: record(collections[key][Number(offset)]) }
    }
    const firstSource = (node: Record<string, unknown>, depth = 0): SourceRange | undefined => {
      if (depth > 64) invalid()
      const own = doclingSources(node, pages, pageCount)[0]
      if (own) return own
      for (const child of values(node.children)) { const found = firstSource(resolve(child).node, depth + 1); if (found) return found }
      return undefined
    }
    const visit = (raw: unknown, parent: string | null, depth: number, furniture: boolean): void => {
      if (depth > 64 || visited.size > 100_000) invalid()
      const { ref, key, node } = resolve(raw)
      if (visited.has(ref)) invalid()
      visited.add(ref)
      const id = 'docling-' + key + '-' + ref.split('/').at(-1)
      const sources = doclingSources(node, pages, pageCount)
      const labelledFurniture = furniture || node.content_layer === 'furniture'
      const label = text(node.label)
      let nodeId = contexts.get(parent ?? '') ?? parent ?? undefined
      if (key === 'groups') {
        const source = firstSource(node)
        if (source) {
          const group = builder.node(text(node.name) || copy('document.bodyGroup'), source.anchor, depth + 1, parent, 'group')
          nodeId = group.id
        }
      }
      let content = text(node.text)
      let table: DocumentTable | undefined, degraded = false
      if (key === 'tables') { const parsed = doclingTable(node, id, pages, pageCount); content = parsed.text; table = parsed.table; degraded = parsed.degraded }
      if (content.trim()) {
        if (!sources.length) invalid()
        const heading = ['title', 'section_header'].includes(label)
        if (heading) {
          const level = typeof node.level === 'number' ? node.level : depth + 1
          let ancestor = contexts.get(parent ?? '')
          while (ancestor && ancestor !== parent && builder.nodes.get(ancestor)!.level >= level) ancestor = builder.nodes.get(ancestor)!.parentId ?? undefined
          const headingNode = builder.node(content, sources[0].anchor, Math.max(1, level), ancestor ?? parent)
          nodeId = headingNode.id; contexts.set(parent ?? '', nodeId)
        }
        const kind: DocumentUnit['kind'] = heading ? 'heading' : table ? 'table' : key === 'tables' ? 'paragraph' :
          ['page_header', 'header'].includes(label) ? 'header' : ['page_footer', 'footer'].includes(label) ? 'footer' :
            label === 'footnote' ? 'note' : label === 'list_item' ? 'list' : label === 'formula' ? 'formula' : label === 'caption' ? 'caption' :
              ['text', 'paragraph', 'code', ''].includes(label) ? 'paragraph' : 'unknown'
        const unit = builder.unit({ id, text: content, kind, sources, searchable: !labelledFurniture && !['header', 'footer'].includes(kind),
          relatedIds: [], ...(table ? { table } : {}) }, nodeId)
        byRef.set(ref, unit)
        if (degraded) builder.diagnostic('table-degraded', unit)
      }
      for (const kind of ['captions', 'footnotes', 'references'] as const) for (const target of values(node[kind])) {
        try { relations.push({ from: ref, to: resolve(target).ref, kind }) }
        catch { const unit = byRef.get(ref); if (unit) builder.diagnostic(kind === 'footnotes' ? 'unlinked-note' : 'unknown-structure', unit) }
      }
      for (const child of values(node.children)) visit(child, key === 'groups' || ['title', 'section_header'].includes(label) ? nodeId ?? parent : parent, depth + 1, labelledFurniture)
    }
    for (const child of values(record(rawDocument.body).children)) visit(child, null, 0, false)
    if (rawDocument.furniture) for (const child of values(record(rawDocument.furniture).children)) visit(child, null, 0, true)
    for (let index = 0; index < relations.length; index++) {
      if (index > 100_000) invalid()
      const relation = relations[index]
      if (!visited.has(relation.to)) visit({ $ref: relation.to }, null, 0, false)
      const from = byRef.get(relation.from), to = byRef.get(relation.to)
      if (!from || !to || from.id === to.id) continue
      // Only explicit provider links to notes/captions produce optional evidence expansion.
      if (relation.kind !== 'references' || ['note', 'caption'].includes(to.kind)) {
        from.relatedIds.push(to.id); to.relatedIds.push(from.id)
        if (from.table && relation.kind === 'captions') from.table.captionIds.push(to.id)
        if (from.table && relation.kind === 'footnotes') from.table.noteIds.push(to.id)
      }
    }
    return builder.finish()
  } catch (error) { if (error instanceof AppError) throw error; return invalid() }
}

export function normalizeMineru(value: unknown, pageCount: number): DocumentSection[] { return documentSections(normalizeMineruDocument(value, pageCount)) }
export function normalizeDocling(value: unknown, pageCount: number): DocumentSection[] { return documentSections(normalizeDoclingDocument(value, pageCount)) }
