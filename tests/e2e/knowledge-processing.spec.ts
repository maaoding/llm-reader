import { showPreparation, hidePreparation, showAssistant } from './support/workspace'
import { showLibrary, enterReading, togglePreparation } from './support/workspace'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'
import type { ContextSnapshot, DocumentSection } from '../../src/shared/contracts'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader, restartReader } from './support/electron-app'

let server: Server, endpoint = '', pageCount = 3, documentPending = false, holdEmbeddings = false
let uploads = 0, embeddingCalls = 0
let lastContext: ContextSnapshot | undefined
const received: { path: string; headers: Record<string, string | string[] | undefined>; body: string }[] = []
test.beforeAll(async () => {
  server = createServer((request, response) => {
    let raw = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { raw += chunk })
    request.on('end', () => {
      const path = request.url ?? ''
      received.push({ path, headers: request.headers, body: raw })
      const json = (value: unknown): void => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)) }
      if (path === '/v1/rerank') {
        const body = JSON.parse(raw) as { documents: string[] }
        json({ results: body.documents.map((_text, index) => ({ index, relevance_score: 1 / (index + 1) })) }); return
      }
      if (path === '/v1/embeddings') {
        embeddingCalls++
        if (holdEmbeddings && embeddingCalls > 1) return
        const input = (JSON.parse(raw) as { input: string[] }).input
        json({ data: input.map((text, index) => ({ index, embedding: /群体压力|随大流/u.test(text) ? [1, 0, 0] : [0, 1, 0] })) }); return
      }
      if (path === '/openapi.json') { json({ paths: { '/v1/convert/file/async': { post: {} }, '/tasks': { post: {} } } }); return }
      if (path === '/api/v4/file-urls/batch') { json({ code: 0, data: { batch_id: 'test-job', file_urls: [`${endpoint}/cloud-upload`] } }); return }
      if (path === '/cloud-upload') { uploads++; response.writeHead(200).end(); return }
      if (path === '/api/v4/extract-results/batch/test-job') { json({ code: 0, data: { extract_result: [{ state: documentPending ? 'waiting-file' : 'done', full_zip_url: `${endpoint}/cloud-result.zip` }] } }); return }
      if (path === '/cloud-result.zip') {
        const zip = new JSZip()
        zip.file('document_content_list.json', JSON.stringify([
          { type: 'text', text: '个体受到群体压力而改变判断。', page_idx: pageCount - 1, bbox: [0, 500, 900, 600] },
          { type: 'table', table_body: '<table><tr><td>判断条件</td><td>复核要求</td></tr><tr><td>临时行动</td><td>事后补齐</td></tr></table>', page_idx: 0 }
        ]))
        void zip.generateAsync({ type: 'nodebuffer' }).then((bytes) => { response.writeHead(200, { 'content-type': 'application/zip' }); response.end(bytes) })
        return
      }
      if (path === '/v1/convert/file/async' || (path === '/tasks' && request.method === 'POST')) { uploads++; json({ task_id: 'test-job' }); return }
      if (path === '/v1/status/poll/test-job' || path === '/tasks/test-job') { json({ task_status: documentPending ? 'started' : 'success', status: documentPending ? 'processing' : 'completed' }); return }
      if (path === '/v1/result/test-job') {
        json({ status: 'success', document: { json_content: {
          pages: Object.fromEntries(Array.from({ length: pageCount }, (_, index) => [String(index + 1), { size: { width: 600, height: 800 } }])),
          body: { children: [{ $ref: '#/texts/0' }, { $ref: '#/texts/1' }] }, texts: [
            { text: '定义与判断', label: 'section_header', prov: [{ page_no: 1, bbox: { t: 700, coord_origin: 'BOTTOMLEFT' } }] },
            { text: '个体受到群体压力而改变判断。', label: 'text', prov: [{ page_no: pageCount, bbox: { t: 400, coord_origin: 'BOTTOMLEFT' } }] }
          ] } } }); return
      }
      if (path === '/tasks/test-job/result') {
        json({ results: { document: { content_list: JSON.stringify([
          { type: 'text', text: 'OCR 识别的判断定义', text_level: 1, page_idx: 0, bbox: [0, 100, 900, 200] },
          { type: 'text', text: '个体受到群体压力而改变判断。', page_idx: pageCount - 1, bbox: [0, 500, 900, 600] }
        ]) } } }); return
      }
      if (path === '/v1/models') { json({ data: [{ id: 'qa-test' }] }); return }
      if (path === '/v1/chat/completions') {
        const body = JSON.parse(raw) as { model: string; messages: { content: string }[] }
        const system = body.messages[0].content
        let content = '连接成功'
        if (system.includes('只输出 JSON：')) {
          const section = JSON.parse(body.messages[1].content) as DocumentSection
          content = JSON.stringify({ summary: '作者讨论自主判断。', claims: [], conditions: [], exceptions: [], concepts: [] })
          expect(section.blocks.length).toBeGreaterThan(0)
        } else if (system.includes('综合这些笔记')) content = '全书讨论自主判断与群体影响。'
        else if (system.includes('为阅读问题')) content = '{"chapters":[],"terms":[]}'
        else if (system.includes('你是阅读助手')) {
          lastContext = JSON.parse(body.messages.at(-1)!.content.split('\n')[1]) as ContextSnapshot
          const source = lastContext.passages.find((item) => item.text.includes('群体压力'))
          content = source ? `书中的相关证据在这里。[${source.id}]` : '没有取到相关证据。'
        }
        json({ model: body.model, choices: [{ message: { content } }], usage: { total_tokens: 12 } }); return
      }
      response.writeHead(404).end()
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture server unavailable')
  endpoint = `http://127.0.0.1:${address.port}`
})
test.afterAll(async () => { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())) })
test.beforeEach(() => { received.length = 0; uploads = 0; embeddingCalls = 0; holdEmbeddings = false; documentPending = false; lastContext = undefined })

