/* global process */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({ options: { 'report-dir': { type: 'string' } } })
let output
if (values['report-dir']) {
  output = resolve(values['report-dir'])
  await mkdir(dirname(output), { recursive: true })
  await mkdir(output) // Preserve previous evidence; an existing report directory is an error.
} else {
  await mkdir(join(root, 'output'), { recursive: true })
  output = await mkdtemp(join(root, 'output/offline-evaluation-'))
}

async function sourceIdentity() {
  const inputs = ['package.json', 'pnpm-lock.yaml']
  for (const directory of ['src', 'scripts']) {
    for (const entry of await readdir(join(root, directory), { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && /\.(?:ts|tsx|mjs|md)$/u.test(entry.name)) {
        const path = join(entry.parentPath, entry.name).slice(root.length + 1).replaceAll('\\', '/')
        inputs.push(path)
      }
    }
  }
  inputs.sort()
  const hash = createHash('sha256')
  for (const path of inputs) {
    const digest = createHash('sha256').update(await readFile(join(root, path))).digest('hex')
    hash.update(`${path}\0${digest}\n`)
  }
  let commit = null, dirty = null
  try {
    const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    commit = git(['rev-parse', 'HEAD'])
    dirty = Boolean(git(['status', '--porcelain', '--untracked-files=normal']))
  } catch { /* Source archives still have a reproducible input fingerprint. */ }
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  return { version: metadata.version, node: process.version, commit, dirty, inputsSha256: hash.digest('hex'), inputs }
}

const startedAt = new Date().toISOString()
let server
let report
let source
try {
  source = await sourceIdentity()
  server = await createServer({ root, configFile: false, optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null }, resolve: { alias: { '@shared': join(root, 'src/shared') } } })
  const { runOfflineEvaluation } = await server.ssrLoadModule('/scripts/offline-eval-runner.ts')
  const result = await runOfflineEvaluation()
  const finalSource = await sourceIdentity()
  if (source.inputsSha256 !== finalSource.inputsSha256) {
    result.report.status = 'failed'
    result.report.failures.push({ group: 'source', id: '*', check: 'inputs-changed-during-evaluation' })
  }
  report = { ...result.report, source, startedAt, finishedAt: new Date().toISOString() }
  await writeFile(join(output, 'retrieval.json'), JSON.stringify(result.retrieval, null, 2) + '\n')
  await writeFile(join(output, 'document-structure.json'), JSON.stringify(result.structure, null, 2) + '\n')
} catch (error) {
  report = { schemaVersion: 1, mode: 'offline-retrieval', status: 'error', source, startedAt,
    finishedAt: new Date().toISOString(), realServiceVerified: false, answerQualityAssessed: false,
    error: error instanceof Error ? error.message : String(error) }
} finally {
  await server?.close()
}

await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
const lines = ['# 离线取材质量基线', '', `状态：${report.status}`, '',
  `版本：${report.source?.version ?? '未知'}；提交：${report.source?.commit ?? '未知'}；工作区有改动：${report.source?.dirty ?? '未知'}`, '',
  `输入摘要：${report.source?.inputsSha256 ?? '未取得'}`, `样本摘要：${report.fixtureSha256 ?? '未取得'}`, '',
  '固定合成样本；只评估取材、预算裁剪和来源位置。未调用真实模型、OCR、解析或重排服务，未评估回答语义正确性及无答案时的回答行为。', '',
  '| 组别 | 题数 | 预期证据 | 正常预算命中 | 缩减预算命中 |', '| --- | ---: | ---: | ---: | ---: |',
  ...(report.summary ?? []).map((row) => `| ${row.group} | ${row.questions} | ${row.expected} | ${row.finalHits} | ${row.reducedHits} |`), '',
  ...(report.failures ?? []).map((failure) => `- 失败：${failure.group}/${failure.id} — ${failure.check}`),
  ...(report.error ? [`错误：${report.error}`, ''] : []), '',
  '逐题实际证据与来源见 [检索报告](retrieval.json) 和 [结构报告](document-structure.json)。', '']
await writeFile(join(output, 'report.md'), lines.join('\n'))
process.stdout.write(JSON.stringify({ status: report.status, failures: report.failures ?? [], report: join(output, 'report.md') }, null, 2) + '\n')
if (report.status !== 'passed') process.exitCode = 1
