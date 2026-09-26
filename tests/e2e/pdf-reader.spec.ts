import { showContents } from './support/workspace'
import { showLibrary, enterReading } from './support/workspace'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { join, resolve } from 'node:path'
import {
  cleanupE2eWorkspace,
  createE2eWorkspace,
  launchReader,
  restartReader
} from './support/electron-app'

const textPdf = resolve('tests/e2e/fixtures/text-reader.pdf')
const noOutlinePdf = resolve('tests/e2e/fixtures/no-outline-reader.pdf')
const scannedPdf = resolve('tests/e2e/fixtures/scanned-reader.pdf')
const damagedPdf = resolve('tests/e2e/fixtures/damaged-reader.pdf')
const oversizedPdf = resolve('tests/e2e/fixtures/oversized-reader.pdf')
const hostilePdf = resolve('tests/e2e/fixtures/hostile-reader.pdf')
const complexLayoutPdf = resolve('tests/e2e/fixtures/complex-layout-reader.pdf')

let mockServer: Server
let mockEndpoint = ''
let latestPdfPrompt = ''
let visualRequests: Array<Record<string, unknown>> = []

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
      const body = JSON.parse(rawBody) as {
        stream?: boolean
        messages?: Array<{ content: string | Array<Record<string, unknown>> }>
      }
      const visual = Array.isArray(body.messages?.at(-1)?.content)
      if (visual && body.stream) visualRequests.push(body as Record<string, unknown>)
      const visualQuestion = visual
        ? (body.messages?.at(-1)?.content as Array<{ type?: string; text?: string }>).find((block) => block.type === 'text')?.text ?? ''
        : ''
      if (visualQuestion.includes('FAIL_VISUAL')) {
        response.writeHead(415, { 'content-type': 'application/json' }).end('{"error":"image unsupported"}')
        return
      }
      if (!body.stream) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          id: 'mock-pdf-check',
          model: 'mock-pdf-reader',
          choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }]
        }))
        return
      }

      latestPdfPrompt = body.messages?.map((message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n') ?? ''
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      response.write(
        `data: ${JSON.stringify({ id: 'mock-pdf-stream', model: 'mock-pdf-reader', choices: [{ index: 0, delta: { content: visual ? '已收到图片区域。' : '已收到框选后的文字。' } }] })}\n\n`
      )
      if (visualQuestion.includes('SLOW_VISUAL')) {
        const timer = setTimeout(() => response.end('data: [DONE]\n\n'), 10_000)
        response.on('close', () => clearTimeout(timer))
        return
      }
      response.end('data: [DONE]\n\n')
    })
  })

  await new Promise<void>((resolveListen, reject) => {
    mockServer.once('error', reject)
    mockServer.listen(0, '127.0.0.1', () => resolveListen())
  })
  const address = mockServer.address()
  if (!address || typeof address === 'string') throw new Error('Mock PDF provider did not expose a TCP port')
  mockEndpoint = `http://127.0.0.1:${address.port}/v1`
})

test.afterAll(async () => {
  await new Promise<void>((resolveClose, reject) => {
    mockServer.close((error) => (error ? reject(error) : resolveClose()))
  })
})

async function openFixture(fixture: string): Promise<{
  application: ElectronApplication
  page: Page
  testRoot: string
  userData: string
}> {
  const workspace = await createE2eWorkspace('llm-reader-pdf-')
  const { application, page } = await launchReader({
    userData: workspace.userData,
    importPath: fixture
  })
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`[renderer] ${message.text()}`)
  })
  page.on('pageerror', (error) => console.error(`[renderer-pageerror] ${error.message}`))
  await showLibrary(page); await expect(page.getByTestId('book-item').first()).toBeVisible()
  await showLibrary(page); await page.getByTestId('book-item').first().click(); await enterReading(page); await page.getByTestId('reader-settings-button').click()
  return { application, page, testRoot: workspace.root, userData: workspace.userData }
}

async function closeFixture(application: ElectronApplication | undefined, testRoot: string): Promise<void> {
  await cleanupE2eWorkspace(application, testRoot)
}

async function dragPdfRegion(
  page: Page,
  region: { left: number; top: number; right: number; bottom: number }
): Promise<void> {
  await page.getByTestId('reader-host').evaluate(async (host, target) => {
    const sheet = host.querySelector('.pdf-page')
    if (!sheet) throw new Error('Expected a PDF page')
    const sheetRect = sheet.getBoundingClientRect()
    const hostRect = host.getBoundingClientRect()
    const bottom = sheetRect.top + sheetRect.height * target.bottom
    const top = sheetRect.top + sheetRect.height * target.top
    if (bottom > hostRect.bottom - 20) host.scrollTop += bottom - hostRect.bottom + 20
    else if (top < hostRect.top + 20) host.scrollTop -= hostRect.top + 20 - top
    await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()))
  }, region)
  const box = await page.locator('.pdf-page').first().boundingBox()
  if (!box) throw new Error('Expected a visible PDF page')
  await page.mouse.move(box.x + box.width * region.left, box.y + box.height * region.top)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * region.right, box.y + box.height * region.bottom, { steps: 8 })
  await page.mouse.up()
}

async function configureMockProvider(page: Page): Promise<void> {
  await page.getByTestId('settings-button').click()
  await page.getByTestId('settings-nav-model').click()
  await page.getByTestId('provider-profile-name').fill('PDF 测试')
  await page.getByTestId('provider-base-url').fill(mockEndpoint)
  await page.getByTestId('provider-model').fill('mock-pdf-reader')
  await page.getByTestId('provider-api-key').fill('test-only-key')
  await page.getByTestId('provider-save').click()
  await page.getByTestId('provider-activate').click()
  await page.getByTestId('settings-close').click()
  await expect(page.getByTestId('settings-modal')).toHaveCount(0)
}

