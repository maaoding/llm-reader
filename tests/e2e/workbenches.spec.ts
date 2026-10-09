import { expect, test, type ElectronApplication } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ContextSnapshot } from '../../src/shared/contracts'
import type {} from '../../src/renderer/src/global'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader, restartReader } from './support/electron-app'
import { enterReading, resizeWorkspace, showLibrary } from './support/workspace'

let server: Server, endpoint = ''
const answers: Array<{ context: ContextSnapshot; history: string[] }> = []
test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      const body = JSON.parse(raw) as { messages: Array<{ role: string; content: string }> }
      const system = body.messages[0]?.content ?? ''
      let content = 'OK'
      if (system.includes('为阅读问题')) content = JSON.stringify({ chapters: [], terms: ['群体判断', '证据'] })
      else if (system.includes('你是阅读助手')) {
        const context = JSON.parse(body.messages.at(-1)!.content.split('\n')[1]) as ContextSnapshot
        answers.push({ context, history: body.messages.slice(1, -1).map((message) => message.content) })
        content = context.passages.map((passage) => `《${passage.bookTitle}》的原文依据。[${passage.id}]`).join('\n\n')
      }
      if (system.includes('你是阅读助手')) {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content || '无原文' } }] })}\n\n`)
        setTimeout(() => { if (!res.destroyed) res.end('data: [DONE]\n\n') }, 1_500)
      } else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ model: 'fixture', choices: [{ message: { content } }] }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture port')
  endpoint = `http://127.0.0.1:${address.port}/v1`
})
test.afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) })

