import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { ContextSnapshot } from '../../src/shared/contracts'
import { structureDoclingFixture } from '../../scripts/document-structure-fixture'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader, restartReader } from './support/electron-app'

async function theme(page: Page, value: string): Promise<void> {
  await page.getByTestId('settings-button').click()
  await page.getByTestId('settings-nav-appearance').click()
  await page.getByTestId(`theme-${value}`).click()
  await page.getByTestId('settings-close').click()
  if (await page.locator('.reader-document--txt').count()) await expect.poll(() =>
    page.locator('.reader-document--txt').evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe(value === 'dark' ? 'rgb(34, 41, 45)' : 'rgb(253, 252, 249)')
}
async function resize(application: ElectronApplication, width: number, height: number): Promise<void> {
  await application.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.unmaximize(); window.setSize(size[0], size[1])
  }, [width, height])
}

test('TXT prepares locally without any model and retains readiness across restart', async () => {
  test.setTimeout(90_000)
  const workspace = await createE2eWorkspace('llm-reader-structure-txt-')
  let application: ElectronApplication | undefined
  try {
    const fixture = join(workspace.root, '无标题原文.txt')
    await writeFile(fixture, '没有标题的文字同样可以建立原文检索。😀𠮷\n\n- 列表保留独立段落。\n\n没有标题的文字同样可以建立原文检索。😀𠮷', 'utf8')
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    let page = launched.page
    await page.getByTestId('book-item').click()
    await page.getByTestId('analysis-details').locator('summary').first().click()
    expect((await page.evaluate(() => window.readerApi.getProviderOverview())).profiles).toHaveLength(0)
    await expect(page.getByTestId('document-prepare')).toBeEnabled()
    await expect(page.getByTestId('analysis-start')).toBeDisabled()
    await page.getByTestId('document-prepare').click()
    await expect(page.getByTestId('document-status')).toHaveText('原文可检索')
    await expect(page.getByTestId('notes-status')).toContainText('0/')
    for (const color of ['light', 'dark']) {
      await theme(page, color)
      for (const [width, height] of [[1440, 900], [940, 600]]) {
        await resize(application, width, height)
        await page.getByTestId('document-rebuild').scrollIntoViewIfNeeded()
        await expect(page.getByTestId('document-rebuild')).toBeInViewport()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: test.info().outputPath(`prepared-${color}-${width}.png`) })
      }
    }
    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application; page = restarted.page
    await page.getByTestId('book-item').click()
    await expect(page.getByTestId('document-status')).toHaveText('原文可检索')
    const state = await page.evaluate(async () => window.readerApi.getBookAnalysis((await window.readerApi.listBooks())[0].id))
    expect(state).toMatchObject({ status: 'empty', completedSections: 0, document: { status: 'ready', version: 2 } })
  } finally { await cleanupE2eWorkspace(application, workspace.root) }
})

