/* global process */
import { createServer } from 'vite'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, resolve: { alias: { '@shared': resolve('src/shared') } } })
try {
  const { runDocumentStructureEvaluation } = await server.ssrLoadModule('/scripts/document-structure-eval-runner.ts')
  const report = await runDocumentStructureEvaluation()
  const directory = resolve('output/document-structure-validation')
  await mkdir(directory, { recursive: true })
  await writeFile(resolve(directory, 'structure-evaluation.json'), JSON.stringify({ evaluatedAt: new Date().toISOString(), ...report }, null, 2), 'utf8')
  process.stdout.write(JSON.stringify(report.totals, null, 2) + '\n')
} finally { await server.close() }
