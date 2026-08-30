import {
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'
import {
  cleanupE2eWorkspace,
  createE2eWorkspace,
  launchReader,
  restartReader
} from './support/electron-app'

let mockServer: Server
let endpoint = ''
let providerTestRequests = 0

async function selectNodeContents(locator: Locator): Promise<void> {
  await locator.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
}

async function topVisibleEpubParagraph(page: Page): Promise<string> {
  return page.getByTestId('reader-host').evaluate((host) => {
    const hostRect = host.getBoundingClientRect()
    let nearest: { id: string; distance: number } | null = null
    for (const frame of host.querySelectorAll('iframe')) {
      const document = frame.contentDocument
      if (!document) continue
      const frameTop = frame.getBoundingClientRect().top
      for (const paragraph of document.querySelectorAll<HTMLElement>('p[id]')) {
        const rect = paragraph.getBoundingClientRect()
        const top = frameTop + rect.top
        const bottom = frameTop + rect.bottom
        if (bottom <= hostRect.top + 12 || top >= hostRect.bottom) continue
        const distance = Math.abs(top - hostRect.top)
        if (!nearest || distance < nearest.distance) nearest = { id: paragraph.id, distance }
      }
    }
    return nearest?.id ?? ''
  })
}

function rgbChannels(value: string): [number, number, number] {
  const channels = value.match(/[\d.]+/gu)?.slice(0, 3).map(Number)
  if (!channels || channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) {
    throw new Error(`Expected an RGB color, received: ${value}`)
  }
  return channels as [number, number, number]
}

function relativeLuminance(value: string): number {
  const linear = rgbChannels(value).map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background))
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

