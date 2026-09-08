import { expect, test, type ElectronApplication } from '@playwright/test'
import { createServer } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ContextSnapshot, DocumentSection } from '../../src/shared/contracts'
import type {} from '../../src/renderer/src/global'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader, restartReader } from './support/electron-app'

test('retains final-summary errors and resumes cached work across restart, themes and window sizes', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-analysis-recovery-')
  const fixture = join(workspace.root, '汇总恢复.txt')
  await writeFile(fixture, '第一章 判断\n\n自主判断应回到证据，并且注意结论的适用条件。', 'utf8')
  let notes = 0, chapters = 0, overviews = 0, fail = true
  const sessions: string[] = []
  const server = createServer((request, response) => {
    let raw = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { raw += chunk })
    request.on('end', () => {
      const body = JSON.parse(raw) as { messages: Array<{ content: string }> }
      const system = body.messages[0].content
      if (system.includes('为阅读问题') || system.includes('你是阅读助手')) {
        const snapshot = system.includes('你是阅读助手') ? JSON.parse(body.messages.at(-1)!.content.split('\n')[1]) as ContextSnapshot : null
        const source = snapshot?.passages.find((passage) => passage.text.includes('适用条件'))
        const content = snapshot ? `原文要求核对证据与适用条件。[${source!.id}]` : '{"chapters":[],"terms":[]}'
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ choices: [{ message: { content } }] })); return
      }
      if (body.messages.length < 2) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }))
        return
      }
      const input = JSON.parse(body.messages[1].content) as DocumentSection | string[]
      sessions.push(String(request.headers['x-opencode-session']))
      let content: string
      if (!Array.isArray(input)) {
        notes++
        content = JSON.stringify({ summary: '分节笔记：自主判断的依据与适用条件。', claims: [{ text: '判断需要证据。', sourceIds: [input.blocks[0].id] }], conditions: [], exceptions: [], concepts: [] })
      } else if (input.some((part) => part.includes('章节汇总正文'))) {
        overviews++
        content = fail ? '长'.repeat(1701) : '全书合并完成：自主判断需要证据，并应保留适用条件。'
      } else {
        chapters++
        content = '章节汇总正文：论点以证据为基础，并明确限制。'
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 30 } }))
    })
  })
  let application: ElectronApplication | undefined
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Mock endpoint unavailable')
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    let page = launched.page
    await expect(page.getByTestId('book-item').first()).toBeVisible()
    await page.evaluate(async (baseUrl) => {
      const overview = await window.readerApi.createProviderProfile({ name: '恢复测试', baseUrl, model: 'fixture', apiKey: 'fixture-only', compatibility: 'opencode-go' })
      await window.readerApi.activateProviderProfile(overview.profiles[0].id)
    }, `http://127.0.0.1:${address.port}`)
    await page.reload()
    await page.getByTestId('book-item').first().click()
    await page.getByTestId('scope-book').click()
    await page.getByTestId('analysis-details').locator('summary').first().click()
    await page.getByTestId('document-prepare').click()
    await expect(page.getByTestId('document-status')).toHaveText('原文可检索')
    await page.getByTestId('analysis-start').click()
    await expect(page.getByTestId('analysis-retrying')).toBeVisible()
    await expect(page.locator('.analysis-error')).toContainText('全书合并：汇总返回了 1701 字符', { timeout: 15_000 })
    await expect(page.getByTestId('analysis-stage-progress')).toContainText('全书合并：0/1')
    expect(notes).toBe(1)
    expect(chapters).toBe(1)
    expect(overviews).toBe(3)
    await expect(page.getByTestId('followup-input')).toBeEnabled()
    await page.getByTestId('followup-input').fill('自主判断的适用条件是什么？')
    await page.getByTestId('followup-input').press('Enter')
    await expect(page.getByTestId('answer-current')).toContainText('原文要求核对证据与适用条件')
    await expect(page.getByTestId('citation-valid')).toHaveCount(1)
    await page.getByTestId('analysis-failures').locator('summary').click()
    await expect(page.getByTestId('analysis-failures').locator('li')).toHaveCount(3)
    for (const theme of ['light', 'dark'] as const) {
      await page.getByTestId('settings-button').click()
      await page.getByTestId('settings-nav-appearance').click()
      await page.getByTestId(`theme-${theme}`).click()
      await page.getByTestId('settings-close').click()
      await expect.poll(() => page.locator('.reader-document--txt').evaluate((element) => getComputedStyle(element).backgroundColor))
        .toBe(theme === 'dark' ? 'rgb(34, 41, 45)' : 'rgb(253, 252, 249)')
      for (const [width, height] of [[1440, 900], [940, 600]]) {
        await application.evaluate(({ BrowserWindow }, size) => { const window = BrowserWindow.getAllWindows()[0]; window.unmaximize(); window.setSize(size[0], size[1]) }, [width, height])
        await page.locator('.analysis-error').scrollIntoViewIfNeeded()
        await expect(page.locator('.analysis-error')).toBeInViewport()
        await page.screenshot({ path: test.info().outputPath(`error-${theme}-${width}.png`) })
        await page.getByTestId('analysis-start').scrollIntoViewIfNeeded()
        await expect(page.getByTestId('analysis-start')).toBeInViewport()
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        await page.screenshot({ path: test.info().outputPath(`recovery-${theme}-${width}.png`) })
      }
    }
    const before = { notes, chapters, overviews }
    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application
    page = restarted.page
    await page.getByTestId('book-item').first().click()
    await page.getByTestId('scope-book').click()
    await page.getByTestId('analysis-details').locator('summary').first().click()
    await expect(page.locator('.analysis-error')).toContainText('1701 字符')
    await page.getByTestId('analysis-failures').locator('summary').click()
    await expect(page.getByTestId('analysis-failures').locator('li')).toHaveCount(3)
    expect({ notes, chapters, overviews }).toEqual(before)
    fail = false
    await page.getByTestId('analysis-start').click()
    await expect(page.getByTestId('book-analysis-controls')).toContainText('章节笔记已完成')
    expect({ notes, chapters, overviews }).toEqual({ ...before, overviews: before.overviews + 1 })
    expect(new Set(sessions).size).toBe(1)
    expect(sessions[0]).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu)
    await expect(page.getByTestId('followup-input')).toBeEnabled()
    await expect(page.getByTestId('analysis-failures').locator('li')).toHaveCount(3)
    await page.screenshot({ path: test.info().outputPath('recovery-completed.png') })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
