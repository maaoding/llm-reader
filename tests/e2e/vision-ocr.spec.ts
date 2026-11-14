import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { resolve } from 'node:path'
import type { ContextSnapshot } from '../../src/shared/contracts'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader, restartReader } from './support/electron-app'
import { enterReading, hidePreparation, resizeWorkspace, showLibrary, showPreparation } from './support/workspace'

let server: Server, endpoint = '', holdPages = false
let failNextPage = false, pageText = '扫描原文：独立复核是必要条件。'
let pageContents: string[] | null = null
const images: { image: string; session: string | undefined; authorization: string | undefined }[] = []
const paddleRequests: Record<string, unknown>[] = []
const scannedLines = ['扫描页测试', '这些字只存在于图片中，不应产生文字层。']

function paddleFixture(file: string) {
  const bytes = Buffer.from(file, 'base64')
  const sample = bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  const width = sample ? bytes.readUInt32BE(16) : 1785
  const height = sample ? bytes.readUInt32BE(20) : 2525
  const lines = sample ? ['OCR'] : scannedLines
  const wordBoxes = sample ? [[[width * 0.05, height * 0.15, width * 0.9, height * 0.85]]] : lines.map((line, index) => Array.from(line, (_, col) => {
    const em = index ? 32 : 54, y = index ? 285 : 185
    return [(130 + col * em) / 1240 * width, y / 1754 * height, (130 + (col + 1) * em) / 1240 * width, (y + em) / 1754 * height]
  }))
  return { errorCode: 0, result: { dataInfo: { type: 'image', width, height }, ocrResults: [{ prunedResult: {
    rec_texts: lines, text_word: sample ? [['OCR']] : lines.map((line) => Array.from(line)),
    text_word_boxes: wordBoxes, rec_boxes: wordBoxes.map((row) => [row[0][0], row[0][1], row.at(-1)![2], row[0][3]]),
    model_settings: { use_doc_preprocessor: false, use_textline_orientation: false }
  } }] } }
}
test.beforeAll(async () => {
  server = createServer((request, response) => {
    let raw = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { raw += chunk })
    request.on('end', () => {
      if (request.url === '/v1/ocr') {
        const { file, ...options } = JSON.parse(raw) as Record<string, unknown>
        paddleRequests.push(options)
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(paddleFixture(String(file))))
        return
      }
      if (request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return }
      const body = JSON.parse(raw) as { model: string; messages: { content: string | { type: string; image_url?: { url: string } }[] }[] }
      const user = body.messages.at(-1)!.content
      const image = Array.isArray(user) ? user.find((part) => part.type === 'image_url')?.image_url?.url : undefined
      let content = '连接成功'
      if (image) {
        images.push({ image, session: request.headers['x-opencode-session'] as string | undefined, authorization: request.headers.authorization })
        if (image.startsWith('data:image/jpeg') && holdPages && pageImages().length > 1) return
        if (image.startsWith('data:image/jpeg') && failNextPage) { failNextPage = false; response.writeHead(502).end(); return }
        content = image.startsWith('data:image/png') ? 'OCR' : pageContents?.[pageImages().length - 1] ?? pageText
      } else if (typeof user === 'string') {
        const system = String(body.messages[0].content)
        if (system.includes('为阅读问题')) content = '{"chapters":[],"terms":["独立复核"]}'
        else if (system.includes('你是阅读助手')) {
          const context = JSON.parse(user.split('\n')[1]) as ContextSnapshot & { selectedPassageId?: string }
          const passage = context.passages.find((item) => item.text.includes('独立复核'))
          const positioned = context.passages.find((item) => item.id === context.selectedPassageId && item.text === '这些字')
          content = passage ? `书中要求独立复核。[${passage.id}]` : positioned ? `这是所选文字。[${positioned.id}]` : '未取到扫描原文。'
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
test.beforeEach(() => { images.length = 0; paddleRequests.length = 0; holdPages = false; failNextPage = false; pageText = '扫描原文：独立复核是必要条件。'; pageContents = null })
test.afterAll(async () => { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())) })
const pageImages = () => images.filter((item) => item.image.startsWith('data:image/jpeg'))
const status = (page: Page, bookId: string) => page.evaluate((id) => window.readerApi.getBookAnalysis(id).then((value) => value.document?.status), bookId)
async function selectOcrText(page: Page, quote: string) {
  await page.getByTestId('ocr-reading-text').evaluate((element, value) => {
    const text = element.firstChild!, start = text.textContent!.indexOf(value)
    if (start < 0) throw new Error('Selection fixture missing')
    const range = document.createRange(); range.setStart(text, start); range.setEnd(text, start + value.length)
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }, quote)
}

async function dragScanWords(page: Page, sheet: Locator, first: [number, number], last: [number, number]): Promise<void> {
  const bounds = await sheet.boundingBox()
  if (!bounds) throw new Error('Scan page has no bounds')
  await page.mouse.move(bounds.x + bounds.width * first[0], bounds.y + bounds.height * first[1])
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * last[0], bounds.y + bounds.height * last[1], { steps: 12 })
  await expect(sheet.getByTestId('pdf-ocr-drag')).toBeVisible()
  await page.mouse.up()
}

test('selects, reviews and cites PaddleOCR words on the original scan across zoom and restart', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-positioned-ocr-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: resolve('tests/e2e/fixtures/scanned-reader.pdf') })
    application = launched.application
    let page = launched.page
    await showLibrary(page)
    await expect(page.getByTestId('book-item')).toBeVisible()
    await resizeWorkspace(application, page, 1180, 800)
    await page.getByTestId('settings-button').click()
    await page.getByTestId('theme-light').click()
    await page.getByTestId('scale-100').click()
    await page.getByTestId('settings-nav-knowledge').click()
    await page.getByTestId('document-config').locator('summary').first().click()
    await page.getByTestId('document-processor').selectOption('paddle-ocr')
    await page.getByTestId('document-url').fill(endpoint + '/ocr')
    await page.getByTestId('document-test').click()
    await expect(page.getByTestId('knowledge-document-status')).toContainText('样图文字识别成功')
    await page.getByTestId('document-save').click()
    await expect(page.getByTestId('knowledge-document-status')).toContainText('已保存')
    await page.getByTestId('settings-close').click()
    const bookId = await page.evaluate(async (baseUrl) => {
      const overview = await window.readerApi.createProviderProfile({ name: 'OCR 选区引用', baseUrl, model: 'qa-fixture', apiKey: 'test-only-key' })
      await window.readerApi.activateProviderProfile(overview.profiles[0].id)
      return (await window.readerApi.listBooks())[0].id
    }, endpoint)
    await page.reload()
    await showLibrary(page)
    await page.getByTestId('book-item').click()
    await enterReading(page)
    const sheet = page.locator('.pdf-page[data-page-number="1"]')
    await expect(page.getByTestId('pdf-no-text-banner')).toBeVisible()
    await expect(sheet.locator('.pdf-ocr-hit-layer')).toHaveCount(0)
    await showPreparation(page)
    await page.getByTestId('ocr-preview-start').click()
    await expect(page.getByTestId('ocr-preview-text')).toContainText(scannedLines[0])
    await page.getByTestId('document-prepare').click()
    await expect.poll(() => status(page, bookId)).toBe('ready')
    await hidePreparation(page)
    await expect(sheet).toHaveAttribute('data-ocr-selectable', 'true')
    expect(paddleRequests).toHaveLength(2)
    expect(paddleRequests[1]).toMatchObject({ fileType: 1, returnWordBox: true, useDocUnwarping: false, visualize: false })
    const center = (character: number): [number, number] => [(130 + (character + 0.5) * 32) / 1240, 301 / 1754]
    // Pointer capture must not turn a drag outside the source page into a quote.
    const host = page.getByTestId('reader-host')
    const sheetBounds = (await sheet.boundingBox())!
    const hostBounds = (await host.boundingBox())!
    await dragScanWords(page, sheet, center(0), [(hostBounds.x - sheetBounds.x + 4) / sheetBounds.width, center(0)[1]])
    await expect(page.getByTestId('pdf-selection-review')).toHaveCount(0)
    await expect(page.locator('.toast')).toContainText('同一页、同一栏')
    await dragScanWords(page, sheet, center(0), center(2))
    await expect(page.getByTestId('pdf-selection-review-input')).toHaveValue('这些字')
    await expect(page.getByTestId('pdf-selection-review')).toContainText('校对 OCR 选区')
    await expect.poll(() => page.getByTestId('pdf-ocr-review-image').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
    await page.screenshot({ path: test.info().outputPath('scan-ocr-review-light.png'), animations: 'disabled' })
    await page.getByTestId('pdf-selection-review-cancel').click()
    await expect(sheet.getByTestId('pdf-ocr-drag')).toHaveCount(0)
    await expect(page.getByTestId('selection-toolbar')).toBeHidden()

    await page.getByTestId('reader-settings-button').click()
    await page.getByRole('button', { name: '放大', exact: true }).click()
    await expect(sheet).toHaveAttribute('aria-busy', 'false')
    await dragScanWords(page, sheet, center(9), center(6))
    await expect(page.getByTestId('pdf-selection-review-input')).toHaveValue('于图片中')
    await page.getByTestId('pdf-selection-review-input').fill('于图片中（已校对）')
    await page.getByTestId('pdf-selection-review-confirm').click()
    const selectionToolbar = page.getByTestId('selection-toolbar')
    await expect(selectionToolbar).toBeVisible()
    const toolbarBounds = (await selectionToolbar.boundingBox())!
    const selectedLine = (await sheet.getByTestId('pdf-region-selection').locator('span').boundingBox())!
    expect(Math.min(Math.abs(toolbarBounds.y - selectedLine.y - selectedLine.height),
      Math.abs(toolbarBounds.y + toolbarBounds.height - selectedLine.y))).toBeLessThan(30)
    await page.getByTestId('action-save-highlight').click()
    const [saved] = await page.evaluate((id) => window.readerApi.listHighlights(id), bookId)
    expect(saved.quote).toBe('于图片中（已校对）')
    expect(saved.anchor).toMatch(/^pdfocrrect:1:/u)
    await dragScanWords(page, sheet, center(0), center(2))
    await page.getByTestId('pdf-selection-review-confirm').click()
    await page.getByTestId('action-explain').click()
    await expect(page.getByTestId('answer-current')).toContainText('这是所选文字')
    await page.getByTestId('citation-valid').click()
    const citation = sheet.locator('.pdf-region-overlay.is-temporary')
    await expect(citation).toBeInViewport()
    await expect(citation).toHaveAttribute('data-region-anchor', /^pdfrect:1:0\.1048/u)

    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application
    page = restarted.page
    await showLibrary(page)
    await resizeWorkspace(application, page, 940, 600)
    await page.getByTestId('settings-button').click()
    await page.getByTestId('theme-dark').click()
    await page.getByTestId('scale-125').click()
    await page.getByTestId('settings-close').click()
    await page.getByTestId('book-item').click()
    const restored = page.locator('.pdf-page[data-ocr-selectable="true"]')
    await expect(restored.locator('.pdf-region-overlay.is-persistent')).toBeVisible()
    await page.getByTestId('highlights-tab').click()
    await page.getByTestId('highlight-item').filter({ hasText: saved.quote }).locator('.highlight-jump').click()
    await expect(restored.locator('.pdf-region-overlay.is-temporary')).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath('scan-ocr-extract-dark.png'), animations: 'disabled' })
    expect(paddleRequests).toHaveLength(2)
  } finally {
    server.closeAllConnections()
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('reads cached OCR text, selects passages for cited questions and restores the reader after restart', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-ocr-reading-')
  let application: ElectronApplication | undefined
  try {
    let launched = await launchReader({ userData: workspace.userData, importPath: resolve('tests/e2e/fixtures/scanned-reader.pdf') })
    application = launched.application; let page = launched.page
    await showLibrary(page)
    await page.evaluate(async (baseUrl) => {
      await window.readerApi.saveKnowledgeSettings({ embedding: { enabled: false, baseUrl: '', model: '' }, document: { processor: 'vision', baseUrl, model: 'vision-fixture', apiKey: 'ocr-only', ocr: true, language: 'ch' } })
      const profiles = await window.readerApi.createProviderProfile({ name: '提问模型', baseUrl, model: 'qa-fixture', apiKey: 'qa-only' })
      await window.readerApi.activateProviderProfile(profiles.profiles[0].id)
    }, endpoint)
    await page.reload(); await showLibrary(page); await page.getByTestId('book-item').click(); await enterReading(page)
    await page.getByTestId('settings-button').click()
    await page.getByTestId('theme-light').click()
    await page.getByTestId('scale-100').click()
    await page.getByTestId('settings-close').click()
    await resizeWorkspace(application, page, 1180, 800)
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme', 'light')
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-interface-scale', '100')
    const noTextBanner = page.getByTestId('pdf-no-text-banner')
    await expect(noTextBanner).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('pdf-before-ocr-light.png') })
    const bookId = await page.evaluate(async () => (await window.readerApi.listBooks())[0].id)
    await page.getByTestId('ocr-reading-toggle').click()
    await expect(page.getByTestId('ocr-reading-prepare')).toBeVisible()
    expect(pageImages()).toHaveLength(0)
    await page.getByTestId('ocr-reading-prepare').click()
    await expect(page.getByTestId('book-preparation-dialog')).toBeVisible()
    await page.getByTestId('document-prepare').click()
    await expect.poll(() => status(page, bookId), { timeout: 20_000 }).toBe('ready')
    await hidePreparation(page)
    await expect(page.getByTestId('pdf-reader')).toBeVisible()
    await expect(noTextBanner).toHaveAttribute('hidden', '')
    await expect(noTextBanner).toBeHidden()
    await page.screenshot({ path: test.info().outputPath('pdf-after-ocr-light.png') })
    const before = await page.evaluate(async () => (await window.readerApi.listBooks())[0])
    await page.getByTestId('ocr-reading-toggle').click()
    await expect(page.getByTestId('ocr-reading-text')).toHaveText(pageText)
    await expect(page.getByTestId('ocr-reading-previous')).toBeDisabled()
    await expect(page.getByTestId('ocr-reading-next')).toBeDisabled()
    await page.getByTestId('ocr-reading-copy').click()
    await expect(page.getByTestId('ocr-page-reader')).toContainText('已复制')
    expect(await application.evaluate(({ clipboard }) => clipboard.readText())).toBe(pageText)
    const after = await page.evaluate(async () => (await window.readerApi.listBooks())[0])
    expect(after.lastLocator).toBe(before.lastLocator); expect(after.progress).toBe(before.progress)
    await selectOcrText(page, '独立复核是必要条件')
    await expect(page.getByTestId('selection-toolbar')).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('ocr-text-selection.png') })
    await page.getByTestId('action-explain').click()
    await expect(page.getByTestId('answer-current')).toContainText('书中要求独立复核')
    await page.getByTestId('answer-save').click()
    await expect.poll(() => page.evaluate(async (id) => (await window.readerApi.listInsights(id)).length, bookId)).toBe(1)
    const archived = await page.evaluate(async (id) => (await window.readerApi.listInsights(id))[0], bookId)
    expect(archived.selection).toMatchObject({ quote: '独立复核是必要条件', chapterTitle: '第 1 页', anchor: expect.stringMatching(/^pdfocr:1:/u) })
    await page.getByTestId('citation-valid').click()
    await expect(page.getByTestId('ocr-page-reader')).toHaveCount(0)
    await expect(page.getByTestId('reader-host')).not.toHaveAttribute('inert')
    await expect(noTextBanner).toBeHidden()
    await expect(page.locator('.pdf-page[data-page-number="1"]')).toBeInViewport()
    await expect(page.locator('.toast.is-error')).toHaveCount(0)
    expect(pageImages()).toHaveLength(1)

    launched = await restartReader(application, { userData: workspace.userData }); application = launched.application; page = launched.page
    await showLibrary(page)
    await page.evaluate(() => window.readerApi.saveKnowledgeSettings({
      embedding: { enabled: false, baseUrl: '', model: '' }, document: { processor: 'none', baseUrl: '', ocr: true, language: 'ch' }
    }))
    await page.getByTestId('book-item').click(); await enterReading(page)
    await page.getByTestId('settings-button').click()
    await page.getByTestId('theme-dark').click()
    await page.getByTestId('scale-125').click()
    await page.getByTestId('settings-close').click()
    await resizeWorkspace(application, page, 940, 600)
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme', 'dark')
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-interface-scale', '125')
    await expect(page.getByTestId('pdf-reader')).toBeVisible()
    const restoredBanner = page.getByTestId('pdf-no-text-banner')
    await expect(restoredBanner).toHaveAttribute('hidden', '')
    await expect(restoredBanner).toBeHidden()
    await page.screenshot({ path: test.info().outputPath('pdf-after-ocr-restart-dark.png') })
    await page.getByTestId('ocr-reading-toggle').click()
    await expect(page.getByTestId('ocr-reading-text')).toHaveText(pageText)
    expect(pageImages()).toHaveLength(1)
  } finally { server.closeAllConnections(); await cleanupE2eWorkspace(application, workspace.root) }
})

