import { showLibrary, enterReading, togglePreparation, showReferences, showAssistant, resizeWorkspace } from './support/workspace'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'
import type { ContextSnapshot, DocumentSection } from '../../src/shared/contracts'
import type {} from '../../src/renderer/src/global'
import { createSearchLinksEpubFixture } from './fixtures/search-links-epub'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader, restartReader } from './support/electron-app'

const definition = '从众是个体受到群体压力而改变判断；随大流是这里的日常说法。😀𠮷'
const finalParagraph = '自主判断要求回到证据。这里应联系前面从众的定义。'
let server: Server
let endpoint = ''
let notes: Array<{ model: string; section: DocumentSection }> = []
let answers: Array<{ model: string; context: ContextSnapshot; question: string; sessionId: string }> = []
let analysisSessions: string[] = [], planningSessions: string[] = []
let holdNotes = false
let rerankStatus = 200, rerankCalls = 0

test.beforeAll(async () => {
  server = createServer((request, response) => {
    let raw = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { raw += chunk })
    request.on('end', () => {
      if (request.url?.endsWith('/rerank')) {
        rerankCalls++
        expect(request.headers.authorization).toBe('Bearer rerank-only')
        expect(request.headers['x-opencode-session']).toBeUndefined()
        const input = JSON.parse(raw) as { documents: string[]; top_n: number; return_documents: boolean }
        expect(input.top_n).toBe(input.documents.length); expect(input.return_documents).toBe(false)
        response.writeHead(rerankStatus, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ results: input.documents.map((text, index) => ({ index, relevance_score: text.includes('从众是') ? 1 : 0 })) }))
        return
      }
      const body = JSON.parse(raw) as { model: string; messages: Array<{ content: string }> }
      const system = body.messages[0]?.content ?? ''
      const sessionId = request.headers['x-opencode-session']
      if (typeof sessionId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu.test(sessionId) ||
          !request.headers['user-agent']?.startsWith('LLM-Reader/')) {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'missing x-opencode-session or client identity' }))
        return
      }
      let content = 'OK', delay = 0
      if (system.includes('只输出 JSON：')) {
        analysisSessions.push(sessionId)
        const section = JSON.parse(body.messages[1].content) as DocumentSection
        notes.push({ model: body.model, section })
        const source = section.blocks.find((block) => block.text.includes('从众是')) ?? section.blocks.find((block) => block.kind !== 'heading') ?? section.blocks[0]
        content = JSON.stringify({ summary: `${section.chapterTitle}：讨论判断、群体压力及证据的关系。`, claims: [{ text: source.text.slice(0, 350), sourceIds: [source.id] }], conditions: [], exceptions: [],
          concepts: source.text.includes('从众是') ? [{ term: '从众', aliases: ['随大流', 'conformity'], text: definition, sourceIds: [source.id] }] : [] })
        delay = 200
        if (holdNotes && notes.length > 1) return
      } else if (system.includes('综合这些笔记')) {
        analysisSessions.push(sessionId)
        content = '全书先讨论自主判断，然后定义从众，最后对照自主判断与群体压力，并要求回到证据。'
      } else if (system.includes('为阅读问题')) {
        planningSessions.push(sessionId)
        content = JSON.stringify({ chapters: ['c1'], terms: ['从众', 'conformity'] })
      } else if (system.includes('你是阅读助手')) {
        const user = body.messages.at(-1)!.content
        const context = JSON.parse(user.split('\n')[1]) as ContextSnapshot
        const source = context.passages.find((passage) => passage.text.includes('从众是'))
        answers.push({ model: body.model, context, question: user, sessionId })
        content = source ? `从众的定义来自书中原文。[${source.id}]\n\n作者把群体压力与自主判断作了对照。` : '当前原文依据不足，无法确定。'
      }
      setTimeout(() => {
        if (response.destroyed) return
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ model: body.model, choices: [{ message: { content } }], usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 } }))
      }, delay)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Mock endpoint unavailable')
  endpoint = `http://127.0.0.1:${address.port}`
})
test.afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})
test.beforeEach(() => { notes = []; answers = []; analysisSessions = []; planningSessions = []; holdNotes = false; rerankStatus = 200; rerankCalls = 0 })

