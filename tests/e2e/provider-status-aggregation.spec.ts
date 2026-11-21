import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BaseWindow, OpenDialogOptions } from 'electron'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader } from './support/electron-app'

const TITLES = ['并发成功的书', '并发失败的书']
const CHUNKS = ['### 回答\n\n第一段内容，用于确认请求已开始。\n\n', '第二段内容，保持流式输出。\n\n', '第三段内容，请求到此结束。']

let mockServer: Server
let endpoint = ''
let failNextStream = false

async function stubImportDialog(application: ElectronApplication, paths: string[]): Promise<void> {
  await application.evaluate(({ dialog }, selectedPaths) => {
    dialog.showOpenDialog = (async (_window: BaseWindow, options: OpenDialogOptions) => {
      if (!options.properties?.includes('multiSelections')) throw new Error('Expected multiSelections')
      return { canceled: false, filePaths: selectedPaths, bookmarks: [] }
    }) as unknown as typeof dialog.showOpenDialog
  }, paths)
}

async function selectNodeContents(locator: Locator): Promise<void> {
  await locator.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
}

async function configureProvider(page: Page): Promise<void> {
  await page.getByTestId('settings-button').click()
  await page.getByTestId('settings-nav-model').click()
  await page.getByTestId('provider-profile-name').fill('连接状态测试')
  await page.getByTestId('provider-base-url').fill(endpoint)
  await page.getByTestId('provider-model').fill('mock-status-aggregation')
  await page.getByTestId('provider-api-key').fill('test-only-key')
  await page.getByTestId('provider-save').click()
  await page.getByTestId('provider-activate').click()
  await page.getByTestId('settings-close').click()
  await expect(page.getByTestId('settings-modal')).toHaveCount(0)
}

test.beforeAll(async () => {
  mockServer = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    let rawBody = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      rawBody += chunk
    })
    request.on('end', () => {
      const body = JSON.parse(rawBody) as { stream?: boolean }
      if (!body.stream) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          id: 'mock-status-aggregation',
          model: 'mock-status-aggregation',
          choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }]
        }))
        return
      }
      if (failNextStream) {
        failNextStream = false
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'mock 并发失败' } }))
        return
      }
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      CHUNKS.forEach((content, index) => {
        setTimeout(() => {
          if (response.writableEnded) return
          response.write(`data: ${JSON.stringify({
            id: 'mock-status-aggregation-stream',
            model: 'mock-status-aggregation',
            choices: [{ index: 0, delta: { content } }]
          })}\n\n`)
          if (index === CHUNKS.length - 1) response.end('data: [DONE]\n\n')
        }, index * 900)
      })
    })
  })
  await new Promise<void>((resolveListen, reject) => {
    mockServer.once('error', reject)
    mockServer.listen(0, '127.0.0.1', () => resolveListen())
  })
  const address = mockServer.address()
  if (!address || typeof address === 'string') throw new Error('Mock provider did not expose a TCP port')
  endpoint = `http://127.0.0.1:${address.port}/v1`
})

test.afterAll(async () => {
  await new Promise<void>((resolveClose, reject) => {
    mockServer.close((error) => (error ? reject(error) : resolveClose()))
  })
})

test('keeps the connection status steady while another conversation request is still running', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-status-aggregation-')
  let application: ElectronApplication | undefined

  try {
    const paths = TITLES.map((title) => join(workspace.root, `${title}.txt`))
    await Promise.all(paths.map((path, index) => writeFile(path, `${TITLES[index]}\n\n${TITLES[index]}的正文段落，用于划词提问。\n\n第二段正文。`, 'utf8')))
    const launched = await launchReader({ userData: workspace.userData })
    application = launched.application
    const { page } = launched
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-workspace-ready', 'true')
    await stubImportDialog(application, paths)
    await page.getByTestId('import-book').click()
    await expect(page.getByTestId('book-import-summary')).toContainText('已导入 2 本')
    await page.getByTestId('book-import-close').click()

    const status = page.getByTestId('provider-connection-status')
    const askOnce = async (index: number): Promise<void> => {
      await page.getByTestId('nav-library').click()
      await page.getByTestId('book-item').filter({ hasText: TITLES[index] }).click()
      await page.getByTestId('workspace-tab-reading').click()
      await expect(page.locator('.reader-document--txt')).toBeVisible()
      await selectNodeContents(page.getByTestId('reader-host').locator('p').first())
      await expect(page.getByTestId('selection-toolbar')).toBeVisible()
      await page.getByTestId('action-explain').click()
    }

    await askOnce(0)
    await configureProvider(page)
    await expect(status).toHaveAttribute('aria-label', 'API 连接正常')

    // 书 A 慢速流式进行中，书 B 的请求失败：状态点必须保持“正常”。
    await selectNodeContents(page.getByTestId('reader-host').locator('p').first())
    await expect(page.getByTestId('selection-toolbar')).toBeVisible()
    await page.getByTestId('action-explain').click()
    await expect(page.getByTestId('answer-current')).toContainText('第一段内容', { timeout: 30_000 })

    failNextStream = true
    await askOnce(1)
    await expect(page.getByTestId('answer-current').locator('.turn-error')).toBeVisible({ timeout: 30_000 })
    await expect(status).toHaveAttribute('aria-label', 'API 连接正常')
    await expect(status).not.toHaveClass(/is-disconnected/u)

    // 书 A 结束：仍然是“正常”，失败的请求没有把状态点带偏。
    await page.getByTestId('nav-library').click()
    await page.getByTestId('book-item').filter({ hasText: TITLES[0] }).click()
    await page.getByTestId('workspace-tab-reading').click()
    await expect(page.getByTestId('answer-current')).toContainText('第三段内容，请求到此结束。', { timeout: 30_000 })
    await expect(status).toHaveAttribute('aria-label', 'API 连接正常')

    // 单独一个请求失败（没有并发）：才标记为未连接。
    failNextStream = true
    await selectNodeContents(page.getByTestId('reader-host').locator('p').first())
    await expect(page.getByTestId('selection-toolbar')).toBeVisible()
    await page.getByTestId('action-explain').click()
    await expect(page.getByTestId('answer-current').locator('.turn-error')).toBeVisible({ timeout: 30_000 })
    await expect(status).toHaveAttribute('aria-label', 'API 未连接')
    await expect(status).toHaveClass(/is-disconnected/u)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
