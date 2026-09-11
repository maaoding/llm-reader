import { expect, type ElectronApplication, type Page } from '@playwright/test'

export async function resizeWorkspace(application: ElectronApplication, page: Page, width: number, height: number): Promise<void> {
  const wasCompact = await page.evaluate(() => innerWidth < 1180)
  await application.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.unmaximize()
    window.setSize(size[0], size[1])
  }, [width, height])
  // setSize resolves before Windows delivers the renderer resize and media-query events.
  await expect.poll(() => page.evaluate(([w, h]) => Math.abs(innerWidth - w) <= 2 && Math.abs(innerHeight - h) <= 2, [width, height])).toBe(true)
  if (wasCompact !== (width < 1180)) {
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-assistant-visible', String(width >= 1180))
  }
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

export async function showLibrary(page: Page): Promise<void> {
  await expect(page.locator('.workspace-shell')).toHaveAttribute('data-workspace-ready', 'true')
  await page.getByTestId('nav-library').click()
}

export async function enterReading(page: Page): Promise<void> {
  await page.getByTestId('workspace-tab-reading').click()
  await expect(page.locator('.workspace-shell')).toHaveAttribute('data-page', 'reading')
}

export async function showAssistant(page: Page): Promise<void> {
  if (await page.locator('.right-sidebar').isVisible()) return
  await page.getByTestId('workspace-tab-conversation').click()
  await expect(page.getByTestId('assistant-dialog')).toBeVisible()
}

export async function showReferences(page: Page): Promise<void> {
  const references = page.locator('.answer-sources').last()
  if (await references.getAttribute('open') === null) await references.locator('summary').click()
}

export async function showPreparation(page: Page): Promise<void> {
  if (!await page.getByTestId('book-preparation-dialog').isVisible()) await page.getByTestId('workspace-prepare').click()
}

export async function hidePreparation(page: Page): Promise<void> {
  if (await page.getByTestId('book-preparation-dialog').isVisible()) await page.getByTestId('preparation-close').click()
}

export async function togglePreparation(page: Page): Promise<void> {
  if (await page.getByTestId('book-preparation-dialog').isVisible()) await page.getByTestId('preparation-close').click()
  else await page.getByTestId('workspace-prepare').click()
}

export async function showContents(page: Page): Promise<void> {
  await enterReading(page)
  if (await page.getByTestId('reader-contents-button').getAttribute('aria-pressed') !== 'true') await page.getByTestId('reader-contents-button').click()
}