test('reads, searches, disables native selection, zooms and follows only internal links in a text PDF', async () => {
  test.setTimeout(120_000)
  const opened = await openFixture(textPdf)
  let application = opened.application
  let page = opened.page
  const { testRoot, userData } = opened
  try {
    await expect(page.getByTestId('pdf-reader')).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('.pdf-page')).toHaveCount(3)
    await expect.poll(() => page.locator('.pdf-page-canvas').first().evaluate((canvas) => (
      (canvas as HTMLCanvasElement).width
    ))).toBeGreaterThan(0)
    await expect.poll(() => page.locator('.pdf-text-layer span').count()).toBeGreaterThan(0)
    await expect(page.getByTestId('reader-settings-button')).toHaveAccessibleName('PDF 工具')
    await expect(page.getByTestId('reader-settings-button')).toHaveAttribute('aria-expanded', 'true')
    await page.getByTestId('reader-settings-button').click()
    await expect(page.getByTestId('pdf-toolbar')).toBeHidden()
    await page.getByTestId('reader-settings-button').click()
    await expect(page.getByTestId('pdf-region-select')).toBeVisible()
    await expect(page.getByTestId('pdf-image-region-select')).toBeVisible()
    await expect(page.locator('.pdf-text-layer').first()).toHaveCSS('user-select', 'none')
    await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '第一章')
    await expect(page.getByTestId('toc-item')).toHaveCount(5)

    const visualDirectory = process.env.LLM_READER_VISUAL_DIR
    if (visualDirectory) {
      await mkdir(visualDirectory, { recursive: true })
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))
      await page.getByTestId('recent-conversations').click()
      await expect(page.locator('.right-sidebar .recent-conversations-popover')).toBeVisible()
      await page.screenshot({ path: join(visualDirectory, 'pdf-reader-light-1440x900.png') })
      await page.keyboard.press('Escape')
      await page.getByTestId('settings-button').click()
      await page.getByTestId('theme-dark').click()
      await page.getByTestId('scale-125').click()
      await page.getByTestId('settings-close').click()
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(940, 600))
      await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme', 'dark')
      await expect(page.getByTestId('app-shell')).toHaveAttribute('data-interface-scale', '125')
      await page.getByTestId('recent-conversations').click()
      await expect(page.locator('.right-sidebar .recent-conversations-popover')).toBeVisible()
      await page.screenshot({ path: join(visualDirectory, 'pdf-reader-dark-940x600-125.png') })
      await page.keyboard.press('Escape')
      await page.getByTestId('settings-button').click()
      await page.getByTestId('theme-light').click()
      await page.getByTestId('scale-100').click()
      await page.getByTestId('settings-close').click()
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))
    }

    const fitWidth = page.getByRole('button', { name: '适合宽度', exact: true })
    await expect(fitWidth).toHaveAttribute('aria-pressed', 'true')
    // 适宽时读数隐藏,避免与“适合宽度”开关同义并排。
    await expect(page.getByTestId('pdf-zoom-value')).toBeHidden()
    await page.getByRole('button', { name: '放大', exact: true }).click()
    await page.getByRole('button', { name: '放大', exact: true }).click()
    await expect(page.getByTestId('pdf-zoom-value')).toBeVisible()
    await expect(page.getByTestId('pdf-zoom-value')).toHaveText('130%')
    await expect(fitWidth).toHaveAttribute('aria-pressed', 'false')
    await assertHorizontalScroll(page)
    await fitWidth.click()
    await expect(page.getByTestId('pdf-zoom-value')).toBeHidden()
    await expect(fitWidth).toHaveAttribute('aria-pressed', 'true')
    await assertFitWidth(page)

    // 适宽无横向溢出:不提供拖拽平移;放大溢出后按住拖拽即可平移。
    await expect(page.locator('.pdf-reader')).not.toHaveClass(/is-pannable/u)
    await page.getByRole('button', { name: '放大', exact: true }).click()
    await page.getByRole('button', { name: '放大', exact: true }).click()
    await expect(page.locator('.pdf-reader')).toHaveClass(/is-pannable/u)
    const hostBox = await page.getByTestId('reader-host').boundingBox()
    if (!hostBox) throw new Error('Expected a reader host box')
    const scrollLeftBeforePan = await page.getByTestId('reader-host').evaluate((element) => element.scrollLeft)
    await page.mouse.move(hostBox.x + hostBox.width * 0.72, hostBox.y + hostBox.height * 0.5)
    await page.mouse.down()
    await page.mouse.move(hostBox.x + hostBox.width * 0.32, hostBox.y + hostBox.height * 0.5, { steps: 8 })
    await expect(page.locator('.pdf-reader')).toHaveClass(/is-panning/u)
    await page.mouse.up()
    await expect
      .poll(() => page.getByTestId('reader-host').evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(scrollLeftBeforePan)
    await expect(page.locator('.pdf-reader')).not.toHaveClass(/is-panning/u)
    await fitWidth.click()
    await expect(page.locator('.pdf-reader')).not.toHaveClass(/is-pannable/u)

    await page.keyboard.press('Control+f')
    await page.getByTestId('reader-search-input').fill('星河')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('reader-search-result')).toHaveCount(13)
    await page.getByTestId('reader-search-result').last().click()
    await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '第二章')
    await expect.poll(() => page.evaluate(() => (
      (CSS as typeof CSS & { highlights?: Map<string, unknown> }).highlights?.has('llm-reader-pdf-temporary') ?? false
    ))).toBe(true)

    await page.getByTestId('reader-contents-button').click()
    await showContents(page)
    await page.getByTestId('toc-item').first().click()
    await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '第一章')
    const internalLink = page.locator('.pdf-internal-link').first()
    await expect(internalLink).toHaveAttribute('data-target-page', '3')
    await internalLink.evaluate((button) => (button as HTMLButtonElement).click())
    await expect.poll(() => page.getByTestId('reader-host').evaluate((host) => {
      const pageThree = host.querySelector<HTMLElement>('.pdf-page[data-page-number="3"]')
      if (!pageThree) return false
      const hostRect = host.getBoundingClientRect()
      const pageRect = pageThree.getBoundingClientRect()
      return pageRect.top < hostRect.bottom && pageRect.bottom > hostRect.top
    })).toBe(true)
    await expect(page.getByTestId('reader-return-button')).toBeEnabled()
    expect(application.windows()).toHaveLength(1)

    // A late scroll event after a jump must not replace the natural position.
    await page.getByTestId('reader-host').evaluate(async (host) => {
      await new Promise((resolveEvent) => setTimeout(resolveEvent, 200))
      host.dispatchEvent(new Event('scroll'))
    })
    await expect(page.getByTestId('reader-return-button')).toBeVisible()
    await page.getByTestId('reader-return-button').click()
    await page.locator('.pdf-text-layer span').filter({ hasText: '中文关键词' }).first().evaluate((element) => {
      const node = element.firstChild
      if (!node) throw new Error('Expected a PDF text node')
      const range = document.createRange()
      range.selectNodeContents(node)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
    await expect(page.getByTestId('selection-toolbar')).toBeHidden()

    await page.getByTestId('reader-host').evaluate((host) => {
      const pageTwo = host.querySelector<HTMLElement>('.pdf-page[data-page-number="2"]')
      if (!pageTwo) throw new Error('Expected PDF page 2')
      host.scrollTop = pageTwo.offsetTop + Math.min(120, pageTwo.offsetHeight / 4)
      host.dispatchEvent(new Event('scroll'))
    })
    await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '第二章')
    await expect.poll(async () => {
      const books = await page.evaluate(() => (
        window as unknown as {
          readerApi: { listBooks(): Promise<Array<{ lastLocator: string | null }>> }
        }
      ).readerApi.listBooks())
      return books[0]?.lastLocator ?? null
    }, { timeout: 10_000 }).toMatch(/^pdf:2:/u)

    const restarted = await restartReader(application, { userData })
    application = restarted.application
    page = restarted.page
    await showLibrary(page); await expect(page.getByTestId('book-item').first()).toBeVisible()
    await showLibrary(page); await page.getByTestId('book-item').first().click(); await enterReading(page)
    await expect(page.getByTestId('pdf-reader')).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '第二章')
  } finally {
    await closeFixture(application, testRoot)
  }
})