async function profiles(page: Page): Promise<{ analysisId: string; questionId: string }> {
  return page.evaluate(async (baseUrl) => {
    const first = await window.readerApi.createProviderProfile({ name: '阅读问答', baseUrl, model: 'question-model', apiKey: 'fixture-only', compatibility: 'opencode-go' })
    const questionId = first.profiles[0].id
    await window.readerApi.activateProviderProfile(questionId)
    const second = await window.readerApi.createProviderProfile({ name: '章节分析', baseUrl, model: 'analysis-model', apiKey: 'fixture-only', compatibility: 'opencode-go' })
    return { questionId, analysisId: second.profiles.find((profile) => profile.name === '章节分析')!.id }
  }, endpoint)
}
async function ask(page: Page, question: string): Promise<void> {
  const surface = await page.getByTestId('assistant-dialog').count() ? page.getByTestId('assistant-dialog') : page
  await surface.getByTestId('followup-input').fill(question)
  await surface.getByTestId('followup-input').press('Enter')
  await expect(surface.getByTestId('answer-current')).toContainText('从众的定义来自书中原文')
  await expect(surface.getByTestId('answer-current').getByTestId('citation-valid')).toHaveCount(1)
  await expect(surface.getByTestId('cancel-request')).toHaveCount(0)
}