test('PDF source ranges navigate both pages, return and survive archived followups and export without notes', async () => {
  test.setTimeout(150_000)
  const workspace = await createE2eWorkspace('llm-reader-structure-pdf-')
  let application: ElectronApplication | undefined
  const contexts: ContextSnapshot[] = []
  let uploads = 0, plans = 0, noteCalls = 0
  const server = createServer((request, response) => {
    let raw = ''
    request.setEncoding('utf8'); request.on('data', (chunk) => { raw += chunk })
    request.on('end', () => {
      const json = (value: unknown): void => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)) }
      if (request.url === '/v1/convert/file/async') { uploads++; json({ task_id: 'structure' }); return }
      if (request.url === '/v1/status/poll/structure') { json({ task_status: 'success' }); return }
      if (request.url === '/v1/result/structure') { json({ status: 'success', document: { json_content: structureDoclingFixture() } }); return }
      if (request.url === '/v1/chat/completions') {
        const body = JSON.parse(raw) as { messages: { content: string }[] }
        const instruction = body.messages[0].content
        let content = '连接成功'
        if (instruction.includes('为阅读问题')) { plans++; content = '{"chapters":[],"terms":["资料冲突","核验表","表注"]}' }
        else if (instruction.includes('你是阅读助手')) {
          const snapshot = JSON.parse(body.messages.at(-1)!.content.split('\n')[1]) as ContextSnapshot
          contexts.push(snapshot)
          const table = snapshot.passages.find((passage) => passage.text.includes('资料冲突\t分别核查两个来源'))
          content = table ? `核验表要求分别核查两个来源。[${table.id}]` : '当前原文依据不足。'
        } else if (instruction.includes('读书笔记')) noteCalls++
        json({ choices: [{ message: { content } }], usage: { total_tokens: 20 } }); return
      }
      response.writeHead(404).end()
    })
  })
  try {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Fixture server unavailable')
    const endpoint = `http://127.0.0.1:${address.port}`
    const launched = await launchReader({ userData: workspace.userData, importPath: resolve('tests/e2e/fixtures/document-structure.pdf') })
    application = launched.application
    let page = launched.page
    await expect(page.getByTestId('book-item')).toBeVisible()
    await page.evaluate((url) => window.readerApi.saveKnowledgeSettings({ embedding: { enabled: false, baseUrl: '', model: '' },
      document: { processor: 'docling', baseUrl: url, ocr: true, language: 'ch' } }), endpoint)
    await page.reload(); await page.getByTestId('book-item').click()
    await expect(page.locator('.pdf-page')).toHaveCount(6)
    const bookId = await page.evaluate(async () => (await window.readerApi.listBooks())[0].id)
    await page.getByTestId('analysis-details').locator('summary').first().click()
    await expect(page.getByTestId('analysis-start')).toBeDisabled()
    await page.getByTestId('document-prepare').click()
    await expect(page.getByTestId('document-status')).toHaveText('原文可检索')
    expect(uploads).toBe(1); expect(noteCalls).toBe(0)
    await page.getByTestId('document-check').locator('summary').click()
    await expect(page.getByTestId('document-check')).toContainText('脚注缺少明确关联')
    await expect(page.getByTestId('document-check')).toContainText('疑似重复内容')
    await page.screenshot({ path: test.info().outputPath('document-check.png') })
    await page.evaluate(async (baseUrl) => {
      const overview = await window.readerApi.createProviderProfile({ name: '问答模拟', baseUrl, model: 'fixture', apiKey: 'fixture-only' })
      await window.readerApi.activateProviderProfile(overview.profiles[0].id)
    }, endpoint)
    await page.reload(); await page.getByTestId('book-item').click()
    await page.getByTestId('scope-book').click()
    await page.evaluate(() => window.readerApi.onLlmEvent((event) => {
      if (event.type === 'context') (window as typeof window & { structureContext?: ContextSnapshot }).structureContext = event.context
    }))
    await expect(page.getByTestId('followup-input')).toBeEnabled()
    await page.getByTestId('followup-input').fill('资料冲突时，跨页核验表与表注要求怎么做？')
    await page.getByTestId('followup-input').press('Enter')
    await expect(page.getByTestId('answer-current')).toContainText('分别核查两个来源')
    await expect(page.getByTestId('cancel-request')).toHaveCount(0)
    expect(plans).toBe(1); expect(noteCalls).toBe(0)
    const snapshot = await page.evaluate(() => (window as typeof window & { structureContext?: ContextSnapshot }).structureContext!)
    expect(snapshot.coverage.covered).toBe(0); expect(snapshot.background).toBe('')
    expect(contexts[0].passages.some((passage) => passage.text.includes('表注：可逆'))).toBe(true)
    const table = snapshot.passages.find((passage) => passage.tableSlice)!
    expect(table.sources?.map((source) => source.page)).toEqual([3, 4])
    await page.locator('.answer-sources').last().locator('summary').click()
    const tableSource = page.locator('.answer-source-item').filter({ hasText: '整表页范围' }).first()
    await expect(tableSource).toContainText('未确定行级页码')
    const natural = await page.getByTestId('reader-host').evaluate((host) => host.scrollTop)
    for (const targetPage of [3, 4]) {
      await tableSource.getByRole('button', { name: `第 ${targetPage} 页`, exact: true }).click()
      await expect.poll(() => page.getByTestId('reader-host').evaluate((host, number) => {
        const rect = host.querySelector(`.pdf-page[data-page-number="${number}"]`)!.getBoundingClientRect()
        const bounds = host.getBoundingClientRect()
        return rect.bottom > bounds.top && rect.top < bounds.bottom
      }, targetPage)).toBe(true)
      await expect(page.getByTestId('reader-return-button')).toBeEnabled()
      await page.getByTestId('reader-return-button').click()
      await expect.poll(() => page.getByTestId('reader-host').evaluate((host, top) => Math.abs(host.scrollTop - top), natural)).toBeLessThan(5)
    }
    for (const color of ['light', 'dark']) {
      await theme(page, color)
      for (const [width, height] of [[1440, 900], [940, 600]]) {
        await resize(application, width, height)
        await tableSource.scrollIntoViewIfNeeded()
        await expect(tableSource.getByRole('button', { name: '第 4 页', exact: true })).toBeInViewport()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: test.info().outputPath(`sources-${color}-${width}.png`) })
      }
    }
    await page.getByTestId('answer-save').click()
    const saved = await page.evaluate(async (id) => (await window.readerApi.listInsights(id))[0], bookId)
    expect(saved.context?.passages.find((passage) => passage.tableSlice)?.sources).toEqual(table.sources)
    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application; page = restarted.page
    await page.getByTestId('book-item').click()
    await expect(page.getByTestId('document-status')).toHaveText('原文可检索')
    await page.getByTestId('assistant-expand-button').click()
    await page.getByTestId('assistant-dialog-tab-insights').click()
    const exportPath = join(workspace.root, '跨页来源归档.md')
    await application.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, exportPath)
    await page.getByTestId('insight-export').click()
    await expect.poll(() => readFile(exportPath, 'utf8').catch(() => '')).toContain('整表页范围')
    const exported = await readFile(exportPath, 'utf8')
    expect(exported).toContain('第 3、4 页'); expect(exported).toContain('资料冲突')
    await page.getByTestId('insight-item').locator('.insight-content').click()
    const dialog = page.getByTestId('assistant-dialog')
    await expect(dialog.getByTestId('citation-valid')).toHaveCount(1)
    await dialog.getByTestId('followup-input').fill('再次核对资料冲突的处理规则')
    await dialog.getByTestId('followup-input').press('Enter')
    await expect(dialog.getByTestId('citation-valid')).toHaveCount(2)
    const history = await page.evaluate(async (id) => (await window.readerApi.listInsights(id))[0].history, bookId)
    expect(history[1].context?.passages).toEqual(saved.context?.passages)
    expect(history[3].context?.passages.find((passage) => passage.tableSlice)?.sources).toEqual(table.sources)
    expect(uploads).toBe(1); expect(noteCalls).toBe(0); expect(plans).toBe(2)
    await page.screenshot({ path: test.info().outputPath('archived-cross-page.png') })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((done) => server.close(() => done()))
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
