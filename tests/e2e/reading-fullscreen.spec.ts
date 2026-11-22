import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { createSearchLinksEpubFixture } from './fixtures/search-links-epub'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader } from './support/electron-app'
import { jumpToPassage, resizeWorkspace, showContents } from './support/workspace'

const txt = resolve('tests/fixtures/complex-reading.txt')
const pdf = resolve('tests/e2e/fixtures/text-reader.pdf')
const fullscreenButton = 'reader-fullscreen'

async function pressNativeF11(application: ElectronApplication, assistant = false): Promise<void> {
  await application.evaluate(({ BrowserWindow }, useAssistant) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => Boolean(candidate.getParentWindow()) === useAssistant)
    if (!window) throw new Error('Expected a window for F11')
    window.focus()
    // CDP's keyboard emulation bypasses Electron's before-input-event.
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F11' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F11' })
  }, assistant)
}

async function waitForVisibleAssistant(application: ElectronApplication): Promise<void> {
  await expect.poll(() => application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().find((window) => window.getParentWindow())?.isVisible() ?? false
  )).toBe(true)
}

async function openFullscreen(application: ElectronApplication, page: Page): Promise<Page> {
  const opening = application.waitForEvent('window')
  await page.getByTestId(fullscreenButton).click()
  const popup = await opening
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-reading-fullscreen', 'true')
  await waitForVisibleAssistant(application)
  return popup
}

const citationTest = test.extend<{ citationEndpoint: { url: string; requests: () => number } }>({
  citationEndpoint: async ({}, use) => { // eslint-disable-line no-empty-pattern -- Playwright requires a destructured fixture argument.
    let requests = 0
    const server = createServer((request, response) => {
      requests++
      request.resume()
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '原文依据 [P1]' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
    })
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolveListen)
    })
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Mock provider did not expose a TCP port')
      await use({ url: `http://127.0.0.1:${address.port}/v1`, requests: () => requests })
    } finally {
      await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
    }
  }
})

async function activateCitationProvider(page: Page, baseUrl: string): Promise<void> {
  await expect(page.getByTestId('book-item')).toBeVisible()
  await page.evaluate(async (baseUrl) => {
    const overview = await window.readerApi.createProviderProfile({
      name: '全屏引用验证', baseUrl, model: 'fullscreen-citations', apiKey: 'test-only-key'
    })
    await window.readerApi.activateProviderProfile(overview.profiles[0].id)
  }, baseUrl)
  await page.reload()
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-workspace-ready', 'true')
}