test('pages through saved OCR, clears old selections on blank pages and refreshes after rebuilding', async () => {
  const workspace = await createE2eWorkspace('llm-reader-ocr-pages-')
  let application: ElectronApplication | undefined
  pageContents = ['第一页独立复核。', '[EMPTY_PAGE]', '第三页原文。']
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: resolve('tests/e2e/fixtures/text-reader.pdf') })
    application = launched.application; const page = launched.page
    await showLibrary(page)
    await page.evaluate((baseUrl) => window.readerApi.saveKnowledgeSettings({ embedding: { enabled: false, baseUrl: '', model: '' }, document: { processor: 'vision', baseUrl, model: 'vision-fixture', ocr: true, language: 'ch' } }), endpoint)
    await page.getByTestId('book-item').click(); await enterReading(page)
    const bookId = await page.evaluate(async () => (await window.readerApi.listBooks())[0].id)
    await page.evaluate((id) => window.readerApi.prepareBookDocument({ bookId: id }), bookId)
    await expect.poll(() => status(page, bookId), { timeout: 20_000 }).toBe('ready')
    await page.getByTestId('ocr-reading-toggle').click()
    await expect(page.getByTestId('ocr-reading-text')).toHaveText(pageContents[0])
    await selectOcrText(page, '独立复核')
    await expect(page.getByTestId('selection-toolbar')).toBeVisible()
    await page.getByTestId('ocr-reading-next').click()
    await expect(page.getByTestId('ocr-reading-page')).toHaveValue('2')
    await expect(page.getByTestId('ocr-page-reader')).toContainText('本页未识别到文字')
    await expect(page.getByTestId('ocr-reading-copy')).toBeDisabled()
    await expect(page.getByTestId('selection-toolbar')).toHaveCount(0)
    await page.getByTestId('ocr-reading-next').click()
    await expect(page.getByTestId('ocr-reading-text')).toHaveText(pageContents[2])
    await page.getByTestId('ocr-reading-close').click()
    await expect(page.locator('.pdf-page[data-page-number="3"]')).toBeInViewport()
    await expect(page.getByTestId('ocr-reading-toggle')).toBeFocused()
    await page.getByTestId('ocr-reading-toggle').click()
    await expect(page.getByTestId('ocr-reading-page')).toHaveValue('3')
    await selectOcrText(page, '第三页')
    await expect(page.getByTestId('selection-toolbar')).toBeVisible()
    const before = await page.evaluate((id) => window.readerApi.getBookOcrPage({ bookId: id, pageNumber: 3 }), bookId)
    await page.evaluate((id) => window.readerApi.prepareBookDocument({ bookId: id, rebuild: true }), bookId)
    await expect.poll(() => status(page, bookId), { timeout: 20_000 }).toBe('ready')
    await expect(page.getByTestId('ocr-reading-text')).toHaveText(pageContents[2])
    await expect(page.getByTestId('selection-toolbar')).toHaveCount(0)
    const after = await page.evaluate((id) => window.readerApi.getBookOcrPage({ bookId: id, pageNumber: 3 }), bookId)
    expect(before.status === 'ready' && after.status === 'ready' && before.revision !== after.revision).toBe(true)
    expect(pageImages()).toHaveLength(3)
  } finally { server.closeAllConnections(); await cleanupE2eWorkspace(application, workspace.root) }
})

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
    await page.getByTestId('document-config').locator('summary').first().click()
    await page.getByTestId('document-processor').selectOption('vision')
    await page.getByTestId('document-url').fill(endpoint)
    await page.getByTestId('document-model').fill('vision-fixture')
    await page.locator('#document-key').fill('ocr-only')
    await page.locator('#document-compatibility').selectOption('opencode-go')
    await page.getByTestId('document-test').click()
    await expect(page.getByTestId('knowledge-document-status')).toContainText('样图文字识别成功')
    expect(pageImages()).toHaveLength(0)
    expect(await page.evaluate(() => window.readerApi.getKnowledgeSettings().then((value) => value.document.processor))).toBe('none')
    await page.getByTestId('document-save').click()
    await expect(page.getByTestId('knowledge-document-status')).toContainText('已保存')
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
    // Ordinary in-book search uses the saved OCR text and does not recognize pages again.
    await page.keyboard.press('Control+f')
    await page.getByTestId('reader-search-input').fill('独立复核')
    await page.getByTestId('reader-search-input').press('Enter')
    await expect(page.getByTestId('reader-search-result')).toHaveCount(1)
    await expect(page.getByTestId('reader-search-result')).toContainText('第 1 页')
    await page.getByTestId('reader-search-result').click()
    await expect(page.locator('.toast.is-error')).toHaveCount(0)
    expect(pageImages()).toHaveLength(1)
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
    expect(await page.evaluate((id) => window.readerApi.searchBookDocument({ bookId: id, query: '独立复核' }), bookId)).toMatchObject({ available: true, results: [{ anchor: 'pdfpos:1:0' }] })
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

