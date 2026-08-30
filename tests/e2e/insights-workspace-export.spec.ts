import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  cleanupE2eWorkspace,
  createE2eWorkspace,
  launchReader
} from './support/electron-app'

const firstFixture = resolve('tests/fixtures/complex-reading.txt')

let mockServer: Server
let endpoint = ''
let streamRequestCount = 0

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
  await page.getByTestId('provider-profile-name').fill('归档测试')
  await page.getByTestId('provider-base-url').fill(endpoint)
  await page.getByTestId('provider-model').fill('mock-insights-export')
  await page.getByTestId('provider-api-key').fill('test-only-key')
  await page.getByTestId('provider-save').click()
  await page.getByTestId('provider-activate').click()
  await page.getByTestId('settings-close').click()
  await expect(page.getByTestId('settings-modal')).toHaveCount(0)
}

async function archiveSelection(page: Page, expectedAnswer: string): Promise<void> {
  await selectNodeContents(page.getByTestId('reader-host').locator('p').first())
  await expect(page.getByTestId('selection-toolbar')).toBeVisible()
  await page.getByTestId('action-explain').click()
  await expect(page.getByTestId('answer-current')).toContainText(expectedAnswer)
  await expect(page.getByTestId('answer-save')).toBeVisible()
  await page.getByTestId('answer-save').click()
}

test.beforeEach(() => {
  streamRequestCount = 0
})

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
          id: 'mock-insights-export-test',
          model: 'mock-insights-export',
          choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }]
        }))
        return
      }

      streamRequestCount += 1
      const answer = streamRequestCount === 1 ? '这是第一本书的归档回答。' : '这是第二本书的归档回答。'
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      response.write(
        `data: ${JSON.stringify({ id: 'mock-insights-export-stream', model: 'mock-insights-export', choices: [{ index: 0, delta: { content: answer } }] })}\n\n`
      )
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

