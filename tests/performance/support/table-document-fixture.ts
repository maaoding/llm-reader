import type { NormalizedDocument, SourceRange, TableCell } from '../../../src/shared/contracts'

export type TableFixture = 'small' | 'dense-rows' | 'repeated-header' | 'oversized-header' | 'merged-rows' | 'long-row'

/** Prepared provider output; excludes document-service parsing from section benchmarks. */
export function tableDocumentFixture(kind: TableFixture): NormalizedDocument {
  const count = kind === 'small' ? 4 : kind === 'dense-rows' ? 800 : kind === 'long-row' ? 4 : 400
  const cells: TableCell[] = []
  const source = (page: number): SourceRange => ({ page, anchor: `pdfpos:${page}:0`, precision: 'text' })
  const add = (row: number, column: number, text: string, header = false, rowSpan = 1, columnSpan = 1) => {
    cells.push({ id: `cell-${row}-${column}`, row, column, rowSpan, columnSpan, header, text,
      sources: [{ ...source(row > count / 2 ? 2 : 1), textStart: 0, textEnd: Array.from(text).length }] })
  }
  add(0, 0, kind === 'repeated-header' ? '题😀'.repeat(800) : kind === 'oversized-header' ? '题😀'.repeat(1_000) : '名称', true)
  add(0, 1, '规则', true)
  if (kind === 'merged-rows') {
    add(1, 0, '甲😀𠮷 é，适用条件。'.repeat(30), false, count)
    for (let row = 1; row <= count; row++) add(row, 1, `规则 ${row}。`)
  } else {
    for (let row = 1; row <= count; row++) {
      add(row, 0, kind === 'dense-rows' ? '甲' : `行 ${row}`)
      add(row, 1, kind === 'long-row' && row === 1 ? '😀𠮷 é，需核对条件。'.repeat(1_000) : kind === 'dense-rows' ? '乙😀' : '规则成立。')
    }
  }
  return { version: 2, pageCount: 2, nodes: [{ id: 'chapter', title: '结构化表格', parentId: null, level: 1, order: 0, anchor: 'pdfpos:1:0', kind: 'section' }],
    units: [{ id: 'table', nodeId: 'chapter', order: 0, kind: 'table', text: cells.map((cell) => cell.text).join('\n'),
      sources: [{ ...source(1), precision: 'table' }, { ...source(2), precision: 'table' }], relatedIds: [], searchable: true,
      table: { rows: count + 1, columns: 2, cells, captionIds: [], noteIds: [] } }], diagnostics: [] }
}
