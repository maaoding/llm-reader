/* global process */
import { createServer } from 'vite'
import { resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { createEvaluationSession } from './knowledge-eval-session.mjs'

const label = process.argv[2] ?? 'baseline'
if (!/^[a-z-]+$/u.test(label)) throw new Error('Invalid evaluation label')
const session = await createEvaluationSession()
const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, resolve: { alias: { '@shared': resolve('src/shared') } } })
try {
  const { runHardEvaluation } = await server.ssrLoadModule('/scripts/knowledge-hard-runner.ts')
  const result = await runHardEvaluation({ directory: resolve('output/knowledge-hard-20260909'), label, fetcher: session.fetcher, log: (text) => process.stdout.write(text + '\n') })
  process.stdout.write(JSON.stringify(result) + '\n')
} finally {
  await writeFile(resolve('output/knowledge-hard-20260909', label + '-network.json'), JSON.stringify(session.trace, null, 2), 'utf8')
  await server.close(); await session.close()
}