for (const [width, height] of [[1180, 800], [940, 600]] as const) {
  for (const theme of ['light', 'dark'] as const) {
    for (const scale of [100, 125]) {
      test(`opens a native assistant in reading fullscreen at ${width}x${height} ${theme}/${scale}`, async () => {
        const workspace = await createE2eWorkspace('llm-reader-fullscreen-')
        let application: ElectronApplication | undefined
        try {
          const launched = await launchReader({ userData: workspace.userData, importPath: txt })
          application = launched.application
          const { page } = launched
          await resizeWorkspace(application, page, width, height)
          await page.getByTestId('settings-button').click()
          await page.getByTestId(`theme-${theme}`).click()
          await page.getByTestId(`scale-${scale}`).click()
          const language = theme === 'dark' ? 'en' : 'zh'
          await page.getByTestId(`ui-language-${language}`).click()
          await page.getByTestId('settings-close').click()
          await page.getByTestId('book-item').click()
          const host = page.getByTestId('reader-host')
          await expect(host.locator('.reader-document--txt')).toBeVisible()
          const normalBounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
          const normalDraft = page.locator('.right-sidebar').getByTestId('followup-input')
          await normalDraft.fill('草稿 draft')
          const hoverControl = page.getByTestId('reader-contents-button')
          await hoverControl.hover()
          await expect(hoverControl).toHaveCSS('translate', '0px -1px')
          await expect(hoverControl).toHaveCSS('transition-duration', /0\.12s/u)
          await hoverControl.evaluate((button: HTMLButtonElement) => { button.disabled = true })
          await expect(hoverControl).toHaveCSS('translate', 'none')
          await hoverControl.evaluate((button: HTMLButtonElement) => { button.disabled = false })
          await page.getByTestId('settings-button').hover()
          await expect(page.getByTestId('settings-button')).toHaveCSS('translate', 'none')
          await page.emulateMedia({ reducedMotion: 'reduce' })
          await hoverControl.hover()
          await expect(hoverControl).toHaveCSS('translate', 'none')
          await page.emulateMedia({ reducedMotion: 'no-preference' })
          await hoverControl.hover()
          await expect(hoverControl).toHaveCSS('translate', '0px -1px')
          await page.screenshot({ path: test.info().outputPath('reading-hover.png'), animations: 'disabled' })

          const popup = await openFullscreen(application, page)
          await expect(page.getByTestId('settings-button')).toBeHidden()
          await expect(page.getByTestId('window-close')).toBeHidden()
          await expect(page.getByTestId('workspace-reading-position')).toBeVisible()
          await expect(page.getByTestId('workspace-prepare')).toBeVisible()
          await expect(hoverControl).toBeVisible()
          await expect(page.getByTestId('ai-panel')).toHaveCount(0)
          await expect(host).toBeFocused()
          if (width === 940 && height === 600 && theme === 'dark' && scale === 125) {
            await page.keyboard.press('PageDown')
            await expect.poll(() => host.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
          }
          await expect(page.locator('.reader-column')).toHaveCSS('margin-right', '0px')
          await expect(popup.locator('html')).toHaveAttribute('data-theme', theme)
          await expect(popup.locator('html')).toHaveAttribute('data-interface-scale', String(scale))
          await expect(popup.locator('html')).toHaveAttribute('lang', language === 'en' ? 'en' : 'zh-CN')
          await expect(popup.getByTestId('followup-input')).toHaveValue('草稿 draft')
          await expect(popup.getByTestId('followup-input')).toHaveCSS('font-size', scale === 125 ? '17.5px' : '14px')
          await expect(popup.getByText(language === 'en' ? 'Reading assistant' : '阅读助手', { exact: true })).toBeVisible()
          expect(await popup.evaluate(() => typeof window.readerApi)).toBe('undefined')
          await expect.poll(() => application!.evaluate(({ BrowserWindow }) => {
            const child = BrowserWindow.getAllWindows().find((window) => window.getParentWindow())
            // Electron exposes this diagnostic on the runtime object.
            const preferences = (child?.webContents as unknown as { getLastWebPreferences(): Electron.WebPreferences } | undefined)?.getLastWebPreferences()
            return [child?.getParentWindow()?.isFullScreen(), child?.isModal(), child?.isAlwaysOnTop(), preferences?.sandbox, preferences?.contextIsolation, Boolean(preferences?.nodeIntegration)]
          })).toEqual([true, false, false, true, true, false])
          await page.screenshot({ path: test.info().outputPath('reading-fullscreen.png'), animations: 'disabled' })
          await popup.screenshot({ path: test.info().outputPath('assistant-window.png'), animations: 'disabled' })
          await popup.getByTestId('followup-input').fill('浮窗中的草稿')
          const closed = popup.waitForEvent('close')
          await page.getByTestId(fullscreenButton).click()
          await closed
          await expect(page.getByTestId('app-shell')).toHaveAttribute('data-reading-fullscreen', 'false')
          await expect(normalDraft).toHaveValue('浮窗中的草稿')
          await expect.poll(() => application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())).toEqual(normalBounds)
        } finally {
          await cleanupE2eWorkspace(application, workspace.root)
        }
      })
    }
  }
}

