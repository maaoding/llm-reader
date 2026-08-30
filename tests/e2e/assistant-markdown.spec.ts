import {
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { resolve } from 'node:path'
import {
  cleanupE2eWorkspace,
  createE2eWorkspace,
  launchReader,
  restartReader
} from './support/electron-app'

let mockServer: Server
let endpoint = ''
let streamRequestCount = 0

const FOLLOW_UP_CHUNKS = [
  '这是归档会话里的追问回答，应随归档历史一起保留。'
]

const STREAM_CHUNKS = [
  '### 解释\n\n这段**关键**内容涉及 `术语`：\n\n',
  `一段较长的说明用于撑开助手区，确认流式输出时自动跟随底部。${'这是同一段落的内容。'.repeat(60)}\n\n- 要点甲\n- 要点乙\n\n依据 [P1]。\n\n`,
  '```text\n[P1]\n```\n\n',
  '最后补充：滚动恢复后仍应停在底部。'
]

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

async function configureAndAsk(page: Page): Promise<void> {
  await page.getByTestId('book-item').first().waitFor()
  await page.getByTestId('book-item').first().click()
  await expect(page.getByTestId('reader-host')).toContainText('复杂概念')

  await page.getByTestId('settings-button').click()
  await page.getByTestId('settings-nav-model').click()
  await page.getByTestId('provider-base-url').fill(endpoint)
  await page.getByTestId('provider-model').fill('markdown-reader')
  await page.getByTestId('provider-api-key').fill('test-only-key')
  await page.getByTestId('provider-save').click()
  await expect(page.getByTestId('settings-modal')).toHaveCount(0)

  await selectNodeContents(page.getByTestId('reader-host').locator('p').first())
  await expect(page.getByTestId('selection-toolbar')).toBeVisible()
  await page.getByTestId('action-explain').click()
}

async function openInsightsWorkspace(page: Page): Promise<void> {
  await page.getByTestId('assistant-expand-button').click()
  await expect(page.getByTestId('assistant-dialog')).toBeVisible()
  await page.getByTestId('assistant-dialog-tab-insights').click()
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
        response.end(
          JSON.stringify({
            id: 'mock-assistant-markdown-test',
            model: 'mock-assistant-markdown',
            choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }]
          })
        )
        return
      }

      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      streamRequestCount += 1
      const chunks = streamRequestCount === 1 ? STREAM_CHUNKS : FOLLOW_UP_CHUNKS
      chunks.forEach((content, index) => {
        setTimeout(() => {
          if (response.writableEnded) return
          response.write(
            `data: ${JSON.stringify({ id: 'mock-assistant-markdown-stream', model: 'mock-assistant-markdown', choices: [{ index: 0, delta: { content } }] })}\n\n`
          )
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

test('renders assistant markdown without breaking citation navigation', async () => {
  const workspace = await createE2eWorkspace('assistant-markdown-e2e-')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({
      userData: workspace.userData,
      importPath: resolve('tests/fixtures/complex-reading.txt')
    })
    application = launched.application
    const { page } = launched
    await page.getByTestId('settings-button').click()
    await page.getByTestId('scale-125').click()
    await page.getByTestId('settings-close').click()
    await expect(page.getByTestId('settings-modal')).toHaveCount(0)
    await configureAndAsk(page)

    const answer = page.getByTestId('answer-current')
    await expect(answer.locator('.answer-model')).toHaveText('mock-assistant-markdown')
    await expect(answer.locator('h3')).toHaveText('解释')
    await expect(answer.locator('.answer-text strong')).toHaveText('关键')
    await expect(answer.locator('.answer-code-inline')).toHaveText('术语')
    await expect(answer.locator('ul li')).toHaveCount(2)
    await expect(answer.locator('blockquote')).toHaveCount(0)
    await expect(answer.locator('.answer-code-block')).toHaveText('[P1]')
    await expect(answer.locator('.answer-code-block .citation-valid')).toHaveCount(0)
    await expect(answer.locator('.citation-valid')).toHaveCount(1)
    await expect(answer.locator('.citation-valid')).not.toContainText('P1')
    await expect(answer).not.toContainText('**')
    await expect(answer).not.toContainText('```')

    await expect(answer.locator('.answer-footer')).toBeVisible()
    await expect(page.getByTestId('answer-save')).toContainText('归档')
    await page.getByTestId('answer-save').click()
    await openInsightsWorkspace(page)
    await expect(page.getByTestId('assistant-dialog-tab-insights')).toContainText('归档')

    const insight = page.getByTestId('insight-item')
    await expect(insight.locator('.answer-text h3')).toHaveText('解释')
    await expect(insight.locator('.answer-text strong')).toHaveText('关键')
    await expect(insight.locator('.answer-text .citation-valid')).toHaveCount(1)
    await expect(insight.locator('.answer-text .citation-valid')).not.toContainText('P1')
    await expect(insight.locator('.answer-code-block')).toHaveText('[P1]')
    await expect(insight.locator('.answer-text')).not.toContainText('**')
    await page.getByTestId('insight-delete').click()
    await expect(page.getByTestId('insight-delete-confirm')).toBeVisible()
    for (const id of ['insight-delete-confirm', 'insight-delete-cancel']) {
      const button = page.getByTestId(id)
      await expect.poll(() => button.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('nowrap')
      await expect.poll(() => button.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    }
    await page.getByTestId('insight-delete-cancel').click()
    await expect(page.getByTestId('insight-delete-confirm')).toHaveCount(0)

    await insight.locator('.insight-content').click()
    await expect(page.getByTestId('assistant-dialog')).toBeVisible()
    await expect(page.getByTestId('assistant-dialog-tab-insights')).toBeVisible()
    await expect(page.getByTestId('answer-current')).toBeVisible()
    await expect(page.getByTestId('answer-current').locator('.answer-model')).toHaveText('mock-assistant-markdown')
    await expect(page.locator('.question-bubble')).toContainText('请用清晰、准确的语言解释这段内容。')
    await expect(page.getByTestId('answer-current').locator('.answer-save')).toHaveCount(0)
    await expect(page.locator('.assistant-dialog .question-bubble')).toContainText('归档的回答')
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('keeps streaming answers pinned to the bottom until the reader scrolls away', async () => {
  const workspace = await createE2eWorkspace('assistant-scroll-e2e-')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({
      userData: workspace.userData,
      importPath: resolve('tests/fixtures/complex-reading.txt')
    })
    application = launched.application
    const { page } = launched
    await configureAndAsk(page)

    const scroller = page.locator('.assistant-scroll')
    const nearBottom = (): Promise<boolean> => scroller.evaluate((element) => (
      element.scrollHeight - element.scrollTop - element.clientHeight < 48
    ))

    // Chunk 1 is already visible; chunk 2 makes the conversation tall enough to scroll.
    await expect(page.getByTestId('answer-current')).toContainText('要点乙')
    await expect.poll(nearBottom).toBe(true)

    // Simulate the reader scrolling up while the stream is still running.
    await scroller.evaluate((element) => {
      element.scrollTop = 0
      element.dispatchEvent(new Event('scroll'))
    })
    await expect(page.getByTestId('answer-current').locator('.answer-code-block')).toBeVisible()
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0)

    // Scrolling back to the bottom should resume following.
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight
      element.dispatchEvent(new Event('scroll'))
    })
    await expect(page.getByTestId('answer-current')).toContainText('最后补充')
    await expect.poll(nearBottom).toBe(true)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('keeps archive follow-up history after reopening and restarting the app', async () => {
  const workspace = await createE2eWorkspace('assistant-archive-history-e2e-')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({
      userData: workspace.userData,
      importPath: resolve('tests/fixtures/complex-reading.txt')
    })
    application = launched.application
    const { page } = launched
    await configureAndAsk(page)
    await expect(page.getByTestId('answer-current').locator('.answer-footer')).toBeVisible()
    await page.getByTestId('answer-save').click()
    await openInsightsWorkspace(page)

    await page.getByTestId('insight-item').locator('.insight-content').click()
    await expect(page.getByTestId('assistant-dialog')).toBeVisible()
    const followup = page.getByTestId('followup-input')
    await followup.fill('追问：这个结论有什么边界？')
    await followup.press('Enter')
    await expect(page.getByTestId('answer-current')).toContainText('这是归档会话里的追问回答，应随归档历史一起保留。')
    await expect(page.locator('.assistant-dialog .question-bubble')).toHaveCount(2)

    await page.getByTestId('assistant-dialog-close').click()
    await expect(page.getByTestId('assistant-dialog')).toHaveCount(0)

    // The temporary sidebar conversation stays intact while the workspace is closed.
    await expect(page.getByTestId('answer-current')).toContainText('这段')
    await expect(page.locator('.question-bubble')).toHaveCount(1)
    await openInsightsWorkspace(page)
    await page.getByTestId('insight-item').locator('.insight-content').click()
    await expect(page.getByTestId('assistant-dialog')).toBeVisible()
    await expect(page.locator('.assistant-dialog .question-bubble')).toHaveCount(2)
    await expect(page.getByTestId('answer-current')).toContainText('这是归档会话里的追问回答，应随归档历史一起保留。')

    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application
    const restoredPage = restarted.page
    await restoredPage.getByTestId('book-item').first().click()
    await expect(restoredPage.getByTestId('reader-host')).toContainText('复杂概念')
    await expect(restoredPage.locator('.conversation-turn')).toHaveCount(0)
    await openInsightsWorkspace(restoredPage)
    await restoredPage.getByTestId('insight-item').locator('.insight-content').click()
    await expect(restoredPage.getByTestId('assistant-dialog')).toBeVisible()
    await expect(restoredPage.locator('.assistant-dialog .question-bubble')).toHaveCount(2)
    await expect(restoredPage.getByTestId('answer-current')).toContainText('这是归档会话里的追问回答，应随归档历史一起保留。')
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