test('previews a real PDF page, validates page ranges and cancels without starting whole-book OCR', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-page-preview-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: resolve('tests/e2e/fixtures/text-reader.pdf') })
    application = launched.application
    const page = launched.page
    await showLibrary(page)
    await page.evaluate((baseUrl) => window.readerApi.saveKnowledgeSettings({ embedding: { enabled: false, baseUrl: '', model: '' },
      document: { processor: 'vision', baseUrl, model: 'vision-fixture', apiKey: 'ocr-only', compatibility: 'opencode-go', ocr: true, language: 'ch' } }), endpoint)
    await page.getByTestId('book-item').click(); await enterReading(page)
    const before = await page.evaluate(async () => (await window.readerApi.listBooks())[0])
    await showPreparation(page)
    await page.getByTestId('ocr-preview-page').fill('2')
    await page.getByTestId('ocr-preview-start').click()
    await expect(page.getByTestId('ocr-preview-text')).toContainText('独立复核是必要条件')
    await expect(page.getByTestId('ocr-preview-result')).toContainText('第 2 页')
    await expect.poll(() => page.getByTestId('ocr-preview-result').locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
    expect(pageImages()).toHaveLength(1)
    expect(await status(page, before.id)).toBe('empty')
    await expect(page.getByTestId('document-prepare')).toBeEnabled()
    const after = await page.evaluate(async () => (await window.readerApi.listBooks())[0])
    expect(after.lastLocator).toBe(before.lastLocator)
    expect(after.progress).toBe(before.progress)
    await page.getByTestId('ocr-preview-result').scrollIntoViewIfNeeded()
    await page.screenshot({ path: test.info().outputPath('ocr-page-preview.png') })

    await page.getByTestId('ocr-preview-page').fill('600')
    await page.getByTestId('ocr-preview-start').click()
    await expect(page.getByTestId('ocr-preview-error')).toContainText('PDF 页码')
    expect(pageImages()).toHaveLength(1)
    await page.getByTestId('ocr-preview-page').fill('1')
    holdPages = true
    await page.getByTestId('ocr-preview-start').click()
    await expect.poll(() => pageImages().length).toBe(2)
    await expect(page.getByTestId('document-prepare')).toBeDisabled()
    await page.getByTestId('ocr-preview-cancel').click()
    await expect(page.getByTestId('ocr-preview-error')).toContainText('已取消')
    await expect(page.getByTestId('document-prepare')).toBeEnabled()
    expect(await status(page, before.id)).toBe('empty')

    await page.getByTestId('ocr-preview-start').click()
    await expect.poll(() => pageImages().length).toBe(3)
    await hidePreparation(page)
    holdPages = false
    await showPreparation(page)
    await page.getByTestId('ocr-preview-start').click()
    await expect(page.getByTestId('ocr-preview-text')).toContainText('独立复核是必要条件')
    expect(pageImages()).toHaveLength(4)
    expect(await status(page, before.id)).toBe('empty')
  } finally { server.closeAllConnections(); await cleanupE2eWorkspace(application, workspace.root) }
})

