import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  cleanupE2eWorkspace,
  createE2eWorkspace,
  launchReader,
  restartReader
} from './support/electron-app'

const textPdf = resolve('tests/e2e/fixtures/text-reader.pdf')
const scannedPdf = resolve('tests/e2e/fixtures/scanned-reader.pdf')
const damagedPdf = resolve('tests/e2e/fixtures/damaged-reader.pdf')
const oversizedPdf = resolve('tests/e2e/fixtures/oversized-reader.pdf')
const hostilePdf = resolve('tests/e2e/fixtures/hostile-reader.pdf')

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
  await expect(page.getByTestId('book-item').first()).toBeVisible()
  await page.getByTestId('book-item').first().click()
  return { application, page, testRoot: workspace.root, userData: workspace.userData }
}

async function closeFixture(application: ElectronApplication | undefined, testRoot: string): Promise<void> {
  await cleanupE2eWorkspace(application, testRoot)
}

test('reads, searches, selects, zooms and follows only internal links in a text PDF', async () => {
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
    await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '第 1 页')
    await expect(page.getByTestId('toc-item')).toHaveCount(3)

    const visualDirectory = process.env.LLM_READER_VISUAL_DIR
    if (visualDirectory) {
      await mkdir(visualDirectory, { recursive: true })
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))
      await page.screenshot({ path: join(visualDirectory, 'pdf-reader-light-1440x900.png') })
      await page.getByTestId('settings-button').click()
      await page.getByTestId('theme-dark').click()
      await page.getByTestId('scale-125').click()
      await page.getByTestId('settings-close').click()
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(940, 600))
      await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme', 'dark')
      await expect(page.getByTestId('app-shell')).toHaveAttribute('data-interface-scale', '125')
      await page.screenshot({ path: join(visualDirectory, 'pdf-reader-dark-940x600-125.png') })
      await page.getByTestId('settings-button').click()
      await page.getByTestId('theme-light').click()
      await page.getByTestId('scale-100').click()
      await page.getByTestId('settings-close').click()
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))
    }

    await page.getByRole('button', { name: '放大', exact: true }).click()
    await expect(page.getByTestId('pdf-zoom-value')).toHaveText('115%')
    await page.getByRole('button', { name: '适合宽度', exact: true }).click()
    await expect(page.getByTestId('pdf-zoom-value')).toHaveText('100%')

    await page.keyboard.press('Control+f')
    await page.getByTestId('reader-search-input').fill('星河')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('reader-search-result')).toHaveCount(13)
    await page.getByTestId('reader-search-result').last().click()
    await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '第 2 页')
    await expect.poll(() => page.evaluate(() => (
      (CSS as typeof CSS & { highlights?: Map<string, unknown> }).highlights?.has('llm-reader-pdf-temporary') ?? false
    ))).toBe(true)

    await page.getByRole('button', { name: '目录', exact: true }).click()
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
    await expect(page.getByTestId('selection-toolbar')).toBeVisible()

    await page.getByTestId('reader-host').evaluate((host) => {
      const pageTwo = host.querySelector<HTMLElement>('.pdf-page[data-page-number="2"]')
      if (!pageTwo) throw new Error('Expected PDF page 2')
      host.scrollTop = pageTwo.offsetTop + Math.min(120, pageTwo.offsetHeight / 4)
      host.dispatchEvent(new Event('scroll'))
    })
    await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '第 2 页')
    await expect.poll(async () => {
      const books = await page.evaluate(() => (
        window as unknown as {
          readerApi: { listBooks(): Promise<Array<{ lastLocator: string | null }>> }
        }
      ).readerApi.listBooks())
      return books[0]?.lastLocator ?? null
    }).toMatch(/^pdf:2:/u)

    const restarted = await restartReader(application, { userData })
    application = restarted.application
    page = restarted.page
    await expect(page.getByTestId('book-item').first()).toBeVisible()
    await page.getByTestId('book-item').first().click()
    await expect(page.getByTestId('pdf-reader')).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '第 2 页')
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
