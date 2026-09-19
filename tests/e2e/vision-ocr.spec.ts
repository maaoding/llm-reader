import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { resolve } from 'node:path'
import type { ContextSnapshot } from '../../src/shared/contracts'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader, restartReader } from './support/electron-app'
import { enterReading, hidePreparation, showLibrary, showPreparation } from './support/workspace'

let server: Server, endpoint = '', holdPages = false
const images: { image: string; session: string | undefined; authorization: string | undefined }[] = []
test.beforeAll(async () => {
  server = createServer((request, response) => {
    let raw = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { raw += chunk })
    request.on('end', () => {
      if (request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return }
      const body = JSON.parse(raw) as { model: string; messages: { content: string | { type: string; image_url?: { url: string } }[] }[] }
      const user = body.messages.at(-1)!.content
      const image = Array.isArray(user) ? user.find((part) => part.type === 'image_url')?.image_url?.url : undefined
      let content = '连接成功'
      if (image) {
        images.push({ image, session: request.headers['x-opencode-session'] as string | undefined, authorization: request.headers.authorization })
        if (image.startsWith('data:image/jpeg') && holdPages && pageImages().length > 1) return
        content = image.startsWith('data:image/png') ? 'OCR' : '扫描原文：独立复核是必要条件。'
      } else if (typeof user === 'string') {
        const system = String(body.messages[0].content)
        if (system.includes('为阅读问题')) content = '{"chapters":[],"terms":["独立复核"]}'
        else if (system.includes('你是阅读助手')) {
          const context = JSON.parse(user.split('\n')[1]) as ContextSnapshot
          const passage = context.passages.find((item) => item.text.includes('独立复核'))
          content = passage ? `书中要求独立复核。[${passage.id}]` : '未取到扫描原文。'
        }
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ model: body.model, choices: [{ message: { content }, finish_reason: 'stop' }] }))
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture server unavailable')
  endpoint = `http://127.0.0.1:${address.port}/v1`
})
test.beforeEach(() => { images.length = 0; holdPages = false })
test.afterAll(async () => { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())) })
const pageImages = () => images.filter((item) => item.image.startsWith('data:image/jpeg'))
const status = (page: Page, bookId: string) => page.evaluate((id) => window.readerApi.getBookAnalysis(id).then((value) => value.document?.status), bookId)

