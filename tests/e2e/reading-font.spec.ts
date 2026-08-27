import {
  expect,
  test,
  type ElectronApplication
} from '@playwright/test'
import { resolve } from 'node:path'
import {
  cleanupE2eWorkspace,
  createE2eWorkspace,
  launchReader,
  restartReader
} from './support/electron-app'

test('picks a reading font from installed system fonts and persists it across restarts', async () => {
  const workspace = await createE2eWorkspace('llm-reader-font-e2e-')
  const fixture = resolve('tests/fixtures/complex-reading.txt')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const { page } = launched

    await page.getByTestId('book-item').first().click()
    await expect(page.getByTestId('reader-host')).toContainText('复杂概念')

    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-reading').click()

    const fontSelect = page.getByTestId('reading-font-family')
    await expect(fontSelect).toHaveValue('')

    // The main process enumerates installed fonts via PowerShell; wait until they arrive.
    await expect
      .poll(() => fontSelect.locator('optgroup').count(), { timeout: 15_000 })
      .toBeGreaterThan(0)

    const chosen = await fontSelect.evaluate((select) => {
      const firstOption = select.querySelector<HTMLOptionElement>('optgroup option')
      return firstOption?.value ?? ''
    })
    expect(chosen).not.toBe('')
    await fontSelect.selectOption(chosen)
    await expect(fontSelect).toHaveValue(chosen)

    const txtDocument = page.locator('.reader-document--txt')
    await expect
      .poll(() =>
        txtDocument.evaluate(
          (element) => getComputedStyle(element).fontFamily.replace(/['"]/gu, '')
        )
      )
      .toContain(chosen)

    await page.getByTestId('settings-close').click()
    await expect(page.getByTestId('settings-modal')).toHaveCount(0)

    // The selection must survive a restart via localStorage.
    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application
    const restoredPage = restarted.page
    await restoredPage.getByTestId('book-item').first().click()
    await expect(restoredPage.getByTestId('reader-host')).toContainText('复杂概念')
    await expect
      .poll(() =>
        restoredPage
          .locator('.reader-document--txt')
          .evaluate((element) =>
            getComputedStyle(element).fontFamily.replace(/['"]/gu, '')
          )
      )
      .toContain(chosen)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
