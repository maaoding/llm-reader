import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Locator
} from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

let mockServer: Server
let endpoint = ''
let streamRequestCount = 0
let latestStreamPrompt = ''

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
      const body = JSON.parse(rawBody) as {
        stream?: boolean
        messages?: Array<{ content: string }>
      }

      if (!body.stream) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            id: 'mock-assistant-test',
            model: 'mock-assistant-reader',
            choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }]
          })
        )
        return
      }

      streamRequestCount += 1
      latestStreamPrompt = body.messages?.at(-1)?.content ?? ''
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      response.write(
        `data: ${JSON.stringify({ id: 'mock-assistant-stream', model: 'mock-assistant-reader', choices: [{ index: 0, delta: { content: '自定义提示词已收到。' } }] })}\n\n`
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

test('customizes selection action names and prompts and restores them after restart', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'assistant-actions-e2e-'))
  let application: ElectronApplication | undefined

  try {
    application = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        LLM_READER_USER_DATA: userData,
        LLM_READER_E2E_IMPORT: resolve('tests/fixtures/complex-reading.txt')
      }
    })
    const page = await application.firstWindow()
    await expect(page.getByTestId('book-item').first()).toBeVisible()
    await page.getByTestId('book-item').first().click()
    await expect(page.getByTestId('reader-host')).toContainText('复杂概念')

    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-model').click()
    await page.getByTestId('provider-base-url').fill(endpoint)
    await page.getByTestId('provider-model').fill('assistant-actions-reader')
    await page.getByTestId('provider-api-key').fill('test-only-key')
    await page.getByTestId('provider-save').click()
    await expect(page.getByTestId('settings-modal')).toHaveCount(0)

    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-assistant').click()
    await expect(page.getByTestId('settings-modal')).toBeVisible()
    await expect(page.getByTestId('settings-nav-assistant')).toHaveAttribute('aria-selected', 'true')

    await page.getByTestId('assistant-explain-label').fill('通俗解释')
    await page.getByTestId('assistant-explain-prompt').fill('请用通俗语言解释这段内容。')
    await page.getByTestId('assistant-context-label').fill('看上下文')
    await page.getByTestId('assistant-context-prompt').fill('请结合上下文分析这段内容的论证作用。')
    await page.getByTestId('assistant-ask-label').fill('直接问')
    await page.getByTestId('settings-close').click()
    await expect(page.getByTestId('settings-modal')).toHaveCount(0)

    await selectNodeContents(page.getByTestId('reader-host').locator('p').first())
    await expect(page.getByTestId('selection-toolbar')).toBeVisible()
    await expect(page.getByTestId('action-explain')).toContainText('通俗解释')
    await expect(page.getByTestId('action-context')).toContainText('看上下文')
    await expect(page.getByTestId('action-ask')).toContainText('直接问')

    await page.getByTestId('action-explain').click()
    await expect(page.getByTestId('answer-current')).toContainText('自定义提示词已收到。')
    await expect(page.locator('.question-bubble')).toContainText('通俗解释')
    await expect.poll(() => latestStreamPrompt).toContain('读者请求：请用通俗语言解释这段内容。')
    expect(streamRequestCount).toBeGreaterThanOrEqual(1)

    await application.close()
    application = undefined

    application = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        LLM_READER_USER_DATA: userData,
        LLM_READER_E2E_IMPORT: resolve('tests/fixtures/complex-reading.txt')
      }
    })
    const restoredPage = await application.firstWindow()
    await expect(restoredPage.getByTestId('book-item').first()).toBeVisible()
    await restoredPage.getByTestId('book-item').first().click()
    await expect(restoredPage.getByTestId('reader-host')).toContainText('复杂概念')

    await selectNodeContents(restoredPage.getByTestId('reader-host').locator('p').first())
    await expect(restoredPage.getByTestId('selection-toolbar')).toBeVisible()
    await expect(restoredPage.getByTestId('action-explain')).toContainText('通俗解释')

    await restoredPage.getByTestId('settings-button').click()
    await restoredPage.getByTestId('settings-nav-assistant').click()
    await expect(restoredPage.getByTestId('assistant-explain-label')).toHaveValue('通俗解释')
    await expect(restoredPage.getByTestId('assistant-explain-prompt')).toHaveValue('请用通俗语言解释这段内容。')
    await expect(restoredPage.getByTestId('assistant-context-label')).toHaveValue('看上下文')
    await expect(restoredPage.getByTestId('assistant-context-prompt')).toHaveValue('请结合上下文分析这段内容的论证作用。')
    await expect(restoredPage.getByTestId('assistant-ask-label')).toHaveValue('直接问')

    await restoredPage.getByTestId('assistant-actions-reset').click()
    await expect(restoredPage.getByTestId('assistant-explain-label')).toHaveValue('解释这段')
    await expect(restoredPage.getByTestId('assistant-explain-prompt')).toHaveValue('请用清晰、准确的语言解释这段内容。')
    await expect(restoredPage.getByTestId('assistant-context-label')).toHaveValue('联系上下文')
    await expect(restoredPage.getByTestId('assistant-context-prompt')).toHaveValue('请结合本章上下文说明这段内容的含义与作用。')
    await expect(restoredPage.getByTestId('assistant-ask-label')).toHaveValue('自由提问')
    await restoredPage.getByTestId('settings-close').click()

    await expect(restoredPage.getByTestId('selection-toolbar')).toBeVisible()
    await expect(restoredPage.getByTestId('action-explain')).toContainText('解释这段')
    await expect(restoredPage.getByTestId('action-context')).toContainText('联系上下文')
    await expect(restoredPage.getByTestId('action-ask')).toContainText('自由提问')
  } finally {
    await application?.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
})
