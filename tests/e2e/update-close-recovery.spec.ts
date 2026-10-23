import { expect, test, type ElectronApplication } from '@playwright/test'
import { resolve } from 'node:path'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader } from './support/electron-app'
import { enterReading, resizeWorkspace, showLibrary } from './support/workspace'

interface UpdateFailureFixture {
  installs: number
  quitPrevented: boolean
  publishDownload: () => void
  fail: () => void
}
type UpdateFailureGlobal = typeof globalThis & { updateFailureFixture: UpdateFailureFixture }

async function configureUpdateFailure(application: ElectronApplication, delayed: boolean): Promise<void> {
  await application.evaluate(({ app }, deferFailure) => {
    const requireForApp = process.getBuiltinModule('module').createRequire(`${app.getAppPath()}/package.json`)
    const { autoUpdater } = requireForApp('electron-updater') as typeof import('electron-updater')
    const fixture: UpdateFailureFixture = {
      installs: 0,
      quitPrevented: false,
      publishDownload: () => { autoUpdater.emit('update-downloaded', {
        version: '9.9.9-synthetic', downloadedFile: '', files: [], path: 'synthetic-update.exe',
        sha512: 'synthetic-not-downloaded', releaseDate: '2026-10-23T00:00:00Z'
      }) },
      fail: () => {
        // Model BaseUpdater's already queued quit, without starting an installer.
        fixture.quitPrevented = false
        setImmediate(() => app.quit())
        autoUpdater.emit('error', new Error('Synthetic delayed installer failure'))
      }
    }
    ;(globalThis as UpdateFailureGlobal).updateFailureFixture = fixture
    app.on('before-quit', (event) => {
      queueMicrotask(() => { fixture.quitPrevented = event.defaultPrevented })
    })
    if (deferFailure) autoUpdater.quitAndInstall = () => { fixture.installs++ }
    // Otherwise keep the actual quitAndInstall implementation: no download has
    // occurred, so BaseUpdater emits its missing-installer error synchronously.
  }, delayed)
}

