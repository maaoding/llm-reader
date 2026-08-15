import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication
} from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { join } from 'node:path'

test('picks a reading font from installed system fonts and persists it across restarts', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'llm-reader-font-e2e-'))
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
    if (application) await application.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
})
