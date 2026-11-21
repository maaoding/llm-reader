/* global process, window */
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { copyEvaluationProfile, evaluationSourceDirectory, readEvaluationProfile } from './real-provider-profile.mjs'
import { evidence } from './book-context-fixture.mjs'

// The same self-authored evidence already used in the authorized book-context evaluation.
const text = ['第一章 分证判断', evidence.definition, evidence.threshold, '第二章 投票与例外', evidence.comparison, evidence.exception].join('\n\n')
const source = evaluationSourceDirectory()
const { profile } = readEvaluationProfile(source, process.env.LLM_READER_REAL_API_PROFILE_ID)
if (!process.argv.includes('--run')) {
  process.stdout.write(JSON.stringify({ ready: true, model: profile.model, questions: 2, characters: Array.from(text).length, notes: false }) + '\n')
  process.exit(0)
}
const root = await mkdtemp(join(tmpdir(), 'llm-reader-document-live-'))
if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('隔离目录边界无效。')
const userData = join(root, 'profile'), fixture = join(root, '自建分证判断.txt')
const output = resolve('output/document-structure-validation/live')
await mkdir(output, { recursive: true })
const report = { startedAt: new Date().toISOString(), model: profile.model, status: 'running', notesStarted: false,
  scope: '既有自建分证判断原文；准备后直接问答，不生成笔记。PDF、Embedding、重排未使用真实服务。', results: [] }
let application, page
async function launch(importPath = '') {
  const executablePath = process.env.LLM_READER_E2E_EXECUTABLE
  application = await electron.launch({ ...(executablePath ? { executablePath } : {}), args: executablePath ? [] : ['.'],
    env: { ...process.env, LLM_READER_USER_DATA: userData, LLM_READER_E2E_IMPORT: importPath, LLM_READER_UPDATER_DISABLED: '1' } })
  page = await application.firstWindow()
  await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 30_000 })
}
try {
  await writeFile(fixture, text, 'utf8')
  await launch(); await application.close(); application = undefined
  await copyEvaluationProfile(source, userData, profile.id)
  await launch(fixture)
  await page.getByTestId('book-item').click()
  const bookId = await page.evaluate(async () => (await window.readerApi.listBooks())[0].id)
  await page.getByTestId('analysis-details').locator('summary').first().click()
  await page.getByTestId('document-prepare').click()
  await expect(page.getByTestId('document-status')).toHaveText('原文可检索', { timeout: 30_000 })
  report.prepared = await page.evaluate((id) => window.readerApi.getBookAnalysis(id), bookId)
  if (report.prepared.status !== 'empty' || report.prepared.completedSections !== 0) throw new Error('笔记状态异常。')
  await page.getByTestId('analysis-details').locator('summary').first().click()
  await page.getByTestId('scope-book').click()
  for (const question of ['双证门槛的两个前提是什么？临时避险的例外是否可以免除事后复核？', '本书报告这种方法将错误率降低了百分之多少？']) {
    await page.evaluate(() => {
      const capture = { answer: '', context: null, usage: null, done: false, error: null }
      window.structureLive = capture
      const unsubscribe = window.readerApi.onLlmEvent((event) => {
        if (event.type === 'context') { capture.context = event.context; capture.answer = '' }
        if (event.type === 'delta') capture.answer += event.delta
        if (event.type === 'usage') capture.usage = event.usage
        if (event.type === 'completed') { capture.done = true; unsubscribe() }
        if (event.type === 'error') { capture.error = event.code; capture.done = true; unsubscribe() }
      })
    })
    // Exercise the same UI entry as a reader; the app owns its stable conversation ID.
    await page.getByTestId('followup-input').fill(question)
    await page.getByTestId('followup-input').press('Enter')
    await page.waitForFunction(() => window.structureLive?.done, undefined, { timeout: 150_000 })
    const result = await page.evaluate(() => window.structureLive)
    const ids = [...result.answer.matchAll(/\[(P\d+)\]/gu)].map((match) => match[1])
    const passages = result.context?.passages ?? []
    const points = Array.from(text)
    report.results.push({ question, ...result, validCitations: ids.filter((id) => passages.some((passage) => passage.id === id)).length,
      unknownCitations: ids.filter((id) => !passages.some((passage) => passage.id === id)),
      positionsMatchOriginal: passages.every((passage) => { const [, start, end] = passage.anchor.split(':').map(Number); return points.slice(start, end).join('') === passage.text }) })
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
    if (result.error || !result.answer || !result.context) throw new Error('真实问答未完成。')
    await page.screenshot({ path: join(output, `answer-${report.results.length}.png`) })
    process.stdout.write(JSON.stringify({ question: report.results.length, coverage: result.context.coverage,
      validCitations: report.results.at(-1).validCitations, unknownCitations: report.results.at(-1).unknownCitations.length }) + '\n')
  }
  report.status = 'completed'
} catch {
  report.status = 'failed'
  report.failure = '真实接口小样本未全部完成；仅保留已返回结果，没有自动重新调用。'
  process.exitCode = 1
} finally {
  report.finishedAt = new Date().toISOString()
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
  try { await application?.close() }
  finally { await rm(root, { recursive: true, force: true }) }
}
