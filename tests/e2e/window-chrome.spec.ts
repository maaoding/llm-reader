import { expect, test, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('uses a frameless window with working window controls', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'llm-reader-window-chrome-'))
  const application = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      LLM_READER_USER_DATA: userData
    }
  })

  try {
    const page = await application.firstWindow()
    const controls = page.locator('.window-controls')
    const maximizeButton = page.getByTestId('window-toggle-maximize')

    await expect(page.getByTestId('app-shell')).toBeVisible()
    await expect(controls).toBeVisible()
    await expect(page.getByTestId('window-minimize')).toBeVisible()
    await expect(maximizeButton).toBeVisible()
    await expect(page.getByTestId('window-close')).toBeVisible()

    // A frameless window has no native caption area above the web contents.
    const chromeInset = await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      const bounds = window.getBounds()
      const content = window.getContentBounds()
      return content.y - bounds.y
    })
    expect(chromeInset).toBeLessThan(2)

    const isMaximized = (): Promise<boolean> =>
      application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())

    await expect.poll(isMaximized).toBe(false)
    await expect(maximizeButton).toHaveAttribute('aria-label', '最大化')

    await maximizeButton.click()
    await expect.poll(isMaximized).toBe(true)
    await expect(maximizeButton).toHaveAttribute('aria-label', '还原')

    await maximizeButton.click()
    await expect.poll(isMaximized).toBe(false)
    await expect(maximizeButton).toHaveAttribute('aria-label', '最大化')
  } finally {
    await application.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
})
