import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { assessOfflineEvaluation } from '../../scripts/offline-eval-checks'
import { runOfflineEvaluation } from '../../scripts/offline-eval-runner'
import * as retrievalModule from '../../scripts/rerank-eval-runner'

type Result = Awaited<ReturnType<typeof runOfflineEvaluation>>
let baseline: Result
beforeAll(async () => { baseline = await runOfflineEvaluation() }, 20_000)
afterEach(() => { vi.restoreAllMocks() })

describe('offline retrieval acceptance', () => {
  it('passes the frozen cases with no external service or answer-quality claim', () => {
    expect(baseline.report).toMatchObject({ status: 'passed', failures: [], networkAttempts: 0,
      realServiceVerified: false, answerQualityAssessed: false })
    expect(baseline.report.summary.map((row) => [row.questions, row.expected, row.finalHits, row.reducedHits]))
      .toEqual([[24, 28, 28, 28], [24, 28, 28, 28], [24, 28, 28, 28], [24, 26, 26, 26]])
  })

  const mutations: [string, (result: Result) => void, string][] = [
    ['missing question', ({ retrieval }) => { retrieval.results.shift() }, 'complete-unique-cases'],
    ['duplicate question hiding a missing one', ({ retrieval }) => { retrieval.results[3] = retrieval.results[0] }, 'complete-unique-cases'],
    ['unexpected question', ({ retrieval }) => { retrieval.results[0].id = 'unknown' }, 'complete-unique-cases'],
    ['reduced-budget evidence loss', ({ retrieval }) => { retrieval.results[0].metrics!.reducedHits = [] }, 'reducedHits'],
    ['changed expected count hiding evidence loss', ({ retrieval }) => {
      retrieval.results[0].metrics!.expected = 0
      retrieval.results[0].metrics!.finalHits = []
    }, 'expected-evidence-count'],
    ['duplicate evidence inflating a score', ({ retrieval }) => {
      const metrics = retrieval.results[0].metrics!
      metrics.finalHits.push(metrics.finalHits[0])
    }, 'finalHits'],
    ['chapter coverage loss', ({ retrieval }) => { retrieval.results[0].metrics!.reducedChapters = [] }, 'reducedChapters'],
    ['retrieval fallback', ({ retrieval }) => { retrieval.results[0].status = 'fallback' }, 'measurement-completed'],
    ['claiming a real rerank was measured', ({ retrieval }) => { retrieval.results[2].status = 'measured' }, 'real-rerank-not-run'],
    ['structure evidence loss hidden by unchanged totals', ({ structure }) => { structure.results[0].reducedHits = 0 }, 'reducedHits'],
    ['incorrect source position', ({ structure }) => { structure.results[0].sourcePositionsValid = false }, 'source-positions'],
    ['missing absent-fact measurement', ({ structure }) => {
      structure.results.find((row) => row.id === 'S22')!.unsupportedFactAbsent = null
    }, 'unsupported-fact-absent'],
    ['incorrect citation ID', ({ structure }) => { structure.results[0].normal[0].id = 'P999' }, 'normal-citation-ids'],
    ['a measured report claiming real-service validation', ({ structure }) => { structure.realServiceVerified = true }, 'real-service-unverified']
  ]
  it.each(mutations)('rejects %s', (_name, mutate, expectedCheck) => {
    const changed = structuredClone(baseline)
    mutate(changed)
    const result = assessOfflineEvaluation(changed.retrieval, changed.structure)
    expect(result.status).toBe('failed')
    expect(result.failures.some((failure) => failure.check === expectedCheck)).toBe(true)
  })

  it('fails even if an accidental network attempt is caught by a service fallback', async () => {
    const previousFetch = globalThis.fetch
    vi.spyOn(retrievalModule, 'runRerankEvaluation').mockImplementation(async () => {
      await globalThis.fetch('https://must-not-send.invalid').catch(() => undefined)
      return baseline.retrieval
    })
    const result = await runOfflineEvaluation()
    expect(result.report).toMatchObject({ status: 'failed', networkAttempts: 1 })
    expect(result.report.failures).toContainEqual({ group: 'offline', id: '*', check: 'unexpected-network-attempt' })
    expect(globalThis.fetch).toBe(previousFetch)
  })

  it('restores fetch after an evaluator fails', async () => {
    const previousFetch = globalThis.fetch
    vi.spyOn(retrievalModule, 'runRerankEvaluation').mockRejectedValue(new Error('fixture failure'))
    await expect(runOfflineEvaluation()).rejects.toThrow('fixture failure')
    expect(globalThis.fetch).toBe(previousFetch)
  })

  it('writes attributable reports, rejects live flags and preserves an existing report', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'reader-offline-eval-test-'))
    const output = join(directory, 'report')
    const execute = promisify(execFile)
    const script = resolve('scripts/offline-eval.mjs')
    try {
      await execute(process.execPath, [script, '--report-dir', output], { timeout: 20_000 })
      const path = join(output, 'report.json')
      const contents = await readFile(path, 'utf8')
      const report = JSON.parse(contents)
      expect(report).toMatchObject({ status: 'passed', networkAttempts: 0, realServiceVerified: false })
      expect(report.source.inputsSha256).toMatch(/^[a-f\d]{64}$/u)
      expect(report.source.inputs).toContain('src/main/book-analysis.ts')
      expect(report.source.inputs).toContain('scripts/offline-eval-checks.ts')
      await expect(execute(process.execPath, [script, '--report-dir', output])).rejects.toMatchObject({ code: 1 })
      expect(await readFile(path, 'utf8')).toBe(contents)
      await expect(execute(process.execPath, [script, '--live'])).rejects.toMatchObject({ code: 1 })
      const retrieval = JSON.parse(await readFile(join(output, 'retrieval.json'), 'utf8'))
      expect(retrieval.results).toHaveLength(72)
    } finally { await rm(directory, { recursive: true, force: true }) }
  }, 30_000)
})
