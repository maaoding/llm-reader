import { createHash } from 'node:crypto'
import type { runRerankEvaluation } from './rerank-eval-runner'
import type { runDocumentStructureEvaluation } from './document-structure-eval-runner'
import { createRerankFixture, evaluationCases, fixtureVersion } from './rerank-fixture'
import { structureDoclingFixture, structureQuestions } from './document-structure-fixture'

type RetrievalReport = Awaited<ReturnType<typeof runRerankEvaluation>>
type StructureReport = Awaited<ReturnType<typeof runDocumentStructureEvaluation>>
export interface EvaluationFailure { group: string; id: string; check: string }

export const offlineBaseline = {
  id: 'offline-retrieval-v1',
  // Changing a frozen fixture requires a reviewed baseline revision, not a new score under the old name.
  fixtureSha256: '55c4eb14b9a84f916aaea6ad07bf2648f49a84f0f73be064c9aebd1f459bbf7e'
}

export function offlineFixtureSha256(): string {
  return createHash('sha256').update(JSON.stringify({
    retrieval: { version: fixtureVersion, sections: createRerankFixture(), questions: evaluationCases },
    structure: { document: structureDoclingFixture(), questions: structureQuestions }
  })).digest('hex')
}

export function assessOfflineEvaluation(retrieval: RetrievalReport, structure: StructureReport) {
  const failures: EvaluationFailure[] = []
  const check = (valid: boolean, group: string, id: string, name: string) => {
    if (!valid) failures.push({ group, id, check: name })
  }
  const sameMembers = (actual: string[], expected: string[]) => actual.length === expected.length &&
    new Set(actual).size === actual.length && expected.every((id) => actual.includes(id))
  const checkCases = (actual: { group: string; id: string }[], group: string, ids: string[]) => {
    const rows = actual.filter((row) => row.group === group)
    check(sameMembers(rows.map((row) => row.id), ids), group, '*', 'complete-unique-cases')
  }

  check(offlineFixtureSha256() === offlineBaseline.fixtureSha256, 'fixtures', '*', 'frozen-fixture-hash')
  check(retrieval.realRerankVerified === false, 'retrieval', '*', 'real-service-unverified')
  check(structure.realServiceVerified === false, 'structure', '*', 'real-service-unverified')
  check(retrieval.questions === evaluationCases.length, 'retrieval', '*', 'question-count')
  check(retrieval.results.every((row) => ['current', 'expanded', 'reranked'].includes(row.group)), 'retrieval', '*', 'known-groups')
  check(structure.results.every((row) => ['retained-24', 'structure-24'].includes(row.group)), 'structure', '*', 'known-groups')

  const retrievalSummary = []
  for (const group of ['current', 'expanded', 'reranked'] as const) {
    checkCases(retrieval.results, group, evaluationCases.map((item) => item.id))
    const rows = retrieval.results.filter((row) => row.group === group)
    for (const row of rows) {
      const item = evaluationCases.find((item) => item.id === row.id)
      if (!item) continue
      if (group === 'reranked') {
        check(row.status === 'unverified' && row.metrics === null, group, row.id, 'real-rerank-not-run')
        continue
      }
      check(row.status === 'measured' && row.metrics !== null, group, row.id, 'measurement-completed')
      if (!row.metrics) continue
      check(row.metrics.expected === item.expected.length, group, row.id, 'expected-evidence-count')
      for (const key of ['candidateHits', 'finalHits', 'reducedHits'] as const) {
        check(sameMembers(row.metrics[key], item.expected), group, row.id, key)
      }
      for (const key of ['expectedChapters', 'coveredChapters', 'reducedChapters'] as const) {
        check(sameMembers(row.metrics[key], item.chapters), group, row.id, key)
      }
      if (group === 'expanded') {
        check(row.metrics.finalCount <= 12, group, row.id, 'final-passage-limit')
        check(row.metrics.candidateCount <= 60, group, row.id, 'candidate-limit')
      }
    }
    if (group !== 'reranked') retrievalSummary.push({ group, questions: rows.length,
      expected: evaluationCases.reduce((sum, item) => sum + item.expected.length, 0),
      finalHits: rows.reduce((sum, row) => sum + (row.metrics?.finalHits.length ?? 0), 0),
      reducedHits: rows.reduce((sum, row) => sum + (row.metrics?.reducedHits.length ?? 0), 0) })
  }

  const structureSummary = []
  for (const group of ['retained-24', 'structure-24']) {
    const cases = group === 'retained-24' ? evaluationCases : structureQuestions
    checkCases(structure.results, group, cases.map((item) => item.id))
    const rows = structure.results.filter((row) => row.group === group)
    for (const row of rows) {
      const item = cases.find((item) => item.id === row.id)
      if (!item) continue
      const expected = item.expected.length
      check(row.expected === expected, group, row.id, 'expected-evidence-count')
      check(row.finalHits === expected, group, row.id, 'finalHits')
      check(row.reducedHits === expected, group, row.id, 'reducedHits')
      check(row.noAnswer === (expected === 0), group, row.id, 'no-answer-case-classification')
      check(row.sourcePositionsValid, group, row.id, 'source-positions')
      if ('absent' in item && item.absent) check(row.unsupportedFactAbsent === true, group, row.id, 'unsupported-fact-absent')
      for (const key of ['normal', 'reduced'] as const) {
        check(row[key].every((passage, index) => passage.id === `P${index + 1}`), group, row.id, `${key}-citation-ids`)
      }
    }
    structureSummary.push({ group, questions: rows.length,
      expected: cases.reduce((sum, item) => sum + item.expected.length, 0),
      finalHits: rows.reduce((sum, row) => sum + row.finalHits, 0),
      reducedHits: rows.reduce((sum, row) => sum + row.reducedHits, 0) })
  }
  return { status: failures.length ? 'failed' as const : 'passed' as const, failures,
    summary: [...retrievalSummary, ...structureSummary] }
}
