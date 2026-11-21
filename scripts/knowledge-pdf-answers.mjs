/* global process, window */
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createEvaluationSession } from './knowledge-eval-session.mjs'

const label = process.argv[2] ?? 'baseline'
if (!/^[a-z-]+$/u.test(label)) throw new Error('Invalid evaluation label')
const session = await createEvaluationSession('tmp/knowledge-hard-pdf-20260909')
const { page } = session
const source = JSON.parse(await readFile('output/knowledge-hard-20260909/pdf-live.json', 'utf8'))
const path = resolve('output/knowledge-hard-20260909', `pdf-${label}-answers.json`)
const report = existsSync(path) ? JSON.parse(await readFile(path, 'utf8')) : { label, questions: [
  { id: 'P01', question: '表1蓝组普通样本与异常样本各保存多少天，复核阈值各是多少？', pages: [3], terms: ['31', '93', '0.72', '0.88'] },
  { id: 'P02', question: '跨页比较蓝组、青组的异常样本，保留期限差多少天，两个复核阈值是多少？', pages: [3, 4], terms: ['10', '0.88', '0.98'] },
  { id: 'P03', question: '蓝组异常样本93天到期但仍在申诉，可立即删除吗？最终何时处理？', pages: [3, 4], terms: ['结案', '3', '审批'] },
  { id: 'P04', question: '迁移镜像暂停时，脚注是否允许在线主库的复查计时一起暂停？', pages: [2], terms: ['不能'] },
  { id: 'P05', question: '置信余量的公式和全部计算前提是什么？分母为零如何登记？', pages: [5], terms: ['A', 'B', 'C', '不可计算'] },
  { id: 'P06', question: '白鹭站现行首次复查期限是12还是18小时？旧规和苍鹭站规则是否可替代？', pages: [1], terms: ['18', '废止'] },
  { id: 'P07', question: '本手册统计的事故率下降百分比是多少？', pages: [], terms: [] },
  { id: 'P08', question: '迁移失败后按什么顺序恢复？能用缓存覆盖原件吗？', pages: [6], terms: ['原索引', '校验和', '派生缓存'] }
], results: [] }
try {
  const failed = report.results.filter((item) => item.error)
  if (failed.length) {
    report.failedAttempts = [...(report.failedAttempts ?? []), ...failed]
    report.results = report.results.filter((item) => !item.error)
  }
  for (const variant of source.variants.filter((item) => item.ready)) {
    if (label !== 'baseline' && !report.results.some((item) => item.variant === variant.variant)) {
      // Rebuild from this authored document's cached cloud result; no new upload or OCR task is needed.
      const state = await page.evaluate((bookId) => window.readerApi.getBookAnalysis(bookId), variant.bookId)
      await page.evaluate((input) => window.readerApi.prepareBookDocument(input), { bookId: variant.bookId, rebuild: state.document?.status !== 'paused' })
      const deadline = Date.now() + 60_000
      while (true) {
        const state = await page.evaluate((bookId) => window.readerApi.getBookAnalysis(bookId), variant.bookId)
        if (state.document?.status === 'ready') break
        if (state.document?.status === 'error' || state.document?.status === 'paused' || Date.now() >= deadline) throw new Error('PDF preparation did not complete')
        await delay(200)
      }
    }
    for (const item of report.questions) {
      if (report.results.some((row) => row.variant === variant.variant && row.id === item.id)) continue
      const request = { bookId: variant.bookId, scope: 'book', action: 'ask', question: item.question + ' 请在150字内回答并引用原文。', history: [], requestId: randomUUID(), conversationId: randomUUID() }
      const started = Date.now()
      const answer = await page.evaluate(async (request) => new Promise((resolve, reject) => {
        const result = { answer: '', context: null, error: null, usage: null }
        const off = window.readerApi.onLlmEvent((event) => {
          if (event.requestId !== request.requestId) return
          if (event.type === 'context') { result.context = event.context; result.answer = '' }
          if (event.type === 'delta') result.answer += event.delta
          if (event.type === 'usage') result.usage = event.usage
          if (event.type === 'error') result.error = event.code
          if (event.type === 'completed' || event.type === 'error') { off(); resolve(result) }
        })
        window.readerApi.startLlm(request).catch((error) => { off(); reject(error) })
      }), request)
      const cited = [...answer.answer.matchAll(/\[(P\d+)\]/gu)].map((match) => match[1])
      report.results.push({ variant: variant.variant, id: item.id, elapsedMs: Date.now() - started, ...answer,
        citationsValid: cited.every((id) => answer.context?.passages.some((passage) => passage.id === id)), citedCount: cited.length })
      await writeFile(path, JSON.stringify(report, null, 2), 'utf8')
      process.stdout.write(`${label} PDF ${variant.variant} ${item.id}: ${answer.error ?? 'ok'}\n`)
    }
  }
} finally { await session.close() }
