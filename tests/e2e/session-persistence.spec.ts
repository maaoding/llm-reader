import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { resolve } from 'node:path'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader, restartReader } from './support/electron-app'
import { enterReading, showLibrary } from './support/workspace'

let mockServer: Server
let endpoint = ''

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
  await page.getByTestId('provider-profile-name').fill('会话持久化测试')
  await page.getByTestId('provider-base-url').fill(endpoint)
  await page.getByTestId('provider-model').fill('mock-session-persistence')
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
          id: 'mock-session-persistence',
          model: 'mock-session-persistence',
          choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }]
        }))
        return
      }
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      response.write(`data: ${JSON.stringify({
        id: 'mock-session-persistence-stream',
        model: 'mock-session-persistence',
        choices: [{ index: 0, delta: { content: '临时会话里的回答，重启后应当仍在。' } }]
      })}\n\n`)
      response.end('data: [DONE]\n\n')
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

test('restores open archive tabs with their drafts and the active tab', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-archive-tabs-')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: resolve('tests/fixtures/complex-reading.txt') })
    application = launched.application
    let page = launched.page
    await showLibrary(page)
    await page.getByTestId('book-item').first().click()
    await enterReading(page)
    await expect(page.getByTestId('reader-host')).toContainText('复杂概念')
    await configureProvider(page)

    // 两条归档，方便开两个归档标签。
    for (let index = 0; index < 2; index += 1) {
      await selectNodeContents(page.getByTestId('reader-host').locator('p').first())
      await expect(page.getByTestId('selection-toolbar')).toBeVisible()
      await page.getByTestId('action-explain').click()
      await expect(page.getByTestId('answer-current')).toContainText('临时会话里的回答，重启后应当仍在。')
      await page.getByTestId('answer-save').click()
      await expect(page.getByTestId('answer-save')).toContainText('已保存')
    }

    await page.getByTestId('assistant-expand-button').click()
    await page.getByTestId('assistant-dialog-tab-insights').click()
    await expect(page.getByTestId('insight-item')).toHaveCount(2)
    await page.getByTestId('insight-item').nth(0).locator('.insight-content').click()
    await expect(page.getByTestId('assistant-dialog')).toBeVisible()
    await page.getByTestId('assistant-dialog-tab-insights').click()
    await page.getByTestId('insight-item').nth(1).locator('.insight-content').click()
    await expect(page.getByTestId('assistant-session-tab')).toHaveCount(3)
    const dialogDraft = '.assistant-dialog [data-testid="followup-input"]'
    await page.locator(dialogDraft).fill('归档标签里的草稿')

    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application
    page = restarted.page
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-workspace-ready', 'true')
    // 重启后回到对话页，标签顺序、激活项与归档草稿都还原。
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-page', 'conversation')
    await expect(page.getByTestId('assistant-session-tab')).toHaveCount(3)
    await expect(page.getByTestId('assistant-session-tab').nth(0)).toHaveAttribute('data-tab-kind', 'live')
    await expect(page.getByTestId('assistant-session-tab').nth(2)).toHaveAttribute('data-tab-kind', 'archive')
    await expect(page.locator('.assistant-session-tab.is-active .assistant-session-tab-select')).toHaveAttribute('data-tab-kind', 'archive')
    await expect(page.locator(dialogDraft)).toHaveValue('归档标签里的草稿')
    await expect(page.getByTestId('answer-current')).toContainText('临时会话里的回答，重启后应当仍在。')
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('keeps the last temporary session per book across restarts and clears it on demand', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-session-persistence-')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: resolve('tests/fixtures/complex-reading.txt') })
    application = launched.application
    let page = launched.page
    await showLibrary(page)
    await page.getByTestId('book-item').first().click()
    await enterReading(page)
    await expect(page.getByTestId('reader-host')).toContainText('复杂概念')
    await configureProvider(page)

    // 未发送的草稿 + 一轮已完成的问答都属于「最后的临时会话」。
    await selectNodeContents(page.getByTestId('reader-host').locator('p').first())
    await expect(page.getByTestId('selection-toolbar')).toBeVisible()
    await page.getByTestId('action-explain').click()
    await expect(page.getByTestId('answer-current')).toContainText('临时会话里的回答，重启后应当仍在。')
    const draft = '.right-sidebar [data-testid="followup-input"]'
    await page.locator(draft).fill('重启后应保留的草稿')

    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application
    page = restarted.page
    await showLibrary(page)
    await page.getByTestId('book-item').first().click()
    await enterReading(page)
    await expect(page.locator('.right-sidebar .conversation-turn')).toHaveCount(1)
    await expect(page.locator('.right-sidebar .conversation-turn')).toContainText('临时会话里的回答，重启后应当仍在。')
    await expect(page.locator(draft)).toHaveValue('重启后应保留的草稿')

    // 清空会话后连库里的记录一起消失，重启也不会回来。
    await page.getByTestId('assistant-expand-button').click()
    await expect(page.getByTestId('assistant-dialog')).toBeVisible()
    const dialogDraft = '.assistant-dialog [data-testid="followup-input"]'
    await expect(page.locator(dialogDraft)).toHaveValue('重启后应保留的草稿')
    await page.getByTestId('conversation-clear').click()
    await page.getByTestId('conversation-clear-confirm').click()
    await expect(page.locator('.assistant-dialog .conversation-turn')).toHaveCount(0)
    await expect(page.locator(dialogDraft)).toHaveValue('')

    const cleared = await restartReader(application, { userData: workspace.userData })
    application = cleared.application
    page = cleared.page
    await showLibrary(page)
    await page.getByTestId('book-item').first().click()
    await expect(page.locator('.right-sidebar .conversation-turn')).toHaveCount(0)
    await expect(page.locator(draft)).toHaveValue('')
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
