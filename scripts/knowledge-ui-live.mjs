/* global window, document, innerWidth */
import { expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createEvaluationSession } from './knowledge-eval-session.mjs'

const session = await createEvaluationSession('tmp/knowledge-hard-pdf-20260909')
const { page, application } = session
const output = resolve('output/knowledge-hard-20260909')
const bookId = JSON.parse(await readFile(output + '/pdf-live.json', 'utf8')).variants.find((item) => item.variant === 'scanned').bookId
const checks = []
try {
  await page.locator(`[data-testid="book-item"][data-book-id="${bookId}"]`).click()
  await expect(page.locator('.pdf-page')).toHaveCount(6)
  await page.getByTestId('scope-book').click()
  await page.evaluate(() => window.readerApi.onLlmEvent((event) => {
    window.__qualityUi ??= { done: false, answer: '', context: null, error: null }
    if (event.type === 'context') { window.__qualityUi.context = event.context; window.__qualityUi.answer = '' }
    if (event.type === 'delta') window.__qualityUi.answer += event.delta
    if (event.type === 'error') window.__qualityUi.error = event.code
    if (event.type === 'completed' || event.type === 'error') window.__qualityUi.done = true
  }))
  await page.getByTestId('followup-input').fill('跨页比较蓝组、青组的异常样本，各保留多少天、复核阈值是多少？请在100字以内回答并用[P编号]格式引用实际原文。')
  await page.getByTestId('followup-input').press('Enter')
  await page.waitForFunction(() => window.__qualityUi?.done, undefined, { timeout: 120_000 })
  const answer = await page.evaluate(() => window.__qualityUi)
  expect(answer.error).toBeNull()
  await expect(page.getByTestId('answer-current')).toContainText('0.88')
  await expect(page.getByTestId('answer-current')).toContainText('0.98')
  await page.locator('.answer-sources').last().locator('summary').click()
  const natural = await page.getByTestId('reader-host').evaluate((host) => host.scrollTop)
  for (const target of [3, 4]) {
    const button = page.locator('.answer-source-item').getByRole('button', { name: `第 ${target} 页`, exact: true }).first()
    await button.scrollIntoViewIfNeeded(); await button.click()
    await expect.poll(() => page.getByTestId('reader-host').evaluate((host, target) => {
      const bounds = host.getBoundingClientRect(), rect = host.querySelector(`[data-page-number="${target}"]`).getBoundingClientRect()
      return rect.bottom > bounds.top && rect.top < bounds.bottom
    }, target)).toBe(true)
    await page.getByTestId('reader-return-button').click()
    await expect.poll(() => page.getByTestId('reader-host').evaluate((host, position) => Math.abs(host.scrollTop - position), natural)).toBeLessThan(5)
    checks.push(`page ${target} and return`)
  }
  for (const theme of ['light', 'dark']) {
    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-appearance').click()
    await page.getByTestId(`theme-${theme}`).click()
    await page.getByTestId('settings-close').click()
    for (const [width, height] of [[1440, 900], [940, 600]]) {
      await application.evaluate(({ BrowserWindow }, size) => { const appWindow = BrowserWindow.getAllWindows()[0]; appWindow.unmaximize(); appWindow.setContentSize(...size) }, [width, height])
      await expect(page.getByTestId('followup-input')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.locator('.answer-source-item').filter({ hasText: '普通样本' }).first().scrollIntoViewIfNeeded()
      await page.screenshot({ path: output + `/ui-${theme}-${width}.png` })
      checks.push(`${theme} ${width}x${height}`)
    }
  }
  await page.getByTestId('answer-save').click()
  const insight = await page.evaluate(async (bookId) => (await window.readerApi.listInsights(bookId))[0], bookId)
  expect(insight.context.passages.some((passage) => passage.tableSlice?.cells.some((cell, index, cells) => cells.some((other, otherIndex) => otherIndex !== index && other.id === cell.id)))).toBe(true)
  checks.push('archive retains repeated cell source ranges')
  await writeFile(output + '/ui-live.json', JSON.stringify({ checks, answer, insightId: insight.id }, null, 2), 'utf8')
} finally { await session.close() }