async function createEpubFixture(path: string): Promise<void> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
  )
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:llm-reader-e2e</dc:identifier>
    <dc:title>复杂系统阅读样本</dc:title><dc:creator>LLM Reader</dc:creator><dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`
  )
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
  <nav epub:type="toc"><ol><li><a href="chapter.xhtml">第一章</a></li></ol></nav>
</body></html>`
  )
  zip.file(
    'OEBPS/chapter.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head><body>
  <h1>复杂系统与边界</h1><p>复杂系统的行为来自关系，而不只是组成部分的简单相加。</p>
  ${Array.from({ length: 48 }, (_, index) => `<p id="reading-marker-${index + 1}">连续阅读位置 ${index + 1}：调整正文宽度和段落间距后，阅读器仍应停留在当前原文附近。</p>`).join('\n  ')}
  <script>document.body.insertAdjacentHTML('beforeend', '<p id="script-executed">SCRIPT_EXECUTED</p>')</script>
</body></html>`
  )
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await writeFile(path, bytes)
}

test.beforeAll(async () => {
  mockServer = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        data: [{ id: 'z-reader' }, { id: 'configured-alias' }, { id: 'configured-alias' }]
      }))
      return
    }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }

    let rawBody = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      rawBody += chunk
    })
    request.on('end', () => {
      const body = JSON.parse(rawBody) as { stream?: boolean; model?: string }
      if (!body.stream) {
        providerTestRequests += 1
        const finishTest = (): void => {
          if (body.model === 'failing-reader' || body.model === 'slow-fail') {
            response.writeHead(500, { 'content-type': 'application/json' })
            response.end(JSON.stringify({ error: { message: 'test failure' } }))
            return
          }
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(
            JSON.stringify({
              id: 'mock-test',
              model: 'mock-reader',
              choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }]
            })
          )
        }
        setTimeout(finishTest, body.model === 'slow-fail' || body.model === 'slow-ok' ? 500 : 120)
        return
      }

      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      response.write(
        `data: ${JSON.stringify({ id: 'mock-stream', model: 'mock-reader', choices: [{ index: 0, delta: { content: '这段文字提醒我们：' } }] })}\n\n`
      )
      setTimeout(() => {
        response.write(
          `data: ${JSON.stringify({ id: 'mock-stream', model: 'mock-reader', choices: [{ index: 0, delta: { content: '模型必须与适用边界一起理解 [P1]，未知依据 [P999]。' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 12, total_tokens: 32 } })}\n\n`
        )
        response.end('data: [DONE]\n\n')
      }, 650)
    })
  })

  await new Promise<void>((resolveListen, reject) => {
    mockServer.once('error', reject)
    mockServer.listen(0, '127.0.0.1', () => resolveListen())
  })
  const address = mockServer.address()
  if (!address || typeof address === 'string') throw new Error('Mock provider did not expose a TCP port')
  endpoint = `http://127.0.0.1:${address.port}/v1`
})

test.afterAll(async () => {
  await new Promise<void>((resolveClose, reject) => {
    mockServer.close((error) => (error ? reject(error) : resolveClose()))
  })
})

test('keeps escaped keyboard focus inside settings and assistant dialogs', async () => {
  const workspace = await createE2eWorkspace('llm-reader-focus-e2e-')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData })
    application = launched.application
    const { page } = launched
    const settingsButton = page.getByTestId('settings-button')
    const expandButton = page.getByTestId('assistant-expand-button')

    await settingsButton.click()
    const settingsDialog = page.getByTestId('settings-modal')
    const settingsClose = page.getByTestId('settings-close')
    await expect(settingsDialog).toBeVisible()
    await expect(settingsClose).toBeFocused()

    await settingsButton.evaluate((button) => button.focus())
    await expect(settingsButton).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(settingsClose).toBeFocused()

    await settingsButton.evaluate((button) => button.focus())
    await expect(settingsButton).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect
      .poll(() => settingsDialog.evaluate((dialog) => dialog.contains(document.activeElement)))
      .toBe(true)
    await expect
      .poll(() => settingsDialog.evaluate((dialog) => {
        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter((element) => !element.closest('[hidden]') && element.getClientRects().length > 0)
        return document.activeElement === focusable[focusable.length - 1]
      }))
      .toBe(true)

    await page.keyboard.press('Escape')
    await expect(settingsDialog).toHaveCount(0)
    await expect(settingsButton).toBeFocused()

    await expandButton.click()
    const assistantDialog = page.getByTestId('assistant-dialog')
    const assistantClose = page.getByTestId('assistant-dialog-close')
    await expect(assistantDialog).toBeVisible()
    await expect(assistantClose).toBeFocused()

    await expandButton.evaluate((button) => button.focus())
    await expect(expandButton).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(assistantClose).toBeFocused()

    await expandButton.evaluate((button) => button.focus())
    await expect(expandButton).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect
      .poll(() => assistantDialog.evaluate((dialog) => dialog.contains(document.activeElement)))
      .toBe(true)
    await expect
      .poll(() => assistantDialog.evaluate((dialog) => {
        const focusable = dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        return document.activeElement === focusable.item(focusable.length - 1)
      }))
      .toBe(true)

    await page.keyboard.press('Escape')
    await expect(assistantDialog).toHaveCount(0)
    await expect(expandButton).toBeFocused()
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('keeps the home quiet and applies unified appearance, reading and provider settings', async () => {
  const workspace = await createE2eWorkspace('llm-reader-e2e-')
  const fixture = resolve('tests/fixtures/complex-reading.txt')
  const visualDirectory = process.env.LLM_READER_VISUAL_DIR
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const { page } = launched
    await application.evaluate(({ BrowserWindow, dialog }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setContentSize(1536, 864)
      const runtime = globalThis as typeof globalThis & { __llmReaderDialogCalls?: number }
      runtime.__llmReaderDialogCalls = 0
      dialog.showOpenDialog = (async () => {
        runtime.__llmReaderDialogCalls = (runtime.__llmReaderDialogCalls ?? 0) + 1
        return { canceled: true, filePaths: [], bookmarks: [] }
      }) as typeof dialog.showOpenDialog
    })
    if (visualDirectory) {
      const displays = await application.evaluate(({ screen }) => screen.getAllDisplays().map((display) => ({
        bounds: display.bounds,
        scaleFactor: display.scaleFactor,
        workArea: display.workArea
      })))
      await writeFile(join(visualDirectory, 'display-topology.json'), JSON.stringify(displays, null, 2), 'utf8')
    }

    const appShell = page.getByTestId('app-shell')
    const html = page.locator('html')
    const providerStatus = page.getByTestId('provider-connection-status')
    await expect(appShell).toBeVisible()
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('.brand-row')).toHaveText('LLM Reader')
    await expect(page.getByText('专注理解，不离开原文')).toHaveCount(0)
    await expect(page.getByText('欢迎使用 LLM Reader')).toHaveCount(0)
    await expect(page.getByText('本地优先')).toHaveCount(0)
    await expect(page.getByTestId('theme-switcher')).toHaveCount(0)
    await expect(page.getByTestId('import-book')).toBeVisible()
    await expect(providerStatus).toHaveAttribute('aria-label', 'API 未配置')
    await expect(providerStatus).not.toHaveClass(/is-connected/u)
    const initialStatusColor = await providerStatus.evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(initialStatusColor).toBe('rgb(174, 74, 65)')
    await page.keyboard.press('Control+,')
    await expect(page.getByTestId('settings-modal')).toHaveCount(0)
    await page.keyboard.press('Control+O')
    await page.waitForTimeout(100)
    await expect.poll(() => application?.evaluate(() => (globalThis as typeof globalThis & { __llmReaderDialogCalls?: number }).__llmReaderDialogCalls ?? 0)).toBe(0)
    await expect(page.locator('kbd')).toHaveCount(0)
    await expect(page.getByText('Enter 发送 · Shift + Enter 换行')).toHaveCount(0)
    const importLayout = await page.getByTestId('import-book').evaluate((button) => {
      const label = button.querySelector('span')
      const styles = getComputedStyle(button)
      return {
        fits: button.scrollWidth <= button.clientWidth,
        labelLines: label?.getClientRects().length ?? 0,
        whiteSpace: label ? getComputedStyle(label).whiteSpace : '',
        background: styles.backgroundColor,
        boxShadow: styles.boxShadow,
        transform: styles.transform
      }
    })
    expect(importLayout).toEqual({
      fits: true,
      labelLines: 1,
      whiteSpace: 'nowrap',
      background: 'rgba(0, 0, 0, 0)',
      boxShadow: 'none',
      transform: 'none'
    })
    if (visualDirectory) {
      await page.screenshot({ path: join(visualDirectory, 'library-light-1536x864.png') })
    }
    await expect.poll(() => page.locator('.assistant-title').evaluate((element) => getComputedStyle(element).fontSize)).toBe('13px')
    await expect.poll(() => page.locator('.right-sidebar .empty-state strong').evaluate((element) => getComputedStyle(element).fontSize)).toBe('13px')
    await expect.poll(() => page.locator('.right-sidebar .empty-state p').evaluate((element) => getComputedStyle(element).fontSize)).toBe('12px')
    await expect(page.locator('.welcome-state')).toHaveText('从书库打开或导入一本书')
    await expect(page.locator('.welcome-state')).not.toBeVisible()

    await page.emulateMedia({ colorScheme: 'light' })
    await expect(appShell).toHaveAttribute('data-theme-preference', 'system')
    await expect(appShell).toHaveAttribute('data-theme', 'light')
    await expect(html).toHaveAttribute('data-theme', 'light')

    const firstBook = page.getByTestId('book-item').first()
    await expect(firstBook).toBeVisible()
    await firstBook.click()
    await expect(page.getByTestId('reader-host')).toContainText('复杂概念')
    await expect(page.getByTestId('import-book')).toHaveCount(0)

    const settingsButton = page.getByTestId('settings-button')
    const readerSettingsButton = page.getByTestId('reader-settings-button')
    await expect(readerSettingsButton).toHaveAttribute('aria-label', '阅读设置')
    await readerSettingsButton.click()
    await expect(page.getByTestId('settings-nav-reading')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('reading-content-width')).toHaveValue('original')
    await expect(page.getByTestId('reading-paragraph-spacing')).toHaveValue('original')
    await page.getByTestId('settings-close').click()
    await expect(readerSettingsButton).toBeFocused()

    await settingsButton.click()
    const settings = page.getByTestId('settings-modal')
    const themeSwitcher = page.getByTestId('theme-switcher')
    const lightTheme = page.getByTestId('theme-light')
    const systemTheme = page.getByTestId('theme-system')
    const darkTheme = page.getByTestId('theme-dark')
    await expect(settings).toBeVisible()
    await expect(themeSwitcher).toHaveAttribute('role', 'group')
    await expect(themeSwitcher).toHaveAttribute('aria-label', '界面主题')
    await expect(systemTheme).toHaveAttribute('aria-pressed', 'true')
    await expect(lightTheme).toHaveAttribute('aria-pressed', 'false')
    await expect(darkTheme).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('settings-nav-appearance')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('interface-scale')).toHaveAttribute('aria-label', '界面缩放')
    await expect(page.getByTestId('scale-100')).toHaveAttribute('aria-pressed', 'true')
    await expect
      .poll(() => html.evaluate((element) => getComputedStyle(element).getPropertyValue('--ui-accent').trim()))
      .toBe('#586f7e')
    await expect
      .poll(() => html.evaluate((element) => getComputedStyle(element).getPropertyValue('--ui-line').trim()))
      .toBe('#d5dce0')
    await darkTheme.click()
    await expect(darkTheme).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('scale-125').click()
    await page.getByTestId('settings-nav-reading').click()
    await expect(page.getByTestId('reading-font-scale')).toHaveValue('100')
    await expect(page.getByTestId('reading-line-height')).toHaveValue('original')
    await expect(page.getByTestId('reading-indent')).toHaveValue('original')
    await expect(page.getByTestId('reading-content-width')).toHaveValue('original')
    await expect(page.getByTestId('reading-paragraph-spacing')).toHaveValue('original')
    await page.getByTestId('reading-font-scale').fill('125')
    await page.getByTestId('reading-line-height').selectOption('1.7')
    await page.getByTestId('reading-indent').selectOption('2em')
    await page.getByTestId('reading-content-width').selectOption('narrow')
    await page.getByTestId('reading-paragraph-spacing').selectOption('compact')
    await expect(appShell).toHaveAttribute('data-theme-preference', 'dark')
    await expect(appShell).toHaveAttribute('data-theme', 'dark')
    await expect(appShell).toHaveAttribute('data-interface-scale', '125')
    await expect(html).toHaveAttribute('data-theme-preference', 'dark')
    await expect(html).toHaveAttribute('data-theme', 'dark')
    await expect(html).toHaveAttribute('data-interface-scale', '125')
    await expect
      .poll(() => html.evaluate((element) => getComputedStyle(element).getPropertyValue('--ui-accent').trim()))
      .toBe('#91a7b3')
    await expect
      .poll(() => html.evaluate((element) => getComputedStyle(element).getPropertyValue('--ui-accent-soft').trim()))
      .toBe('#29343a')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(appShell).toHaveAttribute('data-theme', 'dark')
    await expect(html).toHaveAttribute('data-theme', 'dark')
    if (visualDirectory) {
      await page.screenshot({ path: join(visualDirectory, 'reading-settings-dark-1536x864.png') })
    }

    await page.getByTestId('settings-nav-model').click()
    await page.getByTestId('provider-profile-name').fill('阅读设置测试')
    await page.getByTestId('provider-base-url').fill(endpoint)
    await page.getByTestId('provider-model').fill('configured-alias')
    await page.getByTestId('provider-api-key').fill('test-only-key')
    await page.getByTestId('provider-test').click()
    await expect(page.getByTestId('provider-status')).toContainText('连接成功。')
    await expect(providerStatus).toHaveAttribute('aria-label', 'API 未配置')
    await page.getByTestId('provider-save').click()
    await page.getByTestId('provider-activate').click()
    await page.getByTestId('settings-close').click()
    await expect(settings).toHaveCount(0)
    await expect(settingsButton).toBeFocused()
    await expect(providerStatus).toHaveAttribute('aria-label', '正在检测 API 连接')
    await expect(providerStatus).toHaveAttribute('aria-label', 'API 连接正常')
    await expect(providerStatus).toHaveClass(/is-connected/u)
    await expect.poll(() => providerStatus.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(157, 204, 173)')
    await expect
      .poll(() => page.evaluate(() => Object.values(localStorage).join('\n')))
      .not.toContain('test-only-key')

    const txtDocument = page.locator('.reader-document--txt')
    const txtParagraph = txtDocument.locator('p').first()
    await expect.poll(() => txtDocument.evaluate((element) => element.style.fontSize)).toBe('125%')
    await expect.poll(() => txtDocument.evaluate((element) => element.style.maxWidth)).toBe('640px')
    await expect.poll(() => txtParagraph.evaluate((element) => element.style.lineHeight)).toBe('1.7')
    await expect.poll(() => txtParagraph.evaluate((element) => element.style.textIndent)).toBe('2em')
    await expect.poll(() => txtParagraph.evaluate((element) => element.style.marginBottom)).toBe('0.8em')
    const txtColors = await txtDocument.evaluate((element) => {
      const styles = getComputedStyle(element)
      return { color: styles.color, background: styles.backgroundColor }
    })
    expect(contrastRatio(txtColors.color, txtColors.background)).toBeGreaterThanOrEqual(4.5)
    const txtSelectionCss = await txtDocument.evaluate(
      (element) => element.querySelector('style')?.textContent ?? ''
    )
    expect(txtSelectionCss).toContain('.reader-document ::selection')
    expect(txtSelectionCss).toContain('rgba(240, 220, 160, 0.55)')
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('shows an import welcome for an empty library and keeps quiet once books exist', async () => {
  const workspace = await createE2eWorkspace('llm-reader-welcome-e2e-')
  const fixture = resolve('tests/fixtures/complex-reading.txt')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData })
    application = launched.application
    const { page } = launched
    await expect(page.getByTestId('library-list')).toBeVisible()

    const welcome = page.getByTestId('welcome-state')
    await expect(welcome).toBeVisible()
    await expect(welcome.locator('h2')).toHaveText('从一本书开始')
    await expect(welcome).toContainText('导入 EPUB、TXT 或 PDF')
    await expect(page.getByTestId('welcome-import')).toBeVisible()

    await application.evaluate(({ dialog }) => {
      const runtime = globalThis as typeof globalThis & { __llmReaderWelcomeDialogCalls?: number }
      runtime.__llmReaderWelcomeDialogCalls = 0
      dialog.showOpenDialog = (async () => {
        runtime.__llmReaderWelcomeDialogCalls = (runtime.__llmReaderWelcomeDialogCalls ?? 0) + 1
        return { canceled: true, filePaths: [], bookmarks: [] }
      }) as typeof dialog.showOpenDialog
    })
    await page.getByTestId('welcome-import').click()
    await expect
      .poll(() => application?.evaluate(
        () => (globalThis as typeof globalThis & { __llmReaderWelcomeDialogCalls?: number })
          .__llmReaderWelcomeDialogCalls ?? 0
      ))
      .toBe(1)
    await expect(welcome).toBeVisible()

    const restarted = await restartReader(application, {
      userData: workspace.userData,
      importPath: fixture
    })
    application = restarted.application
    const { page: restoredPage } = restarted
    await expect(restoredPage.getByTestId('book-item').first()).toBeVisible()
    await expect(restoredPage.getByTestId('welcome-state')).toHaveCount(0)
    await expect(restoredPage.getByTestId('welcome-import')).toHaveCount(0)
    await expect(restoredPage.locator('.welcome-state')).toHaveText('从书库打开或导入一本书')
    await expect(restoredPage.locator('.welcome-state')).not.toBeVisible()
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('persists reading, conversation and insight deletion after restart', async () => {
  const workspace = await createE2eWorkspace('llm-reader-persistence-e2e-')
  const fixture = resolve('tests/fixtures/complex-reading.txt')
  const visualDirectory = process.env.LLM_READER_VISUAL_DIR
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const { page } = launched
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(1536, 864)
    })
    await expect(page.getByTestId('book-item').first()).toBeVisible()
    await page.getByTestId('book-item').first().click()
    await expect(page.getByTestId('reader-host')).toContainText('复杂概念')

    const settingsButton = page.getByTestId('settings-button')
    await settingsButton.click()
    const settings = page.getByTestId('settings-modal')
    const lightTheme = page.getByTestId('theme-light')
    const darkTheme = page.getByTestId('theme-dark')
    await darkTheme.click()
    await page.getByTestId('scale-125').click()
    await page.getByTestId('settings-nav-reading').click()
    await page.getByTestId('reading-font-scale').fill('125')
    await page.getByTestId('reading-line-height').selectOption('1.7')
    await page.getByTestId('reading-indent').selectOption('2em')
    await page.getByTestId('reading-content-width').selectOption('narrow')
    await page.getByTestId('reading-paragraph-spacing').selectOption('compact')
    await page.getByTestId('settings-nav-model').click()
    await page.getByTestId('provider-profile-name').fill('重启恢复测试')
    await page.getByTestId('provider-base-url').fill(endpoint)
    await page.getByTestId('provider-model').fill('configured-alias')
    await page.getByTestId('provider-api-key').fill('test-only-key')
    await page.getByTestId('provider-test').click()
    await expect(page.getByTestId('provider-status')).toContainText('连接成功。')
    await page.getByTestId('provider-save').click()
    await page.getByTestId('provider-activate').click()
    await page.getByTestId('settings-close').click()
    await expect(settings).toHaveCount(0)

    const txtDocument = page.locator('.reader-document--txt')
    const txtParagraph = txtDocument.locator('p').first()
    await expect.poll(() => txtDocument.evaluate((element) => element.style.fontSize)).toBe('125%')
    await expect.poll(() => txtDocument.evaluate((element) => element.style.maxWidth)).toBe('640px')
    await expect.poll(() => txtParagraph.evaluate((element) => element.style.lineHeight)).toBe('1.7')
    await expect.poll(() => txtParagraph.evaluate((element) => element.style.textIndent)).toBe('2em')
    await expect.poll(() => txtParagraph.evaluate((element) => element.style.marginBottom)).toBe('0.8em')

    const paragraph = page.getByTestId('reader-host').locator('p').nth(1)
    await selectNodeContents(paragraph)

    await expect(page.getByTestId('selection-toolbar')).toBeVisible()
    await page.getByTestId('action-explain').click()
    await expect(page.getByTestId('answer-current').locator('.answer-model')).toHaveText('configured-alias')
    await expect(page.getByTestId('answer-current')).toContainText('这段文字提醒我们')
    await expect(page.getByTestId('answer-current')).toContainText('适用边界')
    const answerText = page.getByTestId('answer-current').locator('.answer-text')
    const validCitation = answerText.getByTestId('citation-valid')
    const unverifiedCitation = answerText.getByTestId('citation-unverified')
    await expect(validCitation).toContainText('原文：')
    await expect(unverifiedCitation).toHaveText('未验证引用')
    await expect(answerText).not.toContainText('P1')
    await expect(answerText).not.toContainText('P999')
    await expect(unverifiedCitation).not.toHaveAttribute('role', 'button')
    await expect
      .poll(() => validCitation.evaluate((element) => element.scrollWidth <= element.clientWidth))
      .toBe(true)
    await validCitation.click()
    await expect
      .poll(() => page.evaluate(() => {
        const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
        return highlights?.has('llm-reader-temporary') ?? false
      }))
      .toBe(true)
    await expect(page.getByTestId('answer-current').locator('.answer-model')).toHaveText('mock-reader')
    await expect(page.getByTestId('answer-current').locator('.answer-footer')).toContainText('32 tokens')
    await expect(page.getByTestId('answer-current').locator('.answer-footer')).not.toContainText('mock-reader')
    const assistantFontSizes = await page.evaluate(() => ({
      title: getComputedStyle(document.querySelector('.assistant-title')!).fontSize,
      question: getComputedStyle(document.querySelector('.question-bubble p')!).fontSize,
      answer: getComputedStyle(document.querySelector('.answer-text')!).fontSize,
      input: getComputedStyle(document.querySelector('.assistant-composer textarea')!).fontSize,
      model: getComputedStyle(document.querySelector('.answer-model')!).fontSize,
      tokens: getComputedStyle(document.querySelector('.answer-footer > span')!).fontSize,
      source: getComputedStyle(document.querySelector('.source-card-header small')!).fontSize
    }))
    expect(assistantFontSizes).toEqual({
      title: '16.25px',
      question: '15px',
      answer: '15px',
      input: '15px',
      model: '12.5px',
      tokens: '12.5px',
      source: '12.5px'
    })
    if (visualDirectory) {
      await page.screenshot({ path: join(visualDirectory, 'assistant-dark-1536x864.png') })
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 960))
      await page.screenshot({ path: join(visualDirectory, 'assistant-dark-1440x960.png') })
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1536, 864))
    }
    const expandButton = page.getByTestId('assistant-expand-button')
    await expandButton.click()
    const assistantDialog = page.getByTestId('assistant-dialog')
    await expect(assistantDialog).toBeVisible()
    await expect(assistantDialog.getByText('CURRENT READING')).toHaveCount(0)
    await expect.poll(() => assistantDialog.locator('.modal-header h2').evaluate((element) => getComputedStyle(element).fontSize)).toBe('16.25px')
    await expect(assistantDialog.getByTestId('answer-current')).toContainText('适用边界')
    if (visualDirectory) {
      await page.waitForTimeout(200)
      await page.screenshot({ path: join(visualDirectory, 'assistant-dialog-dark-1536x864.png') })
    }
    const dialogInput = assistantDialog.getByTestId('followup-input')
    await dialogInput.fill('第一行')
    await dialogInput.press('Shift+Enter')
    await expect(dialogInput).toHaveValue('第一行\n')
    await dialogInput.type('再解释一下这里的前提')
    await dialogInput.press('Enter')
    await expect(dialogInput).toHaveValue('')
    await expect(assistantDialog.getByTestId('answer-current')).toContainText('这段文字提醒我们')
    await page.getByTestId('assistant-dialog-close').click()
    await expect(assistantDialog).toHaveCount(0)
    await expect(expandButton).toBeFocused()
    await expect(page.getByTestId('answer-current')).toContainText('适用边界')
    if (visualDirectory) {
      await settingsButton.click()
      await lightTheme.click()
      await page.getByTestId('settings-nav-reading').click()
      await page.screenshot({ path: join(visualDirectory, 'reading-settings-light-1536x864.png') })
      await page.getByTestId('settings-close').click()
      await page.screenshot({ path: join(visualDirectory, 'assistant-light-1536x864.png') })
      await settingsButton.click()
      await darkTheme.click()
      await page.getByTestId('settings-close').click()
    }
    await page.getByTestId('answer-save').click()
    await page.getByTestId('assistant-expand-button').click()
    const insightsTab = page.getByTestId('assistant-dialog-tab-insights')
    await expect(insightsTab).toContainText('归档')
    await expect.poll(() => insightsTab.locator('span').evaluate((element) => getComputedStyle(element).fontSize)).toBe('11.25px')
    await insightsTab.click()
    const insight = page.getByTestId('insight-item')
    await expect(insight).toContainText('适用边界')
    await expect(insight).toContainText('原文：')
    await expect(insight).toContainText('未验证引用')
    await expect(insight).not.toContainText('P1')
    await expect(insight).not.toContainText('P999')
    await expect.poll(() => insight.locator('strong').evaluate((element) => getComputedStyle(element).fontSize)).toBe('15px')
    await expect(page.locator('.insights-heading')).toHaveCount(0)
    await page.getByTestId('insight-delete').click()
    await expect(page.getByTestId('insight-delete-confirm')).toBeVisible()
    await page.getByTestId('insight-delete-cancel').click()
    await expect(insight).toHaveCount(1)
    await page.getByTestId('insight-delete').click()
    await page.getByTestId('insight-delete-confirm').click()
    await expect(insight).toHaveCount(0)

    const readerHost = page.getByTestId('reader-host')
    await readerHost.evaluate((element) => {
      element.scrollTop = element.scrollHeight
      element.dispatchEvent(new Event('scroll'))
    })
    await expect.poll(() => readerHost.evaluate((element) => element.scrollTop)).toBeGreaterThan(50)

    const providerTestsBeforeRestart = providerTestRequests
    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application
    const restoredPage = restarted.page
    const restoredShell = restoredPage.getByTestId('app-shell')
    const restoredHtml = restoredPage.locator('html')
    const restoredProviderStatus = restoredPage.getByTestId('provider-connection-status')
    await expect.poll(() => providerTestRequests).toBe(providerTestsBeforeRestart + 1)
    await expect(restoredProviderStatus).toHaveAttribute('aria-label', 'API 连接正常')
    await expect(restoredShell).toHaveAttribute('data-theme-preference', 'dark')
    await expect(restoredShell).toHaveAttribute('data-theme', 'dark')
    await expect(restoredShell).toHaveAttribute('data-interface-scale', '125')
    await expect(restoredHtml).toHaveAttribute('data-theme-preference', 'dark')
    await expect(restoredHtml).toHaveAttribute('data-theme', 'dark')

    await expect(restoredPage.getByTestId('book-item').first()).toBeVisible()
    await restoredPage.getByTestId('book-item').first().click()
    await expect
      .poll(() => restoredPage.getByTestId('reader-host').evaluate((element) => element.scrollTop))
      .toBeGreaterThan(50)
    await restoredPage.getByTestId('assistant-expand-button').click()
    await restoredPage.getByTestId('assistant-dialog-tab-insights').click()
    await expect(restoredPage.getByTestId('insight-item')).toHaveCount(0)
    await restoredPage.getByTestId('assistant-dialog-close').click()
    await expect(restoredPage.getByTestId('assistant-dialog')).toHaveCount(0)

    const restoredDocument = restoredPage.locator('.reader-document--txt')
    await expect.poll(() => restoredDocument.evaluate((element) => element.style.fontSize)).toBe('125%')
    await expect.poll(() => restoredDocument.evaluate((element) => element.style.maxWidth)).toBe('640px')
    await expect.poll(() => restoredDocument.locator('p').first().evaluate((element) => element.style.lineHeight)).toBe('1.7')
    await expect.poll(() => restoredDocument.locator('p').first().evaluate((element) => element.style.textIndent)).toBe('2em')
    await expect.poll(() => restoredDocument.locator('p').first().evaluate((element) => element.style.marginBottom)).toBe('0.8em')

    const restoredSettingsButton = restoredPage.getByTestId('settings-button')
    await restoredSettingsButton.click()
    const restoredSystemTheme = restoredPage.getByTestId('theme-system')
    const restoredDarkTheme = restoredPage.getByTestId('theme-dark')
    await expect(restoredDarkTheme).toHaveAttribute('aria-pressed', 'true')
    await expect(restoredPage.getByTestId('scale-125')).toHaveAttribute('aria-pressed', 'true')
    await restoredSystemTheme.click()
    await expect(restoredSystemTheme).toHaveAttribute('aria-pressed', 'true')
    await expect(restoredDarkTheme).toHaveAttribute('aria-pressed', 'false')
    await expect(restoredShell).toHaveAttribute('data-theme-preference', 'system')
    await expect(restoredHtml).toHaveAttribute('data-theme-preference', 'system')

    await restoredPage.emulateMedia({ colorScheme: 'light' })
    await expect(restoredShell).toHaveAttribute('data-theme', 'light')
    await expect(restoredHtml).toHaveAttribute('data-theme', 'light')

    await restoredPage.emulateMedia({ colorScheme: 'dark' })
    await expect(restoredShell).toHaveAttribute('data-theme', 'dark')
    await expect(restoredHtml).toHaveAttribute('data-theme', 'dark')

    await restoredPage.getByTestId('settings-nav-reading').click()
    await expect(restoredPage.getByTestId('reading-font-scale')).toHaveValue('125')
    await expect(restoredPage.getByTestId('reading-line-height')).toHaveValue('1.7')
    await expect(restoredPage.getByTestId('reading-indent')).toHaveValue('2em')
    await expect(restoredPage.getByTestId('reading-content-width')).toHaveValue('narrow')
    await expect(restoredPage.getByTestId('reading-paragraph-spacing')).toHaveValue('compact')
    await restoredPage.getByTestId('reading-reset').click()
    await expect(restoredPage.getByTestId('reading-font-scale')).toHaveValue('100')
    await expect(restoredPage.getByTestId('reading-line-height')).toHaveValue('original')
    await expect(restoredPage.getByTestId('reading-indent')).toHaveValue('original')
    await expect(restoredPage.getByTestId('reading-content-width')).toHaveValue('original')
    await expect(restoredPage.getByTestId('reading-paragraph-spacing')).toHaveValue('original')
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('keeps provider status consistent across overlapping checks and saves', async () => {
  const workspace = await createE2eWorkspace('llm-reader-provider-status-e2e-')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData })
    application = launched.application
    const restoredPage = launched.page
    const restoredSettingsButton = restoredPage.getByTestId('settings-button')
    const restoredProviderStatus = restoredPage.getByTestId('provider-connection-status')

    await restoredSettingsButton.click()
    await restoredPage.getByTestId('settings-nav-model').click()
    await restoredPage.getByTestId('provider-profile-name').fill('状态测试')
    await restoredPage.getByTestId('provider-base-url').fill(endpoint)
    await restoredPage.getByTestId('provider-model').fill('configured-alias')
    await restoredPage.getByTestId('provider-api-key').fill('test-only-key')
    await restoredPage.getByTestId('provider-save').click()
    await restoredPage.getByTestId('provider-activate').click()
    await expect(restoredProviderStatus).toHaveAttribute('aria-label', 'API 连接正常')

    await restoredPage.getByTestId('provider-model').fill('slow-ok')
    await restoredPage.getByTestId('provider-test').click()
    await expect(restoredProviderStatus).toHaveAttribute('aria-label', 'API 连接正常')
    await expect(restoredPage.getByTestId('provider-status')).toContainText('连接成功。')

    await restoredPage.getByTestId('provider-model').fill('failing-reader')
    await restoredPage.getByTestId('provider-save').click()
    await expect(restoredProviderStatus).toHaveAttribute('aria-label', 'API 未连接')
    await restoredPage.waitForTimeout(600)
    await expect(restoredPage.getByText('模型连接正常')).toHaveCount(0)
    await expect(restoredProviderStatus).toHaveAttribute('aria-label', 'API 未连接')

    await restoredPage.getByTestId('provider-model').fill('slow-fail')
    await restoredPage.getByTestId('provider-save').click()
    await restoredPage.getByTestId('provider-model').fill('configured-alias')
    await restoredPage.getByTestId('provider-save').click()
    await expect(restoredProviderStatus).toHaveAttribute('aria-label', 'API 连接正常')
    await restoredPage.waitForTimeout(600)
    await expect(restoredProviderStatus).toHaveAttribute('aria-label', 'API 连接正常')

    await restoredPage.getByTestId('provider-model').fill('failing-reader')
    await restoredPage.getByTestId('provider-save').click()
    await expect(restoredProviderStatus).toHaveAttribute('aria-label', 'API 未连接')
    await expect(restoredProviderStatus).not.toHaveClass(/is-connected/u)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('manages multiple provider profiles and discovers models without persisting the candidate list', async () => {
  const workspace = await createE2eWorkspace('llm-reader-provider-profiles-e2e-')
  let application: ElectronApplication | undefined

  try {
    let launched = await launchReader({ userData: workspace.userData })
    application = launched.application
    let page = launched.page
    const providerStatus = page.getByTestId('provider-connection-status')

    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-model').click()
    await page.getByTestId('provider-profile-name').fill('日常配置')
    await page.getByTestId('provider-base-url').fill(endpoint)
    await page.getByTestId('provider-api-key').fill('daily-key')
    await page.getByTestId('provider-models-fetch').click()
    await expect(page.getByTestId('provider-models-status')).toContainText('已获取 2 个模型')
    await expect(page.locator('#provider-model-options option')).toHaveCount(2)
    const visualDirectory = process.env.LLM_READER_VISUAL_DIR
    if (visualDirectory) {
      await mkdir(visualDirectory, { recursive: true })
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1536, 864))
      await page.screenshot({ path: join(visualDirectory, 'provider-profiles-light-1536x864.png') })
      await application.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.setMinimumSize(300, 400)
        window.setContentSize(390, 800)
      })
      await page.screenshot({ path: join(visualDirectory, 'provider-profiles-light-390x800.png') })
      await page.getByTestId('settings-nav-appearance').click()
      await page.getByTestId('theme-dark').click()
      await page.getByTestId('settings-nav-model').click()
      await page.screenshot({ path: join(visualDirectory, 'provider-profiles-dark-390x800.png') })
      await application.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.setContentSize(1536, 864)
        window.setMinimumSize(940, 600)
      })
    }
    await page.getByTestId('provider-model').fill('configured-alias')
    await page.getByTestId('provider-save').click()
    await page.getByTestId('provider-activate').click()
    await expect(providerStatus).toHaveAttribute('aria-label', 'API 连接正常')
    const firstId = await page.getByTestId('provider-profile').inputValue()

    await page.getByTestId('provider-new').click()
    await page.getByTestId('provider-profile-name').fill('研究配置')
    await page.getByTestId('provider-base-url').fill(endpoint)
    await page.getByTestId('provider-model').fill('z-reader')
    await page.getByTestId('provider-api-key').fill('research-key')
    await page.getByTestId('provider-save').click()
    await expect(page.getByTestId('provider-profile')).not.toHaveValue('')
    const secondId = await page.getByTestId('provider-profile').inputValue()
    expect(secondId).not.toBe(firstId)
    await expect(providerStatus).toHaveAttribute('aria-label', 'API 连接正常')

    await page.getByTestId('provider-model').fill('unsaved-model')
    page.once('dialog', (dialog) => dialog.dismiss())
    await page.getByTestId('provider-profile').selectOption(firstId)
    await expect(page.getByTestId('provider-profile')).toHaveValue(secondId)
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByTestId('provider-profile').selectOption(firstId)
    await expect(page.getByTestId('provider-profile')).toHaveValue(firstId)
    await page.getByTestId('provider-profile').selectOption(secondId)
    await page.getByTestId('provider-activate').click()
    await expect(providerStatus).toHaveAttribute('aria-label', 'API 连接正常')
    await page.getByTestId('settings-close').click()

    launched = await restartReader(application, { userData: workspace.userData })
    application = launched.application
    page = launched.page
    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-model').click()
    await expect(page.getByTestId('provider-profile').locator('option')).toHaveCount(2)
    await expect(page.getByTestId('provider-profile')).toHaveValue(secondId)
    await expect(page.locator('#provider-model-options option')).toHaveCount(0)

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByTestId('provider-delete').click()
    await expect(page.getByTestId('provider-connection-status')).toHaveAttribute('aria-label', 'API 未配置')
    await expect(page.getByTestId('provider-profile')).toHaveValue(firstId)
    await page.getByTestId('provider-activate').click()
    await expect(page.getByTestId('provider-connection-status')).toHaveAttribute('aria-label', 'API 连接正常')
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('renders EPUB continuously while keeping embedded scripts disabled', async () => {
  const workspace = await createE2eWorkspace('llm-reader-epub-e2e-')
  const fixture = join(workspace.root, 'safe-fixture.epub')
  await createEpubFixture(fixture)
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const { page } = launched
    await expect(page.getByTestId('book-item').first()).toBeVisible()
    await page.getByTestId('book-item').first().click()
    await expect(page.getByTestId('toc-item').first()).toContainText('第一章')

    const chapterFrame = page.getByTestId('reader-host').frameLocator('iframe').first()
    await expect(chapterFrame.getByText('复杂系统的行为来自关系')).toBeVisible()
    await expect(chapterFrame.locator('#script-executed')).toHaveCount(0)
    const epubSelectionCss =
      (await chapterFrame.locator('#epubjs-inserted-css-llm-reader-reading-preferences').textContent()) ??
      ''
    expect(epubSelectionCss).toContain('::selection')
    expect(epubSelectionCss).toContain('rgba(240, 220, 160, 0.55)')

    const epubScroller = page.getByTestId('reader-host').locator('.epub-container')
    await expect
      .poll(() => epubScroller.evaluate((element) => element.scrollHeight - element.clientHeight))
      .toBeGreaterThan(300)
    await epubScroller.evaluate((element) => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.55
      element.dispatchEvent(new Event('scroll'))
    })
    await expect.poll(() => topVisibleEpubParagraph(page)).not.toBe('')
    const visibleBeforeLayoutChange = await topVisibleEpubParagraph(page)

    await page.getByTestId('reader-settings-button').click()
    await expect(page.getByTestId('settings-nav-reading')).toHaveAttribute('aria-selected', 'true')
    await page.getByTestId('reading-content-width').selectOption('wide')
    await page.getByTestId('reading-paragraph-spacing').selectOption('relaxed')
    await page.getByTestId('settings-close').click()

    await expect
      .poll(async () => {
        const frame = page.getByTestId('reader-host').frameLocator('iframe').first()
        return (await frame.locator('#epubjs-inserted-css-llm-reader-reading-preferences').textContent()) ?? ''
      })
      .toContain('max-width: 920px')
    const updatedEpubCss =
      (await page.getByTestId('reader-host').frameLocator('iframe').first()
        .locator('#epubjs-inserted-css-llm-reader-reading-preferences').textContent()) ?? ''
    expect(updatedEpubCss).toContain('margin-block-end: 1.8em')
    const markerBefore = Number(visibleBeforeLayoutChange.replace('reading-marker-', ''))
    await expect
      .poll(async () => {
        const markerAfter = Number((await topVisibleEpubParagraph(page)).replace('reading-marker-', ''))
        return Number.isFinite(markerAfter) && Math.abs(markerAfter - markerBefore) <= 1
      })
      .toBe(true)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('anchors the selection toolbar next to a TXT selection and follows scroll', async () => {
  const workspace = await createE2eWorkspace('llm-reader-toolbar-txt-e2e-')
  const fixture = resolve('tests/fixtures/complex-reading.txt')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const { page } = launched
    await page.getByTestId('book-item').first().click()
    await expect(page.getByTestId('reader-host')).toContainText('复杂概念')

    const toolbar = page.getByTestId('selection-toolbar')
    const paragraph = page.getByTestId('reader-host').locator('p').first()
    await selectNodeContents(paragraph)
    await expect(toolbar).toBeVisible()

    // 工具栏应贴近选区(上方留 10px 间距),而不是固定在阅读区底部。
    const paragraphBox = await paragraph.boundingBox()
    const toolbarBox = await toolbar.boundingBox()
    if (!paragraphBox || !toolbarBox) throw new Error('Expected paragraph and toolbar boxes')
    const aboveGap = paragraphBox.y - (toolbarBox.y + toolbarBox.height)
    const belowGap = toolbarBox.y - (paragraphBox.y + paragraphBox.height)
    expect(
      (aboveGap >= -2 && aboveGap <= 24) || (belowGap >= -2 && belowGap <= 24)
    ).toBe(true)

    // 滚动阅读区后,锚点重算,工具栏保持可见并被约束在阅读面内。
    const surface = page.locator('.reader-surface')
    await page.getByTestId('reader-host').evaluate((element) => {
      element.scrollTop = 320
      element.dispatchEvent(new Event('scroll'))
    })
    await expect
      .poll(async () => {
        const next = await toolbar.boundingBox()
        const surfaceBox = await surface.boundingBox()
        if (!next || !surfaceBox) return null
        return next.y >= surfaceBox.y - 1 && next.y + next.height <= surfaceBox.y + surfaceBox.height + 1
      })
      .toBe(true)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('anchors the selection toolbar next to an EPUB selection inside the chapter iframe', async () => {
  const workspace = await createE2eWorkspace('llm-reader-toolbar-epub-e2e-')
  const fixture = join(workspace.root, 'anchored-reading.epub')
  let application: ElectronApplication | undefined

  try {
    await createEpubFixture(fixture)
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const { page } = launched
    await page.getByTestId('book-item').first().click()
    const chapterFrame = page.getByTestId('reader-host').frameLocator('iframe').first()
    await expect(chapterFrame.getByText('复杂系统的行为来自关系')).toBeVisible()

    const toolbar = page.getByTestId('selection-toolbar')
    const paragraph = chapterFrame.locator('p').first()
    await paragraph.waitFor()
    await selectNodeContents(paragraph)
    await expect(toolbar).toBeVisible()

    const paragraphBox = await paragraph.boundingBox()
    const toolbarBox = await toolbar.boundingBox()
    if (!paragraphBox || !toolbarBox) throw new Error('Expected paragraph and toolbar boxes')
    const aboveGap = paragraphBox.y - (toolbarBox.y + toolbarBox.height)
    const belowGap = toolbarBox.y - (paragraphBox.y + paragraphBox.height)
    expect(
      (aboveGap >= -2 && aboveGap <= 24) || (belowGap >= -2 && belowGap <= 24)
    ).toBe(true)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
