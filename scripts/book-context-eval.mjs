/* global document, MouseEvent, process, setTimeout, window */
import { _electron as electron, expect } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { copyEvaluationProfile, evaluationSourceDirectory, readEvaluationProfile } from './real-provider-profile.mjs'
import { evaluationCases, evidence, fixtureText, fixtureVersion, measureAnswer, selectionQuote } from './book-context-fixture.mjs'

const run = process.argv.includes('--run')
const sourceDirectory = evaluationSourceDirectory()
const requestedProfileId = process.env.LLM_READER_REAL_API_PROFILE_ID
const { profile } = readEvaluationProfile(sourceDirectory, requestedProfileId)
const description = { model: profile.model, fixtureVersion, characters: Array.from(fixtureText).length, questions: evaluationCases.length,
  scope: '自建三章 TXT；原有局部上下文与全书增强各回答一次；不带历史；分析与问答使用同一固定配置' }
process.stdout.write(`${JSON.stringify(description, null, 2)}\n`)
if (!run) {
  process.stdout.write('仅检查条件，没有调用模型。使用 --run 执行真实接口评测并消耗所选模型额度。\n')
  process.exit(0)
}

const testRoot = await mkdtemp(join(tmpdir(), 'llm-reader-book-eval-'))
if (dirname(testRoot) !== resolve(tmpdir())) throw new Error('评测临时目录边界无效。')
const userData = join(testRoot, 'profile')
const fixturePath = join(testRoot, '分证判断评测样本.txt')
const reportDirectory = resolve('tmp', `book-context-eval-${Date.now()}`)
const report = { ...description, startedAt: new Date().toISOString(), fixtureSha256: createHash('sha256').update(fixtureText).digest('hex'),
  evidence, cases: evaluationCases, results: [], status: 'running', manualReviewRequired: true }
let application
let page

async function launch(importPath = '') {
  const executablePath = process.env.LLM_READER_E2E_EXECUTABLE
  application = await electron.launch({ ...(executablePath ? { executablePath } : {}), args: executablePath ? [] : ['.'],
    env: { ...process.env, LLM_READER_USER_DATA: userData, LLM_READER_E2E_IMPORT: importPath, LLM_READER_UPDATER_DISABLED: '1' } })
  page = await application.firstWindow()
  await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 30_000 })
}

async function beginCapture(requestId) {
  await page.evaluate((targetId) => {
    const capture = { targetId, answer: '', context: null, usage: null, done: false, model: null, error: null }
    window.__readerEvaluation = capture
    const unsubscribe = window.readerApi.onLlmEvent((event) => {
      capture.targetId ??= event.requestId
      if (capture.targetId !== event.requestId) return
      if (event.type === 'context') { capture.context = event.context; capture.answer = '' }
      if (event.type === 'delta') capture.answer += event.delta
      if (event.type === 'usage') capture.usage = event.usage
      if (event.type === 'completed') { capture.model = event.model; capture.done = true; unsubscribe() }
      if (event.type === 'error') { capture.error = event.code; capture.done = true; unsubscribe() }
    })
  }, requestId)
}

async function finishCapture(item, mode) {
  await page.waitForFunction(() => window.__readerEvaluation?.done, undefined, { timeout: 100_000 })
  const result = await page.evaluate(() => window.__readerEvaluation)
  const measured = { id: item.id, mode, ...result, metrics: measureAnswer(result, item) }
  report.results.push(measured)
  await saveReport()
  if (result.error || !result.answer.trim() || !result.context) throw new Error(`评测问答失败：${result.error ?? 'EMPTY_RESULT'}`)
  process.stdout.write(`${mode} / ${item.category}：取得 ${measured.metrics.retrievedEvidence.length}/${item.expected.length} 处关键原文，未知引用 ${measured.metrics.unknownCitations.length} 个。\n`)
  return result
}

async function ask(item, mode, bookId, selection) {
  const requestId = `eval-${mode}-${item.id}`
  await beginCapture(requestId)
  await page.evaluate((request) => window.readerApi.startLlm(request), {
    requestId, conversationId: randomUUID(), action: 'ask', question: item.question, history: [],
    ...(mode === 'enhanced' && item.scope === 'book' ? { scope: 'book', bookId } : { scope: 'selection', selection })
  })
  return finishCapture(item, mode)
}

