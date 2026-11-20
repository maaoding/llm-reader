import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader, restartReader } from './support/electron-app'

let server: Server
let endpoint = ''
const questions: string[] = []
const fixture = resolve('tests/fixtures/complex-reading.txt')

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw || '{}') as { stream?: boolean }
    if (request.url?.endsWith('/models')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'onboarding-model' }] }))
    } else if (body.stream) {
      questions.push(raw)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '理解概念时，需要区分定义、成立条件和适用边界。[P1]' } }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`)
      response.end('data: [DONE]\n\n')
    } else {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }))
    }
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Local model unavailable')
  endpoint = `http://127.0.0.1:${address.port}`
})
test.beforeEach(() => { questions.length = 0 })
test.afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((done) => server.close(() => done()))
})

async function importBook(application: ElectronApplication, page: Page, filePath = fixture) {
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path], bookmarks: [] })
  }, filePath)
  await page.getByTestId('import-book').click()
  await expect(page.locator('.reader-surface')).toHaveClass(/is-ready/)
}

async function selectPassage(page: Page) {
  await page.locator('[data-reader-paragraph="0"]').evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  await expect(page.getByTestId('selection-toolbar')).toBeVisible()
}

async function screenshot(page: Page, name: string) {
  const path = test.info().outputPath(name)
  await page.screenshot({ path, animations: 'disabled' })
  await test.info().attach(name, { path, contentType: 'image/png' })
}

test('first explanation configures a model without an error turn and continues only when requested', async () => {
  const workspace = await createE2eWorkspace('llm-reader-onboarding-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData })
    application = launched.application
    const { page } = launched
    await expect(page.getByTestId('library-first-import')).toBeVisible()
    await expect(page.getByTestId('library-list')).toContainText('AI 功能可稍后配置')
    await expect(page.getByTestId('provider-connection-status')).toHaveClass(/is-not-configured/)
    await screenshot(page, 'empty-library.png')
    await importBook(application, page)
    await expect(page.getByTestId('reading-guide')).toBeVisible()
    await selectPassage(page)
    await page.getByTestId('action-explain').click()
    await expect(page.locator('#settings-panel-model')).toBeVisible()
    await expect(page.getByTestId('answer-current')).toHaveCount(0)
    await expect(page.getByTestId('provider-profile-name')).not.toHaveValue('')
    expect(questions).toHaveLength(0)

    await page.getByTestId('settings-nav-appearance').click()
    await page.getByTestId('theme-dark').click()
    await page.getByTestId('scale-125').click()
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(940, 600))
    await page.getByTestId('settings-nav-model').click()
    const saveBounds = await page.getByTestId('provider-activate').boundingBox()
    expect(saveBounds).not.toBeNull()
    expect(saveBounds!.y + saveBounds!.height).toBeLessThanOrEqual(600)
    await screenshot(page, 'first-model-940-dark-125.png')
    await page.getByTestId('provider-base-url').fill(endpoint)
    await page.getByTestId('provider-api-key').fill('synthetic-onboarding-key')
    await page.getByTestId('provider-models-fetch').click()
    await expect(page.getByTestId('provider-models-status')).toContainText('已获取 1 个模型')
    await page.getByTestId('provider-model-options-toggle').click()
    await expect(page.locator('#provider-model-options [role="option"]')).toHaveCount(1)
    await page.locator('#provider-model-options [role="option"]').click()
    await page.getByTestId('provider-activate').click()
    await expect(page.getByTestId('provider-continue')).toBeVisible()
    expect(questions).toHaveLength(0)
    await page.getByTestId('settings-close').click()
    await expect(page.getByTestId('pending-action-continue')).toContainText('解释这段')
    await expect(page.getByTestId('answer-current')).toHaveCount(0)
    await page.getByTestId('pending-action-continue').click()
    await expect(page.getByTestId('answer-save')).toBeVisible()
    expect(questions).toHaveLength(1)
    expect(questions[0]).toContain('理解一个复杂概念')
    await expect(page.locator('.turn-error')).toHaveCount(0)
    await expect(page.getByTestId('pending-selection-action')).toHaveCount(0)
    await expect(page.getByTestId('answer-guide')).toBeVisible()
    await page.getByTestId('answer-guide-dismiss').click()
    await screenshot(page, 'first-answer.png')
  } finally { await cleanupE2eWorkspace(application, workspace.root) }
})