test('keeps a movable assistant within the application lifecycle and rejects unrelated windows', async () => {
  const workspace = await createE2eWorkspace('llm-reader-native-assistant-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: txt })
    application = launched.application
    const { page } = launched
    expect(await page.evaluate(() => window.open('about:blank', 'unrelated') === null)).toBe(true)
    await page.getByTestId('book-item').click()
    await expect(page.getByTestId('reader-host').locator('.reader-document--txt')).toBeVisible()
    await page.getByTestId('window-toggle-maximize').click()
    await expect.poll(() => application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true)
    const opening = application.waitForEvent('window')
    await pressNativeF11(application)
    let popup = await opening
    await waitForVisibleAssistant(application)
    const bounds = await application.evaluate(({ BrowserWindow, screen }) => {
      const child = BrowserWindow.getAllWindows().find((window) => window.getParentWindow())!
      const parentDisplay = screen.getDisplayMatching(child.getParentWindow()!.getBounds())
      const display = screen.getAllDisplays().find(({ id }) => id !== parentDisplay.id) ?? parentDisplay
      child.setBounds({ x: display.workArea.x + 24, y: display.workArea.y + 48, width: 420, height: Math.min(510, display.workArea.height - 48) })
      if (screen.getDisplayMatching(child.getBounds()).id !== display.id) throw new Error('The native child did not move to the chosen display')
      if (!child.getParentWindow()?.isFullScreen()) throw new Error('Moving the child exited reading fullscreen')
      return child.getBounds()
    })
    expect(await page.evaluate(() => window.open('about:blank', 'second-child') === null)).toBe(true)
    expect(await popup.evaluate(() => window.open('about:blank', 'nested-child') === null)).toBe(true)

    const closed = popup.waitForEvent('close')
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getParentWindow())!.close())
    await closed
    const reopening = application.waitForEvent('window')
    await page.getByTestId('reader-assistant-window').click()
    popup = await reopening
    await waitForVisibleAssistant(application)
    await expect.poll(() => application!.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find((window) => window.getParentWindow())!.getBounds()
    )).toEqual(bounds)
    await popup.getByTestId('session-persona-trigger').click()
    await expect(popup.getByTestId('session-persona-popover')).toBeVisible()
    await popup.keyboard.press('Escape')
    await expect(popup.getByTestId('session-persona-popover')).toBeHidden()
    await popup.getByTestId('recent-conversations').click()
    await expect(popup.locator('.recent-conversations-popover')).toBeVisible()
    await popup.locator('.assistant-title').click()
    await expect(popup.locator('.recent-conversations-popover')).toBeHidden()

    await popup.getByRole('button', { name: '设置模型服务' }).click()
    await expect(page.getByTestId('settings-modal')).toBeVisible()
    await expect.poll(() => application!.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find((window) => window.getParentWindow())?.isVisible()
    )).toBe(false)
    await page.getByTestId('settings-close').click()
    await waitForVisibleAssistant(application)
    await pressNativeF11(application, true)
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-reading-fullscreen', 'false')
    await expect.poll(() => application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true)
    await expect(page.getByTestId('ai-panel')).toBeVisible()

    await openFullscreen(application, page)
    await page.getByTestId('workspace-tab-notes').click()
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-page', 'notes')
    await expect.poll(() => application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(false)
    await page.getByTestId('workspace-tab-reading').click()
    await openFullscreen(application, page)
    await page.getByTestId('workspace-tab-conversation').click()
    await expect(page.getByTestId('assistant-dialog')).toBeVisible()
    await expect.poll(() => application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('shows a retry when the automatic assistant window cannot open', async () => {
  const workspace = await createE2eWorkspace('llm-reader-assistant-retry-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: txt })
    application = launched.application
    const { page } = launched
    await application.evaluate(({ ipcMain }) => {
      const channel = 'assistant-window:reserve'
      type ReserveHandler = (event: Electron.IpcMainInvokeEvent) => string | null
      const original = (ipcMain as unknown as { _invokeHandlers: Map<string, ReserveHandler> })._invokeHandlers.get(channel)
      if (!original) throw new Error('Missing assistant window reservation handler')
      ipcMain.removeHandler(channel)
      ipcMain.handleOnce(channel, () => {
        ipcMain.handle(channel, original)
        return null
      })
    })
    await page.getByTestId('book-item').click()
    await expect(page.getByTestId('reader-host').locator('.reader-document--txt')).toBeVisible()
    await page.getByTestId(fullscreenButton).click()
    await expect(page.locator('.toast')).toContainText('无法打开阅读助手浮窗')
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-reading-fullscreen', 'true')
    expect(application.windows()).toHaveLength(1)
    const opening = application.waitForEvent('window')
    await page.getByTestId('reader-assistant-window').click()
    await expect((await opening).getByTestId('followup-input')).toBeVisible()
    await waitForVisibleAssistant(application)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

for (const [width, height, theme, scale] of [[1180, 800, 'light', 100], [940, 600, 'dark', 125]] as const) {
  citationTest(`keeps the EPUB chapter through fullscreen and jumps to the citation at ${width}x${height} ${theme}/${scale}`, async ({ citationEndpoint }) => {
    const workspace = await createE2eWorkspace('llm-reader-epub-fullscreen-')
    const bookPath = join(workspace.root, 'fullscreen.epub')
    let application: ElectronApplication | undefined
    try {
      await createSearchLinksEpubFixture(bookPath, 120)
      const launched = await launchReader({ userData: workspace.userData, importPath: bookPath })
      application = launched.application
      const { page } = launched
      await activateCitationProvider(page, citationEndpoint.url)
      await resizeWorkspace(application, page, width, height)
      await page.getByTestId('settings-button').click()
      await page.getByTestId(`theme-${theme}`).click()
      await page.getByTestId(`scale-${scale}`).click()
      await page.getByTestId(`ui-language-${theme === 'dark' ? 'en' : 'zh'}`).click()
      await page.getByTestId('settings-close').click()
      await page.getByTestId('book-item').click()
      await page.frameLocator('.epub-view iframe').first().getByRole('link', { name: '前往第二章' }).click()
      const chapter = page.frameLocator('.epub-view iframe[srcdoc*="第二章包含小写"]')
      const paragraph = chapter.locator('#destination')
      await expect(paragraph).toBeInViewport()
      await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '第二章')
      await paragraph.evaluate((element: HTMLElement) => {
        element.tabIndex = -1
        element.focus({ preventScroll: true })
      })
      await expect(paragraph).toBeFocused()
      const opening = application.waitForEvent('window')
      await pressNativeF11(application)
      const popup = await opening
      await waitForVisibleAssistant(application)
      const scrollArea = page.locator('.epub-container')
      const chapterBody = chapter.locator('p').nth(2)
      await expect(scrollArea).toBeFocused()
      await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '第二章')
      await expect(paragraph).toBeInViewport()
      const readScrollTop = () => scrollArea.evaluate((element) => element.scrollTop)
      const chapterStart = await readScrollTop()
      await page.keyboard.press('ArrowDown')
      await expect.poll(readScrollTop).toBeGreaterThan(chapterStart)
      await expect(chapterBody).toBeInViewport()
      await chapterBody.evaluate((element) => {
        const owner = element.ownerDocument
        const text = element.firstChild!
        const range = owner.createRange()
        range.setStart(text, 0)
        range.setEnd(text, text.textContent!.length)
        owner.getSelection()?.removeAllRanges()
        owner.getSelection()?.addRange(range)
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      })
      await expect(page.getByTestId('selection-toolbar')).toBeVisible()
      await page.evaluate(() => window.readerApi.onLlmEvent((event) => {
        if (event.type === 'context') (window as Window & { fullscreenEvidence?: string }).fullscreenEvidence = event.context.passages[0]?.text
      }))
      await page.getByTestId('action-explain').click()
      await scrollArea.evaluate((element) => { element.scrollTop += element.clientHeight })
      await expect(chapterBody).not.toBeInViewport()
      const citation = popup.getByTestId('citation-valid')
      const preview = popup.getByTestId('source-preview')
      const previewText = preview.getByTestId('source-preview-text')
      await expect(citation).toBeVisible()
      const beforePreview = await readScrollTop()
      const requestsBeforePreview = citationEndpoint.requests()
      await citation.hover()
      await expect(preview).toBeVisible()
      await expect(preview).toBeInViewport({ ratio: 1 })
      const expected = await page.evaluate(() => (window as Window & { fullscreenEvidence?: string }).fullscreenEvidence)
      expect(expected).toBeTruthy()
      expect(await previewText.textContent()).toBe(expected)
      await expect(preview).toContainText('第二章')
      await expect(page.getByTestId('source-preview')).toHaveCount(0)
      await previewText.hover()
      await expect(preview).toBeVisible()
      expect(await readScrollTop()).toBe(beforePreview)
      await popup.keyboard.press('Escape')
      await expect(preview).toHaveCount(0)
      await expect(citation).toBeFocused()
      await citation.press('Enter')
      await expect(previewText).toBeFocused()
      expect(citationEndpoint.requests()).toBe(requestsBeforePreview)
      await popup.screenshot({ path: test.info().outputPath('passage-preview.png'), animations: 'disabled' })
      await preview.getByTestId('source-preview-jump').click()
      await expect(preview).toHaveCount(0)
      const highlight = page.locator('.llm-reader-temporary-highlight rect').first()
      await expect(highlight).toBeInViewport()
      await expect(chapterBody).toBeInViewport()
      await page.screenshot({ path: test.info().outputPath('epub-citation.png'), animations: 'disabled' })
      await page.getByTestId(fullscreenButton).click()
      await expect(page.getByTestId('app-shell')).toHaveAttribute('data-reading-fullscreen', 'false')
      await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '第二章')
      await expect(chapterBody).toBeInViewport()
    } finally {
      await cleanupE2eWorkspace(application, workspace.root)
    }
  })
}

citationTest('uses PDF fit width and region selection in fullscreen without returning to the first page', async ({ citationEndpoint }) => {
  const workspace = await createE2eWorkspace('llm-reader-pdf-fullscreen-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: pdf })
    application = launched.application
    const { page } = launched
    await activateCitationProvider(page, citationEndpoint.url)
    await page.getByTestId('book-item').click()
    await expect(page.getByTestId('pdf-reader')).toBeVisible()
    const sheet = page.locator('.pdf-page[data-page-number="3"]')
    await showContents(page)
    await page.getByTestId('toc-item').filter({ hasText: '第三章' }).click()
    await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '第三章')
    await page.getByTestId('reader-contents-button').click()
    const popup = await openFullscreen(application, page)
    const closed = popup.waitForEvent('close')
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getParentWindow())!.close())
    await closed
    await expect(sheet).toBeInViewport()
    await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '第三章')
    await expect(sheet).toHaveAttribute('aria-busy', 'false')
    const pdfToolbar = page.getByTestId('pdf-toolbar')
    const pdfTools = page.getByTestId('reader-settings-button')
    if (await pdfTools.getAttribute('aria-expanded') === 'false') await pdfTools.click()
    const fit = pdfToolbar.getByRole('button', { name: '适合宽度' })
    await expect(fit).toHaveAttribute('aria-pressed', 'true')
    await fit.hover()
    await expect(fit).toHaveCSS('translate', '0px -1px')
    const region = page.getByTestId('pdf-region-select')
    await region.click()
    await expect(region).toHaveAttribute('aria-pressed', 'true')
    const box = await sheet.boundingBox()
    expect(box).not.toBeNull()
    const visible = await page.getByTestId('reader-host').boundingBox()
    expect(visible).not.toBeNull()
    const x = box!.x + box!.width * 0.03
    const y = Math.max(box!.y + box!.height * 0.03, visible!.y + 70)
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(box!.x + box!.width * 0.64, Math.min(visible!.y + visible!.height - 24, y + box!.height * 0.32), { steps: 8 })
    await page.mouse.up()
    await expect(page.getByTestId('pdf-selection-review')).toBeVisible()
    await expect(page.getByTestId('pdf-selection-review-input')).toHaveValue(/第三章|内部链接/u)
    await page.getByTestId('pdf-selection-review-confirm').click()
    await expect(page.getByTestId('selection-toolbar')).toBeVisible()
    const reopening = application.waitForEvent('window')
    await page.getByTestId('action-explain').click()
    const assistant = await reopening
    await jumpToPassage(assistant.getByTestId('citation-valid'))
    await expect(sheet.locator('.pdf-region-overlay.is-temporary')).toBeVisible()
    await page.getByTestId(fullscreenButton).click()
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-reading-fullscreen', 'false')
    await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '第三章')
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
