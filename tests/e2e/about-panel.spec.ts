import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader } from './support/electron-app'

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
    await expect(aboutPanel).toContainText('electron-updater（MIT）')
    await expect(aboutPanel).toContainText('epub.js（BSD-2-Clause）')
    await expect(aboutPanel).toContainText('React、React DOM（MIT）')
    await expect(aboutPanel).toContainText('THIRD_PARTY_NOTICES.md')
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('explains that update checks are unavailable in the test environment', async () => {
  const workspace = await createE2eWorkspace('llm-reader-about-update-')
  const { application, page } = await launchReader({ userData: workspace.userData })

  try {
    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-about').click()

    const updateBlock = page.getByTestId('about-update')
    await expect(updateBlock).toBeVisible()
    await expect(page.getByTestId('update-status')).toHaveText('当前环境不支持更新检查')
    await expect(page.getByTestId('update-action-button')).toBeDisabled()
    await expect(page.getByTestId('update-release-notes')).toHaveCount(0)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
