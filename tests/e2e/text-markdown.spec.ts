import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ContextSnapshot } from '../../src/shared/contracts'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader, restartReader } from './support/electron-app'
import { enterReading, resizeWorkspace, showLibrary } from './support/workspace'

const title = 'Markdown 阅读样本'
const source = ['# Markdown 阅读样本', '', '## 原文与强调', '', '甲**😀乙**丙 &amp; \\*星\\*。', '',
  '- 清单一', '- 清单二', '  - 嵌套条目', '', '> 引用说明。', '> 保留原文位置。', '', '> <div>', '> 原样 HTML', '> </div>', '', '```ts', 'const value = "<img>"', '```', '',
  '| 项目 | 数值 |', '| --- | --- |', '| 中文 | 24 |', '',
  '<script>window.__markdownExecuted = true</script>', '', '![图片](https://markdown.invalid/image.png)', '', '[外链](https://markdown.invalid/)', '',
  '## 后文', '', ...Array.from({ length: 35 }, (_, index) => `背景段落 ${index + 1}。用于检查连续滚动和阅读位置。\n`)].join('\n')

async function mode(page: Page, value: 'auto' | 'plain' | 'markdown'): Promise<void> {
  await page.getByTestId('reader-settings-button').click()
  await page.getByTestId('settings-nav-reading').click()
  await page.getByTestId('text-reading-mode').selectOption(value)
  await expect(page.getByTestId('text-reading-mode')).toHaveValue(value)
  await page.getByTestId('settings-close').click()
}

async function selectAcrossEmphasis(page: Page): Promise<void> {
  const paragraph = page.getByTestId('reader-host').locator('p').filter({ hasText: '甲😀乙丙' }).first()
  await paragraph.scrollIntoViewIfNeeded()
  await paragraph.evaluate((element) => {
    const range = document.createRange()
    range.setStart(element.firstChild!, 0)
    range.setEnd(element.querySelector('strong')!.nextSibling!, 1)
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  await expect(page.getByTestId('selection-toolbar')).toBeVisible()
}

test('renders safe TXT Markdown across themes, scales and desktop/minimum windows', async () => {
  test.setTimeout(90_000)
  const workspace = await createE2eWorkspace('reader-markdown-layout-')
  const fixture = join(workspace.root, title + '.txt')
  await writeFile(fixture, source, 'utf8')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const page = launched.page
    const errors: string[] = [], externalRequests: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) => { if (request.url().includes('markdown.invalid')) externalRequests.push(request.url()) })
    await showLibrary(page); await page.getByTestId('book-item').first().click(); await enterReading(page)
    const article = page.locator('.reader-document--txt')
    await expect(article).toHaveAttribute('data-text-rendering', 'markdown')
    await expect(article.locator('strong')).toHaveText('😀乙')
    await expect(article.locator('pre code')).toHaveText('const value = "<img>"')
    await expect(article.locator('table')).toContainText('24')
    await expect(article.locator('script,img,a,input,iframe')).toHaveCount(0)
    await mode(page, 'plain')
    await page.getByTestId('reader-settings-button').click()
    await page.getByTestId('reading-reset').click()
    await expect(page.getByTestId('text-reading-mode')).toHaveValue('auto')
    await page.getByTestId('settings-close').click()
    await expect(article).toHaveAttribute('data-text-rendering', 'markdown')
    for (const theme of ['light', 'dark'] as const) for (const width of [1180, 940]) {
      await resizeWorkspace(application, page, width, width === 940 ? 600 : 800)
      await page.getByTestId('settings-button').click()
      await page.getByTestId('settings-nav-appearance').click()
      await page.getByTestId('theme-' + theme).click()
      await page.getByTestId(width === 940 ? 'scale-125' : 'scale-100').click()
      await page.getByTestId('settings-nav-reading').click()
      await expect(page.getByTestId('text-reading-status')).toContainText('Markdown')
      await expect(page.getByTestId('text-reading-mode')).toBeInViewport()
      await page.screenshot({ path: test.info().outputPath(`markdown-settings-${theme}-${width}.png`) })
      await page.getByTestId('settings-close').click()
      await expect.poll(() => article.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      await page.getByTestId('reader-host').evaluate((element) => { element.scrollTop = 0 })
      await page.screenshot({ path: test.info().outputPath(`markdown-reading-${theme}-${width}.png`) })
    }
    expect(errors).toEqual([])
    expect(externalRequests).toEqual([])
    expect(await page.evaluate(() => (window as unknown as { __markdownExecuted?: boolean }).__markdownExecuted)).toBeUndefined()
  } finally { await cleanupE2eWorkspace(application, workspace.root) }
})