test('tracks precise outline sections and keeps fit-width stable through rapid zoom and resize', async () => {
  test.setTimeout(150_000)
  const { application, page, testRoot } = await openFixture(textPdf)
  try {
    await expect(page.getByTestId('pdf-reader')).toBeVisible({ timeout: 60_000 })
    await expect.poll(() => page.locator('.pdf-text-layer[data-page-number="1"] span').count()).toBeGreaterThan(0)

    await page.getByTestId('reader-contents-button').click()
    await showContents(page)
    await page.getByTestId('toc-item').filter({ hasText: '1.1 同页目录定位' }).click()
    await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '1.1 同页目录定位')
    await expect(page.locator('.reader-heading strong')).toHaveText('0%')
    const headingPosition = await page.locator('.pdf-text-layer span').filter({ hasText: '1.1 同页目录定位' }).first().evaluate((heading) => {
      const host = document.querySelector<HTMLElement>('[data-testid="reader-host"]')
      if (!host) throw new Error('Expected reader host')
      return heading.getBoundingClientRect().top - host.getBoundingClientRect().top
    })
    expect(headingPosition).toBeGreaterThan(20)
    expect(headingPosition).toBeLessThan(220)

    await page.waitForTimeout(120)
    await page.getByTestId('reader-host').evaluate((host) => {
      const pageOne = host.querySelector<HTMLElement>('.pdf-page[data-page-number="1"]')
      if (!pageOne) throw new Error('Expected PDF page 1')
      // The adapter resolves the active section at its reading line, below the viewport top.
      host.scrollTop = pageOne.offsetTop + pageOne.offsetHeight * 0.52 - Math.min(120, host.clientHeight * 0.25)
      host.dispatchEvent(new Event('scroll'))
    })
    await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '1.1 同页目录定位')
    await expect.poll(async () => Number.parseInt((await page.locator('.reader-heading strong').textContent()) ?? '0', 10)).toBeGreaterThan(50)

    await showContents(page)
    await page.getByTestId('toc-item').filter({ hasText: '1.2 适宽稳定性' }).click()
    await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '1.2 适宽稳定性')
    await expect(page.locator('.reader-heading strong')).toHaveText('0%')

    await page.waitForTimeout(120)
    await page.getByTestId('reader-host').evaluate((host) => {
      const pageTwo = host.querySelector<HTMLElement>('.pdf-page[data-page-number="2"]')
      if (!pageTwo) throw new Error('Expected PDF page 2')
      host.scrollTop = pageTwo.offsetTop + pageTwo.offsetHeight - host.clientHeight * 0.55
      host.dispatchEvent(new Event('scroll'))
    })
    await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '第二章')

    const pageTwoText = page.locator('.pdf-text-layer[data-page-number="2"] span').filter({ hasText: /\S/u }).first()
    await expect(pageTwoText).toBeVisible()
    await pageTwoText.evaluate((span) => {
      const node = span.firstChild
      if (!node) throw new Error('Expected a PDF text node')
      const range = document.createRange()
      range.selectNodeContents(node)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
    await expect(page.getByTestId('selection-toolbar')).toBeHidden()

    const zoomIn = page.getByRole('button', { name: '放大', exact: true })
    const fitWidth = page.getByRole('button', { name: '适合宽度', exact: true })
    await zoomIn.click()
    await zoomIn.click()
    await fitWidth.click()
    await expect(page.getByTestId('pdf-zoom-value')).toBeHidden()
    await expect(fitWidth).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('selection-toolbar')).toBeHidden()
    await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '第二章')
    await expect.poll(() => page.getByTestId('reader-host').evaluate((host) => {
      const pageTwo = host.querySelector<HTMLElement>('.pdf-page[data-page-number="2"]')
      if (!pageTwo) return false
      const hostRect = host.getBoundingClientRect()
      const pageRect = pageTwo.getBoundingClientRect()
      return pageRect.top < hostRect.bottom && pageRect.bottom > hostRect.top
    })).toBe(true)
    for (const pageNumber of [1, 2, 3]) {
      await assertPdfCanvasPainted(page, pageNumber)
    }
    await assertFitWidth(page)

    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(940, 600))
    await assertFitWidth(page)
    await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '第二章')
  } finally {
    await closeFixture(application, testRoot)
  }
})

test('uses whole-document progress for a text PDF without an outline', async () => {
  test.setTimeout(90_000)
  const { application, page, testRoot } = await openFixture(noOutlinePdf)
  try {
    await expect(page.getByTestId('pdf-reader')).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '全文')
    await page.getByTestId('reader-contents-button').click()
    await expect(page.getByText('没有可用目录')).toBeVisible()

    await page.getByTestId('reader-host').evaluate((host) => {
      const pageTwo = host.querySelector<HTMLElement>('.pdf-page[data-page-number="2"]')
      if (!pageTwo) throw new Error('Expected PDF page 2')
      host.scrollTop = pageTwo.offsetTop
      host.dispatchEvent(new Event('scroll'))
    })
    await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '全文')
    await expect.poll(async () => Number.parseInt((await page.locator('.reader-heading strong').textContent()) ?? '0', 10)).toBeGreaterThan(45)
  } finally {
    await closeFixture(application, testRoot)
  }
})

async function assertFitWidth(page: Page): Promise<void> {
  await expect.poll(() => page.getByTestId('reader-host').evaluate((host) => {
    const documentElement = host.querySelector<HTMLElement>('.pdf-document')
    const pageElement = host.querySelector<HTMLElement>('.pdf-page')
    if (!documentElement || !pageElement) return Number.POSITIVE_INFINITY
    const style = getComputedStyle(documentElement)
    const expected = host.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
    return Math.abs(pageElement.getBoundingClientRect().width - expected)
  })).toBeLessThan(2)
  const overflow = await page.getByTestId('reader-host').evaluate((host) => ({
    extraWidth: host.scrollWidth - host.clientWidth,
    scrollLeft: host.scrollLeft
  }))
  expect(overflow.extraWidth).toBeLessThanOrEqual(1)
  expect(overflow.scrollLeft).toBe(0)
}

async function assertHorizontalScroll(page: Page): Promise<void> {
  await expect.poll(() => page.getByTestId('reader-host').evaluate((host) => (
    host.scrollWidth - host.clientWidth
  ))).toBeGreaterThan(20)
  await page.getByTestId('reader-host').evaluate((host) => {
    host.scrollLeft = Math.max(1, (host.scrollWidth - host.clientWidth) / 2)
  })
  await expect.poll(() => page.getByTestId('reader-host').evaluate((host) => host.scrollLeft)).toBeGreaterThan(0)
}

async function assertPdfCanvasPainted(page: Page, pageNumber: number): Promise<void> {
  const canvas = page.locator(`.pdf-page[data-page-number="${pageNumber}"] canvas`)
  await expect.poll(() => canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement
    if (target.width < 2 || target.height < 2) return false
    const context = target.getContext('2d', { willReadFrequently: true })
    if (!context) return false
    const pixel = context.getImageData(1, 1, 1, 1).data
    return pixel[3] === 255 && pixel[0] + pixel[1] + pixel[2] > 600
  })).toBe(true)
  await expect(canvas).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(canvas).toHaveCSS('visibility', 'visible')
}