async function prepareQa(page: Page): Promise<string> {
  return page.evaluate(async (baseUrl) => {
    const overview = await window.readerApi.createProviderProfile({ name: '阅读模型', baseUrl, model: 'qa-test', apiKey: 'qa-only', compatibility: 'auto' })
    await window.readerApi.activateProviderProfile(overview.profiles[0].id)
    return overview.profiles[0].id
  }, endpoint)
}
async function ask(page: Page, question = '随大流是什么？'): Promise<void> {
  await hidePreparation(page); await showAssistant(page)
  await page.getByTestId('scope-book').click()
  await page.getByTestId('followup-input').fill(question)
  await page.getByTestId('followup-input').press('Enter')
  await expect(page.getByTestId('answer-current')).toContainText('书中的相关证据')
  await expect(page.getByTestId('citation-valid')).toHaveCount(1)
}

test('settings use unsaved form values, retain independent keys, and fit both themes and window sizes', async () => {
  test.setTimeout(90_000)
  const workspace = await createE2eWorkspace('llm-reader-knowledge-ui-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData }); application = launched.application
    const page = launched.page
    await hidePreparation(page)
    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-knowledge').click()
    await page.getByTestId('embedding-enabled').check()
    await page.getByTestId('embedding-url').fill(`${endpoint}/v1`)
    await page.getByTestId('embedding-model').fill('embedding-test')
    await page.locator('#embedding-key').fill('embedding-only')
    await page.getByTestId('embedding-test').click()
    await expect(page.getByTestId('knowledge-status')).toContainText('检查通过')
    expect(await page.evaluate(() => window.readerApi.getKnowledgeSettings().then((value) => value.embedding.enabled))).toBe(false)
    await page.getByTestId('rerank-enabled').check()
    await page.getByTestId('rerank-url').fill(`${endpoint}/v1`)
    await page.getByTestId('rerank-model').fill('reranker-test')
    await page.locator('#rerank-key').fill('rerank-only')
    await page.getByTestId('rerank-test').click()
    await expect(page.getByTestId('knowledge-status')).toContainText('重排接口检查通过')
    expect(await page.evaluate(() => window.readerApi.getKnowledgeSettings().then((value) => value.rerank.enabled))).toBe(false)
    const rerankRequest = received.find((item) => item.path === '/v1/rerank')!
    expect(rerankRequest.headers.authorization).toBe('Bearer rerank-only')
    expect(rerankRequest.headers['x-opencode-session']).toBeUndefined()
    expect(JSON.parse(rerankRequest.body)).toMatchObject({ model: 'reranker-test', query: '雨天出门应该带什么？', top_n: 2, return_documents: false })
    await page.getByTestId('document-processor').selectOption('docling')
    await page.getByTestId('document-url').fill(endpoint)
    await page.locator('#document-key').fill('document-only')
    await page.getByTestId('document-test').click()
    await expect(page.getByTestId('knowledge-status')).toContainText('服务接口可用')
    await page.getByTestId('knowledge-save').click()
    await expect(page.getByTestId('knowledge-status')).toContainText('已保存')
    expect(received.find((item) => item.path === '/v1/embeddings')?.headers.authorization).toBe('Bearer embedding-only')
    expect(received.find((item) => item.path === '/openapi.json')?.headers['x-api-key']).toBe('document-only')
    expect(received.every((item) => String(item.headers['user-agent']).startsWith('LLM-Reader/'))).toBe(true)
    for (const theme of ['light', 'dark']) {
      await page.getByTestId('settings-nav-appearance').click()
      await page.getByTestId(`theme-${theme}`).click()
      await page.getByTestId('settings-nav-knowledge').click()
      for (const size of [[1440, 900], [940, 600]]) {
        await application.evaluate(({ BrowserWindow }, dimensions) => { const window = BrowserWindow.getAllWindows()[0]; window.unmaximize(); window.setSize(dimensions[0], dimensions[1]) }, size)
        await page.getByTestId('embedding-url').scrollIntoViewIfNeeded()
        await expect(page.getByTestId('embedding-url')).toBeInViewport()
        await page.screenshot({ path: test.info().outputPath(`embedding-${theme}-${size[0]}.png`) })
        await page.getByTestId('rerank-enabled').scrollIntoViewIfNeeded()
        await expect(page.getByTestId('rerank-enabled')).toBeInViewport()
        await page.screenshot({ path: test.info().outputPath(`rerank-${theme}-${size[0]}.png`) })
        await page.getByTestId('rerank-test').scrollIntoViewIfNeeded()
        await expect(page.getByTestId('rerank-test')).toBeInViewport()
        await page.screenshot({ path: test.info().outputPath(`rerank-controls-${theme}-${size[0]}.png`) })
        await page.getByTestId('document-processor').scrollIntoViewIfNeeded()
        await page.screenshot({ path: test.info().outputPath(`document-${theme}-${size[0]}.png`) })
        await page.getByTestId('knowledge-save').scrollIntoViewIfNeeded()
        await expect(page.getByTestId('knowledge-save')).toBeInViewport()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      }
    }
    await page.getByTestId('settings-close').click()
    const restarted = await restartReader(application, { userData: workspace.userData }); application = restarted.application
    const settings = await restarted.page.evaluate(() => window.readerApi.getKnowledgeSettings())
    expect(settings).toMatchObject({ embedding: { enabled: true, model: 'embedding-test', hasApiKey: true }, document: { processor: 'docling', hasApiKey: true } })
    expect(settings.rerank).toMatchObject({ enabled: true, model: 'reranker-test', hasApiKey: true })
    expect(JSON.stringify(settings)).not.toContain('rerank-only')
    expect(JSON.stringify(settings)).not.toContain('embedding-only')
    await restarted.page.getByTestId('settings-button').click()
    await restarted.page.getByTestId('settings-nav-knowledge').click()
    await restarted.page.getByTestId('rerank-model').fill('unsaved-reranker')
    await restarted.page.getByTestId('settings-nav-model').click()
    await restarted.page.getByTestId('settings-nav-knowledge').click()
    await expect(restarted.page.getByTestId('rerank-model')).toHaveValue('unsaved-reranker')
    restarted.page.once('dialog', (dialog) => void dialog.dismiss())
    await restarted.page.getByTestId('settings-close').click()
    await expect(restarted.page.getByTestId('rerank-model')).toBeVisible()
    restarted.page.once('dialog', (dialog) => void dialog.accept())
    await restarted.page.getByTestId('settings-close').click()
    expect(await restarted.page.evaluate(() => window.readerApi.getKnowledgeSettings().then((value) => value.embedding.model))).toBe('embedding-test')
    expect(await restarted.page.evaluate(() => window.readerApi.getKnowledgeSettings().then((value) => value.rerank.model))).toBe('reranker-test')
    await restarted.page.getByTestId('settings-button').click()
    await restarted.page.getByTestId('settings-nav-knowledge').click()
    await restarted.page.getByTestId('rerank-clear-key').check()
    await restarted.page.getByTestId('knowledge-save').click()
    await expect(restarted.page.getByTestId('knowledge-status')).toContainText('已保存')
    expect(await restarted.page.evaluate(() => window.readerApi.getKnowledgeSettings().then((value) => value.rerank.hasApiKey))).toBe(false)
  } finally { await cleanupE2eWorkspace(application, workspace.root) }
})