test('keeps original anchors through Markdown selection, answering, search, per-book mode and restart', async () => {
  test.setTimeout(90_000)
  const workspace = await createE2eWorkspace('reader-markdown-sources-')
  const paths = [join(workspace.root, title + '.txt'), join(workspace.root, '纯文本书籍.txt')]
  await writeFile(paths[0], source, 'utf8')
  await writeFile(paths[1], '纯文本书籍\n\n普通正文，含一个 # 号与乘法 2 * 3。', 'utf8')
  const answers: ContextSnapshot[] = []
  const server = createServer((request, response) => {
    let raw = ''; request.setEncoding('utf8')
    request.on('data', (chunk) => { raw += chunk })
    request.on('end', () => {
      const body = JSON.parse(raw) as { messages: Array<{ content: string }> }
      let content = 'OK'
      if (body.messages[0].content.includes('为阅读问题')) content = JSON.stringify({ chapters: [], terms: ['甲', '乙'] })
      else if (body.messages[0].content.includes('你是阅读助手')) {
        const context = JSON.parse(body.messages.at(-1)!.content.split('\n')[1]) as ContextSnapshot
        answers.push(context)
        const selected = context.passages.find((passage) => passage.text === '甲😀乙丙')
        content = selected ? `选中原文可核对。[${selected.id}]` : '没有取得选中原文。'
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content } }] }))
    })
  })
  let application: ElectronApplication | undefined
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture endpoint')
    let launched = await launchReader({ userData: workspace.userData })
    application = launched.application
    let page = launched.page
    await showLibrary(page)
    await application.evaluate(({ dialog }, filePaths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths }) }, paths)
    await page.getByTestId('import-book').click()
    await expect(page.getByTestId('book-import-summary')).toContainText('已导入 2 本')
    await page.getByTestId('book-import-close').click()
    const bookId = await page.evaluate(async (baseUrl) => {
      const profiles = await window.readerApi.createProviderProfile({ name: '合成 Markdown 回归', baseUrl, model: 'markdown-fixture', apiKey: 'synthetic-only' })
      await window.readerApi.activateProviderProfile(profiles.profiles[0].id)
      return (await window.readerApi.listBooks()).find((book) => book.title === 'Markdown 阅读样本')!.id
    }, `http://127.0.0.1:${address.port}`)
    await page.reload(); await showLibrary(page)
    await page.getByTestId('book-item').filter({ hasText: title }).click(); await enterReading(page)
    await page.evaluate((id) => window.readerApi.prepareBookDocument({ bookId: id }), bookId)
    await expect.poll(() => page.evaluate(async (id) => (await window.readerApi.getBookAnalysis(id)).document?.status, bookId)).toBe('ready')
    const jobId = await page.evaluate(async (id) => (await window.readerApi.getBookAnalysis(id)).document!.jobId, bookId)
    await selectAcrossEmphasis(page)
    await page.getByTestId('action-save-highlight').click()
    await expect.poll(() => page.evaluate(async (id) => (await window.readerApi.listHighlights(id)).length, bookId)).toBe(1)
    const saved = await page.evaluate(async (id) => (await window.readerApi.listHighlights(id))[0], bookId)
    const start = Array.from(source.slice(0, source.indexOf('甲'))).length
    const end = Array.from(source.slice(0, source.indexOf('丙') + 1)).length
    expect(saved).toMatchObject({ quote: '甲😀乙丙', anchor: `txt:${start}:${end}` })
    await selectAcrossEmphasis(page)
    await page.getByTestId('action-ask').click()
    const input = page.getByTestId('followup-input')
    await expect(input).toBeEditable(); await input.fill('解释选中的文字。')
    await page.getByTestId('send-question').click()
    const answer = page.getByTestId('answer-current')
    await expect(answer).toContainText('选中原文可核对')
    await expect(answer.getByTestId('citation-valid')).toHaveCount(1)
    expect(answers).toHaveLength(1)
    expect(answers[0].passages[0].text).toBe('甲😀乙丙')
    await page.getByTestId('answer-save').click()
    await expect.poll(() => page.evaluate(async (id) => (await window.readerApi.listInsights(id)).length, bookId)).toBe(1)
    const insight = await page.evaluate(async (id) => (await window.readerApi.listInsights(id))[0], bookId)
    expect(insight.context?.passages[0].anchor).toBe(saved.anchor)
    await answer.getByTestId('citation-valid').click()
    await mode(page, 'plain')
    await expect(page.locator('.reader-document--txt')).toHaveAttribute('data-text-rendering', 'plain')
    await expect(page.getByTestId('reader-host')).toContainText('甲**😀乙**丙')
    await expect(page.getByTestId('reader-return-button')).toBeVisible()
    expect(await page.evaluate(async (id) => (await window.readerApi.getBookAnalysis(id)).document!.jobId, bookId)).toBe(jobId)
    await showLibrary(page); await page.getByTestId('book-item').filter({ hasText: '纯文本书籍' }).click(); await enterReading(page)
    await page.getByTestId('reader-settings-button').click()
    await expect(page.getByTestId('text-reading-mode')).toHaveValue('auto')
    await page.getByTestId('settings-close').click()
    await showLibrary(page); await page.getByTestId('book-item').filter({ hasText: title }).click(); await enterReading(page)
    await expect(page.locator('.reader-document--txt')).toHaveAttribute('data-text-rendering', 'plain')
    launched = await restartReader(application, { userData: workspace.userData }); application = launched.application; page = launched.page
    await showLibrary(page); await page.getByTestId('book-item').filter({ hasText: title }).click(); await enterReading(page)
    await expect(page.locator('.reader-document--txt')).toHaveAttribute('data-text-rendering', 'plain')
    await mode(page, 'markdown')
    await expect(page.locator('.reader-document--txt')).toHaveAttribute('data-text-rendering', 'markdown')
    expect(await page.evaluate(async (id) => (await window.readerApi.listHighlights(id))[0].anchor, bookId)).toBe(saved.anchor)
    await page.getByTestId('reader-search-button').click()
    await page.getByTestId('reader-search-input').fill('甲😀乙丙')
    await page.getByTestId('reader-search-input').press('Enter')
    await expect(page.getByTestId('reader-search-result')).toHaveCount(1)
    await page.getByTestId('reader-search-result').click()
    await expect(page.getByTestId('reader-host')).toContainText('甲😀乙丙')
    await page.screenshot({ path: test.info().outputPath('markdown-sources-restored.png') })
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()))
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('keeps the TXT book identity when Markdown starts with front matter or a separator', async () => {
  const workspace = await createE2eWorkspace('reader-markdown-metadata-')
  const bookTitle = '带前置字段的笔记'
  const fixture = join(workspace.root, bookTitle + '.txt')
  await writeFile(fixture, '---\ntitle: 前置字段\n---\n\n# 正文标题\n\n**正文内容**。', 'utf8')
  let application: ElectronApplication | undefined
  try {
    let launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    let page = launched.page
    await showLibrary(page); await page.getByTestId('book-item').first().click(); await enterReading(page)
    await expect(page.locator('.reader-document--txt')).toHaveAttribute('data-text-rendering', 'markdown')
    expect(await page.evaluate(async () => (await window.readerApi.listBooks())[0].title)).toBe(bookTitle)
    await mode(page, 'plain')
    await expect(page.getByTestId('reader-host')).toContainText('# 正文标题')
    await mode(page, 'markdown')
    launched = await restartReader(application, { userData: workspace.userData }); application = launched.application; page = launched.page
    await showLibrary(page)
    await expect(page.getByTestId('book-item')).toContainText(bookTitle)
    await page.getByTestId('book-item').click(); await enterReading(page)
    await expect(page.locator('.reader-document--txt')).toHaveAttribute('data-text-rendering', 'markdown')
    expect(await page.evaluate(async () => (await window.readerApi.listBooks())[0].title)).toBe(bookTitle)
  } finally { await cleanupE2eWorkspace(application, workspace.root) }
})