async function saveReport() {
  await mkdir(reportDirectory, { recursive: true })
  await writeFile(join(reportDirectory, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
  const lines = ['# 全书上下文真实模型对照', '', `模型：${report.model}；样本版本：${fixtureVersion}；状态：${report.status}`, '',
    '原文召回与引用编号由程序检查；回答结论是否被原文支持、是否正确说明无答案，需要人工逐项复核。', '',
    '| 问题 | 模式 | 关键原文 | 被引用的关键原文 | 未知引用 |', '| --- | --- | --- | --- | --- |']
  for (const result of report.results) {
    const item = evaluationCases.find((candidate) => candidate.id === result.id)
    lines.push(`| ${item.category} | ${result.mode} | ${result.metrics.retrievedEvidence.length}/${item.expected.length} | ${result.metrics.citedEvidence.length}/${item.expected.length} | ${result.metrics.unknownCitations.length} |`)
  }
  for (const result of report.results) {
    lines.push('', `## ${result.id} / ${result.mode}`, '', evaluationCases.find((item) => item.id === result.id).question, '', result.answer,
      '', `用量：${result.usage ? JSON.stringify(result.usage) : '接口未返回'}；笔记覆盖：${JSON.stringify(result.context?.coverage ?? null)}`, '', '本轮原文：', '')
    for (const passage of result.context?.passages ?? []) lines.push(`[${passage.id}] ${passage.chapterTitle ?? ''} ${passage.text}`, '')
  }
  await writeFile(join(reportDirectory, 'report.md'), lines.join('\n'), 'utf8')
}

try {
  await writeFile(fixturePath, fixtureText, 'utf8')
  await launch()
  await application.close()
  application = undefined
  await copyEvaluationProfile(sourceDirectory, userData, profile.id)
  await launch(fixturePath)
  await expect(page.getByTestId('book-item').first()).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('book-item').first().click()
  const bookId = await page.evaluate(async () => (await window.readerApi.listBooks())[0].id)
  // The first baseline question obtains the actual reader selection and its original 6,000-character chapter window.
  const paragraph = page.locator('.reader-document--txt p').filter({ hasText: selectionQuote })
  await paragraph.scrollIntoViewIfNeeded()
  await paragraph.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  await expect(page.getByTestId('selection-toolbar')).toBeVisible()
  await page.getByTestId('action-ask').click()
  await beginCapture(null)
  await page.getByTestId('followup-input').fill(evaluationCases[0].question)
  await page.getByTestId('followup-input').press('Enter')
  const first = await finishCapture(evaluationCases[0], 'baseline')
  const selection = first.context.selection
  for (const item of evaluationCases.slice(1)) await ask(item, 'baseline', bookId, selection)

  await page.evaluate((bookId) => window.readerApi.prepareBookDocument({ bookId }), bookId)
  await expect.poll(() => page.evaluate((bookId) => window.readerApi.getBookAnalysis(bookId).then((state) => state.document?.status), bookId), { timeout: 120_000 }).toBe('ready')
  await page.evaluate((input) => window.readerApi.startBookAnalysis(input), { bookId, profileId: profile.id })
  let lastCompleted = -1
  const deadline = Date.now() + 15 * 60_000
  while (true) {
    const state = await page.evaluate((id) => window.readerApi.getBookAnalysis(id), bookId)
    report.analysis = state
    if (state.completedSections !== lastCompleted) {
      process.stdout.write(`分析进度：${state.completedSections}/${state.sections}\n`)
      lastCompleted = state.completedSections
    }
    if (state.status === 'ready') break
    if (state.status === 'error' || state.status === 'paused') throw new Error('分析未完成；评测已停止，详见隔离测试中的进度。')
    if (Date.now() > deadline) { await page.evaluate((id) => window.readerApi.cancelBookAnalysis(id), bookId); throw new Error('分析评测超时，已取消。') }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000))
  }
  for (const item of evaluationCases) await ask(item, 'enhanced', bookId, selection)
  report.status = 'completed'
} catch (error) {
  report.status = 'failed'
  report.failure = error instanceof Error && error.message.startsWith('评测问答失败：') ? error.message : '评测中断；已保留完成的结果，未自动重试。'
  process.stderr.write(`${report.failure}\n`)
  process.exitCode = 1
} finally {
  try {
    report.finishedAt = new Date().toISOString()
    await saveReport()
    process.stdout.write(`评测记录：${join(reportDirectory, 'report.md')}\n`)
  } finally {
    try { await application?.close() } finally { await rm(testRoot, { recursive: true, force: true }) }
  }
}