test('vision settings recognize scanned PDF images and support cited, archived questions across restart', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-vision-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: resolve('tests/e2e/fixtures/scanned-reader.pdf') })
    application = launched.application; let page = launched.page
    await showLibrary(page); await expect(page.getByTestId('book-item')).toBeVisible()
    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-knowledge').click()
    await page.getByTestId('document-processor').selectOption('vision')
    await page.getByTestId('document-url').fill(endpoint)
    await page.getByTestId('document-model').fill('vision-fixture')
    await page.locator('#document-key').fill('ocr-only')
    await page.locator('#document-compatibility').selectOption('opencode-go')
    await page.getByTestId('document-test').click()
    await expect(page.getByTestId('knowledge-status')).toContainText('样图文字识别成功')
    expect(pageImages()).toHaveLength(0)
    expect(await page.evaluate(() => window.readerApi.getKnowledgeSettings().then((value) => value.document.processor))).toBe('none')
    await page.getByTestId('knowledge-save').click()
    await expect(page.getByTestId('knowledge-status')).toContainText('已保存')
    await page.screenshot({ path: test.info().outputPath('vision-settings.png') })
    await page.getByTestId('settings-close').click()
    await page.evaluate(async (baseUrl) => {
      const overview = await window.readerApi.createProviderProfile({ name: '提问模型', baseUrl, model: 'qa-fixture', apiKey: 'qa-only' })
      await window.readerApi.activateProviderProfile(overview.profiles[0].id)
    }, endpoint)
    await page.reload(); await showLibrary(page); await page.getByTestId('book-item').click(); await enterReading(page)
    await expect(page.getByTestId('pdf-no-text-banner')).toBeVisible()
    const bookId = await page.evaluate(async () => (await window.readerApi.listBooks())[0].id)
    await showPreparation(page)
    await expect(page.getByTestId('analysis-details')).toContainText('逐页发送图片')
    await page.getByTestId('document-prepare').click()
    await expect.poll(() => status(page, bookId), { timeout: 20_000 }).toBe('ready')
    await expect(page.getByTestId('ocr-progress')).toHaveText('已识别 1/1 页')
    expect(pageImages()).toHaveLength(1)
    expect(Buffer.from(pageImages()[0].image.split(',')[1], 'base64').subarray(0, 2).toString('hex')).toBe('ffd8')
    expect(pageImages()[0]).toMatchObject({ authorization: 'Bearer ocr-only', session: expect.stringMatching(/^[\da-f-]{36}$/u) })
    await hidePreparation(page)
    await page.getByTestId('scope-book').click()
    await page.getByTestId('followup-input').fill('扫描书中提到什么必要条件？')
    await page.getByTestId('followup-input').press('Enter')
    await expect(page.getByTestId('answer-current')).toContainText('书中要求独立复核')
    await page.getByTestId('citation-valid').click()
    await expect(page.locator('.toast.is-error')).toHaveCount(0)
    await page.getByTestId('answer-save').click()
    await expect.poll(() => page.evaluate(async (id) => (await window.readerApi.listInsights(id)).length, bookId)).toBe(1)
    const archived = await page.evaluate(async (id) => (await window.readerApi.listInsights(id))[0], bookId)
    expect(archived.context?.passages).toContainEqual(expect.objectContaining({ anchor: 'pdfpos:1:0', sources: [expect.objectContaining({ page: 1 })] }))
    await page.screenshot({ path: test.info().outputPath('vision-citation.png') })
    const restarted = await restartReader(application, { userData: workspace.userData }); application = restarted.application; page = restarted.page
    await showLibrary(page)
    expect(await status(page, bookId)).toBe('ready')
    await page.evaluate((id) => window.readerApi.prepareBookDocument({ bookId: id, rebuild: true }), bookId)
    await expect.poll(() => status(page, bookId)).toBe('ready')
    expect(pageImages()).toHaveLength(1)
  } finally { server.closeAllConnections(); await cleanupE2eWorkspace(application, workspace.root) }
})

test('multi-page OCR keeps completed pages when paused and resumes only on request after restart', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-vision-pause-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: resolve('tests/e2e/fixtures/text-reader.pdf') })
    application = launched.application; let page = launched.page
    await showLibrary(page); await expect(page.getByTestId('book-item')).toBeVisible()
    await page.evaluate((baseUrl) => window.readerApi.saveKnowledgeSettings({ embedding: { enabled: false, baseUrl: '', model: '' },
      document: { processor: 'vision', baseUrl, model: 'vision-fixture', apiKey: 'ocr-only', compatibility: 'opencode-go', ocr: true, language: 'ch' } }), endpoint)
    const bookId = await page.evaluate(async () => (await window.readerApi.listBooks())[0].id)
    holdPages = true
    await page.evaluate((id) => window.readerApi.prepareBookDocument({ bookId: id }), bookId)
    await expect.poll(() => pageImages().length, { timeout: 20_000 }).toBe(2)
    await page.evaluate((id) => window.readerApi.cancelBookDocument(id), bookId)
    expect(await status(page, bookId)).toBe('paused')
    const progress = await page.evaluate((id) => window.readerApi.getBookAnalysis(id).then((value) => value.document?.ocrProgress), bookId)
    expect(progress?.completed).toBe(1)
    expect(progress?.total).toBeGreaterThan(1)
    const restarted = await restartReader(application, { userData: workspace.userData }); application = restarted.application; page = restarted.page
    await showLibrary(page)
    expect(await status(page, bookId)).toBe('paused')
    expect(pageImages()).toHaveLength(2)
    holdPages = false
    await page.evaluate((id) => window.readerApi.prepareBookDocument({ bookId: id }), bookId)
    await expect.poll(() => status(page, bookId), { timeout: 20_000 }).toBe('ready')
    expect(pageImages()).toHaveLength(progress!.total + 1)
    expect(new Set(pageImages().map((item) => item.session)).size).toBe(1)
  } finally { server.closeAllConnections(); await cleanupE2eWorkspace(application, workspace.root) }
})
