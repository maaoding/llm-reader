/* global process, console */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({ options: { profile: { type: 'string', default: 'all' }, 'report-dir': { type: 'string' } } })
if (!['quick', 'many-files', 'large-files', 'all'].includes(values.profile)) throw new Error('Use --profile quick, many-files, large-files or all')
let output
if (values['report-dir']) {
  output = resolve(values['report-dir'])
  await mkdir(dirname(output), { recursive: true })
  await mkdir(output) // Do not overwrite an earlier report.
} else {
  await mkdir(join(root, 'output'), { recursive: true })
  output = await mkdtemp(join(root, 'output/backup-stress-'))
}
const inputs = ['package.json', 'pnpm-lock.yaml', 'scripts/backup-stress.mjs', 'scripts/backup-stress-runner.ts',
  'src/main/database.ts', 'src/main/library-storage.ts', 'src/main/library-backup-files.ts', 'src/main/errors.ts',
  'src/shared/contracts.ts', 'src/shared/library-preferences.ts', 'src/shared/copy.ts', 'src/shared/copy.md', 'src/shared/copy.en.md']
async function fingerprint() {
  const hash = createHash('sha256')
  for (const input of inputs) hash.update(`${input}\0${createHash('sha256').update(await readFile(join(root, input))).digest('hex')}\n`)
  return hash.digest('hex')
}
const report = { schemaVersion: 1, fixture: 'backup-stress-v1', status: 'running', platform: process.platform,
  node: process.version, startedAt: new Date().toISOString(), sourceSha256: await fingerprint(), sourceInputs: inputs,
  nativeWindowsInstallerVerified: false, cases: [] }
let server
try {
  server = await createServer({ root, configFile: false, optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null }, resolve: { alias: { '@shared': join(root, 'src/shared') } } })
  const { runBackupStress } = await server.ssrLoadModule('/scripts/backup-stress-runner.ts')
  for (const profile of values.profile === 'all' ? ['many-files', 'large-files'] : [values.profile]) {
    console.log(`Running disposable backup stress profile: ${profile}`)
    const result = await runBackupStress(profile)
    report.cases.push(result)
    console.log(JSON.stringify({ profile, passed: result.passed, measurements: result.measurements, disk: result.disk }))
  }
  if (report.sourceSha256 !== await fingerprint()) throw new Error('Inputs changed during backup stress validation')
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.error = error instanceof Error ? error.message : String(error)
  process.exitCode = 1
} finally { await server?.close() }
report.finishedAt = new Date().toISOString()
await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
const mib = (bytes) => (bytes / 1024 ** 2).toFixed(1)
const lines = ['# 备份恢复存储压力检查', '', `状态：${report.status}；环境：${report.platform} / ${report.node}`, '',
  `输入摘要：${report.sourceSha256}`, '',
  '固定合成 TXT 和会话草稿；直接生成隔离书库，不读取日常资料、不调用外部服务。临时书库在每组结束后清理。', '',
  '| 样本 | 书籍 | 原文 MiB | 备份 ms | 预览 ms | 恢复 ms | 启动校验 ms |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...report.cases.map(row => `| ${row.profile} | ${row.books} | ${mib(row.filePayloadBytes)} | ${row.measurements.map(m => m.elapsedMs).join(' | ')} |`), '',
  '| 样本 | 原书库 MiB | 备份 MiB | 恢复后总占用 MiB | 进程采样最高 RSS MiB |', '| --- | ---: | ---: | ---: | ---: |',
  ...report.cases.map(row => `| ${row.profile} | ${mib(row.disk.originalBytes)} | ${mib(row.disk.backupBytes)} | ${mib(row.disk.afterRestoreBytes)} | ${mib(Math.max(...row.measurements.map(m => m.sampledPeakRss)))} |`), '',
  '耗时是本机单次观察，受文件缓存、磁盘与数据库大小影响；不是速度承诺。恢复包含来源重验、复制与副本校验，启动校验单列。目录占用是各检查点的逻辑文件大小，恢复后总占用包含原书库、备份及恢复副本，不代表瞬时磁盘峰值；RSS 为每 20ms 采样的整个 Node 进程占用，包含数据库和测试加载器，同步操作中的瞬间峰值可能未捕获。', '',
  '结果只覆盖存储层，不包括导入解析、界面响应、操作系统自动重启、原生 Windows 安装升级或断电耐久性。写盘故障注入另见 tests/unit/backend-library-backup.test.ts。', '',
  ...(report.error ? [`失败：${report.error}`, ''] : [])]
await writeFile(join(output, 'report.md'), lines.join('\n'))
console.log(JSON.stringify({ status: report.status, report: join(output, 'report.md') }))