test('disables native PDF selection and supports editable single-page region selections', async () => {
  test.setTimeout(180_000)
  const opened = await openFixture(complexLayoutPdf)
  let application = opened.application
  let page = opened.page
  const { testRoot, userData } = opened
  try {
    await expect(page.getByTestId('pdf-reader')).toBeVisible({ timeout: 60_000 })
    await expect.poll(() => page.locator('.pdf-page-canvas').first().evaluate((canvas) => (
      (canvas as HTMLCanvasElement).width
    ))).toBeGreaterThan(0)
    await expect.poll(() => page.locator('.pdf-text-layer span').count()).toBeGreaterThan(0)

    await page.locator('.pdf-text-layer').first().evaluate((layer) => {
      const spans = Array.from(layer.querySelectorAll<HTMLElement>('span'))
      const startSpan = spans.find((span) => span.textContent?.includes('换行测试'))
      const endSpan = spans.find((span) => span.textContent?.includes('自然空格'))
      const startNode = startSpan?.firstChild
      const endNode = endSpan?.firstChild
      if (!startNode || !endNode) throw new Error('Expected wrapped paragraph text nodes')
      const range = document.createRange()
      range.setStart(startNode, 0)
      range.setEnd(endNode, endNode.textContent?.length ?? 0)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
    await expect(page.getByTestId('selection-toolbar')).toBeHidden()

    const regionButton = page.getByTestId('pdf-region-select')
    await regionButton.click()
    await expect(regionButton).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.toast')).toContainText('请在单页内框选')
    await dragPdfRegion(page, { left: 0.06, top: 0.19, right: 0.48, bottom: 0.41 })
    await expect(page.getByTestId('pdf-selection-review')).toBeVisible()
    // 校对弹窗打开后,引导 toast 应被撤下,避免与弹窗说明重复。
    await expect(page.locator('.toast')).toHaveCount(0)
    const reviewInput = page.getByTestId('pdf-selection-review-input')
    await expect(reviewInput).toHaveValue(/左栏第一行/u)
    await expect(reviewInput).not.toHaveValue(/右栏第一行/u)
    const editedQuote = '左栏第一行：区域框选目标。\n左栏第二行：不应混入右栏。\n（已校正）'
    await reviewInput.fill(editedQuote)
    await page.getByTestId('pdf-selection-review-confirm').click()
    await expect(page.getByTestId('pdf-selection-review')).toBeHidden()
    await expect(regionButton).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('selection-toolbar')).toBeVisible()
    await expect(page.getByTestId('pdf-region-selection')).toBeVisible()
    await page.getByTestId('action-save-highlight').click()
    const persistentRegion = page.locator('.pdf-region-overlay.is-persistent')
    await expect(persistentRegion).toHaveCount(1)
    const beforeZoom = await persistentRegion.first().getAttribute('style')
    await page.getByRole('button', { name: '放大', exact: true }).click()
    await expect(page.getByTestId('pdf-zoom-value')).toHaveText('115%')
    await expect(persistentRegion).toHaveCount(1)
    expect(await persistentRegion.first().getAttribute('style')).toBe(beforeZoom)

    await expect.poll(async () => page.evaluate(async () => {
      const api = (window as unknown as {
        readerApi: {
          listBooks(): Promise<Array<{ id: string }>>
          listHighlights(bookId: string): Promise<Array<{ anchor: string; quote: string }>>
        }
      }).readerApi
      const [book] = await api.listBooks()
      return (await api.listHighlights(book.id)).find((highlight) => highlight.anchor.startsWith('pdfrect:')) ?? null
    })).toEqual(expect.objectContaining({ quote: editedQuote }))

    const restarted = await restartReader(application, { userData })
    application = restarted.application
    page = restarted.page
    await showLibrary(page); await expect(page.getByTestId('book-item').first()).toBeVisible()
    await showLibrary(page); await page.getByTestId('book-item').first().click(); await enterReading(page)
    await expect(page.getByTestId('pdf-reader')).toBeVisible({ timeout: 60_000 })
    const restoredPersistentRegion = page.locator('.pdf-region-overlay.is-persistent')
    await expect(restoredPersistentRegion).toHaveCount(1)
    expect(await restoredPersistentRegion.getAttribute('style')).toBe(beforeZoom)
    await showContents(page)
    await page.getByTestId('highlights-tab').click()
    const regionHighlight = page.getByTestId('highlight-item').filter({ hasText: '已校正' })
    await expect(regionHighlight).toHaveCount(1)
    await regionHighlight.locator('.highlight-jump').click()
    const temporaryRegion = page.locator('.pdf-region-overlay.is-temporary')
    await expect(temporaryRegion).toHaveCount(1)
    expect(await temporaryRegion.getAttribute('style')).toBe(beforeZoom)
  } finally {
    await closeFixture(application, testRoot)
  }
})

test('uses edited PDF region text in a real question and keeps the dark review dialog usable', async () => {
  test.setTimeout(180_000)
  const { application, page, testRoot } = await openFixture(complexLayoutPdf)
  try {
    latestPdfPrompt = ''
    await expect(page.getByTestId('pdf-reader')).toBeVisible({ timeout: 60_000 })
    await expect.poll(() => page.locator('.pdf-text-layer span').count()).toBeGreaterThan(0)
    await configureMockProvider(page)

    await page.getByTestId('settings-button').click()
    await page.getByTestId('theme-dark').click()
    await page.getByTestId('scale-125').click()
    await page.getByTestId('settings-close').click()
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(940, 600))
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme', 'dark')
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-interface-scale', '125')

    await page.getByTestId('pdf-region-select').click()
    await dragPdfRegion(page, { left: 0.06, top: 0.19, right: 0.48, bottom: 0.41 })
    const review = page.getByTestId('pdf-selection-review')
    await expect(review).toBeVisible()
    const reviewBounds = await review.boundingBox()
    const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
    expect(reviewBounds).not.toBeNull()
    expect(reviewBounds!.x).toBeGreaterThanOrEqual(0)
    expect(reviewBounds!.y).toBeGreaterThanOrEqual(0)
    expect(reviewBounds!.x + reviewBounds!.width).toBeLessThanOrEqual(viewport.width)
    expect(reviewBounds!.y + reviewBounds!.height).toBeLessThanOrEqual(viewport.height)

    const visualDirectory = process.env.LLM_READER_VISUAL_DIR
    if (visualDirectory) {
      await mkdir(visualDirectory, { recursive: true })
      await page.screenshot({ path: join(visualDirectory, 'pdf-region-review-dark-940x600-125.png') })
    }

    const editedQuote = '左栏第一行：区域框选目标。\n左栏第二行：不应混入右栏。\n（深色提问校正）'
    await page.getByTestId('pdf-selection-review-input').fill(editedQuote)
    await page.getByTestId('pdf-selection-review-confirm').click()
    await page.getByTestId('action-ask').click()
    await expect(page.locator('.source-card blockquote')).toContainText(editedQuote)

    const question = '这段框选文字在论证中有什么作用？'
    await page.getByTestId('followup-input').fill(question)
    await page.getByTestId('followup-input').press('Enter')
    await expect(page.getByTestId('answer-current')).toContainText('已收到框选后的文字。')
    await expect.poll(() => latestPdfPrompt).toContain(JSON.stringify(editedQuote).slice(1, -1))
    expect(latestPdfPrompt).toContain(question)
  } finally {
    await closeFixture(application, testRoot)
  }
})