test('creates an independent workbench, cites two books, keeps reading drafts and restores sources across restart', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('reader-workbenches-')
  let application: ElectronApplication | undefined
  try {
    const titles = ['群体判断甲书', '群体判断乙书']
    const paths = titles.map((title) => join(workspace.root, `${title}.txt`))
    await writeFile(paths[0], '群体判断甲书\n\n第一章 判断\n\n群体判断受到群体压力影响，人们应核对证据。\n\n甲书的后文。')
    await writeFile(paths[1], '群体判断乙书\n\n第一章 判断\n\n群体判断需要独立检验，证据比人数更重要。\n\n乙书的后文。')
    let launched = await launchReader({ userData: workspace.userData })
    application = launched.application
    let page = launched.page
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await showLibrary(page)
    await application.evaluate(({ dialog }, filePaths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths }) }, paths)
    await page.getByTestId('import-book').click()
    await expect(page.getByTestId('book-import-summary')).toContainText('已导入 2 本')
    await page.getByTestId('book-import-close').click()
    const ids = await page.evaluate(async (baseUrl) => {
      const overview = await window.readerApi.createProviderProfile({ name: '工作台测试', baseUrl, model: 'fixture', apiKey: 'test-only' })
      await window.readerApi.activateProviderProfile(overview.profiles[0].id)
      await window.readerApi.saveKnowledgeSettings({ target: 'webSearch', embedding: { enabled: false, baseUrl: '', model: '' },
        document: { processor: 'none', baseUrl: '', ocr: true, language: 'ch' }, webSearch: { enabled: true, baseUrl, apiKey: 'test-search-only' } })
      return (await window.readerApi.listBooks()).map((book) => ({ id: book.id, title: book.title }))
    }, endpoint)
    await page.reload(); await showLibrary(page)
    for (const book of ids) {
      await page.evaluate((id) => window.readerApi.prepareBookDocument({ bookId: id }), book.id)
      await expect.poll(() => page.evaluate(async (id) => (await window.readerApi.getBookAnalysis(id)).document?.status, book.id)).toBe('ready')
    }
    await page.getByTestId('book-item').filter({ hasText: titles[0] }).click()
    await enterReading(page)
    await page.locator('.right-sidebar').getByTestId('followup-input').fill('阅读旁的单书草稿')
    const readingId = ids.find((book) => book.title === titles[0])!.id
    await expect.poll(() => page.evaluate(async (id) => (await window.readerApi.getBookSession(id))?.draft, readingId)).toBe('阅读旁的单书草稿')
    const originalSession = await page.evaluate((id) => window.readerApi.getBookSession(id), readingId)

    await page.getByTestId('nav-archives').click()
    await page.getByTestId('nav-workbenches').click()
    await page.getByTestId('workbench-new').click()
    await page.getByTestId('workbench-name').fill('群体判断对读')
    await page.getByRole('button', { name: '创建工作台', exact: true }).click()
    await expect(page.getByTestId('workbench-detail')).toBeVisible()
    await expect(page.getByTestId('workbench-send')).toBeDisabled()
    for (const title of titles) await page.getByRole('checkbox', { name: title }).check()

    // The workbench shares the reader's composer tools, expanding draft and keyboard behavior.
    const input = page.getByTestId('workbench-question')
    const search = page.getByTestId('web-search-mode')
    const persona = page.getByTestId('session-persona-trigger')
    await expect(search).toHaveText('')
    await expect(search).toHaveAttribute('aria-pressed', 'false')
    await search.click()
    await expect(search).toHaveAttribute('aria-pressed', 'true')
    await search.click()
    await expect(search).toHaveAttribute('aria-pressed', 'false')
    await input.fill('草稿')
    const shortHeight = (await input.boundingBox())!.height
    await input.fill('比较论证的条件与证据。\n'.repeat(20))
    expect((await input.boundingBox())!.height).toBeGreaterThan(shortHeight + 30)
    await input.fill('草稿')
    expect((await input.boundingBox())!.height).toBe(shortHeight)
    await input.press('End')
    await input.press('Shift+Enter')
    await expect(input).toHaveValue('草稿\n')
    await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true })
    await expect(page.getByTestId('workbench-turn')).toHaveCount(0)
    const composerHeight = (await page.locator('.assistant-composer:visible').boundingBox())!.height
    await persona.click()
    await page.getByTestId('session-persona-edit').click()
    const editor = page.getByTestId('session-persona-editor')
    await editor.getByRole('textbox', { name: '人设名称' }).fill('对读助手')
    await editor.getByRole('textbox', { name: '提示词正文' }).fill('比较不同书籍的论据，标明出处。')
    await expect(page.locator('form form')).toHaveCount(0)
    expect((await page.locator('.assistant-composer:visible').boundingBox())!.height).toBe(composerHeight)
    await page.getByTestId('session-persona-apply').click()
    await expect(persona).toHaveAttribute('aria-label', '助手：对读助手')
    await expect(input).toHaveValue('草稿\n')
    await persona.click()
    await page.getByTestId('session-persona-save-as').click()
    await persona.click()
    const savedPersona = await page.getByTestId('session-persona').inputValue()
    expect(savedPersona).not.toBe('custom')
    expect(savedPersona).not.toBe('')
    await page.keyboard.press('Escape')
    await expect(persona).toBeFocused()
    await page.getByTestId('workbench-question').fill('比较两本书关于群体判断和证据的观点')
    await expect(page.getByTestId('workbench-send')).toBeEnabled()
    await input.press('Enter')
    await expect(page.getByTestId('workbench-turn')).toContainText('的原文依据')
    await expect(search).toBeDisabled()
    await expect(persona).toBeDisabled()
    expect(new Set(answers.at(-1)!.context.passages.map((passage) => passage.bookId))).toEqual(new Set(ids.map((book) => book.id)))

    await page.getByTestId('workbench-turn').getByTestId('citation-valid').filter({ hasText: titles[1] }).first().click()
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-page', 'reading')
    await expect(page.getByTestId('reader-host')).toContainText('证据比人数更重要')
    await page.getByTestId('return-workbench').click()
    await expect(page.getByTestId('workbench-detail')).toBeVisible()
    await expect(page.getByTestId('workbench-stop')).toHaveCount(0)
    await expect.poll(() => page.evaluate(async () => (await window.readerApi.listWorkbenches())[0].turns[0].status)).toBe('completed')
    const originalWorkbench = await page.evaluate(async () => (await window.readerApi.listWorkbenches())[0])
    expect(originalWorkbench.turns[0].context?.books).toHaveLength(2)
    expect(originalWorkbench.turns[0].persona?.name).toBe('对读助手')
    await page.getByTestId('workbench-question').fill('工作台草稿，重启后继续')
    await expect.poll(() => page.evaluate(async () => (await window.readerApi.listWorkbenches())[0].draft)).toBe('工作台草稿，重启后继续')
    expect(await page.evaluate((id) => window.readerApi.getBookSession(id), readingId)).toMatchObject({ conversationId: originalSession!.conversationId, draft: originalSession!.draft, turns: [] })
    await resizeWorkspace(application, page, 1180, 820)
    await expect(page.locator('.toast')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('workbench-desktop.png') })
    await resizeWorkspace(application, page, 940, 600)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByTestId('workbench-send')).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath('workbench-compact.png') })
    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-appearance').click()
    await page.getByTestId('theme-dark').click()
    await page.getByTestId('scale-125').click()
    await page.getByTestId('settings-close').click()
    const layout = await page.locator('.assistant-question-box:visible').evaluate((element) => {
      const box = element.getBoundingClientRect()
      const textarea = element.querySelector('textarea')!.getBoundingClientRect()
      const searchButton = element.querySelector('[data-testid="web-search-mode"]')!.getBoundingClientRect()
      const send = element.querySelector('[data-testid="workbench-send"]')!.getBoundingClientRect()
      return { overflow: element.scrollWidth - element.clientWidth, sameLine: Math.abs(searchButton.top - send.top),
        marginDelta: Math.abs((searchButton.left - box.left) - (box.right - send.right)), toolsBelowText: searchButton.top >= textarea.bottom }
    })
    expect(layout.overflow).toBeLessThanOrEqual(1)
    expect(layout.sameLine).toBeLessThanOrEqual(1)
    expect(layout.marginDelta).toBeLessThanOrEqual(1)
    expect(layout.toolsBelowText).toBe(true)
    await expect(page.getByTestId('workbench-send')).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath('workbench-compact-dark.png') })
    await persona.click()
    await page.getByTestId('session-persona-edit').click()
    await expect(page.getByTestId('session-persona-apply')).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath('workbench-persona-dark.png') })
    await page.keyboard.press('Escape')
    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-appearance').click()
    await page.getByTestId('theme-light').click()
    await page.getByTestId('scale-100').click()
    await page.getByTestId('settings-close').click()
    expect(errors).toEqual([])

    launched = await restartReader(application, { userData: workspace.userData })
    application = launched.application; page = launched.page
    await expect(page.getByTestId('workbench-detail')).toBeVisible()
    await expect(page.getByTestId('workbench-question')).toHaveValue('工作台草稿，重启后继续')
    await expect(page.getByTestId('session-persona-trigger')).toHaveAttribute('aria-label', '助手：对读助手')
    await expect(page.getByTestId('workbench-turn')).toContainText('的原文依据')
    const exportPath = join(workspace.root, '对读.md')
    await application.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, exportPath)
    await page.getByRole('button', { name: '导出工作台', exact: true }).click()
    await expect.poll(async () => (await readFile(exportPath, 'utf8').catch(() => '')).includes(titles[1])).toBe(true)
    expect(await readFile(exportPath, 'utf8')).toContain('证据比人数更重要')

    await page.getByText('选择书籍（最多 5 本）', { exact: true }).click()
    await page.getByRole('checkbox', { name: titles[1] }).uncheck()
    await page.getByTestId('workbench-question').fill('甲书如何解释证据？')
    await page.getByTestId('workbench-send').click()
    await expect(page.getByTestId('workbench-turn')).toHaveCount(2)
    await expect(page.getByTestId('workbench-stop')).toHaveCount(0)
    expect(answers.at(-1)!.context.books?.map((book) => book.id)).toEqual([readingId])
    expect(answers.at(-1)!.history).toEqual([])
    // Changing current sources never changes the source snapshot used to regenerate the last turn.
    await page.getByRole('checkbox', { name: titles[1] }).check()
    await page.getByRole('button', { name: '重新生成最后一轮', exact: true }).click()
    await expect(page.getByTestId('workbench-stop')).toHaveCount(0)
    expect(answers.at(-1)!.context.books?.map((book) => book.id)).toEqual([readingId])
    await expect(page.getByTestId('workbench-turn')).toHaveCount(2)
    await page.getByRole('button', { name: '编辑最后一问', exact: true }).click()
    await page.getByTestId('workbench-question').fill('甲书的证据有什么限制？')
    await page.getByTestId('workbench-send').click()
    await expect(page.getByTestId('workbench-stop')).toHaveCount(0)
    await expect(page.getByTestId('workbench-turn')).toHaveCount(2)
    await expect(page.getByTestId('workbench-turn').last()).toContainText('甲书的证据有什么限制？')
    expect(answers.at(-1)!.context.books?.map((book) => book.id)).toEqual([readingId])

    // Deleting one source keeps the workbench and its original excerpts; its references become unavailable.
    await page.evaluate((id) => window.readerApi.deleteBook(id), ids.find((book) => book.title === titles[1])!.id)
    await page.reload()
    await expect(page.getByTestId('workbench-turn').first()).toContainText('书籍已删除')
    const afterDelete = await page.evaluate(async () => (await window.readerApi.listWorkbenches())[0])
    expect(afterDelete.id).toBe(originalWorkbench.id)
    expect(afterDelete.bookIds).toEqual([readingId])
    await page.getByRole('button', { name: '删除工作台', exact: true }).click()
    await page.getByRole('button', { name: '确认', exact: true }).click()
    await expect(page.getByTestId('workbench-list')).toBeVisible()
    expect(await page.evaluate(() => window.readerApi.listWorkbenches())).toEqual([])
    expect(await page.evaluate((id) => window.readerApi.getBookSession(id), readingId)).toMatchObject({ conversationId: originalSession!.conversationId, draft: originalSession!.draft })
  } finally { await cleanupE2eWorkspace(application, workspace.root) }
})
