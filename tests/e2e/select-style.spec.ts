import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader } from './support/electron-app'
import { resizeWorkspace } from './support/workspace'

async function expectStyledSelects(page: Page): Promise<void> {
  const controls = page.locator('select:visible')
  expect(await controls.count()).toBeGreaterThan(0)
  for (const control of await controls.all()) {
    await expect(control).toHaveCSS('appearance', 'base-select')
  }
}

test('styles native dropdowns across settings and keeps keyboard dismissal inside the picker', async () => {
  const workspace = await createE2eWorkspace('llm-reader-selects-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: resolve('tests/fixtures/complex-reading.txt') })
    application = launched.application
    const page = launched.page
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-workspace-ready', 'true')
    await page.getByTestId('book-item').click()
    await page.getByTestId('settings-button').click()
    for (const theme of ['light', 'dark'] as const) {
      await resizeWorkspace(application, page, theme === 'light' ? 1180 : 940, theme === 'light' ? 800 : 600)
      await page.getByTestId('settings-nav-appearance').click()
      await page.getByTestId(`theme-${theme}`).click()
      await page.getByTestId(theme === 'light' ? 'scale-100' : 'scale-125').click()
      await page.getByTestId('settings-nav-reading').click()
      await expectStyledSelects(page)
      const font = page.getByTestId('reading-font-family')
      await expect(font.locator('optgroup')).not.toHaveCount(0)
      await font.click()
      await expect.poll(() => font.evaluate((element) => element.matches(':open'))).toBe(true)
      await page.screenshot({ path: test.info().outputPath(`font-menu-${theme}.png`), scale: 'css', animations: 'disabled' })
      await page.keyboard.press('Escape')
      await expect.poll(() => font.evaluate((element) => element.matches(':open'))).toBe(false)
      await expect(page.getByTestId('settings-close')).toBeVisible()
      await expect(font).toBeFocused()
    }
    const lineHeight = page.getByTestId('reading-line-height')
    await lineHeight.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await expect(lineHeight).toHaveValue('1.9')
    await lineHeight.click()
    await lineHeight.locator('option[value="1.7"]').click()
    await expect(lineHeight).toHaveValue('1.7')
    await lineHeight.click()
    await page.keyboard.press('Tab')
    await expect.poll(() => lineHeight.evaluate((element) => element.matches(':open'))).toBe(false)
    await expect(page.getByTestId('settings-close')).toBeVisible()

    for (const section of ['model', 'assistant', 'persona']) {
      await page.getByTestId(`settings-nav-${section}`).click()
      await expectStyledSelects(page)
    }
    await page.getByTestId('settings-nav-knowledge').click()
    await page.getByTestId('document-config').locator('summary').click()
    await expectStyledSelects(page)
    const processor = page.getByTestId('document-processor')
    await processor.click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Enter')
    await expect(processor).toHaveValue('mineru-local')
    await expect(processor.locator('option[value="none"]')).toBeDisabled()
    await expectStyledSelects(page)
    await processor.click()
    await page.screenshot({ path: test.info().outputPath('processor-menu-dark-125.png'), scale: 'css', animations: 'disabled' })
    await page.keyboard.press('Escape')
    await processor.selectOption('vision')
    await expectStyledSelects(page)
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByTestId('settings-close').click()
  } finally { await cleanupE2eWorkspace(application, workspace.root) }
})