test('opens the assistant workspace, browses cross-book archives and exports Markdown', async () => {
  test.setTimeout(180_000)
  const workspace = await createE2eWorkspace('llm-reader-insights-export-')
  const secondFixture = join(workspace.root, '第二本书.txt')
  await writeFile(secondFixture, '第二本书开篇。\n这是第二本书的一段可以选中的内容。', 'utf8')
  const allExportPath = join(workspace.root, '全部归档.md')
  const bookExportPath = join(workspace.root, '本书归档.md')
  const oneExportPath = join(workspace.root, '单条归档.md')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({
      userData: workspace.userData,
      importPath: firstFixture
    })
    application = launched.application
    const { page } = launched

    await page.getByTestId('book-item').first().click()
    await expect(page.getByTestId('reader-host')).toContainText('复杂概念')
    await configureProvider(page)
    await archiveSelection(page, '这是第一本书的归档回答。')

    await application.evaluate(({ dialog }, fixturePath) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [fixturePath],
        bookmarks: []
      })) as unknown as typeof dialog.showOpenDialog
    }, secondFixture)
    await page.getByTestId('library-tab').click()
    await page.getByTestId('import-book').click()
    await expect(page.getByTestId('reader-host')).toContainText('第二本书开篇')
    await page.getByTestId('library-tab').click()
    await expect(page.getByTestId('book-item')).toHaveCount(2)
    await page.getByTestId('book-item').nth(0).click()
    await expect(page.getByTestId('reader-host')).toContainText('第二本书开篇')
    await archiveSelection(page, '这是第二本书的归档回答。')

    await page.getByTestId('assistant-expand-button').click()
    await expect(page.getByTestId('assistant-dialog')).toBeVisible()
    await page.getByTestId('assistant-dialog-tab-insights').click()
    await expect(page.getByTestId('insight-item')).toHaveCount(2)
    const firstInsight = page.getByTestId('insight-item').filter({ hasText: '这是第一本书的归档回答。' })
    const secondInsight = page.getByTestId('insight-item').filter({ hasText: '这是第二本书的归档回答。' })
    await expect(firstInsight).toHaveCount(1)
    await expect(secondInsight).toHaveCount(1)

    await application.evaluate(({ dialog }, paths) => {
      let callIndex = 0
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: paths[callIndex++ % paths.length] ?? '',
        bookmarks: []
      })) as unknown as typeof dialog.showSaveDialog
    }, [allExportPath, bookExportPath, oneExportPath])

    await page.getByTestId('insights-export-scope').click()
    await expect(page.locator('.toast')).toContainText('已导出')
    await expect.poll(async () => readFile(allExportPath, 'utf8')).toContain('这是第一本书的归档回答。')
    const allMarkdown = await readFile(allExportPath, 'utf8')
    expect(allMarkdown).toContain('这是第二本书的归档回答。')
    expect(allMarkdown.match(/^## /gmu)).toHaveLength(2)

    await page.getByTestId('insights-scope-book').click()
    await expect(page.getByTestId('insight-item')).toHaveCount(1)
    await expect(page.getByTestId('insight-item')).toContainText('这是第二本书的归档回答。')
    await page.getByTestId('insights-export-scope').click()
    await expect.poll(async () => readFile(bookExportPath, 'utf8').catch(() => '')).toContain('这是第二本书的归档回答。')
    const bookMarkdown = await readFile(bookExportPath, 'utf8')
    expect(bookMarkdown).not.toContain('这是第一本书的归档回答。')

    await page.getByTestId('insights-scope-all').click()
    await firstInsight.getByTestId('insight-export').click()
    await expect.poll(async () => readFile(oneExportPath, 'utf8').catch(() => '')).toContain('这是第一本书的归档回答。')
    const oneMarkdown = await readFile(oneExportPath, 'utf8')
    expect(oneMarkdown).not.toContain('这是第二本书的归档回答。')

    const search = page.getByTestId('insights-search-input')
    await search.fill('这是第二本书的归档回答。')
    await expect(page.getByTestId('insight-item')).toHaveCount(1)
    await expect(page.getByTestId('insight-item')).toContainText('这是第二本书的归档回答。')
    await search.fill('')
    await expect(page.getByTestId('insight-item')).toHaveCount(2)

    await firstInsight.locator('.insight-content').click()
    await expect(page.locator('.assistant-session-tab.is-active [role="tab"]')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('answer-current')).toContainText('这是第一本书的归档回答。')
    await expect(page.locator('.assistant-dialog .question-bubble')).toContainText('归档的回答')
    await expect(page.getByTestId('reader-host')).toContainText('复杂概念')

    const secondLiveTab = page.getByTestId('assistant-session-tab').filter({ hasText: '第二本书' })
    await expect(secondLiveTab).toHaveCount(1)
    await secondLiveTab.click()
    await expect(page.getByTestId('reader-host')).toContainText('第二本书开篇')
    await expect(page.getByTestId('answer-current')).toContainText('这是第二本书的归档回答。')

    await page.getByTestId('assistant-dialog-close').click()
    await expect(page.getByTestId('assistant-dialog')).toHaveCount(0)
    await expect(page.getByTestId('reader-host')).toContainText('第二本书开篇')
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('keeps two archive tabs independent and closes the active one back to current', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-insights-tabs-')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({
      userData: workspace.userData,
      importPath: firstFixture
    })
    application = launched.application
    const { page } = launched

    await page.getByTestId('book-item').first().click()
    await expect(page.getByTestId('reader-host')).toContainText('复杂概念')
    await configureProvider(page)
    await archiveSelection(page, '这是第一本书的归档回答。')

    await selectNodeContents(page.getByTestId('reader-host').locator('p').first())
    await expect(page.getByTestId('selection-toolbar')).toBeVisible()
    await page.getByTestId('action-explain').click()
    await expect(page.getByTestId('answer-current')).toContainText('这是第二本书的归档回答。')
    await expect(page.getByTestId('answer-save')).toBeVisible()
    await page.getByTestId('answer-save').click()

    await page.getByTestId('assistant-expand-button').click()
    await page.getByTestId('assistant-dialog-tab-insights').click()
    await expect(page.getByTestId('insight-item')).toHaveCount(2)

    const firstInsight = page.getByTestId('insight-item').filter({ hasText: '这是第一本书的归档回答。' })
    const secondInsight = page.getByTestId('insight-item').filter({ hasText: '这是第二本书的归档回答。' })
    await firstInsight.locator('.insight-content').click()
    await expect(page.locator('.assistant-session-tab.is-active [role="tab"]')).toHaveAttribute('aria-selected', 'true')
    const followup = page.getByTestId('followup-input')
    await followup.fill('第一份未发送草稿')
    await expect(followup).toHaveValue('第一份未发送草稿')

    await page.getByTestId('assistant-dialog-tab-insights').click()
    await secondInsight.locator('.insight-content').click()
    await expect(followup).toHaveValue('')
    await followup.fill('第二份未发送草稿')
    await expect(followup).toHaveValue('第二份未发送草稿')

    const archiveTabs = page.locator('.assistant-session-tab').filter({ has: page.locator('.assistant-session-tab-select[data-tab-kind="archive"]') })
    await expect(archiveTabs).toHaveCount(2)
    await archiveTabs.nth(0).locator('.assistant-session-tab-select').click()
    await expect(followup).toHaveValue('第一份未发送草稿')
    await archiveTabs.nth(1).locator('.assistant-session-tab-select').click()
    await expect(followup).toHaveValue('第二份未发送草稿')

    await archiveTabs.nth(1).locator('.assistant-session-tab-close').click()
    await expect(archiveTabs).toHaveCount(1)
    await expect(page.locator('.assistant-session-tab.is-active .assistant-session-tab-select[data-tab-kind="live"]')).toHaveAttribute('aria-selected', 'true')

    await archiveTabs.nth(0).locator('.assistant-session-tab-select').click()
    await expect(followup).toHaveValue('第一份未发送草稿')
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
