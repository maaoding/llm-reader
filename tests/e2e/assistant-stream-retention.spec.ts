import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BaseWindow, OpenDialogOptions } from 'electron'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader } from './support/electron-app'
import { resizeWorkspace } from './support/workspace'

let mockServer: Server
let endpoint = ''

const TITLES = ['正在生成的书', '另一本书', '排队的书']

const STREAM_CHUNKS = [
  '### 解释\n\n第一段：这段**关键**内容涉及 `术语`。\n\n',
  '第二段：切换标签后仍在后台生成。\n\n',
  '第三段：回到本书时答案应当完整。'
]

async function stubImportDialog(application: ElectronApplication, paths: string[]): Promise<void> {
  await application.evaluate(({ dialog }, selectedPaths) => {
    dialog.showOpenDialog = (async (_window: BaseWindow, options: OpenDialogOptions) => {
      const hasMultiSelection = options.properties?.includes('multiSelections') ?? false
      if (!hasMultiSelection) throw new Error('Expected multiSelections')
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
  await page.getByTestId('provider-profile-name').fill('保留回答测试')
  await page.getByTestId('provider-base-url').fill(endpoint)
  await page.getByTestId('provider-model').fill('mock-stream-retention')
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
          id: 'mock-stream-retention',
          model: 'mock-stream-retention',
          choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }]
        }))
        return
      }
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      STREAM_CHUNKS.forEach((content, index) => {
        setTimeout(() => {
          if (response.writableEnded) return
          response.write(`data: ${JSON.stringify({
            id: 'mock-stream-retention-stream',
            model: 'mock-stream-retention',
            choices: [{ index: 0, delta: { content } }]
          })}\n\n`)
          if (index === STREAM_CHUNKS.length - 1) response.end('data: [DONE]\n\n')
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

test('keeps a running answer while switching book tabs and renders its markdown preview on the overview', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-stream-retention-')
  let application: ElectronApplication | undefined

  try {
    const paths = TITLES.map((title) => join(workspace.root, `${title}.txt`))
    await Promise.all(paths.map((path, index) => writeFile(path, `${TITLES[index]}\n\n${TITLES[index]}的正文段落，用于划词与提问。\n\n第二段正文。`, 'utf8')))
    const launched = await launchReader({ userData: workspace.userData })
    application = launched.application
    const { page } = launched
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-workspace-ready', 'true')
    await stubImportDialog(application, paths)
    await page.getByTestId('import-book').click()
    await expect(page.getByTestId('book-import-summary')).toContainText('已导入 3 本')
    await page.getByTestId('book-import-close').click()

    const openFromLibrary = async (index: number): Promise<void> => {
      await page.getByTestId('nav-library').click()
      await page.getByTestId('book-item').filter({ hasText: TITLES[index] }).click()
      await expect(page.locator('.workspace-book-title h1')).toHaveText(TITLES[index])
    }

    await openFromLibrary(0)
    await configureProvider(page)
    await page.getByTestId('workspace-tab-reading').click()
    await expect(page.locator('.reader-document--txt')).toBeVisible()

    // 在书 A 中发起问答
    await selectNodeContents(page.getByTestId('reader-host').locator('p').first())
    await expect(page.getByTestId('selection-toolbar')).toBeVisible()
    await page.getByTestId('action-explain').click()
    const answer = page.getByTestId('answer-current')
    await expect(answer).toContainText('第一段', { timeout: 30_000 })

    // 流式生成期间切到另一本书
    await openFromLibrary(1)
    await expect(page.locator('.workspace-book-title h1')).toHaveText(TITLES[1])
    const tabs = page.getByTestId('book-tab')
    await expect(tabs).toHaveCount(2)
    // 另一本书不应显示上一本书的停止按钮
    await expect(page.getByTestId('cancel-request')).toHaveCount(0)

    // 回到书 A：答案在后台继续生成，并且未被取消
    await tabs.first().click()
    await expect(page.locator('.workspace-book-title h1')).toHaveText(TITLES[0])
    const restored = page.getByTestId('answer-current')
    await expect(restored).toContainText('第一段')
    await expect(restored).toContainText('第三段：回到本书时答案应当完整。', { timeout: 30_000 })
    await expect(restored).not.toContainText('已停止生成')
    await expect(restored.locator('.turn-error')).toHaveCount(0)
    await expect(page.getByTestId('cancel-request')).toHaveCount(0)

    // 保存回答后，概览的最近回答预览按 Markdown 渲染且不显示原始标记
    await page.getByTestId('answer-save').click()
    await expect(page.getByTestId('answer-save')).toContainText('已保存')
    await page.getByTestId('workspace-tab-overview').click()
    const recent = page.locator('.workspace-recent-item').first()
    await expect(recent).toContainText('这段')
    await expect(recent.locator('.workspace-recent-answer strong')).toHaveText('关键')
    await expect(recent.locator('.workspace-recent-answer .answer-code-inline')).toHaveText('术语')
    await expect(recent.locator('.workspace-recent-answer')).not.toContainText('**')
    await expect(recent.locator('.workspace-recent-answer h3')).toHaveCount(0)

    // 阅读页的助手区常驻：窄窗口也不收起，阅读正文始终为其留位、不被覆盖。
    await page.getByTestId('workspace-tab-reading').click()
    await expect(page.locator('.reader-document--txt')).toBeVisible()

    // 并发上限 2：第三个会话请求排队等待，前两个结束后自动补位。
    for (const index of [0, 1, 2]) {
      await openFromLibrary(index)
      await page.getByTestId('workspace-tab-reading').click()
      await expect(page.locator('.reader-document--txt')).toBeVisible()
      await selectNodeContents(page.getByTestId('reader-host').locator('p').first())
      await expect(page.getByTestId('selection-toolbar')).toBeVisible()
      await page.getByTestId('action-explain').click()
      if (index < 2) await expect(page.getByTestId('answer-current')).toContainText('第一段', { timeout: 30_000 })
    }
    // 第三个请求先排队，等前两个结束后自动开始。
    await expect(page.getByTestId('answer-current')).toContainText('已排队，前面还有回答在生成。')
    await expect(page.getByTestId('answer-current')).toContainText('第三段：回到本书时答案应当完整。', { timeout: 30_000 })
    await expect(page.locator('.right-sidebar .conversation-turn')).toHaveCount(1)

    await resizeWorkspace(application, page, 940, 600)
    const sidebar = page.locator('.right-sidebar')
    await expect(sidebar).toBeVisible()
    await expect.poll(() => page.getByTestId('reader-host').evaluate((host) => {
      const panel = document.querySelector<HTMLElement>('.right-sidebar')
      if (!panel) return false
      return host.getBoundingClientRect().right <= panel.getBoundingClientRect().left + 1
    })).toBe(true)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
