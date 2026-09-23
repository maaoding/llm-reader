import { expect, test, type ElectronApplication } from '@playwright/test'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { resolve } from 'node:path'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader, restartReader } from './support/electron-app'
import { showLibrary } from './support/workspace'

let server: Server, endpoint: string
const requests: Array<{ path: string; headers: IncomingHttpHeaders; body: string }> = []
test.beforeAll(async () => {
  server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      requests.push({ path: request.url!, headers: request.headers, body })
      response.setHeader('Content-Type', 'application/json')
      if (request.url?.endsWith('/models')) response.end(JSON.stringify({ data: [{ id: 'claude-fixture' }] }))
      else if (request.url?.endsWith('/messages')) {
        if (JSON.parse(body).stream) {
          response.setHeader('Content-Type', 'text/event-stream')
          response.end([
            { type: 'message_start', message: { model: 'claude-fixture' } },
            { type: 'content_block_delta', delta: { type: 'text_delta', text: 'OK' } },
            { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
            { type: 'message_stop' }
          ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''))
        } else response.end(JSON.stringify({ type: 'message', model: 'claude-fixture', stop_reason: 'end_turn', content: [{ type: 'text', text: 'OK' }] }))
      }
      else if (request.url?.endsWith('/ocr')) {
        const raw = JSON.parse(body) as { document: { image_url: string } }
        response.end(JSON.stringify({ pages: [{ index: 0, markdown: raw.document.image_url.startsWith('data:image/png') ? 'OCR' : '扫描原文：独立复核是必要条件。' }] }))
      } else if (request.url?.endsWith('/general/v0/general')) response.end(JSON.stringify([{ text: body.includes('page.png') ? 'OCR' : '扫描原文：独立复核是必要条件。', metadata: { page_number: 999 } }]))
      else response.writeHead(404).end()
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture unavailable')
  endpoint = `http://127.0.0.1:${address.port}`
})
test.beforeEach(() => { requests.length = 0 })
test.afterAll(async () => { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())) })

test('Claude settings use draft headers, support header-only authentication and survive restart', async () => {
  const workspace = await createE2eWorkspace('reader-claude-')
  let application: ElectronApplication | undefined
  try {
    let launched = await launchReader({ userData: workspace.userData })
    application = launched.application; let page = launched.page
    await page.getByTestId('settings-button').click(); await page.getByTestId('settings-nav-model').click()
    await page.getByTestId('provider-profile-name').fill('Claude 原生')
    await page.getByTestId('provider-protocol').selectOption('anthropic')
    await page.getByTestId('provider-base-url').fill(`${endpoint}/proxy/v1/messages`)
    await page.getByTestId('provider-model').fill('claude-fixture')
    await page.getByTestId('provider-advanced').locator('summary').click()
    await page.getByTestId('provider-headers').fill('{"x-api-key":"header-only-fixture","X-Project":"reading"}')
    await page.getByTestId('provider-body').fill('{"max_tokens":256,"temperature":0.2}')
    await page.getByTestId('provider-timeout').fill('30')
    await page.getByTestId('provider-test').click()
    await expect(page.getByTestId('provider-status')).toContainText('文本测试通过')
    expect(requests.at(-1)).toMatchObject({ path: '/proxy/v1/messages', headers: { 'x-api-key': 'header-only-fixture', 'anthropic-version': '2023-06-01', 'x-project': 'reading' } })
    expect(JSON.parse(requests.at(-1)!.body)).toMatchObject({ max_tokens: 256, temperature: 0.2, stream: false })
    await page.getByTestId('provider-test-stream').click()
    await expect(page.getByTestId('provider-status')).toContainText('流式测试通过')
    expect(JSON.parse(requests.at(-1)!.body)).toMatchObject({ max_tokens: 256, temperature: 0.2, stream: true })
    expect(await page.evaluate(() => window.readerApi.getProviderOverview().then((value) => value.profiles))).toHaveLength(0)
    await page.getByTestId('provider-models-fetch').click()
    await expect(page.locator('#provider-model-options option')).toHaveCount(1)
    await page.getByTestId('provider-save').click()
    await expect(page.getByTestId('provider-dirty-hint')).toHaveCount(0)
    await page.getByTestId('provider-activate').click()
    await expect(page.getByTestId('provider-connection-status')).toHaveAttribute('aria-label', 'API 连接正常')
    expect(JSON.stringify(await page.evaluate(() => window.readerApi.getProviderOverview()))).not.toContain('header-only-fixture')
    launched = await restartReader(application, { userData: workspace.userData }); application = launched.application; page = launched.page
    await page.getByTestId('settings-button').click(); await page.getByTestId('settings-nav-model').click()
    await expect(page.getByTestId('provider-protocol')).toHaveValue('anthropic')
    await page.getByTestId('provider-advanced').locator('summary').click()
    await expect(page.getByTestId('provider-headers')).toHaveValue('')
    await expect(page.getByTestId('provider-headers')).toHaveAttribute('placeholder', /已保存/)
    await expect(page.getByTestId('provider-timeout')).toHaveValue('30')
    await page.getByTestId('provider-test').click()
    await expect(page.getByTestId('provider-status')).toContainText('文本测试通过')
    await page.screenshot({ path: test.info().outputPath('claude-custom-settings.png') })
    await page.getByTestId('provider-base-url').fill(`${endpoint}/different`)
    const before = requests.length
    await page.getByTestId('provider-test').click()
    await expect(page.getByTestId('provider-status')).toContainText('重新填写')
    expect(requests).toHaveLength(before)
  } finally { await cleanupE2eWorkspace(application, workspace.root) }
})

