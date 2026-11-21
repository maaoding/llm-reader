import { afterEach, expect, it, vi } from 'vitest'
import { documentSections, cropPassage } from '../../src/shared/document-structure'
import { previousDocumentSections } from '../performance/support/legacy-document-sections'
import { tableDocumentFixture, type TableFixture } from '../performance/support/table-document-fixture'

afterEach(() => vi.restoreAllMocks())

it.each<TableFixture>(['small', 'dense-rows', 'repeated-header', 'oversized-header', 'merged-rows', 'long-row'])('preserves complete sections, cell provenance and row order for %s', (kind) => {
  const document = tableDocumentFixture(kind), original = structuredClone(document)
  const before = previousDocumentSections(document), after = documentSections(document)
  expect(after).toEqual(before)
  expect(document).toEqual(original)
  const cells = new Map(document.units[0].table!.cells.map((cell) => [cell.id, Array.from(cell.text)]))
  for (const section of after) for (const full of section.blocks) {
    for (const block of [full, cropPassage(full, Array.from(full.text).slice(0, 137).join(''))]) {
      const text = Array.from(block.text)
      expect(text.length).toBeLessThanOrEqual(1_800)
      for (const range of block.tableSlice!.cells) {
        expect(text.slice(range.textStart, range.textEnd).join('')).toBe(cells.get(range.id)!.slice(range.start, range.end).join(''))
      }
      expect(block.tableSlice!.rows).toEqual([...new Set(block.tableSlice!.rows)].sort((a, b) => a - b))
    }
  }
})

it('preserves empty cells, missing cell sources, column gaps and surrogate boundaries between cells and rows', () => {
  const document = tableDocumentFixture('small'), table = document.units[0].table!
  for (const [index, cell] of table.cells.entries()) {
    cell.text = ['', '\uD800', '\uDC00', '😀', '𠮷 é'][index % 5]
    cell.column *= 2
    if (index % 2) cell.sources = undefined
    else cell.sources = cell.sources!.map((source) => ({ ...source, textEnd: Array.from(cell.text).length }))
  }
  table.columns = 3
  expect(documentSections(document)).toEqual(previousDocumentSections(document))
  table.cells = table.cells.filter((cell) => cell.header)
  expect(documentSections(document)).toEqual(previousDocumentSections(document))
})

it('retains rejection before excessive merged-cell and column-gap expansion', () => {
  for (const kind of ['merged-span', 'column-gap']) {
    const document = tableDocumentFixture('small'), table = document.units[0].table!
    table.cells = [table.cells[0]]
    table.cells[0].text = '甲'.repeat(500)
    if (kind === 'merged-span') {
      table.rows = table.cells[0].rowSpan = 1_000
      table.columns = table.cells[0].columnSpan = 100
    } else {
      table.cells[0].column = 40_000_000; table.columns = 40_000_001
    }
    expect(() => previousDocumentSections(document)).toThrow('表格展开超过处理上限')
    expect(() => documentSections(document)).toThrow('表格展开超过处理上限')
  }
})

it('avoids recounting repeated headers and scanning cell row lists for every output row', () => {
  const document = tableDocumentFixture('repeated-header')
  const points = vi.spyOn(String.prototype, 'codePointAt')
  const before = previousDocumentSections(document), beforePoints = points.mock.calls.length
  points.mockClear()
  const after = documentSections(document), afterPoints = points.mock.calls.length
  points.mockRestore()
  expect(after).toEqual(before)
  expect(afterPoints).toBeLessThan(beforePoints / 3)
  console.info(`Structured table repeated header: ${beforePoints} -> ${afterPoints} codePointAt calls; identical sections and sources.`)

  const dense = tableDocumentFixture('dense-rows')
  const includes = vi.spyOn(Array.prototype, 'includes')
  const expected = previousDocumentSections(dense), beforeRows = includes.mock.calls.length
  includes.mockClear()
  const actual = documentSections(dense), afterRows = includes.mock.calls.length
  includes.mockRestore()
  expect(actual).toEqual(expected)
  expect(beforeRows).toBeGreaterThan(100_000)
  expect(afterRows).toBe(0)
  console.info(`Structured table row membership: ${beforeRows} -> ${afterRows} Array.includes calls; identical contributing rows.`)
})