test('recovers from the real updater missing-installer error and saves later edits on normal exit', async () => {
  const workspace = await createE2eWorkspace('llm-reader-update-error-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: resolve('tests/fixtures/complex-reading.txt') })
    application = launched.application
    let page = launched.page
    await showLibrary(page)
    await page.getByTestId('book-item').click()
    await enterReading(page)
    const draft = page.locator('.right-sidebar [data-testid="followup-input"]')
    await draft.fill('安装失败前的草稿')
    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-about').click()
    await expect(page.getByTestId('update-status')).toBeVisible()
    await configureUpdateFailure(application, false)
    await application.evaluate(() => (globalThis as UpdateFailureGlobal).updateFailureFixture.publishDownload())
    await expect(page.getByTestId('update-action-button')).toHaveText('重启并安装')
    await page.getByTestId('update-action-button').click()
    await expect.poll(() => page.evaluate(() => window.readerApi.getAppUpdatePhase())).toEqual({ status: 'error' })
    await expect(page.getByTestId('session-close-saving')).toHaveCount(0)
    await expect(page.getByTestId('app-shell')).not.toHaveAttribute('inert', '')
    await page.getByTestId('settings-close').click()
    await expect(draft).toHaveValue('安装失败前的草稿')
    await draft.fill('安装失败后继续编辑，再正常退出')
    const closed = page.waitForEvent('close')
    await page.getByTestId('window-close').click()
    await closed
    await application.close().catch(() => undefined)
    application = undefined
    const restarted = await launchReader({ userData: workspace.userData })
    application = restarted.application
    page = restarted.page
    await expect(page.locator('.right-sidebar [data-testid="followup-input"]')).toHaveValue('安装失败后继续编辑，再正常退出')
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('styles the pending close across themes and scales and recovers from delayed installation errors', async () => {
  test.setTimeout(180_000)
  const testInfo = test.info()
  const workspace = await createE2eWorkspace('llm-reader-close-appearance-')
  let { application, page } = await launchReader({ userData: workspace.userData })
  try {
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-workspace-ready', 'true')
    await configureUpdateFailure(application, true)
    for (const theme of ['light', 'dark']) for (const width of [1180, 940]) for (const scale of [90, 100, 110, 125]) {
      await resizeWorkspace(application, page, width, width === 940 ? 600 : 760)
      await page.getByTestId('settings-button').click()
      await page.getByTestId(`theme-${theme}`).click()
      await page.getByTestId(`scale-${scale}`).click()
      await page.getByTestId('settings-nav-about').click()
      await expect(page.getByTestId('update-status')).toBeVisible()
      await application.evaluate(() => (globalThis as UpdateFailureGlobal).updateFailureFixture.publishDownload())
      await expect(page.getByTestId('update-action-button')).toHaveText('重启并安装')
      await page.getByTestId('update-action-button').click()
      await expect.poll(() => application.evaluate(() => (globalThis as UpdateFailureGlobal).updateFailureFixture.installs)).toBe(1)
      const overlay = page.getByTestId('session-close-saving')
      await expect(overlay).toBeVisible()
      await expect(page.getByTestId('app-shell')).toHaveAttribute('inert', '')
      const appearance = await overlay.evaluate((element) => {
        const style = getComputedStyle(element)
        const shellStyle = getComputedStyle(document.querySelector('[data-testid="app-shell"]')!)
        const colorProbe = document.createElement('span')
        colorProbe.style.backgroundColor = 'color-mix(in srgb, var(--ui-bg) 92%, transparent)'
        element.append(colorProbe)
        const expectedBackground = getComputedStyle(colorProbe).backgroundColor
        colorProbe.remove()
        const bounds = element.getBoundingClientRect()
        return { color: style.color, expectedColor: shellStyle.color, background: style.backgroundColor, expectedBackground,
          fontSize: parseFloat(style.fontSize), baseSize: parseFloat(style.getPropertyValue('--ui-text-size')),
          width: bounds.width, height: bounds.height, viewportWidth: innerWidth, viewportHeight: innerHeight }
      })
      expect(appearance.color).toBe(appearance.expectedColor)
      expect(appearance.background).toBe(appearance.expectedBackground)
      expect(appearance.fontSize).toBeCloseTo(appearance.baseSize * scale / 100)
      // Windows display scaling can expose fractional CSS bounds while innerWidth/Height are integers.
      expect(Math.abs(appearance.width - appearance.viewportWidth)).toBeLessThan(1)
      expect(Math.abs(appearance.height - appearance.viewportHeight)).toBeLessThan(1)
      if (scale === 125) await page.screenshot({ path: testInfo.outputPath(`close-${theme}-${width}-${scale}.png`) })
      await application.evaluate(() => (globalThis as UpdateFailureGlobal).updateFailureFixture.fail())
      await expect.poll(() => application.evaluate(() => (globalThis as UpdateFailureGlobal).updateFailureFixture.quitPrevented)).toBe(true)
      await expect(page.getByTestId('session-close-saving')).toHaveCount(0)
      await expect(page.getByTestId('app-shell')).not.toHaveAttribute('inert', '')
      await expect.poll(() => page.evaluate(() => window.readerApi.getAppUpdatePhase())).toEqual({ status: 'installError' })
      await expect(page.getByTestId('update-status')).toContainText('退出并重新打开应用后重试更新')
      await expect(page.getByTestId('update-action-button')).toBeDisabled()
      await expect(page.evaluate(() => window.readerApi.checkForAppUpdate())).resolves.toEqual({ status: 'installError' })
      await page.getByTestId('settings-close').click()
      await page.getByTestId('nav-archives').click()
      await expect(page.getByTestId('app-shell')).toHaveAttribute('data-page', 'archives')
      const closed = page.waitForEvent('close')
      await page.getByTestId('window-close').click()
      await closed
      await application.close().catch(() => undefined)
      const restarted = await launchReader({ userData: workspace.userData })
      application = restarted.application
      page = restarted.page
      await expect(page.getByTestId('app-shell')).toHaveAttribute('data-workspace-ready', 'true')
      await expect.poll(() => page.evaluate(() => window.readerApi.getAppUpdatePhase())).toEqual({ status: 'idle' })
      await configureUpdateFailure(application, true)
    }
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
