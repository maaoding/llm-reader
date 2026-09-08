import { describe, expect, it } from 'vitest'
import { createRerankFixture, evaluationCases } from '../../scripts/rerank-fixture'
import { runRerankEvaluation } from '../../scripts/rerank-eval-runner'
import { documentSectionSchema } from '../../src/main/schemas'

describe('fixed rerank quality evaluation', () => {
  it('has 24 grounded questions, valid local blocks, duplicate chapter titles and Unicode-safe source anchors', () => {
    const fixture = createRerankFixture(), blocks = fixture.flatMap((section) => section.blocks)
    expect(evaluationCases).toHaveLength(24)
    expect(new Set(evaluationCases.map((item) => item.id)).size).toBe(24)
    expect(evaluationCases.filter((item) => !item.expected.length)).toHaveLength(4)
    expect(fixture.every((section) => documentSectionSchema.safeParse(section).success)).toBe(true)
    expect(evaluationCases.every((item) => item.expected.every((id) => blocks.some((block) => block.id === id)))).toBe(true)
  })
  it('runs production retrieval/budget logic and leaves the real model group unverified without credentials', async () => {
    const report = await runRerankEvaluation()
    expect(report.results).toHaveLength(72)
    expect(report.results.filter((item) => item.group === 'reranked').every((item) => item.status === 'unverified' && item.metrics === null)).toBe(true)
    expect(report.realRerankVerified).toBe(false)
    expect(report.results.filter((item) => item.group === 'expanded').every((item) => item.metrics!.candidateCount <= 60 && item.metrics!.finalCount <= 12)).toBe(true)
  })
})