test('cancels or retries invalid PDF region selections safely', async () => {
  test.setTimeout(120_000)
  const { application, page, testRoot } = await openFixture(complexLayoutPdf)
  try {
    await expect(page.getByTestId('pdf-reader')).toBeVisible({ timeout: 60_000 })
    await expect.poll(() => page.locator('.pdf-text-layer span').count()).toBeGreaterThan(0)
    const regionButton = page.getByTestId('pdf-region-select')
    await regionButton.click()
    await dragPdfRegion(page, { left: 0.06, top: 0.19, right: 0.48, bottom: 0.41 })
    await expect(page.getByTestId('pdf-selection-review')).toBeVisible()
    await page.getByTestId('pdf-selection-review-cancel').click()
    await expect(page.getByTestId('pdf-selection-review')).toBeHidden()
    await expect(regionButton).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.pdf-region-overlay.is-draft')).toHaveCount(0)

    await regionButton.click()
    await dragPdfRegion(page, { left: 0.06, top: 0.19, right: 0.48, bottom: 0.41 })
    await expect(page.getByTestId('pdf-selection-review')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('pdf-selection-review')).toBeHidden()
    await expect(regionButton).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.pdf-region-overlay.is-draft')).toHaveCount(0)

    await regionButton.click()
    await dragPdfRegion(page, { left: 0.1, top: 0.1, right: 0.101, bottom: 0.101 })
    await expect(page.getByRole('status').filter({ hasText: '框选区域太小' })).toBeVisible()
    await expect(regionButton).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')

    await regionButton.click()
    await dragPdfRegion(page, { left: 0.1, top: 0.36, right: 0.4, bottom: 0.395 })
    await expect(page.getByRole('status').filter({ hasText: '没有可提取的文字' })).toBeVisible()
    await expect(regionButton).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')
    await expect(regionButton).toHaveAttribute('aria-pressed', 'false')

    await page.locator('.pdf-text-layer').first().evaluate((layer) => {
      const oversized = document.createElement('span')
      oversized.dataset.pdfTextStart = '0'
      oversized.dataset.pdfTextEnd = '20001'
      oversized.dataset.testid = 'pdf-oversized-region-text'
      oversized.textContent = '超'.repeat(20_001)
      Object.assign(oversized.style, {
        position: 'absolute',
        display: 'block',
        left: '10%',
        top: '60%',
        width: '60%',
        height: '10%',
        overflow: 'hidden'
      })
      layer.append(oversized)
    })
    await regionButton.click()
    await dragPdfRegion(page, { left: 0.1, top: 0.6, right: 0.7, bottom: 0.7 })
    await expect(page.getByRole('status').filter({ hasText: '超过 20,000 字' })).toBeVisible()
    await expect(regionButton).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('pdf-oversized-region-text').evaluate((element) => element.remove())
    await page.keyboard.press('Escape')
    await expect(regionButton).toHaveAttribute('aria-pressed', 'false')
  } finally {
    await closeFixture(application, testRoot)
  }
})

test('clears a PDF region draft when switching books or destroying the reader', async () => {
  test.setTimeout(180_000)
  const opened = await openFixture(complexLayoutPdf)
  let application = opened.application
  let page = opened.page
  const { testRoot, userData } = opened
  try {
    await expect(page.getByTestId('pdf-reader')).toBeVisible({ timeout: 60_000 })
    await expect.poll(() => page.locator('.pdf-text-layer span').count()).toBeGreaterThan(0)
    await page.getByTestId('nav-library').click()
    const complexBookId = await page.getByTestId('book-item').first().getAttribute('data-book-id')
    if (!complexBookId) throw new Error('Expected a stable id for the complex PDF book')
    const bookItemById = (targetPage: Page, bookId: string): Locator =>
      targetPage.locator(`button[data-testid="book-item"][data-book-id="${bookId}"]`)

    await application.evaluate(({ dialog }, fixturePath) => {
      dialog.showOpenDialog = (async () => (
        { canceled: false, filePaths: [fixturePath], bookmarks: [] }
      )) as unknown as typeof dialog.showOpenDialog
    }, textPdf)
    await page.getByTestId('import-book').click()
    await expect(page.locator('.workspace-book-title h1')).toHaveText('PDF 阅读测试')
    await expect(page.getByTestId('pdf-reader')).toBeVisible({ timeout: 60_000 })
    await showLibrary(page)
    await expect(page.getByTestId('book-item')).toHaveCount(2)
    const textBookId = (await page.getByTestId('book-item').evaluateAll((buttons) => (
      buttons.map((button) => button.getAttribute('data-book-id'))
    ))).find((bookId) => bookId !== complexBookId)
    if (!textBookId) throw new Error('Expected a stable id for the text PDF book')
    await page.getByTestId('nav-library').click()
    await expect(page.locator('.reader-surface')).toHaveClass(/is-ready/, { timeout: 60_000 })
    await expect(page.getByTestId('library-list')).toBeVisible()
    const firstComplexBook = bookItemById(page, complexBookId)
    await expect(firstComplexBook).toBeVisible()
    await firstComplexBook.click(); await enterReading(page); await page.getByTestId('reader-settings-button').click()
    await expect.poll(() => page.locator('.pdf-text-layer span').count()).toBeGreaterThan(0)
    await page.getByTestId('pdf-region-select').click()
    await dragPdfRegion(page, { left: 0.06, top: 0.19, right: 0.48, bottom: 0.41 })
    await expect(page.getByTestId('pdf-selection-review')).toBeVisible()

    await page.getByTestId('nav-library').evaluate((button) => (button as HTMLButtonElement).click())
    const otherBook = bookItemById(page, textBookId)
    await otherBook.evaluate((button) => (button as HTMLButtonElement).click()); await enterReading(page)
    await expect(page.getByTestId('pdf-selection-review')).toHaveCount(0)
    await expect(page.locator('.pdf-region-overlay.is-draft')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'PDF 阅读测试', exact: true })).toBeVisible()

    await page.getByTestId('nav-library').click()
    await expect(page.locator('.reader-surface')).toHaveClass(/is-ready/, { timeout: 60_000 })
    await expect(page.getByTestId('library-list')).toBeVisible()
    await expect(page.getByTestId('book-item')).toHaveCount(2, { timeout: 30_000 })
    const secondComplexBook = bookItemById(page, complexBookId)
    await expect(secondComplexBook).toBeVisible({ timeout: 30_000 })
    await secondComplexBook.click(); await enterReading(page); await page.getByTestId('reader-settings-button').click()
    await expect.poll(() => page.locator('.pdf-text-layer span').count()).toBeGreaterThan(0)
    await page.getByTestId('pdf-region-select').click()
    await dragPdfRegion(page, { left: 0.06, top: 0.19, right: 0.48, bottom: 0.41 })
    await expect(page.getByTestId('pdf-selection-review')).toBeVisible()

    const restarted = await restartReader(application, { userData })
    application = restarted.application
    page = restarted.page
    await showLibrary(page)
    await expect(page.getByTestId('book-item')).toHaveCount(2)
    await expect(page.getByTestId('pdf-selection-review')).toHaveCount(0)
    await expect(page.locator('.pdf-region-overlay.is-draft')).toHaveCount(0)
  } finally {
    await closeFixture(application, testRoot)
  }
})