test('TXT indexes completed batches, pauses across restart and retrieves synonyms in whole-book questions', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-semantic-e2e-')
  const fixture = join(workspace.root, '语义检索.txt')
  await writeFile(fixture, `第一章 观察\n\n${Array.from({ length: 35 }, (_, index) => `这是天气记录${index}，与社会判断无关。`).join('\n\n')}\n\n第二章 判断\n\n个体受到群体压力而改变判断。`, 'utf8')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture }); application = launched.application
    let page = launched.page
    await showLibrary(page); await expect(page.getByTestId('book-item')).toBeVisible()
    await prepareQa(page)
    await page.evaluate(async (url) => window.readerApi.saveKnowledgeSettings({ embedding: { enabled: true, baseUrl: `${url}/v1`, model: 'embedding-test' }, document: { processor: 'none', baseUrl: '', ocr: true, language: 'ch' } }), endpoint)
    const bookId = await page.evaluate(async () => (await window.readerApi.listBooks())[0].id)
    await page.reload(); await showLibrary(page); await page.getByTestId('book-item').click(); await enterReading(page)
    await page.evaluate((bookId) => window.readerApi.prepareBookDocument({ bookId }), bookId)
    await expect.poll(() => page.evaluate((id) => window.readerApi.getBookAnalysis(id).then((value) => value.document?.status), bookId)).toBe('ready')
    await showPreparation(page)
    holdEmbeddings = true
    await page.getByTestId('semantic-start').click()
    await expect.poll(() => page.evaluate((id) => window.readerApi.getBookAnalysis(id).then((value) => value.semantic?.completed), bookId)).toBe(16)
    await page.getByTestId('semantic-cancel').click()
    const calls = embeddingCalls
    const restarted = await restartReader(application, { userData: workspace.userData }); application = restarted.application; page = restarted.page
    await showLibrary(page); await expect(page.getByTestId('book-item')).toBeVisible()
    expect(embeddingCalls).toBe(calls)
    holdEmbeddings = false
    await showLibrary(page); await page.getByTestId('book-item').click(); await enterReading(page)
    await showPreparation(page)
    await page.getByTestId('semantic-start').click()
    await expect.poll(() => page.evaluate((id) => window.readerApi.getBookAnalysis(id).then((value) => value.semantic?.status), bookId)).toBe('ready')
    await ask(page)
    expect(lastContext?.passages.some((passage) => passage.text.includes('群体压力'))).toBe(true)
    await page.screenshot({ path: test.info().outputPath('semantic-answer.png') })
    await page.evaluate((id) => window.readerApi.deleteBook(id), bookId)
    expect(await page.evaluate(() => window.readerApi.listBooks())).toEqual([])
  } finally { server.closeAllConnections(); await cleanupE2eWorkspace(application, workspace.root) }
})

