import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { access } from 'node:fs/promises'
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

    const iconFileName = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
    const iconLoadsInElectron = await application.evaluate(({ nativeImage }, iconPath) => !nativeImage.createFromPath(iconPath).isEmpty(), resolve('resources', iconFileName))
    expect(iconLoadsInElectron).toBe(true)

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

test('disposes a test profile even when its close acknowledgement is blocked', async () => {
  const workspace = await createE2eWorkspace('llm-reader-window-disposal-')
  const { application, page } = await launchReader({ userData: workspace.userData })
  const electronProcess = application.process()
  try {
    await expect(page.getByTestId('app-shell')).toBeVisible()
    await application.evaluate(({ BrowserWindow, ipcMain }) => {
      const fixture = globalThis as typeof globalThis & { blockedCloseAcknowledgements: number }
      fixture.blockedCloseAcknowledgements = 0
      ipcMain.removeHandler('app:close-ready')
      ipcMain.handle('app:close-ready', () => { fixture.blockedCloseAcknowledgements++ })
      BrowserWindow.getAllWindows()[0].close()
    })
    await expect.poll(() => application.evaluate(() => (
      globalThis as typeof globalThis & { blockedCloseAcknowledgements: number }
    ).blockedCloseAcknowledgements)).toBe(1)
    // The production guard must still leave the window open without approval.
    expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    let disposed = false
    const cleanup = cleanupE2eWorkspace(application, workspace.root).then(() => { disposed = true })
    await expect.poll(() => disposed, { timeout: 10_000 }).toBe(true)
    await cleanup
    expect(electronProcess.exitCode).not.toBeNull()
    await expect(access(workspace.root)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