test('accepts a local complex academic PDF without committing the source file', async () => {
  const realPdf = process.env.LLM_READER_REAL_PDF
  test.skip(!realPdf, 'Set LLM_READER_REAL_PDF to run the local-only PDF acceptance check.')
  if (!realPdf) return
  test.setTimeout(240_000)
  const { application, page, testRoot } = await openFixture(realPdf)
  try {
    await expect(page.getByTestId('pdf-reader')).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('.pdf-page')).toHaveCount(88)
    await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '全文')

    for (const pageNumber of [4, 10, 40, 55, 81]) {
      await page.getByTestId('reader-host').evaluate((host, targetPage) => {
        const pageElement = host.querySelector<HTMLElement>(`.pdf-page[data-page-number="${targetPage}"]`)
        if (!pageElement) throw new Error(`Missing PDF page ${targetPage}`)
        host.scrollTop = pageElement.offsetTop
        host.dispatchEvent(new Event('scroll'))
      }, pageNumber)
      const textSpans = page.locator(`.pdf-text-layer[data-page-number="${pageNumber}"] span`)
      await expect.poll(() => textSpans.count()).toBeGreaterThan(0)
      await textSpans.filter({ hasText: /\S/u }).first().evaluate((span) => {
        const node = span.firstChild
        if (!node) throw new Error('Expected a PDF text node')
        const range = document.createRange()
        range.selectNodeContents(node)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
      })
      await expect(page.getByTestId('selection-toolbar')).toBeHidden()
      await expect(page.locator('.reader-column')).not.toHaveAttribute('data-current-chapter-title', /^第 \d+ 页$/u)
    }
    await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', 'References')

    await page.getByTestId('reader-host').evaluate((host) => {
      const pageElement = host.querySelector<HTMLElement>('.pdf-page[data-page-number="40"]')
      if (!pageElement) throw new Error('Missing PDF page 40')
      host.scrollTop = pageElement.offsetTop
      host.dispatchEvent(new Event('scroll'))
    })
    await expect.poll(() => page.locator('.pdf-text-layer[data-page-number="40"] span').count()).toBeGreaterThan(0)
    await page.getByTestId('pdf-region-select').click()
    const pageFortyBox = await page.locator('.pdf-page[data-page-number="40"]').boundingBox()
    if (!pageFortyBox) throw new Error('Expected PDF page 40 to be visible')
    await page.mouse.move(pageFortyBox.x + pageFortyBox.width * 0.08, pageFortyBox.y + pageFortyBox.height * 0.05)
    await page.mouse.down()
    await page.mouse.move(pageFortyBox.x + pageFortyBox.width * 0.92, pageFortyBox.y + pageFortyBox.height * 0.34, { steps: 8 })
    await page.mouse.up()
    await expect(page.getByTestId('pdf-selection-review-input')).not.toHaveValue('')

    const visualDirectory = process.env.LLM_READER_VISUAL_DIR
    if (visualDirectory) {
      await mkdir(visualDirectory, { recursive: true })
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))
      await page.screenshot({ path: join(visualDirectory, 'pdf-real-region-light-1440x900.png') })
    }
    await page.keyboard.press('Escape')

    const zoomIn = page.getByRole('button', { name: '放大', exact: true })
    const fitWidth = page.getByRole('button', { name: '适合宽度', exact: true })
    await zoomIn.click()
    await zoomIn.click()
    await expect(page.getByTestId('pdf-zoom-value')).toHaveText('130%')
    await assertHorizontalScroll(page)
    for (const pageNumber of [39, 40, 41]) {
      await assertPdfCanvasPainted(page, pageNumber)
    }
    if (visualDirectory) {
      await page.screenshot({ path: join(visualDirectory, 'pdf-real-custom-130-light-1440x900.png') })
    }
    await fitWidth.click()
    await expect(page.getByTestId('pdf-zoom-value')).toBeHidden()
    await expect.poll(() => page.getByTestId('reader-host').evaluate((host) => {
      const pageForty = host.querySelector<HTMLElement>('.pdf-page[data-page-number="40"]')
      if (!pageForty) return false
      const hostRect = host.getBoundingClientRect()
      const pageRect = pageForty.getBoundingClientRect()
      return pageRect.top < hostRect.bottom && pageRect.bottom > hostRect.top
    })).toBe(true)
    for (const pageNumber of [39, 40, 41]) {
      await assertPdfCanvasPainted(page, pageNumber)
    }
    await assertFitWidth(page)

    await page.getByTestId('settings-button').click()
    await page.getByTestId('theme-dark').click()
    await page.getByTestId('scale-125').click()
    await page.getByTestId('settings-close').click()
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(940, 600))
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme', 'dark')
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-interface-scale', '125')
    await assertFitWidth(page)
    if (visualDirectory) {
      await page.screenshot({ path: join(visualDirectory, 'pdf-real-dark-940x600-125.png') })
    }
  } finally {
    await closeFixture(application, testRoot)
  }
})

test('browses a scanned PDF but reports that search and selection are unavailable', async () => {
  test.setTimeout(90_000)
  const { application, page, testRoot } = await openFixture(scannedPdf)
  try {
    await expect(page.getByTestId('pdf-reader')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('pdf-no-text-banner')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('pdf-region-select')).toBeHidden()
    await expect(page.getByTestId('pdf-image-region-select')).toBeVisible()
    await expect.poll(() => page.locator('.pdf-page-canvas').first().evaluate((canvas) => (
      (canvas as HTMLCanvasElement).width
    ))).toBeGreaterThan(0)
    await expect(page.locator('.pdf-text-layer span')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '扫描 PDF 测试', exact: true })).toBeVisible()

    await page.getByTestId('reader-search-button').click()
    await page.getByTestId('reader-search-input').fill('扫描页')
    await page.keyboard.press('Enter')
    await expect(page.getByText('这份 PDF 没有可搜索的文字层。')).toBeVisible()
  } finally {
    await closeFixture(application, testRoot)
  }
})