for (const processor of ['docling', 'mineru-local', 'mineru-cloud'] as const) {
  test(`${processor} processes PDF with page citations and resumes an existing remote job`, async () => {
    test.setTimeout(120_000)
    const workspace = await createE2eWorkspace('llm-reader-pdf-analysis-')
    const fixture = resolve(`tests/e2e/fixtures/${processor === 'docling' ? 'text-reader' : 'scanned-reader'}.pdf`)
    let application: ElectronApplication | undefined
    try {
      const launched = await launchReader({ userData: workspace.userData, importPath: fixture }); application = launched.application
      let page = launched.page
      await showLibrary(page); await expect(page.getByTestId('book-item')).toBeVisible()
      const profileId = await prepareQa(page)
      await page.evaluate(({ url, processor }) => window.readerApi.saveKnowledgeSettings({ embedding: { enabled: false, baseUrl: '', model: '' },
        rerank: { enabled: true, baseUrl: `${url}/v1`, model: 'reranker-test', apiKey: 'rerank-only' },
        document: { processor, baseUrl: url, ocr: true, language: 'ch', apiKey: 'document-only' } }), { url: endpoint, processor })
      await page.reload(); await showLibrary(page); await page.getByTestId('book-item').click(); await enterReading(page)
      await expect(page.locator('.pdf-page').first()).toBeVisible()
      pageCount = await page.locator('.pdf-page').count()
      const bookId = await page.evaluate(async () => (await window.readerApi.listBooks())[0].id)
      await togglePreparation(page)
      await expect(page.getByTestId('analysis-details')).toContainText('整份文件')
      documentPending = true
      await page.getByTestId('document-prepare').click()
      await expect.poll(() => uploads).toBe(1)
      // Receiving the upload on the fixture server does not mean the app has persisted its returned
      // task ID yet. Cancel only after the first poll, so this test exercises resumable accepted jobs.
      const pollPath = processor === 'mineru-cloud' ? '/api/v4/extract-results/batch/test-job'
        : processor === 'docling' ? '/v1/status/poll/test-job' : '/tasks/test-job'
      await expect.poll(() => received.filter((item) => item.path === pollPath).length).toBeGreaterThan(0)
      await expect(page.getByTestId('document-cancel')).toBeEnabled()
      await page.getByTestId('document-cancel').click()
      const restarted = await restartReader(application, { userData: workspace.userData }); application = restarted.application; page = restarted.page
      await showLibrary(page); await expect(page.getByTestId('book-item')).toBeVisible()
      documentPending = false
      await showLibrary(page); await page.getByTestId('book-item').click(); await enterReading(page)
      await togglePreparation(page)
      await page.getByTestId('document-prepare').click()
      await expect.poll(() => page.evaluate((id) => window.readerApi.getBookAnalysis(id).then((value) => value.document?.status), bookId), { timeout: 20_000 }).toBe('ready')
      expect(uploads).toBe(1)
      await page.evaluate(() => window.readerApi.onLlmEvent((event) => {
        if (event.type === 'context') (window as typeof window & { testContext?: ContextSnapshot }).testContext = event.context
      }))
      await ask(page, '群体压力如何影响判断？')
      const snapshot = await page.evaluate(() => (window as typeof window & { testContext?: ContextSnapshot }).testContext)
      expect(snapshot?.rerank?.status).toBe('applied')
      expect(received.filter((item) => item.path === '/v1/rerank')).toHaveLength(1)
      expect(snapshot?.passages.some((passage) => passage.anchor === `pdfpos:${pageCount}:0.5`)).toBe(true)
      const citedPassage = snapshot!.passages.find((passage) => passage.text.includes('群体压力'))!
      expect(citedPassage.chapterTitle).toBeTruthy()
      const naturalChapter = await page.locator('.reader-column').getAttribute('data-current-chapter-title')
      await page.getByTestId('citation-valid').click()
      await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', citedPassage.chapterTitle!)
      await expect(page.locator('.toast.is-error')).toHaveCount(0)
      await expect.poll(() => page.getByTestId('reader-host').evaluate((host, pageNumber) => {
        const target = host.querySelector(`[data-page-number="${pageNumber}"]`)!
        const pageRect = target.getBoundingClientRect(), hostRect = host.getBoundingClientRect()
        return pageRect.top < hostRect.bottom && pageRect.bottom > hostRect.top
      }, pageCount)).toBe(true)
      if (pageCount > 1) await expect(page.getByTestId('reader-return-button')).toBeEnabled()
      await page.screenshot({ path: test.info().outputPath(`${processor}-citation.png`) })
      if (pageCount > 1) {
        await page.getByTestId('reader-return-button').click()
        await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', naturalChapter!)
      }
      await page.getByTestId('answer-save').click()
      const archived = await page.evaluate(async (id) => (await window.readerApi.listInsights(id))[0], bookId)
      expect(archived.context?.passages.some((passage) => passage.anchor === `pdfpos:${pageCount}:0.5`)).toBe(true)
      const upload = received.find((item) => item.path === (processor === 'docling' ? '/v1/convert/file/async' : processor === 'mineru-cloud' ? '/cloud-upload' : '/tasks'))!
      expect(upload.body).toContain('%PDF-')
      expect(upload.headers[processor === 'docling' ? 'x-api-key' : 'authorization']).toBe(processor === 'docling' ? 'document-only' : processor === 'mineru-cloud' ? undefined : 'Bearer document-only')
      if (processor === 'mineru-cloud') expect(received.find((item) => item.path === '/cloud-result.zip')?.headers.authorization).toBeUndefined()
      expect(received.filter((item) => item.path.includes('chat/completions')).every((item) => item.headers.authorization === 'Bearer qa-only')).toBe(true)
      expect(profileId).toBeTruthy()
    } finally { server.closeAllConnections(); await cleanupE2eWorkspace(application, workspace.root) }
  })
}
