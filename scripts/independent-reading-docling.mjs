/**
 * Local authored simulation of a Docling response. This does not parse a PDF or
 * perform OCR: every string comes from the frozen authored page descriptions.
 * Provenance is intentionally page/block level; no cell coordinates are guessed.
 */
export function buildSimulatedDoclingDocument(pdfPages) {
  const texts = [], tables = [], children = []
  const source = (page) => [{ page_no: page, bbox: { t: 0, coord_origin: 'TOPLEFT' } }]
  const addText = (text, page, label = 'text') => {
    const ref = '#/texts/' + texts.length
    texts.push({ self_ref: ref, label, text, prov: source(page), ...(label === 'section_header' ? { level: 1 } : {}) })
    children.push({ $ref: ref })
    return ref
  }
  for (const page of pdfPages) {
    addText(page.title, page.number, 'section_header')
    // The authored PDF lays out complete left and right columns in that order.
    for (const column of page.columns ?? []) for (const paragraph of column) addText(paragraph, page.number)
    let table
    if (page.table) {
      const ref = '#/tables/' + tables.length
      const rows = [page.table.header, ...page.table.rows]
      table = { self_ref: ref, label: 'table', prov: source(page.number), footnotes: [], data: {
        num_rows: rows.length, num_cols: page.table.header.length,
        table_cells: rows.flatMap((row, rowIndex) => row.map((text, columnIndex) => ({
          text, start_row_offset_idx: rowIndex, end_row_offset_idx: rowIndex + 1,
          start_col_offset_idx: columnIndex, end_col_offset_idx: columnIndex + 1,
          row_span: 1, col_span: 1, column_header: rowIndex === 0, row_header: false
        })))
      } }
      tables.push(table)
      children.push({ $ref: ref })
    }
    for (const paragraph of page.paragraphs ?? []) {
      const isFootnote = paragraph.startsWith('Footnote A:')
      const ref = addText(paragraph, page.number, isFootnote ? 'footnote' : 'text')
      if (isFootnote && table) table.footnotes.push({ $ref: ref })
    }
  }
  return { schema_name: 'DoclingDocument', version: '1.0.0', name: 'Authored local simulation; not OCR',
    pages: Object.fromEntries(pdfPages.map((page) => [String(page.number), { size: { width: 612, height: 792 } }])),
    texts, tables, groups: [], pictures: [], body: { children }, furniture: { children: [] }
  }
}
