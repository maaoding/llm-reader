import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const textPdf = resolve('tests/e2e/fixtures/text-reader.pdf')
const scannedPdf = resolve('tests/e2e/fixtures/scanned-reader.pdf')
const damagedPdf = resolve('tests/e2e/fixtures/damaged-reader.pdf')

async function openFixture(fixture: string): Promise<{
  application: ElectronApplication
  page: Page
  testRoot: string
}> {
  const testRoot = await mkdtemp(join(tmpdir(), 'llm-reader-pdf-'))
  const application = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      LLM_READER_USER_DATA: join(testRoot, 'profile'),
      LLM_READER_E2E_IMPORT: fixture
    }
  })
  const page = await application.firstWindow()
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`[renderer] ${message.text()}`)
  })
  page.on('pageerror', (error) => console.error(`[renderer-pageerror] ${error.message}`))
  await expect(page.getByTestId('book-item').first()).toBeVisible()
  await page.getByTestId('book-item').first().click()
  return { application, page, testRoot }
}

async function closeFixture(application: ElectronApplication | undefined, testRoot: string): Promise<void> {
  await application?.close().catch(() => undefined)
  await rm(testRoot, { recursive: true, force: true })
}

test('reads, searches, selects, zooms and follows only internal links in a text PDF', async () => {
  test.setTimeout(120_000)
  const opened = await openFixture(textPdf)
  let application = opened.application
  let page = opened.page
  const { testRoot } = opened
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
    await page.waitForTimeout(800)

    await application.close()
    application = await electron.launch({
      args: ['.'],
      env: { ...process.env, LLM_READER_USER_DATA: join(testRoot, 'profile') }
    })
    page = await application.firstWindow()
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
