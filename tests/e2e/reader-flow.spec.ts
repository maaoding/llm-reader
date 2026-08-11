import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'

let mockServer: Server
let endpoint = ''

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
      response.write(
        `data: ${JSON.stringify({ id: 'mock-stream', model: 'mock-reader', choices: [{ index: 0, delta: { content: '模型必须与适用边界一起理解 [P1]。' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 12, total_tokens: 32 } })}\n\n`
      )
      response.end('data: [DONE]\n\n')
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

test('imports, explains, cites, saves, and restores a local reading insight', async () => {
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

    await expect(page.getByTestId('app-shell')).toBeVisible()
    const firstBook = page.getByTestId('book-item').first()
    await expect(firstBook).toBeVisible()
    await firstBook.click()
    await expect(page.getByTestId('reader-host')).toContainText('复杂概念')

    await page.getByTestId('settings-button').click()
    await expect(page.getByTestId('settings-modal')).toBeVisible()
    await page.getByTestId('provider-base-url').fill(endpoint)
    await page.getByTestId('provider-model').fill('mock-reader')
    await page.getByTestId('provider-api-key').fill('test-only-key')
    await page.getByTestId('provider-save').click()
    const closeSettings = page.getByTestId('settings-close')
    if (await closeSettings.isVisible()) await closeSettings.click()

    const paragraph = page.getByTestId('reader-host').locator('p').nth(1)
    await paragraph.evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })

    await expect(page.getByTestId('selection-toolbar')).toBeVisible()
    await page.getByTestId('action-explain').click()
    await expect(page.getByTestId('answer-current')).toContainText('适用边界')
    await page.getByTestId('answer-save').click()
    await page.getByTestId('insights-tab').click()
    await expect(page.getByTestId('insight-item')).toContainText('适用边界')

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
    await expect(restoredPage.getByTestId('book-item').first()).toBeVisible()
    await restoredPage.getByTestId('book-item').first().click()
    await expect
      .poll(() => restoredPage.getByTestId('reader-host').evaluate((element) => element.scrollTop))
      .toBeGreaterThan(50)
    await restoredPage.getByTestId('insights-tab').click()
    await expect(restoredPage.getByTestId('insight-item')).toContainText('适用边界')
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
