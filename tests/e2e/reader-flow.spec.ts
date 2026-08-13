import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Locator
} from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'

let mockServer: Server
let endpoint = ''

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
  <script>document.body.insertAdjacentHTML('beforeend', '<p id="script-executed">SCRIPT_EXECUTED</p>')</script>
</body></html>`
  )
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await writeFile(path, bytes)
}

test.beforeAll(async () => {
  mockServer = createServer((request, response) => {
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
      const body = JSON.parse(rawBody) as { stream?: boolean }
      if (!body.stream) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            id: 'mock-test',
            model: 'mock-reader',
            choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }]
          })
        )
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
          `data: ${JSON.stringify({ id: 'mock-stream', model: 'mock-reader', choices: [{ index: 0, delta: { content: '模型必须与适用边界一起理解 [P1]。' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 12, total_tokens: 32 } })}\n\n`
        )
        response.end('data: [DONE]\n\n')
      }, 250)
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
  const userData = await mkdtemp(join(tmpdir(), 'llm-reader-focus-e2e-'))
  let application: ElectronApplication | undefined

  try {
    application = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        LLM_READER_USER_DATA: userData
      }
    })
    const page = await application.firstWindow()
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
        const focusable = dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        return document.activeElement === focusable.item(focusable.length - 1)
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
    await application?.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
})

test('keeps the home quiet and persists unified settings, reading, conversation, and insight deletion', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'llm-reader-e2e-'))
  const fixture = resolve('tests/fixtures/complex-reading.txt')
  let application: ElectronApplication | undefined

  try {
    application = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        LLM_READER_USER_DATA: userData,
        LLM_READER_E2E_IMPORT: fixture
      }
    })
    const page = await application.firstWindow()

    const appShell = page.getByTestId('app-shell')
    const html = page.locator('html')
    await expect(appShell).toBeVisible()
    await expect(page.locator('.brand-row')).toHaveText('LLM Reader')
    await expect(page.getByText('专注理解，不离开原文')).toHaveCount(0)
    await expect(page.getByText('欢迎使用 LLM Reader')).toHaveCount(0)
    await expect(page.getByText('本地优先')).toHaveCount(0)
    await expect(page.getByTestId('theme-switcher')).toHaveCount(0)
    await expect(page.getByTestId('import-book')).toBeVisible()
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
    await expect(page.getByTestId('interface-scale')).toHaveAttribute('aria-label', '界面缩放')
    await expect(page.getByTestId('scale-100')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('reading-font-scale')).toHaveValue('100')
    await expect(page.getByTestId('reading-line-height')).toHaveValue('original')
    await expect(page.getByTestId('reading-indent')).toHaveValue('original')
    await expect
      .poll(() => html.evaluate((element) => getComputedStyle(element).getPropertyValue('--ui-accent').trim()))
      .toBe('#586f7e')
    await expect
      .poll(() => html.evaluate((element) => getComputedStyle(element).getPropertyValue('--ui-line').trim()))
      .toBe('#d5dce0')
    await darkTheme.click()
    await page.getByTestId('scale-125').click()
    await page.getByTestId('reading-font-scale').fill('125')
    await page.getByTestId('reading-line-height').selectOption('1.7')
    await page.getByTestId('reading-indent').selectOption('2em')
    await expect(appShell).toHaveAttribute('data-theme-preference', 'dark')
    await expect(appShell).toHaveAttribute('data-theme', 'dark')
    await expect(appShell).toHaveAttribute('data-interface-scale', '125')
    await expect(html).toHaveAttribute('data-theme-preference', 'dark')
    await expect(html).toHaveAttribute('data-theme', 'dark')
    await expect(html).toHaveAttribute('data-interface-scale', '125')
    await expect(darkTheme).toHaveAttribute('aria-pressed', 'true')
    await expect
      .poll(() => html.evaluate((element) => getComputedStyle(element).getPropertyValue('--ui-accent').trim()))
      .toBe('#91a7b3')
    await expect
      .poll(() => html.evaluate((element) => getComputedStyle(element).getPropertyValue('--ui-accent-soft').trim()))
      .toBe('#29343a')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(appShell).toHaveAttribute('data-theme', 'dark')
    await expect(html).toHaveAttribute('data-theme', 'dark')

    await page.getByTestId('provider-base-url').fill(endpoint)
    await page.getByTestId('provider-model').fill('mock-reader')
    await page.getByTestId('provider-api-key').fill('test-only-key')
    await page.getByTestId('provider-save').click()
    await expect(settings).toHaveCount(0)
    await expect(settingsButton).toBeFocused()
    await expect
      .poll(() => page.evaluate(() => Object.values(localStorage).join('\n')))
      .not.toContain('test-only-key')

    const txtDocument = page.locator('.reader-document--txt')
    const txtParagraph = txtDocument.locator('p').first()
    await expect.poll(() => txtDocument.evaluate((element) => element.style.fontSize)).toBe('125%')
    await expect.poll(() => txtParagraph.evaluate((element) => element.style.lineHeight)).toBe('1.7')
    await expect.poll(() => txtParagraph.evaluate((element) => element.style.textIndent)).toBe('2em')
    const txtColors = await txtDocument.evaluate((element) => {
      const styles = getComputedStyle(element)
      return { color: styles.color, background: styles.backgroundColor }
    })
    expect(contrastRatio(txtColors.color, txtColors.background)).toBeGreaterThanOrEqual(4.5)

    const paragraph = page.getByTestId('reader-host').locator('p').nth(1)
    await selectNodeContents(paragraph)

    await expect(page.getByTestId('selection-toolbar')).toBeVisible()
    await page.getByTestId('action-explain').click()
    await expect(page.getByTestId('answer-current')).toContainText('这段文字提醒我们')
    const expandButton = page.getByTestId('assistant-expand-button')
    await expandButton.click()
    const assistantDialog = page.getByTestId('assistant-dialog')
    await expect(assistantDialog).toBeVisible()
    await expect(assistantDialog.getByTestId('answer-current')).toContainText('适用边界')
    await assistantDialog.getByTestId('followup-input').fill('再解释一下这里的前提')
    await assistantDialog.getByRole('button', { name: '发送问题' }).click()
    await expect(assistantDialog.getByTestId('answer-current')).toContainText('这段文字提醒我们')
    await page.getByTestId('assistant-dialog-close').click()
    await expect(assistantDialog).toHaveCount(0)
    await expect(expandButton).toBeFocused()
    await expect(page.getByTestId('answer-current')).toContainText('适用边界')
    await page.getByTestId('answer-save').click()
    await page.getByTestId('insights-tab').click()
    const insight = page.getByTestId('insight-item')
    await expect(insight).toContainText('适用边界')
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

    await application.close()
    application = undefined

    application = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        LLM_READER_USER_DATA: userData
      }
    })
    const restoredPage = await application.firstWindow()
    const restoredShell = restoredPage.getByTestId('app-shell')
    const restoredHtml = restoredPage.locator('html')
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
    await restoredPage.getByTestId('insights-tab').click()
    await expect(restoredPage.getByTestId('insight-item')).toHaveCount(0)

    const restoredDocument = restoredPage.locator('.reader-document--txt')
    await expect.poll(() => restoredDocument.evaluate((element) => element.style.fontSize)).toBe('125%')
    await expect.poll(() => restoredDocument.locator('p').first().evaluate((element) => element.style.lineHeight)).toBe('1.7')
    await expect.poll(() => restoredDocument.locator('p').first().evaluate((element) => element.style.textIndent)).toBe('2em')

    const restoredSettingsButton = restoredPage.getByTestId('settings-button')
    await restoredSettingsButton.click()
    const restoredSystemTheme = restoredPage.getByTestId('theme-system')
    const restoredDarkTheme = restoredPage.getByTestId('theme-dark')
    await expect(restoredDarkTheme).toHaveAttribute('aria-pressed', 'true')
    await expect(restoredPage.getByTestId('scale-125')).toHaveAttribute('aria-pressed', 'true')
    await expect(restoredPage.getByTestId('reading-font-scale')).toHaveValue('125')
    await expect(restoredPage.getByTestId('reading-line-height')).toHaveValue('1.7')
    await expect(restoredPage.getByTestId('reading-indent')).toHaveValue('2em')
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

    await restoredPage.getByTestId('reading-reset').click()
    await expect(restoredPage.getByTestId('reading-font-scale')).toHaveValue('100')
    await expect(restoredPage.getByTestId('reading-line-height')).toHaveValue('original')
    await expect(restoredPage.getByTestId('reading-indent')).toHaveValue('original')
  } finally {
    await application?.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
})

test('renders EPUB continuously while keeping embedded scripts disabled', async () => {
  const testRoot = await mkdtemp(join(tmpdir(), 'llm-reader-epub-e2e-'))
  const userData = join(testRoot, 'profile')
  const fixture = join(testRoot, 'safe-fixture.epub')
  await createEpubFixture(fixture)
  let application: ElectronApplication | undefined

  try {
    application = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        LLM_READER_USER_DATA: userData,
        LLM_READER_E2E_IMPORT: fixture
      }
    })
    const page = await application.firstWindow()
    await expect(page.getByTestId('book-item').first()).toBeVisible()
    await page.getByTestId('book-item').first().click()
    await expect(page.getByTestId('toc-item').first()).toContainText('第一章')

    const chapterFrame = page.getByTestId('reader-host').frameLocator('iframe').first()
    await expect(chapterFrame.getByText('复杂系统的行为来自关系')).toBeVisible()
    await expect(chapterFrame.locator('#script-executed')).toHaveCount(0)
  } finally {
    await application?.close().catch(() => undefined)
    await rm(testRoot, { recursive: true, force: true })
  }
})