for (const format of ['txt', 'epub', 'epub-no-toc'] as const) {
  test(`${format}: analyzes separately, asks without selection, navigates original citations and preserves archives`, async () => {
    const testInfo = test.info()
    test.setTimeout(120_000)
    const workspace = await createE2eWorkspace('llm-reader-book-context-')
    const fixture = join(workspace.root, format === 'txt' ? '全书上下文.txt' : '全书上下文.epub')
    const filler = '这是用于保持自然阅读位置的普通正文，讨论观察方法。'.repeat(320)
    if (format === 'txt') {
      await writeFile(fixture, `\uFEFF第一章 开篇\r\n\r\n自主判断需要证据。\r\n\r\n${filler}\r\n\r\n第二章 定义\r\n\r\n${definition}\r\n\r\n${finalParagraph}`, 'utf8')
    } else {
      await createSearchLinksEpubFixture(fixture)
      const zip = await JSZip.loadAsync(await readFile(fixture))
      const first = (await zip.file('OEBPS/chapter-1.xhtml')!.async('string')).replace('</body>', `<p>${filler}</p><aside id="unicode-note"><p>脚注 😀𠮷 é，保留原文定位。</p></aside></body>`)
      const second = (await zip.file('OEBPS/chapter-2.xhtml')!.async('string')).replace('</body>', `<p>${definition}</p><p>${finalParagraph}</p></body>`)
      zip.file('OEBPS/chapter-1.xhtml', first)
      zip.file('OEBPS/chapter-2.xhtml', second)
      if (format === 'epub-no-toc') {
        zip.file('OEBPS/content.opf', (await zip.file('OEBPS/content.opf')!.async('string')).replace(/<item id="nav"[^>]+\/>/u, ''))
        zip.remove('OEBPS/nav.xhtml')
      }
      await writeFile(fixture, await zip.generateAsync({ type: 'nodebuffer' }))
    }
    let application: ElectronApplication | undefined
    try {
      const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
      application = launched.application
      let page = launched.page
      await showLibrary(page); await expect(page.getByTestId('book-item').first()).toBeVisible()
      const ids = await profiles(page)
      await page.evaluate((url) => window.readerApi.saveKnowledgeSettings({ embedding: { enabled: false, baseUrl: '', model: '' },
        rerank: { enabled: true, baseUrl: `${url}/v1`, model: 'reranker-test', apiKey: 'rerank-only' },
        document: { processor: 'none', baseUrl: '', ocr: true, language: 'ch' } }), endpoint)
      await page.reload()
      await showLibrary(page); await page.getByTestId('book-item').first().click(); await enterReading(page)
      await expect(page.getByTestId('reader-host')).toBeVisible()
      await expect(page.locator('.reader-column')).not.toHaveAttribute('data-current-chapter-title', '')
      const naturalChapter = await page.locator('.reader-column').getAttribute('data-current-chapter-title')
      const bookId = await page.evaluate(async () => (await window.readerApi.listBooks())[0].id)
      await page.getByTestId('scope-book').click()
      await expect(page.getByTestId('followup-input')).toBeEnabled()
      await togglePreparation(page)
      await expect(page.getByTestId('analysis-profile')).toHaveValue(ids.questionId)
      await page.getByTestId('analysis-profile').selectOption(ids.analysisId)
      await application.evaluate(({ app, BrowserWindow }) => {
        const auditApp = app as typeof app & { extractionAudit?: { node: boolean; generalApi: boolean; extractionApi: boolean; hidden: boolean; separateProcess: boolean } }
        app.once('browser-window-created', (_event, window) => {
          window.webContents.once('did-finish-load', () => {
            const main = BrowserWindow.getAllWindows().find((candidate) => candidate.id !== window.id)!
            const state = { hidden: !window.isVisible(), separateProcess: window.webContents.getOSProcessId() !== main.webContents.getOSProcessId() }
            void window.webContents.executeJavaScript('({ node: typeof require !== "undefined", generalApi: typeof readerApi !== "undefined", extractionApi: typeof bookExtractor !== "undefined" })')
              .then((flags: { node: boolean; generalApi: boolean; extractionApi: boolean }) => { auditApp.extractionAudit = { ...state, ...flags } })
          })
        })
      })
      if (format === 'txt') holdNotes = true
      await page.getByTestId('document-prepare').click()
      await expect(page.getByTestId('document-status')).toHaveText('原文已就绪')
      await page.getByTestId('analysis-start').click()
      if (format === 'txt') {
        await expect.poll(() => page.evaluate((id) => window.readerApi.getBookAnalysis(id).then((state) => state.completedSections), bookId)).toBeGreaterThan(0)
        await page.getByTestId('analysis-cancel').click()
        await expect.poll(() => page.evaluate((id) => window.readerApi.getBookAnalysis(id).then((state) => state.status), bookId)).toBe('paused')
        const callsBeforeRestart = notes.length
        const restarted = await restartReader(application, { userData: workspace.userData })
        application = restarted.application
        page = restarted.page
        await showLibrary(page); await page.getByTestId('book-item').first().click(); await enterReading(page)
        expect(notes).toHaveLength(callsBeforeRestart)
        await page.getByTestId('scope-book').click()
        await togglePreparation(page)
        holdNotes = false
        await page.getByTestId('analysis-start').click()
      }
      await expect(page.getByTestId('book-analysis-controls')).toContainText('章节笔记已完成', { timeout: 45_000 })
      if (format !== 'txt') expect(await application.evaluate(({ app }) => (app as typeof app & { extractionAudit?: unknown }).extractionAudit))
        .toEqual({ node: false, generalApi: false, extractionApi: true, hidden: true, separateProcess: true })
      expect(application.windows()).toHaveLength(1)
      const ready = await page.evaluate((id) => window.readerApi.getBookAnalysis(id), bookId)
      expect(ready.sections).toBeGreaterThan(2)
      expect(ready.completedSections).toBe(ready.sections)
      expect(new Set(analysisSessions).size).toBe(1)
      expect(notes.every((item) => item.model === 'analysis-model')).toBe(true)
      expect((await page.evaluate(() => window.readerApi.getProviderOverview())).activeProfileId).toBe(ids.questionId)
      if (format !== 'txt') expect(notes.some((item) => item.section.blocks.some((block) => block.kind === 'note' && block.text.includes('😀')))).toBe(true)
      await togglePreparation(page)
      await ask(page, '结合全书解释随大流与自主判断的关系')
      expect(planningSessions.at(-1)).toBe(answers.at(-1)?.sessionId)
      expect(answers.at(-1)?.sessionId).not.toBe(analysisSessions[0])
      expect(answers.at(-1)?.model).toBe('question-model')
      expect(answers.at(-1)?.context.passages.some((passage) => passage.text.includes(definition))).toBe(true)
      await page.getByTestId('answer-current').getByTestId('citation-valid').click()
      await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', /第二章/u)
      if (format !== 'txt') await expect.poll(() => page.getByTestId('reader-host').evaluate((host, target) => {
        const hostRect = host.getBoundingClientRect()
        return Array.from(host.querySelectorAll('iframe')).some((frame) => {
          const paragraph = Array.from(frame.contentDocument?.querySelectorAll('p') ?? []).find((element) => element.textContent === target)
          if (!paragraph) return false
          const rect = paragraph.getBoundingClientRect(), offset = frame.getBoundingClientRect().top
          return rect.bottom + offset > hostRect.top && rect.top + offset < hostRect.bottom
        })
      }, definition)).toBe(true)
      await expect(page.getByTestId('reader-return-button')).toBeEnabled()
      await page.getByTestId('reader-return-button').click()
      await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', naturalChapter!)
      await page.getByTestId('answer-save').click()
      const saved = await page.evaluate(async (id) => (await window.readerApi.listInsights(id))[0], bookId)
      expect(saved.conversationId).toBe(answers.at(-1)?.sessionId)
      expect(saved.selection).toBeNull()
      expect(saved.context?.scope).toBe('book')
      expect(saved.context?.rerank?.status).toBe('applied')
      expect(rerankCalls).toBe(1)
      expect(saved.context?.passages.some((passage) => passage.text.includes(definition))).toBe(true)
      await page.locator('.right-sidebar').getByRole('button', { name: '选中内容', exact: true }).click()
      await page.getByTestId('scope-book').click()
      rerankStatus = 429
      await ask(page, '再比较一下两种判断')
      expect(rerankCalls).toBe(2)
      await page.locator('.answer-sources').last().locator('summary').click()
      await expect(page.getByTestId('rerank-result').last()).toHaveText('排序服务未完成，已使用原有顺序')
      expect((await page.evaluate((id) => window.readerApi.getBookAnalysis(id), bookId)).status).toBe('ready')
      rerankStatus = 200
      expect(answers.at(-1)?.sessionId).toBe(saved.conversationId)
      expect(answers).toHaveLength(2)
      if (format === 'txt') {
        for (const theme of ['light', 'dark'] as const) {
          await page.getByTestId('settings-button').click()
          await page.getByTestId('settings-nav-appearance').click()
          await page.getByTestId(`theme-${theme}`).click()
          await page.getByTestId('settings-close').click()
          await expect.poll(() => page.locator('.reader-document--txt').evaluate((element) => getComputedStyle(element).backgroundColor))
            .toBe(theme === 'dark' ? 'rgb(34, 41, 45)' : 'rgb(253, 252, 249)')
          for (const [width, height] of [[1440, 900], [940, 600]]) {
            await resizeWorkspace(application, page, width, height)
            await showAssistant(page)
            await expect(page.getByTestId('followup-input')).toBeVisible()
            await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
            await page.screenshot({ path: testInfo.outputPath(`${theme}-${width}.png`) })
            await showReferences(page)
            await page.getByTestId('rerank-result').last().scrollIntoViewIfNeeded()
            await expect(page.getByTestId('rerank-result').last()).toBeInViewport()
            await page.screenshot({ path: testInfo.outputPath(`rerank-fallback-${theme}-${width}.png`) })
            await togglePreparation(page)
            await page.getByTestId('analysis-rebuild').scrollIntoViewIfNeeded()
            await expect(page.getByTestId('analysis-rebuild')).toBeVisible()
            await page.screenshot({ path: testInfo.outputPath(`${theme}-${width}-analysis.png`) })
            await togglePreparation(page)
          }
        }
        await page.getByTestId('workspace-tab-reading').click()
        await expect(page.locator('.workspace-shell')).toHaveAttribute('data-page', 'reading')
        await page.getByTestId('reader-host').locator('p').first().evaluate((element) => {
          const range = document.createRange()
          range.selectNodeContents(element)
          const selection = window.getSelection()
          selection?.removeAllRanges()
          selection?.addRange(range)
          element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        })
        await page.getByTestId('action-explain').click()
        await expect(page.getByTestId('answer-current')).toContainText('从众的定义来自书中原文')
        await expect(page.getByTestId('cancel-request')).toHaveCount(0)
        expect(answers.at(-1)?.context.scope).toBe('selection')
        expect(answers.at(-1)?.sessionId).not.toBe(saved.conversationId)
        expect(answers.at(-1)?.context.passages.some((passage) => passage.text.includes(definition))).toBe(true)
        await page.getByTestId('assistant-expand-button').click()
        await page.getByTestId('assistant-dialog-tab-insights').click()
        await page.getByTestId('insight-item').locator('.insight-content').click()
        await ask(page, '归档追问：书中如何定义从众？')
        expect(answers.at(-1)?.sessionId).toBe(saved.conversationId)
        await expect.poll(() => page.evaluate(async (id) => (await window.readerApi.listInsights(id))[0].history.length, bookId)).toBe(4)
        const archiveHistory = await page.evaluate(async (id) => (await window.readerApi.listInsights(id))[0].history, bookId)
        expect(archiveHistory[1].context?.passages).toEqual(saved.context?.passages)
        expect(archiveHistory[3].context?.passages.some((passage) => passage.text.includes(definition))).toBe(true)
        const restarted = await restartReader(application, { userData: workspace.userData })
        application = restarted.application
        page = restarted.page
        await showLibrary(page); await page.getByTestId('book-item').first().click(); await enterReading(page)
        await page.getByTestId('assistant-expand-button').click()
        await page.getByTestId('assistant-dialog-tab-insights').click()
        const exportPath = join(workspace.root, '全书归档.md')
        await application.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, exportPath)
        await page.getByTestId('insight-export').click()
        await expect.poll(async () => readFile(exportPath, 'utf8').catch(() => '')).toContain(definition)
        await page.getByTestId('insight-item').locator('.insight-content').click()
        await expect(page.getByTestId('assistant-dialog').getByTestId('citation-valid')).toHaveCount(2)
        await ask(page, '重启后继续追问：从众的定义是什么？')
        expect(answers.at(-1)?.sessionId).toBe(saved.conversationId)
        expect(planningSessions.at(-1)).toBe(saved.conversationId)
        await page.getByTestId('workspace-tab-reading').click()
      }
      await togglePreparation(page)
      holdNotes = true
      page.once('dialog', (dialog) => void dialog.accept())
      await page.getByTestId('analysis-rebuild').click()
      await expect.poll(() => analysisSessions.some((sessionId) => sessionId !== analysisSessions[0]), { timeout: 15_000 }).toBe(true)
      await page.getByTestId('analysis-cancel').click()
      expect((await page.evaluate(async (id) => (await window.readerApi.listInsights(id))[0], bookId)).context).toEqual(saved.context)
    } finally { await cleanupE2eWorkspace(application, workspace.root) }
  })
}