test('cancelling setup preserves the draft and changing books discards the pending action', async () => {
  const workspace = await createE2eWorkspace('llm-reader-onboarding-cancel-')
  let application: ElectronApplication | undefined
  try {
    const { application: launched, page } = await launchReader({ userData: workspace.userData })
    application = launched
    await importBook(application, page)
    await page.getByTestId('followup-input').fill('保留这条整本书草稿')
    await selectPassage(page)
    await page.getByTestId('action-context').click()
    await expect(page.locator('#settings-panel-model')).toBeVisible()
    await page.getByTestId('settings-close').click()
    await expect(page.getByTestId('followup-input')).toHaveValue('保留这条整本书草稿')
    await expect(page.getByTestId('pending-selection-action')).toBeVisible()
    await expect(page.getByTestId('answer-current')).toHaveCount(0)
    await page.getByTestId('nav-library').click()
    const second = join(workspace.root, 'another-book.txt')
    await writeFile(second, '另一本书\n\n这本书有独立的会话与阅读位置。')
    await importBook(application, page, second)
    await expect(page.getByTestId('pending-selection-action')).toHaveCount(0)
    expect(questions).toHaveLength(0)
  } finally { await cleanupE2eWorkspace(application, workspace.root) }
})

test('tips stay dismissed after restart, replay in English and lead from preparation to the question', async () => {
  const workspace = await createE2eWorkspace('llm-reader-onboarding-tips-')
  let application: ElectronApplication | undefined
  try {
    let launched = await launchReader({ userData: workspace.userData })
    application = launched.application
    let page = launched.page
    await importBook(application, page)
    await expect(page.getByTestId('reading-guide')).toBeVisible()
    await page.getByTestId('reading-guide-dismiss').click()
    launched = await restartReader(application, { userData: workspace.userData })
    application = launched.application
    page = launched.page
    await expect(page.locator('.reader-surface')).toHaveClass(/is-ready/)
    await expect(page.getByTestId('reading-guide')).toHaveCount(0)
    await page.getByTestId('settings-button').click()
    await page.getByTestId('ui-language-en').click()
    await page.getByTestId('settings-nav-about').click()
    await expect(page.getByTestId('quick-start')).toContainText('Ask about a passage')
    await page.getByTestId('quick-start').scrollIntoViewIfNeeded()
    await screenshot(page, 'quick-start-english.png')
    await page.getByTestId('guide-replay').click()
    await expect(page.getByTestId('reading-guide')).toContainText('Start with a passage')
    await page.getByTestId('guide-prepare').click()
    await page.getByTestId('document-prepare').click()
    await expect(page.getByTestId('document-ask')).toBeVisible()
    await expect(page.getByTestId('optional-enhancements')).not.toHaveAttribute('open')
    await expect(page.getByTestId('analysis-start')).not.toHaveClass('primary-button')
    await screenshot(page, 'prepared-book.png')
    await page.getByTestId('document-ask').click()
    await expect(page.getByTestId('book-preparation-dialog')).toHaveCount(0)
    await expect(page.getByTestId('scope-book')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('followup-input')).toBeFocused()
    await page.getByTestId('workspace-tab-conversation').click()
    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-model').click()
    await page.getByTestId('provider-base-url').fill(endpoint)
    await page.getByTestId('provider-model').fill('onboarding-model')
    await page.getByTestId('provider-api-key').fill('synthetic-onboarding-key')
    await page.getByTestId('provider-activate').click()
    await page.getByTestId('provider-continue').click()
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-page', 'reading')
    expect(questions).toHaveLength(0)
  } finally { await cleanupE2eWorkspace(application, workspace.root) }
})

test('continues the selected explanation directly from saved model settings', async () => {
  const workspace = await createE2eWorkspace('llm-reader-onboarding-continue-')
  let application: ElectronApplication | undefined
  try {
    const { application: launched, page } = await launchReader({ userData: workspace.userData })
    application = launched
    await importBook(application, page)
    await selectPassage(page)
    await page.getByTestId('action-explain').click()
    await page.getByTestId('provider-base-url').fill(endpoint)
    await page.getByTestId('provider-model').fill('onboarding-model')
    await page.getByTestId('provider-api-key').fill('synthetic-onboarding-key')
    await page.getByTestId('provider-activate').click()
    await expect(page.getByTestId('provider-continue')).toContainText('解释这段')
    expect(questions).toHaveLength(0)
    await page.getByTestId('provider-continue').click()
    await expect(page.getByTestId('settings-modal')).toHaveCount(0)
    await expect(page.getByTestId('answer-save')).toBeVisible()
    expect(questions).toHaveLength(1)
  } finally { await cleanupE2eWorkspace(application, workspace.root) }
})
