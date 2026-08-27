import { expect, test } from '@playwright/test'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader } from './support/electron-app'

test('uses a frameless window with working window controls', async () => {
  const workspace = await createE2eWorkspace('llm-reader-window-chrome-')
  const { application, page } = await launchReader({ userData: workspace.userData })

  try {
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
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