for (const processor of ['mistral-ocr', 'unstructured'] as const) {
  test(`${processor} tests a sample, prepares a scanned PDF and reuses its pages after restart`, async () => {
    const workspace = await createE2eWorkspace('reader-document-providers-')
    let application: ElectronApplication | undefined
    try {
      let launched = await launchReader({ userData: workspace.userData, importPath: resolve('tests/e2e/fixtures/scanned-reader.pdf') })
      application = launched.application; let page = launched.page
      await showLibrary(page); await expect(page.getByTestId('book-item')).toBeVisible()
      await page.getByTestId('settings-button').click(); await page.getByTestId('settings-nav-knowledge').click()
      await page.getByTestId('document-processor').selectOption(processor)
      await page.getByTestId('document-url').fill(processor === 'mistral-ocr' ? `${endpoint}/mistral/v1` : `${endpoint}/partition/general/v0/general`)
      await page.locator('#document-key').fill('document-fixture')
      await page.getByTestId('document-advanced').locator('summary').click()
      await page.getByTestId('document-headers').fill('{"X-Document":"reading"}')
      await page.getByTestId('document-test').click()
      await expect(page.getByTestId('knowledge-status')).toContainText('样图文字识别成功')
      expect(requests).toHaveLength(1)
      expect(requests[0].headers['x-document']).toBe('reading')
      await page.getByTestId('knowledge-save').click(); await expect(page.getByTestId('knowledge-status')).toContainText('已保存')
      await page.getByTestId('settings-close').click()
      const bookId = await page.evaluate(async () => (await window.readerApi.listBooks())[0].id)
      await page.evaluate((id) => window.readerApi.prepareBookDocument({ bookId: id }), bookId)
      await expect.poll(() => page.evaluate(async (id) => (await window.readerApi.getBookAnalysis(id)).document?.status, bookId), { timeout: 20_000 }).toBe('ready')
      const state = await page.evaluate((id) => window.readerApi.getBookAnalysis(id), bookId)
      expect(state.document?.ocrProgress).toEqual({ completed: 1, total: 1 })
      expect(requests).toHaveLength(2)
      if (processor === 'unstructured') expect(requests.at(-1)?.headers['content-type']).toContain('multipart/form-data; boundary=')
      launched = await restartReader(application, { userData: workspace.userData }); application = launched.application; page = launched.page
      await page.evaluate((id) => window.readerApi.prepareBookDocument({ bookId: id, rebuild: true }), bookId)
      await expect.poll(() => page.evaluate(async (id) => (await window.readerApi.getBookAnalysis(id)).document?.status, bookId)).toBe('ready')
      expect(requests).toHaveLength(2)
    } finally { await cleanupE2eWorkspace(application, workspace.root) }
  })
}
