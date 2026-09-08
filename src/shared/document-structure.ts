import type { DocumentBlock, DocumentNode, DocumentSection, DocumentUnit, NormalizedDocument, Passage, SourceRange, TableSlice } from './contracts'
import { chapterSections, characters, MAX_BLOCK_CHARACTERS, MAX_BOOK_CHARACTERS, MAX_BOOK_SECTIONS, paragraphSlices } from './book-context'

export const DOCUMENT_STRUCTURE_VERSION = 2
export const MAX_DOCUMENT_CACHE_BYTES = 96_000_000

export function headingPath(nodes: DocumentNode[] | Map<string, DocumentNode>, id: string): string[] {
  const byId = Array.isArray(nodes) ? new Map(nodes.map((node) => [node.id, node])) : nodes
  const result: string[] = [], visited = new Set<string>()
  let current = byId.get(id)
  while (current && !visited.has(current.id)) {
    visited.add(current.id); result.unshift(current.title)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return result
}

export function validateDocument(document: NormalizedDocument): void {
  if (document.version !== DOCUMENT_STRUCTURE_VERSION || !document.nodes.length || !document.units.length ||
      document.nodes.length > 100_000 || document.units.length > 100_000) throw new Error('文档结构无效。')
  const nodes = new Map(document.nodes.map((node) => [node.id, node]))
  const units = new Map(document.units.map((unit) => [unit.id, unit]))
  if (nodes.size !== document.nodes.length || units.size !== document.units.length) throw new Error('文档位置编号重复。')
  let size = 0
  for (const node of nodes.values()) {
    const visited = new Set<string>([node.id])
    let parentId = node.parentId
    while (parentId) {
      const parent = nodes.get(parentId)
      if (!parent || visited.has(parentId) || visited.size > 64) throw new Error('文档层级无效。')
      visited.add(parentId); parentId = parent.parentId
    }
  }
  for (const [index, unit] of document.units.entries()) {
    size += characters(unit.text)
    if (!nodes.has(unit.nodeId) || unit.order !== index || !unit.sources.length || unit.relatedIds.some((id) => !units.has(id)) ||
        unit.sources.some((source) => source.page !== undefined && (!document.pageCount || source.page > document.pageCount))) throw new Error('文档来源或关联无效。')
    if (unit.table) {
      const occupied = new Set<string>(), ids = new Set<string>()
      for (const cell of unit.table.cells) {
        if (ids.has(cell.id) || cell.row < 0 || cell.column < 0 || cell.rowSpan < 1 || cell.columnSpan < 1 ||
            cell.row + cell.rowSpan > unit.table.rows || cell.column + cell.columnSpan > unit.table.columns ||
            cell.rowSpan * cell.columnSpan > 100_000) throw new Error('表格范围无效。')
        ids.add(cell.id)
        for (let row = cell.row; row < cell.row + cell.rowSpan; row++) for (let column = cell.column; column < cell.column + cell.columnSpan; column++) {
          const key = `${row}:${column}`
          if (occupied.has(key) || occupied.size >= 200_000) throw new Error('表格范围无效。')
          occupied.add(key)
        }
      }
      if ([...unit.table.captionIds, ...unit.table.noteIds].some((id) => !units.has(id))) throw new Error('表格关联无效。')
    }
  }
  if (size > MAX_BOOK_CHARACTERS) throw new Error('文档超过处理上限。')
}

function clipSourceText(source: SourceRange, start: number, end: number): SourceRange {
  if (source.textStart === undefined || source.textEnd === undefined) return { ...source }
  const left = Math.max(source.textStart, start), right = Math.min(source.textEnd, end)
  return { ...source, textStart: left - start, textEnd: right - start,
    ...(source.start !== undefined && source.end !== undefined ? {
      start: source.start + left - source.textStart, end: Math.min(source.end, source.start + right - source.textStart)
    } : {}) }
}

function sliceSources(unit: DocumentUnit, start: number, end: number): SourceRange[] {
  return unit.sources.filter((source) => source.textStart === undefined || source.textEnd === undefined ||
    source.textStart < end && source.textEnd > start).map((source) => {
    const match = /^txt:(\d+):(\d+)$/u.exec(source.anchor)
    if (match) {
      const offset = Number(match[1])
      return { ...source, anchor: `txt:${offset + start}:${offset + end}`, start: offset + start, end: offset + end, textStart: 0, textEnd: end - start }
    }
    return clipSourceText(source, start, end)
  })
}

/** Complete rows share true column headers; an oversized row records exactly which cell characters it contains. */
function tableBlocks(unit: DocumentUnit): DocumentBlock[] {
  const table = unit.table!
  const cellsById = new Map(table.cells.map((cell) => [cell.id, cell]))
  const headers = table.cells.filter((cell) => cell.header)
  const rowCells = new Map<number, typeof table.cells>()
  for (const cell of table.cells.filter((item) => !item.header)) for (let row = cell.row; row < cell.row + cell.rowSpan; row++) {
    const cells = rowCells.get(row) ?? []
    cells.push(cell); rowCells.set(row, cells)
  }
  const rows = [...rowCells.keys()].sort((a, b) => a - b)
  const result: DocumentBlock[] = []
  type Part = { text: string; cells: TableSlice['cells'] }
  const serialize = (cells: typeof table.cells, row?: number): Part => {
    let text = '', length = 0
    const ranges: TableSlice['cells'] = []
    for (const cell of cells) {
      if (ranges.length) { text += '\t'; length++ }
      const textStart = length, cellLength = characters(cell.text)
      text += cell.text; length += cellLength
      ranges.push({ id: cell.id, start: 0, end: cellLength, textStart, textEnd: length, header: cell.header, rows: row === undefined ? [] : [row] })
    }
    return { text, cells: ranges }
  }
  const header = serialize(headers)
  const emit = (selectedRows: number[], body: Part): void => {
    const prefix = header.text && body.text ? header.text + '\n' : header.text
    // A header itself exceeding the block limit is retained as cell ranges in separate blocks.
    const repeated = characters(prefix) < MAX_BLOCK_CHARACTERS ? prefix : ''
    const parts = paragraphSlices(body.text || header.text, Math.max(1, MAX_BLOCK_CHARACTERS - (body.text ? characters(repeated) : 0)))
    for (const part of parts) {
      const offset = body.text ? characters(repeated) : 0
      const inputCells = body.text ? body.cells : header.cells
      const cells = inputCells.filter((cell) => cell.textStart < part.end && cell.textEnd > part.start).map((cell) => ({
        ...cell, start: cell.start + Math.max(0, part.start - cell.textStart),
        end: cell.start + Math.min(cell.end - cell.start, part.end - cell.textStart),
        textStart: offset + Math.max(0, cell.textStart - part.start), textEnd: offset + Math.min(part.end - part.start, cell.textEnd - part.start)
      }))
      if (body.text && repeated) cells.unshift(...header.cells)
      const contributing = cells.map((range) => cellsById.get(range.id)!)
      const exact = cells.flatMap((range) => (cellsById.get(range.id)?.sources ?? [])
        .filter((source) => source.textStart === undefined || source.textEnd === undefined || source.textStart < range.end && source.textEnd > range.start)
        .map((source) => {
          const clipped = clipSourceText(source, range.start, range.end)
          return { ...clipped, textStart: range.textStart + (clipped.textStart ?? 0), textEnd: range.textStart + (clipped.textEnd ?? range.end - range.start) }
        }))
      const sources = exact.length && contributing.every((cell) => cell.sources?.length) ? exact : unit.sources.map((source) => ({ ...source, precision: 'table' as const }))
      result.push({ id: unit.id + '-b' + result.length, text: (body.text ? repeated : '') + part.text,
        anchor: sources[0].anchor, sources, kind: 'table', nodeId: unit.nodeId, unitId: unit.id,
        tableSlice: { rows: selectedRows.filter((row) => cells.some((cell) => cell.rows?.includes(row))), cells }, searchable: unit.searchable })
    }
  }
  if (characters(header.text) >= MAX_BLOCK_CHARACTERS && rows.length) emit([], { text: '', cells: [] })
  let pendingRows: number[] = [], pending: Part = { text: '', cells: [] }
  const flush = (): void => { if (pendingRows.length) emit(pendingRows, pending); pendingRows = []; pending = { text: '', cells: [] } }
  for (const row of rows) {
    const body = serialize(rowCells.get(row)!.sort((a, b) => a.column - b.column), row)
    const headerSize = characters(header.text) < MAX_BLOCK_CHARACTERS ? characters(header.text) + 1 : 0
    if (pendingRows.length && characters(pending.text) + 1 + characters(body.text) + headerSize > MAX_BLOCK_CHARACTERS) flush()
    const offset = characters(pending.text) + (pending.text ? 1 : 0)
    pending.text += (pending.text ? '\n' : '') + body.text
    pending.cells.push(...body.cells.map((cell) => ({ ...cell, textStart: cell.textStart + offset, textEnd: cell.textEnd + offset })))
    pendingRows.push(row)
    if (characters(pending.text) + headerSize > MAX_BLOCK_CHARACTERS) flush()
  }
  flush()
  if (!rows.length) emit([], { text: '', cells: [] })
  return result
}


export function documentSections(document: NormalizedDocument): DocumentSection[] {
  validateDocument(document)
  const result: DocumentSection[] = []
  const nodes = new Map(document.nodes.map((node) => [node.id, node]))
  const paths = new Map<string, string[]>()
  let currentNode = '', blocks: DocumentBlock[] = [], run = 0
  const flush = (): void => {
    if (!blocks.length) return
    const title = nodes.get(currentNode)!.title
    const sections = chapterSections(currentNode, title, blocks, result.length)
    for (const section of sections) section.id = `${currentNode}-r${run}-s${section.order}`
    result.push(...sections); blocks = []; run++
  }
  for (const unit of document.units) {
    if (currentNode !== unit.nodeId) { flush(); currentNode = unit.nodeId }
    let path = paths.get(unit.nodeId)
    if (!path) { path = headingPath(nodes, unit.nodeId); paths.set(unit.nodeId, path) }
    const parts = unit.table ? tableBlocks(unit) : paragraphSlices(unit.text).map((part, index): DocumentBlock => {
      const sources = sliceSources(unit, part.start, part.end)
      return { id: `${unit.id}-b${index}`, kind: unit.kind, text: part.text, anchor: sources[0]?.anchor ?? unit.sources[0].anchor,
        sources, unitId: unit.id, nodeId: unit.nodeId, unitRange: { start: part.start, end: part.end }, searchable: unit.searchable }
    })
    blocks.push(...parts.map((block) => ({ ...block, headingPath: path, chapterTitle: nodes.get(unit.nodeId)!.title, chapterId: unit.nodeId })))
  }
  flush()
  if (!result.length || result.length > MAX_BOOK_SECTIONS) throw new Error('文档分节数量无效。')
  return result
}

/** Keep archive provenance consistent when a protected source is shortened by the input budget. */
export function cropPassage(passage: Passage, text: string): Passage {
  if (text === passage.text) return passage
  const length = characters(text)
  const sources = passage.sources?.filter((source) => source.textStart === undefined || source.textStart < length).map((source) => {
    const match = /^txt:(\d+):(\d+)$/u.exec(source.anchor)
    return { ...clipSourceText(source, 0, length), ...(match ? { anchor: `txt:${match[1]}:${Number(match[1]) + length}`, end: Number(match[1]) + length } : {}) }
  })
  const cells = passage.tableSlice?.cells.filter((cell) => cell.textStart < length)
    .map((cell) => ({ ...cell, end: Math.min(cell.end, cell.start + length - cell.textStart), textEnd: Math.min(cell.textEnd, length) }))
  return { ...passage, text, ...(sources ? { sources, anchor: sources[0]?.anchor ?? passage.anchor } : {}),
    ...(passage.unitRange ? { unitRange: { ...passage.unitRange, end: passage.unitRange.start + length } } : {}),
    ...(passage.tableSlice && cells ? { tableSlice: { rows: cells.every((cell) => cell.rows !== undefined)
      ? [...new Set(cells.flatMap((cell) => cell.rows ?? []))] : passage.tableSlice.rows, cells } } : {}) }
}
