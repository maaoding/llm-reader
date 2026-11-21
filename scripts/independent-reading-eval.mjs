/* global process, window, setTimeout, clearTimeout */
import { _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { schemaVersion, fixtureTitle, sources, questions, evidence, fixtureContract } from './independent-reading-fixture.mjs'
import { copyConfiguration, inspectConfiguration, measureIndependentAnswer, sha256, verifyFixtureFiles } from './independent-reading-evaluation.mjs'
import { createReadingSimulation } from './independent-reading-simulation.mjs'

function option(name) {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

const run = process.argv.includes('--run')
const offline = process.argv.includes('--offline')
const simulate = process.argv.includes('--simulate')
if ([run, offline, simulate].filter(Boolean).length > 1) throw new Error('Choose only one of --run, --offline or --simulate')
const fixtureDirectory = resolve(option('--fixtures') ?? 'tmp/independent-reading-fixtures')
const sourceDirectory = option('--source-user-data') ?? process.env.LLM_READER_REAL_API_SOURCE_USER_DATA ??
  (process.env.APPDATA ? join(process.env.APPDATA, 'llm-reader') : undefined)
const requestedProfile = option('--profile') ?? process.env.LLM_READER_REAL_API_PROFILE_ID
const output = resolve(option('--report-dir') ?? `output/independent-reading-${new Date().toISOString().replace(/[:.]/gu, '-')}`)
const inspection = simulate ? { ready: true, model: 'assistant-context-only-simulation', documentProcessor: 'fixture-docling', synthetic: true } : inspectConfiguration(sourceDirectory, requestedProfile)
const report = {
  schemaVersion, fixtureTitle, startedAt: new Date().toISOString(), status: 'checking', mode: simulate ? 'simulation' : run ? 'live' : offline ? 'offline-structure' : 'preflight',
  authored: true, personalContent: false, fixedBeforeModelCalls: true,
  fixtureSha256: sha256(JSON.stringify(fixtureContract)), questionsSha256: sha256(JSON.stringify(questions)),
  questions, expectedEvidence: evidence, configuration: inspection, preparations: [], results: [], blockedReasons: [],
  limits: [
    'Samples are newly authored synthetic material, not independently published books or a representative accuracy estimate.',
    'The report stores application requests and actual context snapshots; it does not capture authenticated HTTP headers.',
    'Evidence matching is exact after NFKC/whitespace normalization; OCR paraphrases need manual inspection.',
    'Valid citation IDs and expected strings do not establish semantic correctness. Manual fields remain null until reviewed.',
    'No chapter notes, embedding, rerank, search or previous-turn history are enabled; results describe this baseline only.',
    'The script checks source mappings, not every citation navigation gesture in the desktop UI.'
  ]
}
if (simulate) {
  report.liveCalls = 0
  report.limits.push('Planning and Docling/OCR responses are local simulations. Answers are written by a context-only assistant reader through the file queue. This is not a real model/provider/OCR quality result.',
    'Elapsed time includes waiting for the assistant reader. No token usage or billable provider latency is estimated.')
}

async function saveReport() {
  await mkdir(output, { recursive: true })
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
  const lines = ['# 独立阅读样本质量评测', '', `状态：${report.status}；模式：${report.mode}`, '',
    `固定样本 SHA-256：${report.fixtureSha256}`, `固定题目 SHA-256：${report.questionsSha256}`, '',
    '材料为新编合成样本；引用编号有效、字面命中与回答语义正确分别记录。', '',
    ...(simulate ? ['本轮使用本机模拟规划与 Docling/OCR，回答由仅看到实际 context 的助手逐题填写；耗时包含等待，未取得真实服务用量或性能数据。', ''] : []),
    ...(report.blockedReasons.length ? ['阻塞原因：' + report.blockedReasons.join('、'), ''] : []),
    '| 问题 | 运行结果 | 原文命中 | 已引用原文 | 未知引用 | 耗时 |', '| --- | --- | --- | --- | --- | --- |']
  for (const result of report.results) {
    lines.push(`| ${result.id} | ${result.error?.code ?? '生成完成，待语义复核'} | ${result.measurements.retrievedEvidence.length}/${result.measurements.expectedEvidence.length} | ${result.measurements.citedEvidence.length}/${result.measurements.expectedEvidence.length} | ${result.measurements.unknownCitations.length} | ${result.elapsedMs} ms |`)
  }
  for (const result of report.results) {
    lines.push('', `## ${result.id}`, '', result.request.question, '', result.answer || '没有取得完整回答。', '',
      `用量：${simulate ? '模拟模式，不提供计费 tokens' : result.usage ? JSON.stringify(result.usage) : '接口未返回'}；规划用量：${simulate ? '模拟模式，不提供计费 tokens' : result.context?.planningUsage ? JSON.stringify(result.context.planningUsage) : '接口未返回'}`, '',
      '人工复核：结论是否有原文支持；条件例外是否完整；无答案时是否恰当说明；跨书来源是否区分。', '', '本次实际参考原文：')
    for (const passage of result.context?.passages ?? []) lines.push('', `[${passage.id}] ${passage.bookTitle ?? ''} ${passage.chapterTitle ?? ''}`, passage.text, `定位：${passage.anchor}`)
  }
  lines.push('', '## 验证边界', '', ...report.limits.map((item) => '- ' + item), '')
  await writeFile(join(output, 'report.md'), lines.join('\n'), 'utf8')
}

let manifest
try {
  manifest = JSON.parse(await readFile(join(fixtureDirectory, 'manifest.json'), 'utf8'))
  if (manifest.fixtureSha256 !== report.fixtureSha256 || manifest.questionsSha256 !== report.questionsSha256) report.blockedReasons.push('FROZEN_FIXTURE_CONTRACT_MISMATCH')
  report.blockedReasons.push(...await verifyFixtureFiles(manifest, fixtureDirectory))
  report.files = manifest.files
} catch { report.blockedReasons.push('GENERATED_FIXTURES_MISSING_OR_INVALID') }
if (!inspection.ready && !offline) report.blockedReasons.push(...inspection.reasons)
if ((!run && !offline && !simulate) || report.blockedReasons.length) {
  report.status = report.blockedReasons.length ? 'blocked' : 'ready-not-run'
  report.liveCalls = 0
  report.finishedAt = new Date().toISOString()
  await saveReport()
  process.stdout.write(JSON.stringify({ status: report.status, questions: questions.length, blockedReasons: report.blockedReasons, report: join(output, 'report.md'), liveCalls: 0 }) + '\n')
  if ((run || offline || simulate) && report.blockedReasons.length) process.exitCode = 2
} else {
  const root = await mkdtemp(join(tmpdir(), 'llm-reader-independent-'))
  const userData = join(root, 'profile')
  const bookIds = {}
  let application
  let page
  let simulation
  const launch = async () => {
    const executablePath = process.env.LLM_READER_E2E_EXECUTABLE
    application = await electron.launch({ ...(executablePath ? { executablePath } : {}), args: executablePath ? [] : ['.'],
      env: { ...process.env, LLM_READER_USER_DATA: userData, LLM_READER_E2E_IMPORT: '', LLM_READER_UPDATER_DISABLED: '1' } })
    page = await application.firstWindow()
    await page.getByTestId('app-shell').waitFor({ state: 'visible', timeout: 30_000 })
  }
  try {
    report.status = 'running'
    report.stage = 'initialize-empty-profile'
    await saveReport()
    await launch()
    await application.close()
    application = undefined
    if (!offline && !simulate) await copyConfiguration(resolve(sourceDirectory), userData, inspection.profileId)
    report.stage = 'launch-isolated-profile'
    await launch()
    report.appInfo = await page.evaluate(() => window.readerApi.getAppInfo())
    if (simulate) {
      report.stage = 'simulation-listener'
      simulation = await createReadingSimulation({ output, files: manifest.files })
      report.simulation = simulation.trace
      if (process.platform === 'linux' && process.env.LLM_READER_E2E_BASIC_TEXT === '1') {
        report.stage = 'simulation-safe-storage'
        await application.evaluate(({ safeStorage }) => {
          if (safeStorage.getSelectedStorageBackend() !== 'basic_text') throw new Error('Expected isolated basic_text test backend')
          safeStorage.setUsePlainTextEncryption(true)
        })
      }
      report.stage = 'simulation-create-provider'
      await page.evaluate(async (endpoint) => {
        const overview = await window.readerApi.createProviderProfile({ name: '独立样本本机模拟', baseUrl: endpoint + '/v1',
          model: 'assistant-context-only-simulation', apiKey: 'synthetic-isolated-fixture-only', timeoutMs: 600_000, compatibility: 'auto' })
        const profile = overview.profiles.find((entry) => entry.model === 'assistant-context-only-simulation')
        if (!profile) throw new Error('Simulation profile missing')
        await window.readerApi.activateProviderProfile(profile.id)
      }, simulation.endpoint)
      report.stage = 'simulation-knowledge-settings'
      await page.evaluate(async (endpoint) => {
        await window.readerApi.saveKnowledgeSettings({ target: 'document',
          embedding: { enabled: false, baseUrl: '', model: '' },
          document: { enabled: true, processor: 'docling', baseUrl: endpoint, apiKey: 'synthetic-document-fixture-only', ocr: true, language: 'en' } })
      }, simulation.endpoint)
      await saveReport()
    }
    // Only the fixed files below are visible to the isolated import dialog.
    for (const source of sources) {
      report.stage = `import-${source.key}`
      const file = manifest.files.find((entry) => entry.key === source.key)
      if (!file) throw new Error('FIXTURE_FILE_NOT_DECLARED')
      await application.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, resolve(fixtureDirectory, file.path))
      const imported = await page.evaluate(() => window.readerApi.importBooks())
      const successful = imported?.items?.find((item) => item.status === 'imported' || item.status === 'duplicate')
      const books = await page.evaluate(() => window.readerApi.listBooks())
      const book = successful?.book ?? books.find((item) => item.originalName === source.filename)
      if (!book || (imported && imported.failed > 0)) throw new Error('FIXTURE_IMPORT_FAILED')
      bookIds[source.key] = book.id
      if (offline && source.kind === 'pdf') {
        report.preparations.push({ key: source.key, bookId: book.id, importConfirmed: true, preparation: 'not-run-no-pdf-service', qualityAssessed: false })
        await saveReport()
        continue
      }
      const started = Date.now()
      report.stage = `prepare-${source.key}`
      await page.evaluate((bookId) => window.readerApi.prepareBookDocument({ bookId }), book.id)
      let state
      while (Date.now() - started < 600_000) {
        state = await page.evaluate((bookId) => window.readerApi.getBookAnalysis(bookId), book.id)
        if (['ready', 'error', 'paused'].includes(state.document?.status)) break
        await delay(750)
      }
      const preparation = { key: source.key, bookId: book.id, elapsedMs: Date.now() - started, state, importConfirmed: Boolean(successful || book) }
      report.preparations.push(preparation)
      await saveReport()
      if (state?.document?.status !== 'ready') {
        await page.evaluate((bookId) => window.readerApi.cancelBookDocument(bookId), book.id)
        throw new Error('DOCUMENT_PREPARATION_INCOMPLETE')
      }
    }
    for (const item of offline ? [] : questions) {
      report.stage = `answer-${item.id}`
      simulation?.setCase(item.id)
      const request = { requestId: randomUUID(), conversationId: randomUUID(), action: 'ask', question: item.question, history: [], webSearch: 'off',
        ...(item.bookKeys.length > 1 ? { scope: 'books', bookIds: item.bookKeys.map((key) => bookIds[key]) } : { scope: 'book', bookId: bookIds[item.bookKeys[0]] }) }
      let workbench
      if (request.scope === 'books') workbench = await page.evaluate((bookIds) => window.readerApi.createWorkbench({ name: '固定独立样本对读', bookIds }), request.bookIds)
      const started = Date.now()
      const answer = await page.evaluate((request) => new Promise((resolveResult) => {
        const result = { answer: '', context: null, usage: null, model: null, error: null }
        let unsubscribe
        const finish = () => { clearTimeout(timer); unsubscribe?.(); resolveResult(result) }
        const timer = setTimeout(() => {
          result.error = { code: 'EVALUATION_TIMEOUT' }
          void window.readerApi.cancelLlm(request.requestId).catch(() => undefined)
          finish()
        }, 600_000)
        unsubscribe = window.readerApi.onLlmEvent((event) => {
          if (event.requestId !== request.requestId) return
          if (event.type === 'context') { result.context = event.context; result.answer = '' }
          if (event.type === 'delta') result.answer += event.delta
          if (event.type === 'usage') result.usage = event.usage
          if (event.type === 'completed') { result.model = event.model; finish() }
          if (event.type === 'error') { result.error = { code: event.code, retryable: event.retryable }; finish() }
        })
        window.readerApi.startLlm(request).catch(() => { result.error = { code: 'REQUEST_START_FAILED' }; finish() })
      }), request)
      const result = { id: item.id, request, ...(workbench ? { workbenchId: workbench.id } : {}), elapsedMs: Date.now() - started, ...answer,
        measurements: measureIndependentAnswer(answer, item, evidence, bookIds) }
      report.results.push(result)
      await saveReport()
      process.stdout.write(`${item.id}: ${answer.error?.code ?? 'generated-awaiting-review'}\n`)
    }
    report.bookIds = bookIds
    report.status = offline ? 'offline-fixtures-validated' : report.results.some((result) => result.error) ? 'incomplete' : simulate ? 'simulation-completed-awaiting-review' : 'completed-awaiting-review'
    if (report.status === 'incomplete') process.exitCode = 1
  } catch (error) {
    report.status = 'incomplete'
    report.failure = /^[A-Z_]+$/u.test(error?.message ?? '') ? error.message : 'EVALUATION_INTERRUPTED'
    if (simulate) {
      report.simulationFailure = { stage: report.stage, message: String(error?.message ?? error).slice(0, 4000), stack: String(error?.stack ?? '').slice(0, 12_000) }
      process.stderr.write(JSON.stringify(report.simulationFailure) + '\n')
    }
    process.exitCode = 1
  } finally {
    report.finishedAt = new Date().toISOString()
    if (offline || simulate) report.liveCalls = 0
    try { await saveReport() } finally {
      try { await application?.close() } finally {
        try { await simulation?.close() } finally { await rm(root, { recursive: true, force: true }) }
      }
    }
    process.stdout.write(`Report: ${join(output, 'report.md')}\n`)
  }
}
