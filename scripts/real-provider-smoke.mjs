/* global document, MouseEvent, process, window */

import { _electron as electron, expect } from '@playwright/test'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const sourceUserData = resolve(
  process.env.LLM_READER_REAL_API_SOURCE_USER_DATA
    ?? join(process.env.APPDATA ?? '', 'llm-reader')
)
const fixturePath = resolve('tests/fixtures/complex-reading.txt')
const testRoot = await mkdtemp(join(tmpdir(), 'llm-reader-real-api-smoke-'))
const isolatedUserData = join(testRoot, 'profile')
let application

if (!isAbsolute(sourceUserData) || !process.env.APPDATA) {
  throw new Error('无法确定已保存配置的绝对用户数据路径。')
}
if (dirname(testRoot) !== resolve(tmpdir())) {
  throw new Error(`拒绝使用非临时目录：${testRoot}`)
}

async function launchReader(importPath = '') {
  const launchedApplication = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      LLM_READER_USER_DATA: isolatedUserData,
      LLM_READER_E2E_IMPORT: importPath
    }
  })
  const page = await launchedApplication.firstWindow()
  await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 30_000 })
  return { application: launchedApplication, page }
}

function cloneProviderSettings() {
  const sourceDatabase = new DatabaseSync(join(sourceUserData, 'reader.sqlite3'), {
    readOnly: true
  })
  const targetDatabase = new DatabaseSync(join(isolatedUserData, 'reader.sqlite3'))
  try {
    const provider = sourceDatabase
      .prepare('SELECT base_url, model FROM provider_settings WHERE singleton = 1')
      .get()
    if (
      !provider
      || typeof provider.base_url !== 'string'
      || !provider.base_url
      || typeof provider.model !== 'string'
      || !provider.model
    ) {
      throw new Error('日常用户数据中没有完整的供应商配置。')
    }
    targetDatabase
      .prepare(
        `INSERT INTO provider_settings(singleton, base_url, model)
         VALUES (1, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           base_url = excluded.base_url,
           model = excluded.model`
      )
      .run(provider.base_url, provider.model)
  } finally {
    targetDatabase.close()
    sourceDatabase.close()
  }
}

try {
  const initialized = await launchReader()
  application = initialized.application
  await application.close()
  application = undefined
  process.stdout.write('1/3 已初始化隔离用户数据。\n')

  cloneProviderSettings()
  await copyFile(
    join(sourceUserData, 'api-key.bin'),
    join(isolatedUserData, 'api-key.bin')
  )
  await copyFile(
    join(sourceUserData, 'Local State'),
    join(isolatedUserData, 'Local State')
  )
  process.stdout.write('2/3 已复制供应商设置和 safeStorage 加密上下文；密钥未解密。\n')

  const launched = await launchReader(fixturePath)
  application = launched.application
  const { page } = launched
  await expect(page.getByTestId('provider-connection-status')).toHaveAttribute(
    'aria-label',
    'API 连接正常',
    { timeout: 45_000 }
  )
  await expect(page.getByTestId('book-item').first()).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('book-item').first().click()
  await expect(page.getByTestId('reader-host')).toContainText('复杂概念')

  const paragraph = page.locator('.reader-document--txt p').nth(1)
  await paragraph.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  await expect(page.getByTestId('selection-toolbar')).toBeVisible()
  await page.getByTestId('action-explain').click()

  const currentAnswer = page.getByTestId('answer-current')
  await expect(currentAnswer.locator('.answer-footer')).toBeVisible({ timeout: 120_000 })
  await expect(currentAnswer.locator('.turn-error')).toHaveCount(0)
  const answerText = (await currentAnswer.locator('.answer-text').textContent())?.trim() ?? ''
  if (answerText.length < 8) throw new Error('真实供应商返回的回答为空或过短。')

  const validCitations = await currentAnswer.getByTestId('citation-valid').count()
  const unverifiedCitations = await currentAnswer.getByTestId('citation-unverified').count()
  process.stdout.write(
    `3/3 真实 API 连接与流式回答通过：回答 ${answerText.length} 字符，` +
    `有效引用 ${validCitations} 个，未验证引用 ${unverifiedCitations} 个。\n`
  )
} finally {
  try {
    await application?.close()
  } finally {
    await rm(testRoot, { recursive: true, force: true })
  }
}
