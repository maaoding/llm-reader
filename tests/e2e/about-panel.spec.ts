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
    const notices = aboutPanel.locator('.about-notices')
    const summary = notices.locator('summary')
    await expect(summary).toHaveText('第三方许可证')
    await expect(notices.getByText('Electron（MIT）')).toBeHidden()
    await summary.focus()
    await summary.press('Enter')
    await expect(notices.getByText('Electron（MIT）')).toBeVisible()
    await expect(notices.getByText('epub.js（BSD-2-Clause）')).toBeVisible()
    await expect(notices.getByText('React、React DOM（MIT）')).toBeVisible()
    await expect(notices.getByText('THIRD_PARTY_NOTICES.md', { exact: false })).toBeVisible()
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

const locales = {
  zh: {
    heading: '关于',
    notices: '第三方许可证',
    license: '许可证',
    source: '源码仓库',
    report: '反馈不当 AI 内容',
    reportFailed: '无法打开反馈页面。'
  },
  en: {
    heading: 'About',
    notices: 'Third-party licenses',
    license: 'License',
    source: 'Source repository',
    report: 'Report inappropriate AI content',
    reportFailed: 'Could not open the report page.'
  }
} as const

for (const distribution of ['standalone', 'store'] as const) {
  test(`lays out the bilingual About panel without updates for ${distribution}`, async () => {
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
          const aboutTab = page.getByTestId('settings-nav-about')
          await expect(aboutTab).toHaveText(locales[language].heading)
          await aboutTab.click()

          const about = page.locator('#settings-panel-about')
          await expect(about.getByTestId('about-version')).toHaveText(/^\d+\.\d+\.\d+/u)
          await expect(about.getByTestId('about-version')).toBeInViewport()
          await expect(about.getByText(locales[language].license, { exact: true })).toBeVisible()
          await expect(about.getByText(locales[language].source, { exact: true })).toBeVisible()
          await expect(page.getByTestId('settings-modal').getByRole('tab', { name: /^(?:更新|Updates?)$/iu })).toHaveCount(0)
          await expect(about.getByTestId('about-update')).toHaveCount(0)
          await expect(about).not.toContainText(/更新|\bupdat(?:es?|ed|ing)\b/iu)
          const report = about.getByRole('button', { name: locales[language].report })
          const summary = about.locator('.about-notices summary')
          await expect(summary).toHaveText(locales[language].notices)
          await expect(summary).toBeInViewport()
          const settingsPanel = page.locator('.settings-panel')
          expect(await settingsPanel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
          await page.screenshot({
            path: test.info().outputPath(`about-${distribution}-${language}-${width}-${theme}-${scale}.png`),
            scale: 'css',
            animations: 'disabled'
          })

          if (distribution === 'store') {
            await expect(report).toBeEnabled()
            await report.click()
            await expect(about.getByRole('alert')).toHaveText(locales[language].reportFailed)
          } else {
            await expect(report).toHaveCount(0)
          }
          await summary.click()
          await expect(about.getByText(language === 'en' ? 'React, React DOM (MIT)' : 'React、React DOM（MIT）')).toBeVisible()
          expect(await settingsPanel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        }
        await page.getByTestId('settings-close').click()
      }
    } finally {
      await cleanupE2eWorkspace(application, workspace.root)
    }
  })
}
