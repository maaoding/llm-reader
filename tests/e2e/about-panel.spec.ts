import { expect, test, type ElectronApplication } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader } from './support/electron-app'
import { resizeWorkspace } from './support/workspace'

test('shows version, license and third-party notices in the About settings section', async () => {
  const workspace = await createE2eWorkspace('llm-reader-about-')
  const { application, page } = await launchReader({ userData: workspace.userData })
  const packageMetadata = JSON.parse(
    await readFile(resolve('package.json'), 'utf8')
  ) as { version: string }

  try {
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-about').click()

    const aboutPanel = page.locator('#settings-panel-about')
    await expect(aboutPanel).toBeVisible()
    const aboutIcon = aboutPanel.locator('.about-brand img')
    await expect(aboutIcon).toBeVisible()
    await expect(aboutIcon).toHaveAttribute('src', /icon-.*\.png/u)
    await expect(aboutPanel).toContainText('LLM Reader')
    await expect(page.getByTestId('about-version')).toHaveText(packageMetadata.version)
    await expect(aboutPanel).toContainText('© 2026 wrh37')
    await expect(aboutPanel).toContainText('GPL-3.0-or-later')
    await expect(aboutPanel).toContainText('https://github.com/maaoding/llm-reader')
    await expect(aboutPanel).toContainText('Electron（MIT）')
    await expect(aboutPanel).toContainText('epub.js（BSD-2-Clause）')
    await expect(aboutPanel).toContainText('React、React DOM（MIT）')
    await expect(aboutPanel).toContainText('THIRD_PARTY_NOTICES.md')
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

const locales = {
  zh: {
    store: '此版本通过 Microsoft Store 更新。',
    standalone: '自行构建的版本需手动更新。',
    report: '反馈不当 AI 内容',
    reportFailed: '无法打开反馈页面。'
  },
  en: {
    store: 'This version receives updates through Microsoft Store.',
    standalone: 'Self-built versions need to be updated manually.',
    report: 'Report inappropriate AI content',
    reportFailed: 'Could not open the report page.'
  }
} as const

for (const distribution of ['standalone', 'store'] as const) {
  test(`shows static update instructions and appropriate reporting controls for ${distribution}`, async () => {
    const workspace = await createE2eWorkspace('llm-reader-about-distribution-')
    let application: ElectronApplication | undefined
    try {
      const launched = await launchReader({ userData: workspace.userData })
      application = launched.application
      const { page } = launched
      if (distribution === 'store') {
        // Exercise the production IPC and preload with a simulated AppX process flag.
        await application.evaluate(({ shell }) => {
          Object.defineProperty(process, 'windowsStore', { value: true })
          shell.openExternal = async () => { throw new Error('Synthetic browser launch failure') }
        })
      }
      expect((await page.evaluate(() => window.readerApi.getAppInfo())).distribution).toBe(distribution)

      for (const [width, height, theme, scale] of [[1180, 800, 'light', 100], [940, 600, 'dark', 125]] as const) {
        await resizeWorkspace(application, page, width, height)
        await page.getByTestId('settings-button').click()
        await page.getByTestId('settings-nav-appearance').click()
        await page.getByTestId(`theme-${theme}`).click()
        await page.getByTestId(`scale-${scale}`).click()
        await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme', theme)
        await expect(page.getByTestId('app-shell')).toHaveAttribute('data-interface-scale', String(scale))

        for (const language of ['zh', 'en'] as const) {
          await page.getByTestId('settings-nav-appearance').click()
          await page.getByTestId(`ui-language-${language}`).click()
          await page.getByTestId('settings-nav-about').click()

          const about = page.locator('#settings-panel-about')
          const message = about.getByTestId('about-update')
          await expect(message).toContainText(locales[language][distribution])
          await expect(message).toBeInViewport()
          await expect(message.getByRole('button')).toHaveCount(0)
          await expect(message.getByRole('link')).toHaveCount(0)
          await expect(about.getByRole('button', { name: /检查更新|下载更新|重启并安装|Check for updates|Download update|Restart and install/u })).toHaveCount(0)
          const report = about.getByRole('button', { name: locales[language].report })
          if (distribution === 'store') {
            await expect(report).toBeEnabled()
            await report.click()
            await expect(about.getByRole('alert')).toHaveText(locales[language].reportFailed)
          } else {
            await expect(report).toHaveCount(0)
          }
          await page.screenshot({
            path: test.info().outputPath(`about-${distribution}-${language}-${width}-${theme}-${scale}.png`),
            animations: 'disabled'
          })
        }
        await page.getByTestId('settings-close').click()
      }
    } finally {
      await cleanupE2eWorkspace(application, workspace.root)
    }
  })
}
