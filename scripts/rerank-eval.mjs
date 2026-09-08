/* global process */
import { createServer } from 'vite'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const live = process.argv.includes('--live')
const apiKey = process.env.LLM_READER_RERANK_API_KEY
if (live && !apiKey) throw new Error('真实评测需要通过 LLM_READER_RERANK_API_KEY 提供已获授权的凭据。')
const server = await createServer({ configFile: false, server: { middlewareMode: true }, resolve: { alias: { '@shared': resolve('src/shared') } } })
try {
  const { runRerankEvaluation } = await server.ssrLoadModule('/scripts/rerank-eval-runner.ts')
  const report = await runRerankEvaluation({ live, apiKey: live ? apiKey : undefined, baseUrl: process.env.LLM_READER_RERANK_BASE_URL, model: process.env.LLM_READER_RERANK_MODEL })
  const output = resolve('output/rerank-evaluation')
  await mkdir(output, { recursive: true })
  await writeFile(resolve(output, live ? 'real-results.json' : 'local-results.json'), JSON.stringify({ evaluatedAt: new Date().toISOString(), ...report }, null, 2), 'utf8')
  const totals = ['current', 'expanded', 'reranked'].map((group) => {
    const measured = report.results.filter((item) => item.group === group && item.metrics)
    const sum = (name) => measured.reduce((count, row) => count + row.metrics[name].length, 0)
    return { group, questions: measured.length, expected: measured.reduce((count, row) => count + row.metrics.expected, 0),
      candidateHits: sum('candidateHits'), finalHits: sum('finalHits'), reducedHits: sum('reducedHits'),
      chapters: sum('coveredChapters'), reducedChapters: sum('reducedChapters'), expectedChapters: sum('expectedChapters') }
  })
  process.stdout.write(`${JSON.stringify({ questions: report.questions, characters: report.characters, realRerankVerified: report.realRerankVerified, totals }, null, 2)}\n`)
} finally { await server.close() }