test('asks about a scanned PDF image region, resends its crop, and restores its source after restart', async () => {
  test.setTimeout(180_000)
  const opened = await openFixture(scannedPdf)
  let application = opened.application
  let page = opened.page
  const { testRoot, userData } = opened
  try {
    visualRequests = []
    await expect(page.getByTestId('pdf-no-text-banner')).toBeVisible({ timeout: 60_000 })
    await configureMockProvider(page)
    await expect(page.getByTestId('pdf-region-select')).toBeHidden()
    await page.getByTestId('pdf-image-region-select').click()
    await dragPdfRegion(page, { left: 0.12, top: 0.18, right: 0.78, bottom: 0.58 })
    const preview = page.getByTestId('pdf-image-region-review')
    await expect(preview).toBeVisible()
    await expect(preview.locator('img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/u)
    await page.getByTestId('pdf-image-region-confirm').click()
    await expect(page.getByTestId('action-visual-explain')).toBeVisible()
    await page.getByTestId('action-visual-explain').click()
    await expect(page.getByTestId('answer-current')).toContainText('已收到图片区域。')
    await expect(page.locator('.source-card')).toContainText('PDF 第 1 页区域')
    await expect(page.locator('.answer-sources')).toHaveCount(0)
    await expect.poll(() => visualRequests.length).toBe(1)

    const question = '再看一下图的右侧。'
    await page.getByTestId('followup-input').fill(question)
    await page.getByTestId('followup-input').press('Enter')
    await expect(page.getByTestId('answer-current')).toContainText('已收到图片区域。')
    await expect.poll(() => visualRequests.length).toBe(2)
    const messages = visualRequests[1].messages as Array<{ role: string; content: unknown }>
    expect(messages.at(-1)?.content).toEqual([
      { type: 'text', text: expect.stringContaining(question) },
      { type: 'image_url', image_url: { url: expect.stringMatching(/^data:image\/jpeg;base64,/u), detail: 'high' } }
    ])
    expect(messages.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(JSON.stringify(visualRequests[1])).not.toContain('selectedPassageId')
    await page.getByTestId('answer-regenerate').click()
    await expect(page.getByTestId('answer-current')).toContainText('已收到图片区域。')
    await expect.poll(() => visualRequests.length).toBe(3)
    expect((visualRequests[2].messages as Array<{ content: unknown }>).at(-1)?.content).toEqual(messages.at(-1)?.content)

    await page.getByTestId('answer-save').click()
    await expect(page.getByTestId('answer-save')).toContainText('已保存')
    const persisted = await page.evaluate(async () => {
      const api = (window as unknown as { readerApi: {
        listBooks(): Promise<Array<{ id: string }>>
        getBookSession(id: string): Promise<unknown>
        listInsights(id: string): Promise<unknown>
      } }).readerApi
      const [book] = await api.listBooks()
      return { session: await api.getBookSession(book.id), insights: await api.listInsights(book.id) }
    })
    expect(JSON.stringify(persisted)).not.toContain('data:image')
    expect(JSON.stringify(persisted)).toContain('pdfrect:1:')

    const restarted = await restartReader(application, { userData })
    application = restarted.application
    page = restarted.page
    await showLibrary(page); await expect(page.getByTestId('book-item').first()).toBeVisible()
    await page.getByTestId('book-item').first().click(); await enterReading(page)
    await expect(page.getByTestId('pdf-reader')).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('.source-card')).toContainText('PDF 第 1 页区域')
    await page.getByTestId('followup-input').fill('重启后还能看到这个区域吗？')
    await page.getByTestId('followup-input').press('Enter')
    await expect(page.getByTestId('answer-current')).toContainText('已收到图片区域。')
    await expect.poll(() => visualRequests.length).toBe(4)

    await page.getByTestId('assistant-expand-button').click()
    await page.getByTestId('assistant-dialog-tab-insights').click()
    await expect(page.getByTestId('insight-item')).toHaveCount(1)
    await page.getByTestId('insight-item').locator('.insight-content').click()
    await expect(page.locator('.assistant-dialog .source-card')).toContainText('PDF 第 1 页区域')
    await page.locator('.assistant-dialog .source-card button').click()
    await expect(page.locator('.pdf-region-overlay.is-temporary')).toHaveCount(1)
  } finally {
    await closeFixture(application, testRoot)
  }
})

test('keeps text-page image crops independent of zoom and handles cancel, small regions, and render errors', async () => {
  test.setTimeout(120_000)
  const { application, page, testRoot } = await openFixture(textPdf)
  try {
    await expect.poll(() => page.locator('.pdf-text-layer span').count()).toBeGreaterThan(0)
    await configureMockProvider(page)
    const button = page.getByTestId('pdf-image-region-select')
    const region = { left: 0.12, top: 0.16, right: 0.64, bottom: 0.36 }
    await button.click()
    await dragPdfRegion(page, region)
    const preview = page.getByTestId('pdf-image-region-review')
    await expect(preview).toBeVisible()
    const normalCrop = await preview.locator('img').getAttribute('src')
    expect(normalCrop).toMatch(/^data:image\/jpeg;base64,/u)
    const normalSize = await preview.locator('img').evaluate((image) => ({ width: (image as HTMLImageElement).naturalWidth, height: (image as HTMLImageElement).naturalHeight }))
    const visualDirectory = process.env.LLM_READER_VISUAL_DIR
    if (visualDirectory) {
      await mkdir(visualDirectory, { recursive: true })
      await preview.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined))) })
      await page.screenshot({ path: join(visualDirectory, 'pdf-image-review-light.png') })
    }
    await preview.getByRole('button', { name: '取消' }).last().click()
    await expect(preview).toHaveCount(0)
    await expect(page.getByTestId('selection-toolbar')).toHaveCount(0)

    await page.getByRole('button', { name: '放大', exact: true }).click()
    await page.getByRole('button', { name: '放大', exact: true }).click()
    await expect(page.getByTestId('pdf-zoom-value')).toHaveText('130%')
    await button.click()
    await dragPdfRegion(page, region)
    await expect(preview).toBeVisible()
    const zoomedSize = await preview.locator('img').evaluate((image) => ({ width: (image as HTMLImageElement).naturalWidth, height: (image as HTMLImageElement).naturalHeight }))
    expect(Math.abs(zoomedSize.width - normalSize.width)).toBeLessThanOrEqual(6)
    expect(Math.abs(zoomedSize.height - normalSize.height)).toBeLessThanOrEqual(6)
    await preview.getByRole('button', { name: '取消' }).last().click()
    await page.getByTestId('settings-button').click()
    await page.getByTestId('theme-dark').click()
    await page.getByTestId('settings-close').click()
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(940, 600))
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme', 'dark')
    await button.click()
    await dragPdfRegion(page, region)
    await expect(preview).toBeVisible()
    const bounds = await preview.boundingBox()
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.y).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height)
    if (visualDirectory) {
      await preview.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined))) })
      await page.screenshot({ path: join(visualDirectory, 'pdf-image-review-dark-narrow.png') })
    }
    await page.getByTestId('pdf-image-region-confirm').click()
    await expect(page.getByTestId('action-visual-ask')).toBeVisible()
    await page.getByTestId('action-visual-ask').click()
    await page.getByTestId('followup-input').fill('只说明框选区域里的图形。')
    await page.getByTestId('followup-input').press('Enter')
    await expect(page.getByTestId('answer-current')).toContainText('已收到图片区域。')
    await expect(page.locator('.source-card blockquote')).toHaveCount(0)
    await page.evaluate(() => {
      const original = HTMLCanvasElement.prototype.toDataURL
      ;(window as Window & { restoreCropExport?: () => void }).restoreCropExport = () => { HTMLCanvasElement.prototype.toDataURL = original }
      HTMLCanvasElement.prototype.toDataURL = () => { throw new Error('fixture render failure') }
    })
    await page.getByTestId('answer-regenerate').click()
    await expect(page.locator('.toast')).toContainText('无法生成所选区域的图片')
    await expect(page.getByTestId('answer-current')).toContainText('已收到图片区域。')
    await page.evaluate(() => (window as Window & { restoreCropExport?: () => void }).restoreCropExport?.())

    await page.getByTestId('followup-input').fill('FAIL_VISUAL')
    await page.getByTestId('followup-input').press('Enter')
    await expect(page.getByTestId('answer-current')).toContainText('当前问答模型可能不支持图片输入')
    await page.getByTestId('followup-input').fill('SLOW_VISUAL')
    await page.getByTestId('followup-input').press('Enter')
    await expect(page.getByTestId('cancel-request')).toBeVisible()
    await page.getByTestId('cancel-request').click()
    await expect(page.getByTestId('cancel-request')).toHaveCount(0)

    await button.click()
    await dragPdfRegion(page, { left: 0.2, top: 0.2, right: 0.205, bottom: 0.205 })
    await expect(page.locator('.toast')).toContainText('框选区域太小')
    await expect(preview).toHaveCount(0)
    const pageBounds = await page.locator('.pdf-page').first().boundingBox()
    if (!pageBounds) throw new Error('Expected a PDF page for outside-page drag')
    await page.mouse.move(pageBounds.x + pageBounds.width * 0.2, pageBounds.y + pageBounds.height * 0.2)
    await page.mouse.down()
    await page.mouse.move(pageBounds.x - 10, pageBounds.y + pageBounds.height * 0.3, { steps: 8 })
    await page.mouse.up()
    await expect(page.locator('.toast')).toContainText('请只在同一页内框选图片区域')
    await page.evaluate(() => {
      const original = HTMLCanvasElement.prototype.toDataURL
      ;(window as Window & { restoreCropExport?: () => void }).restoreCropExport = () => { HTMLCanvasElement.prototype.toDataURL = original }
      HTMLCanvasElement.prototype.toDataURL = () => { throw new Error('fixture render failure') }
    })
    await dragPdfRegion(page, region)
    await expect(page.locator('.toast')).toContainText('无法生成所选区域的图片')
    await page.evaluate(() => (window as Window & { restoreCropExport?: () => void }).restoreCropExport?.())
  } finally {
    await closeFixture(application, testRoot)
  }
})

