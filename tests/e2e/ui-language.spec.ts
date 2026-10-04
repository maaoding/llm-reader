import {
  expect,
  test,
  type ElectronApplication
} from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  cleanupE2eWorkspace,
  createE2eWorkspace,
  launchReader,
  restartReader
} from './support/electron-app'
import { showLibrary } from './support/workspace'

const screenshotDir = resolve('tmp', 'ui-language-e2e')

test('switches the UI language to English, persists it and switches back', async () => {
  const workspace = await createE2eWorkspace('llm-reader-language-e2e-')
  const fixture = resolve('tests/fixtures/complex-reading.txt')
  let application: ElectronApplication | undefined
  await mkdir(screenshotDir, { recursive: true }).catch(() => undefined)

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const { page } = launched

    await showLibrary(page)
    await page.getByTestId('settings-button').click()
    const appearanceNav = page.getByTestId('settings-nav-appearance')
    await expect(appearanceNav).toBeVisible()

    // 中文默认：外观区应出现语言切换控件，主题选项为中文。
    await expect(page.getByTestId('ui-language')).toBeVisible()
    await expect(page.getByTestId('theme-light')).toHaveText('浅色')
    await page.screenshot({ path: resolve(screenshotDir, '01-zh-appearance.png') })

    await page.getByTestId('ui-language-en').click()

    // 立即生效：设置导航、主题选项与外观文案全部切换为英文。
    await expect(appearanceNav).toHaveText('Appearance')
    await expect(page.getByTestId('theme-light')).toHaveText('Light')
    await expect(page.getByTestId('theme-system')).toHaveText('System')
    await expect(page.getByTestId('theme-dark')).toHaveText('Dark')
    await expect(page.getByTestId('ui-language-en')).toHaveAttribute('aria-pressed', 'true')
    await page.screenshot({ path: resolve(screenshotDir, '02-en-appearance.png') })

    // 其余栏目同步切换：进入阅读面板核对标题文案。
    await page.getByTestId('settings-nav-reading').click()
    await expect(page.locator('#reading-settings-title')).toHaveText('Reading')
    await expect(page.getByTestId('reading-reset')).toHaveText('Restore defaults')
    await page.screenshot({ path: resolve(screenshotDir, '03-en-reading.png') })

    // 划词操作的默认名称与提示词跟随界面语言。
    await page.getByTestId('settings-nav-assistant').click()
    await expect(page.getByTestId('assistant-explain-label')).toHaveValue('Explain this')
    await page.screenshot({ path: resolve(screenshotDir, '03b-en-assistant-actions.png') })

    await page.getByTestId('settings-close').click()

    // 持久化：重启后界面仍为英文。
    const restarted = await restartReader(application, { userData: workspace.userData, importPath: fixture })
    application = restarted.application
    const restartedPage = restarted.page
    await showLibrary(restartedPage)
    await restartedPage.getByTestId('settings-button').click()
    await expect(restartedPage.getByTestId('settings-nav-appearance')).toHaveText('Appearance')
    await expect(restartedPage.getByTestId('ui-language-en')).toHaveAttribute('aria-pressed', 'true')
    await restartedPage.screenshot({ path: resolve(screenshotDir, '04-en-after-restart.png') })

    // 切回中文并验证，划词默认值同步回到中文。
    await restartedPage.getByTestId('ui-language-zh').click()
    await expect(restartedPage.getByTestId('settings-nav-appearance')).toHaveText('外观')
    await expect(restartedPage.getByTestId('theme-light')).toHaveText('浅色')
    await restartedPage.getByTestId('settings-nav-assistant').click()
    await expect(restartedPage.getByTestId('assistant-explain-label')).toHaveValue('解释这段')
    await restartedPage.screenshot({ path: resolve(screenshotDir, '06-zh-back-assistant.png') })
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
