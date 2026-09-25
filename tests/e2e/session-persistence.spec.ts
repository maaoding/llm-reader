import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { BaseWindow, OpenDialogOptions } from 'electron'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader, restartReader } from './support/electron-app'
import { enterReading, showLibrary } from './support/workspace'

async function stubImportDialog(application: ElectronApplication, paths: string[]): Promise<void> {
  await application.evaluate(({ dialog }, selectedPaths) => {
    dialog.showOpenDialog = (async (_window: BaseWindow, options: OpenDialogOptions) => {
      if (!options.properties?.includes('multiSelections')) throw new Error('Expected multiSelections')
      return { canceled: false, filePaths: selectedPaths, bookmarks: [] }
    }) as unknown as typeof dialog.showOpenDialog
  }, paths)
}

let mockServer: Server
let endpoint = ''
let streamCount = 0
const streamRequests: { sessionId: string | undefined; body: string }[] = []

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

async function configureProvider(page: Page, compatibility = 'auto'): Promise<void> {
  await page.getByTestId('settings-button').click()
  await page.getByTestId('settings-nav-model').click()
  await page.getByTestId('provider-profile-name').fill('会话持久化测试')
  await page.getByTestId('provider-base-url').fill(endpoint)
  await page.getByTestId('provider-model').fill('mock-session-persistence')
  await page.getByTestId('provider-api-key').fill('test-only-key')
  await page.getByTestId('provider-compatibility').selectOption(compatibility)
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
      streamRequests.push({ sessionId: request.headers['x-opencode-session'] as string | undefined, body: rawBody })
      streamCount += 1
      // 分六段慢慢输出，便于在生成过程中切书、排队与清空。
      const chunks = ['临时会话里的回答，', '重启后应当仍在。', '这是第三段，', '用于拉长生成过程。', '这是第五段。', '（流式结束）']
      chunks.forEach((content, index) => {
        setTimeout(() => {
          if (response.writableEnded) return
          response.write(`data: ${JSON.stringify({
            id: 'mock-session-persistence-stream',
            model: 'mock-session-persistence',
            choices: [{ index: 0, delta: { content } }]
          })}\n\n`)
          if (index === chunks.length - 1) response.end('data: [DONE]\n\n')
        }, index * 600)
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

test.beforeEach(() => {
  streamCount = 0
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
    await expect(page.getByTestId('answer-current')).toContainText('（流式结束）')
    // 等请求真正结束（停止按钮消失）再写草稿，保证落库的是完成态。
    await expect(page.getByTestId('cancel-request')).toHaveCount(0)
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

test('keeps an answer that finished while another book was active', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-background-session-')
  let application: ElectronApplication | undefined

  try {
    const titles = ['后台完成的书', '切走的书']
    const paths = titles.map((title) => join(workspace.root, `${title}.txt`))
    await Promise.all(paths.map((path, index) => writeFile(path, `${titles[index]}\n\n${titles[index]}的正文段落，用于划词提问。`, 'utf8')))
    const launched = await launchReader({ userData: workspace.userData })
    application = launched.application
    let page = launched.page
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-workspace-ready', 'true')
    await stubImportDialog(application, paths)
    await page.getByTestId('import-book').click()
    await expect(page.getByTestId('book-import-summary')).toContainText('已导入 2 本')
    await page.getByTestId('book-import-close').click()
    await page.getByTestId('book-item').filter({ hasText: titles[0] }).click()
    await page.getByTestId('workspace-tab-reading').click()
    await expect(page.locator('.reader-document--txt')).toBeVisible()
    await configureProvider(page)

    await selectNodeContents(page.getByTestId('reader-host').locator('p').first())
    await expect(page.getByTestId('selection-toolbar')).toBeVisible()
    await page.getByTestId('action-explain').click()
    await expect(page.getByTestId('answer-current')).toContainText('临时会话里的回答，', { timeout: 30_000 })

    // 生成未结束时切到另一本书，让回答在后台完成。
    await page.getByTestId('nav-library').click()
    await page.getByTestId('book-item').filter({ hasText: titles[1] }).click()
    await page.getByTestId('workspace-tab-reading').click()
    await expect(page.locator('.workspace-book-title h1')).toHaveText(titles[1])
    await page.waitForTimeout(3_000)

    // 重启后回到第一本：后台完成的回答必须还在。
    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application
    page = restarted.page
    await showLibrary(page)
    await page.getByTestId('book-item').filter({ hasText: titles[0] }).click()
    await page.getByTestId('workspace-tab-reading').click()
    await expect(page.locator('.right-sidebar .conversation-turn')).toHaveCount(1)
    await expect(page.locator('.right-sidebar')).toContainText('（流式结束）')
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('stops a queued request when its session is cleared', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-cleared-queue-')
  let application: ElectronApplication | undefined

  try {
    const titles = ['排在第一的书', '排在第二的书', '被清空的书']
    const paths = titles.map((title) => join(workspace.root, `${title}.txt`))
    await Promise.all(paths.map((path, index) => writeFile(path, `${titles[index]}\n\n${titles[index]}的正文段落，用于划词提问。`, 'utf8')))
    const launched = await launchReader({ userData: workspace.userData })
    application = launched.application
    const { page } = launched
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-workspace-ready', 'true')
    await stubImportDialog(application, paths)
    await page.getByTestId('import-book').click()
    await expect(page.getByTestId('book-import-summary')).toContainText('已导入 3 本')
    await page.getByTestId('book-import-close').click()

    const askIn = async (index: number): Promise<void> => {
      await page.getByTestId('nav-library').click()
      await page.getByTestId('book-item').filter({ hasText: titles[index] }).click()
      await page.getByTestId('workspace-tab-reading').click()
      await expect(page.locator('.reader-document--txt')).toBeVisible()
      await selectNodeContents(page.getByTestId('reader-host').locator('p').first())
      await expect(page.getByTestId('selection-toolbar')).toBeVisible()
      await page.getByTestId('action-explain').click()
    }

    // 先配好供应商，再依次在三本书里连续提问：前两个占用并发位，第三个排队。
    await configureProvider(page)
    await askIn(0)
    await expect(page.getByTestId('answer-current')).toContainText('临时会话里的回答，', { timeout: 30_000 })
    await askIn(1)
    await expect(page.getByTestId('answer-current')).toContainText('临时会话里的回答，', { timeout: 30_000 })
    await askIn(2)
    await expect(page.getByTestId('answer-current')).toContainText('已排队，前面还有回答在生成。')
    expect(streamCount).toBe(2)

    // 清空排队的会话：请求不该再发出，界面上也不该留下无处落地的回答。
    await page.getByTestId('assistant-expand-button').click()
    await expect(page.getByTestId('assistant-dialog')).toBeVisible()
    await page.getByTestId('conversation-clear').click()
    await page.getByTestId('conversation-clear-confirm').click()
    await expect(page.locator('.assistant-dialog .conversation-turn')).toHaveCount(0)
    await page.waitForTimeout(3_500)
    expect(streamCount).toBe(2)
    await expect(page.locator('.assistant-dialog .conversation-turn')).toHaveCount(0)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('keeps a draft written after switching the question scope', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-scope-draft-')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: resolve('tests/fixtures/complex-reading.txt') })
    application = launched.application
    let page = launched.page
    await showLibrary(page)
    await page.getByTestId('book-item').first().click()
    await enterReading(page)
    await expect(page.getByTestId('reader-host')).toContainText('复杂概念')

    // 先划词（进入选中内容范围），再切到整本书，然后写草稿。
    await selectNodeContents(page.getByTestId('reader-host').locator('p').first())
    await expect(page.getByTestId('selection-toolbar')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByTestId('scope-book').click()
    await expect(page.getByTestId('scope-book')).toHaveAttribute('aria-pressed', 'true')
    const draft = '.right-sidebar [data-testid="followup-input"]'
    await page.locator(draft).fill('切到整本书之后写的草稿')

    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application
    page = restarted.page
    await showLibrary(page)
    await page.getByTestId('book-item').first().click()
    await enterReading(page)
    await expect(page.locator(draft)).toHaveValue('切到整本书之后写的草稿')
    await expect(page.getByTestId('scope-book')).toHaveAttribute('aria-pressed', 'true')
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('restores separate selection conversations with drafts across restart and clears only the current one', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-recent-selections-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: resolve('tests/fixtures/complex-reading.txt') })
    application = launched.application
    let page = launched.page
    await showLibrary(page); await page.getByTestId('book-item').first().click(); await enterReading(page)
    await configureProvider(page, 'opencode-go')
    const bookId = await page.evaluate(async () => (await window.readerApi.listBooks())[0].id)
    const firstQuote = (await page.getByTestId('reader-host').locator('p').first().innerText()).trim()
    await selectNodeContents(page.getByTestId('reader-host').locator('p').first())
    await page.getByTestId('action-explain').click()
    await expect(page.getByTestId('answer-current')).toContainText('（流式结束）')
    await expect(page.getByTestId('cancel-request')).toHaveCount(0)
    await page.getByTestId('followup-input').fill('第一处选区的草稿')
    await expect.poll(() => page.evaluate((id) => window.readerApi.getBookSession(id).then((value) => value?.draft), bookId)).toBe('第一处选区的草稿')
    const first = await page.evaluate((id) => window.readerApi.getBookSession(id), bookId)
    expect(streamRequests.at(-1)?.sessionId).toBe(first?.conversationId)

    await selectNodeContents(page.getByTestId('reader-host').locator('p').nth(1))
    await page.getByTestId('action-explain').click()
    await expect(page.getByTestId('answer-current')).toContainText('（流式结束）')
    await expect(page.getByTestId('cancel-request')).toHaveCount(0)
    await expect(page.locator('.right-sidebar .conversation-turn')).toHaveCount(1)
    expect(streamRequests.at(-1)?.sessionId).not.toBe(first?.conversationId)
    await page.getByTestId('followup-input').fill('第二处选区的草稿')
    const scrollTop = await page.locator('.right-sidebar .assistant-scroll').evaluate((element) => element.getBoundingClientRect().top)
    await page.getByTestId('recent-conversations').click()
    await expect(page.getByTestId('recent-conversations')).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.right-sidebar .recent-conversations-popover')).toBeVisible()
    expect(await page.locator('.right-sidebar .assistant-scroll').evaluate((element) => element.getBoundingClientRect().top)).toBe(scrollTop)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('recent-conversations')).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByTestId('recent-conversations')).toBeFocused()
    await page.getByTestId('recent-conversations').click()
    await page.locator('.right-sidebar .assistant-title').click()
    await expect(page.locator('.right-sidebar .recent-conversations-popover')).toBeHidden()
    await page.getByTestId('recent-conversations').click()
    await expect(page.getByTestId('recent-conversation')).toHaveCount(1)
    await page.getByTestId('recent-conversation').filter({ hasText: firstQuote.slice(0, 20) }).click()
    await expect(page.getByTestId('followup-input')).toHaveValue('第一处选区的草稿')
    await expect.poll(() => page.evaluate((id) => window.readerApi.getBookSession(id).then((value) => value?.conversationId), bookId)).toBe(first?.conversationId)
    await page.getByTestId('followup-input').press('Enter')
    await expect(page.getByTestId('cancel-request')).toHaveCount(0)
    await expect(page.locator('.right-sidebar .conversation-turn')).toHaveCount(2)
    expect(streamRequests.at(-1)?.sessionId).toBe(first?.conversationId)
    expect(streamRequests.at(-1)?.body).toContain(firstQuote)
    await page.getByTestId('followup-input').fill('第一处选区的草稿')

    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application; page = restarted.page
    await showLibrary(page); await page.getByTestId('book-item').first().click(); await enterReading(page)
    await expect(page.getByTestId('followup-input')).toHaveValue('第一处选区的草稿')
    await page.getByTestId('recent-conversations').click()
    await expect(page.getByTestId('recent-conversation')).toHaveCount(1)
    await page.getByTestId('recent-conversation').click()
    await expect(page.getByTestId('followup-input')).toHaveValue('第二处选区的草稿')
    await page.getByTestId('assistant-expand-button').click()
    await page.getByTestId('conversation-clear').click(); await page.getByTestId('conversation-clear-confirm').click()
    await page.getByTestId('assistant-dialog').getByTestId('recent-conversations').click()
    await expect(page.getByTestId('assistant-dialog').locator('.recent-conversations-popover')).toBeVisible()
    await expect(page.getByTestId('recent-conversation')).toHaveCount(1)
    await expect(page.getByTestId('recent-conversation')).toContainText(firstQuote.slice(0, 20))
    await page.screenshot({ path: test.info().outputPath('recent-conversations.png') })
  } finally { await cleanupE2eWorkspace(application, workspace.root) }
})
