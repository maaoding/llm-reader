import { expect, test, type ElectronApplication } from '@playwright/test'
import { createServer, type ServerResponse } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader } from './support/electron-app'
import { enterReading, resizeWorkspace, showLibrary } from './support/workspace'

test('copies live turns without persistence truncation and saves the same snapshot through both workspaces', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('reader-conversation-markdown-')
  let application: ElectronApplication | undefined
  let clipboardBackedUp = false
  let count = 0, hold = false
  const held: ServerResponse[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stream?: boolean }
      if (!body.stream) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ choices: [{ message: { content: '连接正常' }, finish_reason: 'stop' }] }))
        return
      }
      count++
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const text = hold ? '生成中的部分文字' : '回答第 ' + count + ' 轮 [P1]，未知 [P99]。\n\n' + '完整长回答'.repeat(5_000) + '\n尾标-' + count
      response.write('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n')
      if (hold) { held.push(response); return }
      response.end('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing mock endpoint')
  const endpoint = 'http://127.0.0.1:' + address.port + '/v1'
  try {
    const fixture = join(workspace.root, '复制测试.txt')
    await writeFile(fixture, '第一章 测试\n\n当轮原文甲，用来核对来源。\n\n后文原文乙，不替换旧来源。', 'utf8')
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const page = launched.page
    await application.evaluate(async ({ clipboard, ClipboardItem }) => {
      const state = globalThis as unknown as { g01ClipboardBackup?: Electron.ClipboardItem[] }
      const backup: Electron.ClipboardItem[] = []
      for (const item of await clipboard.read()) {
        const entries = await Promise.all(item.types.map(async type => [type, await item.getType(type)] as const))
        // A headless runner may expose an empty clipboard entry without MIME types.
        if (entries.length > 0) backup.push(new ClipboardItem(Object.fromEntries(entries)))
      }
      state.g01ClipboardBackup = backup
    })
    clipboardBackedUp = true
    await showLibrary(page)
    await expect(page.getByTestId('book-item')).toHaveCount(1)
    await page.evaluate(async url => {
      const overview = await window.readerApi.createProviderProfile({ name: '本机合成模型', baseUrl: url, model: 'markdown-fixture', apiKey: 'test-only-key' })
      await window.readerApi.activateProviderProfile(overview.profiles[0].id)
    }, endpoint)
    await page.reload()
    await showLibrary(page)
    await page.getByTestId('book-item').click()
    await enterReading(page)
    await page.getByTestId('reader-host').locator('p').first().evaluate(element => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const selection = window.getSelection()
      selection?.removeAllRanges(); selection?.addRange(range)
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    await page.getByTestId('action-ask').click()
    const sidebar = page.getByTestId('ai-panel')
    await expect(page.getByTestId('assistant-expand-button')).toHaveCount(0)
    await expect(sidebar.locator('.assistant-header').getByTestId('conversation-copy')).toHaveAccessibleName('复制当前会话')
    await expect(sidebar.getByTestId('conversation-copy')).toHaveText('')
    await expect(sidebar.locator('.assistant-header').getByTestId('conversation-export')).toBeVisible()
    for (const question of ['第一问', '第二问']) {
      await sidebar.getByTestId('followup-input').fill(question)
      await sidebar.getByTestId('followup-input').press('Enter')
      await expect(sidebar.getByTestId('answer-current')).toContainText('尾标-' + (question === '第一问' ? 1 : 2))
      await expect(sidebar.getByTestId('conversation-copy')).toBeEnabled()
    }
    await sidebar.getByTestId('followup-input').fill('这段草稿不应导出')
    await sidebar.getByTestId('answer-copy').last().click()
    let copied = await application.evaluate(({ clipboard }) => clipboard.readText())
    expect(copied).toContain('尾标-2')
    expect(copied).not.toContain('尾标-1')
    expect(copied.length).toBeGreaterThan(20_000)
    await sidebar.getByTestId('conversation-copy').click()
    copied = await application.evaluate(({ clipboard }) => clipboard.readText())
    expect(copied).toContain('尾标-1')
    expect(copied).toContain('尾标-2')
    expect(copied).toContain('当轮原文甲')
    expect(copied).toContain('未验证的引用编号：[P99]')
    expect(copied.length).toBeGreaterThan(40_000)
    expect(copied).not.toContain('这段草稿不应导出')

    const path = join(workspace.root, '会话.md')
    await application.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog
    }, path)
    await page.getByTestId('workspace-tab-conversation').click()
    const full = page.getByTestId('assistant-dialog')
    await expect(full.locator('.assistant-workspace-nav').getByTestId('conversation-copy')).toBeEnabled()
    await expect(full.getByTestId('conversation-copy')).toHaveText('')
    await expect(full.locator('.assistant-workspace-nav').getByTestId('conversation-export')).toBeVisible()
    await full.getByTestId('conversation-export').click()
    await expect(full.getByTestId('conversation-markdown-status')).toContainText('会话.md')
    expect(await readFile(path, 'utf8')).toBe(copied)

    // Fail one native clipboard write, then verify the explicit file fallback.
    await application.evaluate(({ clipboard }) => {
      const write = clipboard.writeText
      let first = true
      clipboard.writeText = async text => { if (first) { first = false; throw new Error('Synthetic clipboard failure') }; await write(text) }
    })
    const trigger = full.getByTestId('conversation-copy')
    await trigger.click()
    const fallback = page.getByTestId('conversation-markdown-fallback')
    await expect(fallback).toContainText('未能写入剪贴板')
    await page.keyboard.press('Escape')
    await expect(fallback).toHaveCount(0)
    await expect(trigger).toBeFocused()

    // Exercise a failed save and retry without regenerating or archiving.
    await application.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog
    }, join(workspace.root, 'missing', 'failed.md'))
    await full.getByTestId('conversation-export').click()
    await expect(fallback).toContainText('未能保存')
    const retryPath = join(workspace.root, '重试.md')
    await application.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog
    }, retryPath)
    await fallback.getByTestId('conversation-markdown-save').click()
    await expect(fallback).toHaveCount(0)
    expect(await readFile(retryPath, 'utf8')).toBe(copied)

    for (const [width, height, scale, theme] of [[1180, 800, 100, 'light'], [940, 600, 125, 'dark']] as const) {
      await resizeWorkspace(application, page, width, height)
      await page.getByTestId('settings-button').click()
      await page.getByTestId('settings-nav-appearance').click()
      await page.getByTestId('scale-' + scale).click()
      await page.getByTestId('theme-' + theme).click()
      await page.getByTestId('settings-close').click()
      await expect(page.getByTestId('app-shell')).toHaveAttribute('data-interface-scale', String(scale))
      await expect(full.getByTestId('conversation-copy')).toBeInViewport()
      await page.screenshot({ path: test.info().outputPath('conversation-' + width + '-' + theme + '.png'), animations: 'disabled' })
      await application.evaluate(({ clipboard }) => {
        const write = clipboard.writeText
        let first = true
        clipboard.writeText = async text => { if (first) { first = false; throw new Error('Synthetic clipboard failure') }; await write(text) }
      })
      await full.getByTestId('conversation-copy').click()
      await expect(fallback).toBeVisible()
      await expect(fallback.getByTestId('conversation-markdown-save')).toBeInViewport()
      await page.screenshot({ path: test.info().outputPath('fallback-' + width + '-' + theme + '.png'), animations: 'disabled' })
      await page.keyboard.press('Escape')
      await expect(fallback).toHaveCount(0)
      await enterReading(page)
      await expect(sidebar.getByTestId('conversation-copy')).toBeInViewport()
      await page.screenshot({ path: test.info().outputPath('sidebar-' + width + '-' + theme + '.png'), animations: 'disabled' })
      await page.getByTestId('workspace-tab-conversation').click()
    }
    await enterReading(page)
    hold = true
    await sidebar.getByTestId('followup-input').fill('继续生成的一问')
    await sidebar.getByTestId('followup-input').press('Enter')
    await expect(sidebar.getByTestId('answer-current')).toContainText('生成中的部分文字')
    await expect(sidebar.getByTestId('conversation-copy')).toBeDisabled()
    await expect(sidebar.getByTestId('conversation-export')).toBeDisabled()
    await expect(sidebar.getByTestId('answer-copy').first()).toBeEnabled()
    await sidebar.getByTestId('cancel-request').click()
    await expect(sidebar.getByTestId('conversation-copy')).toBeEnabled()
    await sidebar.getByTestId('answer-copy').last().click()
    const partial = await application.evaluate(({ clipboard }) => clipboard.readText())
    expect(partial).toContain('生成中的部分文字')
    expect(partial).toContain('未完成的回答')
  } finally {
    for (const response of held) if (!response.destroyed && !response.writableEnded) response.end()
    if (application && clipboardBackedUp) await application.evaluate(async ({ clipboard }) => {
      const state = globalThis as unknown as { g01ClipboardBackup?: Electron.ClipboardItem[] }
      if (state.g01ClipboardBackup?.length) await clipboard.write(state.g01ClipboardBackup)
      else clipboard.clear()
      delete state.g01ClipboardBackup
    })
    await cleanupE2eWorkspace(application, workspace.root)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
