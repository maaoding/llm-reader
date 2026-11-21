import { describe, expect, it } from 'vitest'
import { buildSimulatedDoclingDocument } from '../../scripts/independent-reading-docling.mjs'
import { evidence, pdfPages } from '../../scripts/independent-reading-fixture.mjs'
import { normalizeDoclingDocument } from '../../src/main/document-normalizer'
import { documentSections } from '../../src/shared/document-structure'

const normalizedText = (value: string) => value.replace(/\s+/gu, ' ').trim()

describe('independent reading local document simulation', () => {
  it('preserves table cells, linked footnote and all frozen PDF quotes through production normalization', () => {
    const document = normalizeDoclingDocument(buildSimulatedDoclingDocument(pdfPages), 4)
    const tables = document.units.filter((unit) => unit.kind === 'table')
    expect(tables).toHaveLength(2)
    expect(tables.map((unit) => [unit.table?.rows, unit.table?.columns, unit.sources.map((source) => source.page)])).toEqual([
      [2, 3, [2]], [2, 3, [3]]
    ])
    expect(tables[0].table?.cells.map((cell) => [cell.row, cell.column, cell.text, cell.header])).toEqual([
      [0, 0, 'Cultivar', true], [0, 1, 'Reserve packs', true], [0, 2, 'Bench window (days)', true],
      [1, 0, 'Amber sedge', false], [1, 1, '16', false], [1, 2, '5', false]
    ])
    const note = document.units.find((unit) => unit.kind === 'note')!
    expect(note.text).toBe(pdfPages[2].paragraphs[0])
    expect(tables[1].table?.noteIds).toEqual([note.id])
    expect(note.sources.map((source) => source.page)).toEqual([3])
    expect(note.relatedIds).toContain(tables[1].id)
    expect(document.diagnostics.filter((item) => ['table-degraded', 'missing-body', 'unlinked-note'].includes(item.code))).toEqual([])

    const blocks = documentSections(document).flatMap((section) => section.blocks)
    const expected = evidence.filter((item: { bookKey: string }) => item.bookKey === 'digital')
    expect(expected).toHaveLength(10)
    for (const item of expected) {
      const block = blocks.find((candidate) => normalizedText(candidate.text).includes(normalizedText(item.quote)))
      expect(block, item.id).toBeDefined()
      expect(block!.sources?.some((source) => source.page === item.page), item.id).toBe(true)
    }
  })

  it('keeps authored two-column reading order without altering the frozen source', () => {
    const before = JSON.stringify(pdfPages)
    const payload = buildSimulatedDoclingDocument(pdfPages)
    const document = normalizeDoclingDocument(payload, 4)
    const pageOne = document.units.filter((unit) => unit.sources.some((source) => source.page === 1))
    expect(pageOne.map((unit) => unit.text)).toEqual([pdfPages[0].title, ...pdfPages[0].columns.flat()])
    expect(JSON.stringify(pdfPages)).toBe(before)
    // The same authored structure may stand in for a scanned response only as a
    // simulation; its metadata explicitly avoids claiming an OCR result.
    expect(payload.name).toContain('not OCR')
  })
})
