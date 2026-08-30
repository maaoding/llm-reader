import {
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { join, resolve } from 'node:path'
import { createNestedEpubFixture } from './fixtures/nested-epub'
import {
  cleanupE2eWorkspace,
  createE2eWorkspace,
  launchReader,
  restartReader
} from './support/electron-app'

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

async function hasPersistentTxtHighlight(page: Page): Promise<boolean> {
  return page.getByTestId('reader-host').evaluate((host) => {
    const highlights = (window as unknown as { CSS?: { highlights?: { has?: (name: string) => boolean } } }).CSS?.highlights
    if (highlights?.has?.('llm-reader-persistent')) return true
    return Boolean(host.querySelector('.llm-reader-persistent-fallback'))
  })
}

test('saves TXT sentence highlights, keeps the tab on one line, restores the natural position and persists paper theme', async () => {
  test.setTimeout(90_000)
  const workspace = await createE2eWorkspace('llm-reader-txt-highlights-')
  const fixture = resolve('tests/fixtures/complex-reading.txt')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const { page } = launched
    await page.getByTestId('book-item').first().click()
    await expect(page.getByTestId('reader-host')).toContainText('理解一个复杂概念')

    const firstParagraph = page.getByTestId('reader-host').locator('p').first()
    await selectNodeContents(firstParagraph)
    await expect(page.getByTestId('selection-toolbar')).toBeVisible()
    await page.getByTestId('action-save-highlight').click()
    await expect(page.getByRole('status').last()).toContainText('已收藏句段')
    await expect.poll(() => hasPersistentTxtHighlight(page)).toBe(true)

    const highlightsTab = page.getByTestId('highlights-tab')
    await highlightsTab.click()
    await expect(highlightsTab.locator('span')).toHaveCount(0)
    const tabFits = await highlightsTab.evaluate((element) => element.scrollWidth <= element.clientWidth)
    expect(tabFits).toBe(true)
    await expect(page.getByTestId('highlight-list')).toContainText('收藏 · 1')
    await expect(page.getByTestId('highlight-item')).toHaveCount(1)
    await page.locator('.highlight-jump').click()
    await expect(page.getByTestId('selection-toolbar')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('selection-toolbar')).toHaveCount(0)

    // Scroll naturally, then jump via TOC and return to the natural position.
    const host = page.getByTestId('reader-host')
    await host.evaluate((element) => element.dispatchEvent(new WheelEvent('wheel', { deltaY: 600, bubbles: true })))
    await host.evaluate((element) => {
      element.scrollTop = Math.min(element.scrollHeight, 640)
    })
    await page.waitForTimeout(250)
    const naturalScrollTop = await host.evaluate((element) => element.scrollTop)
    expect(naturalScrollTop).toBeGreaterThan(0)
    await expect
      .poll(async () => Number.parseInt((await page.locator('.reading-progress').locator('strong').textContent()) ?? '0', 10))
      .toBeGreaterThan(0)
    await expect
      .poll(async () => Number.parseInt((await page.locator('.reading-progress').locator('strong').textContent()) ?? '0', 10))
      .toBeLessThan(100)

    await page.getByRole('button', { name: '目录', exact: true }).click()
    await page.locator('[data-testid="toc-item"][data-current="true"]').click()
    const returnButton = page.getByTestId('reader-return-button')
    await expect(returnButton).toBeEnabled()
    await page.waitForTimeout(250)
    await expect(returnButton).toBeEnabled()
    await returnButton.click()
    await expect
      .poll(() => host.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(naturalScrollTop - 96)

    // The header shows the current chapter name with a live chapter progress value.
    await expect(page.locator('.reading-progress').locator('span')).toHaveText('全文')
    await expect(page.locator('.reading-progress').locator('strong')).toContainText(/%$/)
    await expect(page.locator('[data-testid="toc-item"][data-current="true"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="toc-item"][data-current="true"]')).toContainText('全文')

    // The paper theme remains independent and persists across restart.
    await page.getByTestId('reader-settings-button').click()
    await page.getByTestId('settings-nav-reading').click()
    await page.getByTestId('reading-paper-theme').selectOption('sepia')
    await expect(page.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'sepia')
    await page.getByTestId('settings-close').click()
    await expect
      .poll(() =>
        page.locator('.reader-document--txt').evaluate((element) => getComputedStyle(element).backgroundColor)
      )
      .toBe('rgb(246, 236, 216)')

    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application
    const restored = restarted.page
    await restored.getByTestId('book-item').first().click()
    await expect(restored.getByTestId('reader-host')).toContainText('理解一个复杂概念')
    await expect
      .poll(() =>
        restored.locator('.reader-document--txt').evaluate((element) => getComputedStyle(element).backgroundColor)
      )
      .toBe('rgb(246, 236, 216)')
    await restored.getByTestId('highlights-tab').click()
    await expect(restored.getByTestId('highlight-item')).toHaveCount(1)
    await expect.poll(() => hasPersistentTxtHighlight(restored)).toBe(true)

    await restored.getByTestId('highlight-delete').click()
    await restored.getByTestId('highlight-delete-confirm').click()
    await expect(restored.getByTestId('highlight-item')).toHaveCount(0)
    await expect.poll(() => hasPersistentTxtHighlight(restored)).toBe(false)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('saves EPUB sentence highlights, reapplies them after chapter reload and removes them on delete', async () => {
  test.setTimeout(90_000)
  const workspace = await createE2eWorkspace('llm-reader-epub-highlights-')
  const fixture = join(workspace.root, 'nested-highlights.epub')
  await createNestedEpubFixture(fixture)
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const { page } = launched
    await page.getByTestId('book-item').first().click()
    await expect(page.locator('[data-testid="toc-item"][data-current="true"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="toc-item"][data-current="true"]')).toContainText('第一部')
    const iframe = page.getByTestId('reader-host').locator('iframe').first()
    await expect(iframe).not.toHaveCount(0)
    const frame = iframe.contentFrame()
    if (!frame) throw new Error('EPUB iframe did not expose a content frame')

    const chapterOneParagraph = frame.locator('p').first()
    await selectNodeContents(chapterOneParagraph)
    await expect(page.getByTestId('selection-toolbar')).toBeVisible()
    await page.getByTestId('action-save-highlight').click()
    await expect(page.getByRole('status').last()).toContainText('已收藏句段')

    await page.getByTestId('highlights-tab').click()
    await expect(page.getByTestId('highlight-item')).toHaveCount(1)
    await expect(page.getByTestId('reader-host').locator('.llm-reader-persistent-highlight')).not.toHaveCount(0)
    await page.locator('.highlight-jump').click()
    await expect(page.getByTestId('selection-toolbar')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('selection-toolbar')).toHaveCount(0)

    // Jump to chapter 2 and back so chapter 1 is loaded again.
    await page.getByRole('button', { name: '目录', exact: true }).click()
    await page.getByTestId('toc-item').filter({ hasText: '第二章' }).click()
    await expect(page.getByTestId('reader-host').locator('iframe')).not.toHaveCount(0)
    await expect(page.locator('[data-testid="toc-item"][data-current="true"]')).toContainText('第二章')
    await page.getByTestId('toc-item').filter({ hasText: '第一部' }).first().click()
    await expect.poll(() => page.getByTestId('reader-host').locator('iframe').count()).toBeGreaterThan(0)
    await expect
      .poll(() => page.getByTestId('reader-host').locator('.llm-reader-persistent-highlight').count())
      .toBeGreaterThan(0)

    await page.getByTestId('highlights-tab').click()
    await page.getByTestId('highlight-delete').click()
    await page.getByTestId('highlight-delete-confirm').click()
    await expect(page.getByTestId('highlight-item')).toHaveCount(0)
    await expect
      .poll(() => page.getByTestId('reader-host').locator('.llm-reader-persistent-highlight').count())
      .toBe(0)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