test('reuses previews across restart and preparation, copies text and retries only on request', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-preview-cache-')
  let application: ElectronApplication | undefined
  try {
    let launched = await launchReader({ userData: workspace.userData, importPath: resolve('tests/e2e/fixtures/text-reader.pdf') })
    application = launched.application; let page = launched.page
    await showLibrary(page)
    await page.evaluate((baseUrl) => window.readerApi.saveKnowledgeSettings({ embedding: { enabled: false, baseUrl: '', model: '' },
      document: { processor: 'vision', baseUrl, model: 'vision-fixture', apiKey: 'ocr-only', ocr: true, language: 'ch' } }), endpoint)
    const bookId = await page.evaluate(async () => (await window.readerApi.listBooks())[0].id)
    await page.getByTestId('book-item').click(); await enterReading(page); await showPreparation(page)
    await page.getByTestId('ocr-preview-page').fill('2')
    await page.getByTestId('ocr-preview-start').click()
    await expect(page.getByTestId('ocr-preview-text')).toHaveText(pageText)
    expect(pageImages()).toHaveLength(1)
    await page.getByTestId('ocr-preview-start').click()
    await expect(page.getByTestId('ocr-preview-source')).toContainText('未发送识别请求')
    expect(pageImages()).toHaveLength(1)
    await page.getByTestId('ocr-preview-copy').click()
    await expect(page.getByTestId('ocr-preview-copy')).toHaveText('已复制')
    expect(await application.evaluate(({ clipboard }) => clipboard.readText())).toBe(pageText)

    failNextPage = true
    await page.getByTestId('ocr-preview-refresh').click()
    await expect(page.getByTestId('ocr-preview-error')).toBeVisible()
    await expect(page.getByTestId('ocr-preview-text')).toHaveText(pageText)
    await expect(page.getByTestId('ocr-preview-start')).toHaveText('重试这一页')
    expect(pageImages()).toHaveLength(2)
    pageText = '复核后的第二页原文。'
    await page.getByTestId('ocr-preview-start').click()
    await expect(page.getByTestId('ocr-preview-text')).toHaveText(pageText)
    expect(pageImages()).toHaveLength(3)
    expect(await status(page, bookId)).toBe('empty')
    await page.getByTestId('ocr-preview-result').scrollIntoViewIfNeeded()
    await page.screenshot({ path: test.info().outputPath('ocr-preview-retry-and-copy.png') })

    launched = await restartReader(application, { userData: workspace.userData }); application = launched.application; page = launched.page
    await enterReading(page); await showPreparation(page)
    await page.getByTestId('ocr-preview-page').fill('2')
    await page.getByTestId('ocr-preview-start').click()
    await expect(page.getByTestId('ocr-preview-source')).toContainText('未发送识别请求')
    await expect(page.getByTestId('ocr-preview-text')).toHaveText(pageText)
    expect(pageImages()).toHaveLength(3)
    pageText = '其余页面的原文。'
    await page.getByTestId('document-prepare').click()
    await expect.poll(() => status(page, bookId), { timeout: 20_000 }).toBe('ready')
    expect(pageImages()).toHaveLength(5)
    expect(await page.evaluate((id) => window.readerApi.searchBookDocument({ bookId: id, query: '复核后的第二页' }), bookId))
      .toMatchObject({ available: true, results: [{ anchor: 'pdfpos:2:0' }] })
    await page.getByTestId('ocr-preview-page').fill('1')
    await page.getByTestId('ocr-preview-start').click()
    await expect(page.getByTestId('ocr-preview-source')).toContainText('未发送识别请求')
    await expect(page.getByTestId('ocr-preview-text')).toHaveText(pageText)
    expect(pageImages()).toHaveLength(5)

    await page.getByTestId('ocr-preview-page').fill('2')
    await page.getByTestId('ocr-preview-start').click()
    await expect(page.getByTestId('ocr-preview-text')).toHaveText('复核后的第二页原文。')
    pageText = '再次核验的第二页。'
    await page.getByTestId('ocr-preview-refresh').click()
    await expect(page.getByTestId('ocr-preview-text')).toHaveText(pageText)
    expect(pageImages()).toHaveLength(6)
    expect((await page.evaluate((id) => window.readerApi.searchBookDocument({ bookId: id, query: '再次核验' }), bookId)).results).toHaveLength(0)
    // Native dialogs are unavailable in the headless fixture; accept this one rebuild confirmation.
    await page.evaluate(() => { const original = window.confirm; window.confirm = () => { window.confirm = original; return true } })
    await page.getByTestId('document-rebuild').click()
    await expect.poll(() => status(page, bookId), { timeout: 20_000 }).toBe('ready')
    expect(await page.evaluate((id) => window.readerApi.searchBookDocument({ bookId: id, query: '再次核验' }), bookId))
      .toMatchObject({ available: true, results: [{ anchor: 'pdfpos:2:0' }] })
    expect(pageImages()).toHaveLength(6)
  } finally { server.closeAllConnections(); await cleanupE2eWorkspace(application, workspace.root) }
})
