import { expect, it } from 'vitest'
import { runDocumentStructureEvaluation } from '../../scripts/document-structure-eval-runner'

it('keeps the original 24 questions and passes 24 structural questions by actual text and location under both budgets', async () => {
  const report = await runDocumentStructureEvaluation()
  expect(report.totals).toEqual([
    { group: 'retained-24', questions: 24, expected: 28, finalHits: 28, reducedHits: 28, noAnswer: 4 },
    { group: 'structure-24', questions: 24, expected: 26, finalHits: 26, reducedHits: 26, noAnswer: 2 }
  ])
  expect(report.results.every((row) => row.sourcePositionsValid)).toBe(true)
  expect(report.results.filter((row) => row.unsupportedFactAbsent !== null).every((row) => row.unsupportedFactAbsent)).toBe(true)
  for (const row of report.results.filter((item) => item.group === 'structure-24')) {
    expect(row.coverage.covered).toBe(0)
    expect(row.normal.every((passage, index) => passage.id === `P${index + 1}`)).toBe(true)
    expect(row.reduced.every((passage, index) => passage.id === `P${index + 1}`)).toBe(true)
    if (row.id === 'S24') expect(row.normal.filter((passage) => passage.tableSlice).every((passage) => passage.sources?.every((source) => source.precision === 'table'))).toBe(true)
  }
}, 20_000)