test('shows a reader error for a structurally damaged PDF', async () => {
  test.setTimeout(90_000)
  const { application, page, testRoot } = await openFixture(damagedPdf)
  try {
    await expect(page.getByText('这本书暂时打不开')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText('无法打开 PDF，文件可能已损坏或受密码保护。')).toBeVisible()
  } finally {
    await closeFixture(application, testRoot)
  }
})

test('bounds canvas allocation while rendering and zooming an oversized PDF page', async () => {
  test.setTimeout(120_000)
  const { application, page, testRoot } = await openFixture(oversizedPdf)
  try {
    await expect(page.getByTestId('pdf-reader')).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('.pdf-page')).toHaveCount(1)
    const canvas = page.locator('.pdf-page-canvas').first()
    await expect.poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).height)).toBeGreaterThan(0)

    const initialMetrics = await page.locator('.pdf-page').evaluate((pageElement) => {
      const canvasElement = pageElement.querySelector<HTMLCanvasElement>('.pdf-page-canvas')
      if (!canvasElement) throw new Error('Expected an oversized PDF canvas')
      return {
        canvasWidth: canvasElement.width,
        canvasHeight: canvasElement.height,
        cssHeight: Number.parseFloat((pageElement as HTMLElement).style.height)
      }
    })
    expect(initialMetrics.cssHeight).toBeGreaterThan(3_000)
    expect(Math.max(initialMetrics.canvasWidth, initialMetrics.canvasHeight)).toBeLessThanOrEqual(8_192)
    expect(initialMetrics.canvasWidth * initialMetrics.canvasHeight).toBeLessThanOrEqual(36_000_000)

    await page.getByTestId('reader-search-button').click()
    await page.getByTestId('reader-search-input').fill('超大页面边界测试')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('reader-search-result')).toHaveCount(1)

    const zoomIn = page.getByRole('button', { name: '放大', exact: true })
    for (let index = 0; index < 10; index += 1) await zoomIn.click()
    await expect(page.getByTestId('pdf-zoom-value')).toHaveText('250%')
    await expect.poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).height)).toBeGreaterThan(0)
    const zoomedMetrics = await canvas.evaluate((element) => ({
      width: (element as HTMLCanvasElement).width,
      height: (element as HTMLCanvasElement).height
    }))
    expect(Math.max(zoomedMetrics.width, zoomedMetrics.height)).toBeLessThanOrEqual(8_192)
    expect(zoomedMetrics.width * zoomedMetrics.height).toBeLessThanOrEqual(36_000_000)
    await expect(page.getByTestId('pdf-reader')).toBeVisible()
  } finally {
    await closeFixture(application, testRoot)
  }
})

test('does not expose PDF JavaScript, attachments, forms, external links or launch actions', async () => {
  test.setTimeout(120_000)
  const fixtureBytes = (await readFile(hostilePdf)).toString('latin1')
  for (const marker of ['/JavaScript', '/EmbeddedFiles', '/AcroForm', '/URI', '/Launch']) {
    expect(fixtureBytes).toContain(marker)
  }

  const { application, page, testRoot } = await openFixture(hostilePdf)
  try {
    await expect(page.getByTestId('pdf-reader')).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('.pdf-page')).toHaveCount(2)
    await expect.poll(() => page.locator('.pdf-page-canvas').first().evaluate((canvas) => (
      (canvas as HTMLCanvasElement).width
    ))).toBeGreaterThan(0)

    await expect(page.locator('.pdf-internal-link')).toHaveCount(1)
    await expect(page.locator('.pdf-link-layer').first().locator(':scope > *')).toHaveCount(1)
    await expect(page.locator('.pdf-reader').locator('a, input, select, textarea, iframe, object, embed')).toHaveCount(0)
    await expect(page.getByText('BLOCKED_FORM_FIELD', { exact: true })).toHaveCount(0)
    expect(application.windows()).toHaveLength(1)

    const internalLink = page.locator('.pdf-internal-link')
    await expect(internalLink).toHaveAttribute('data-target-page', '2')
    await internalLink.evaluate((button) => (button as HTMLButtonElement).click())
    await expect.poll(() => page.getByTestId('reader-host').evaluate((host) => {
      const target = host.querySelector<HTMLElement>('.pdf-page[data-page-number="2"]')
      if (!target) return false
      const hostRect = host.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      return targetRect.top < hostRect.bottom && targetRect.bottom > hostRect.top
    })).toBe(true)
    expect(application.windows()).toHaveLength(1)
  } finally {
    await closeFixture(application, testRoot)
  }
})

test('rejects a cross-page PDF selection without producing a reader selection', async () => {
  test.setTimeout(120_000)
  const { application, page, testRoot } = await openFixture(textPdf)
  try {
    await expect(page.getByTestId('pdf-reader')).toBeVisible({ timeout: 60_000 })
    await page.getByTestId('reader-host').evaluate((host) => {
      const pageTwo = host.querySelector<HTMLElement>('.pdf-page[data-page-number="2"]')
      if (!pageTwo) throw new Error('Expected PDF page 2')
      host.scrollTop = pageTwo.offsetTop
      host.dispatchEvent(new Event('scroll'))
    })
    await expect.poll(() => page.locator('.pdf-text-layer[data-page-number="2"] span').count()).toBeGreaterThan(0)
    // 上一页的文本层可能比当前页后渲染，两页就绪后再构造跨页选区。
    await expect.poll(() => page.locator('.pdf-text-layer[data-page-number="1"] span').count()).toBeGreaterThan(0)

    const rangeCountAfterSelection = await page.getByTestId('reader-host').evaluate(() => {
      const startSpan = document.querySelector<HTMLElement>('.pdf-text-layer[data-page-number="1"] span')
      const endSpan = document.querySelector<HTMLElement>('.pdf-text-layer[data-page-number="2"] span')
      const startNode = startSpan?.firstChild
      const endNode = endSpan?.firstChild
      if (!startNode || !endNode) throw new Error('Expected text nodes on adjacent PDF pages')
      const range = document.createRange()
      range.setStart(startNode, 0)
      range.setEnd(endNode, endNode.textContent?.length ?? 0)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      return selection?.rangeCount ?? -1
    })
    expect(rangeCountAfterSelection).toBe(0)
    await expect(page.getByTestId('selection-toolbar')).toBeHidden()
  } finally {
    await closeFixture(application, testRoot)
  }
})
