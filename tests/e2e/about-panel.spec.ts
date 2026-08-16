import { expect, test, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('shows version, license and third-party notices in the About settings section', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'llm-reader-about-'))
  const application = await electron.launch({
    args: ['.'],
    env: { ...process.env, LLM_READER_USER_DATA: userData }
  })

  try {
    const page = await application.firstWindow()
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-about').click()

    const aboutPanel = page.locator('#settings-panel-about')
    await expect(aboutPanel).toBeVisible()
    const aboutIcon = aboutPanel.locator('.about-brand img')
    await expect(aboutIcon).toBeVisible()
    await expect(aboutIcon).toHaveAttribute('src', /icon-.*\.png/u)
    await expect(aboutPanel).toContainText('LLM Reader')
    await expect(page.getByTestId('about-version')).toHaveText('0.2.0')
    await expect(aboutPanel).toContainText('© 2026 wrh37')
    await expect(aboutPanel).toContainText('GPL-3.0-or-later')
    await expect(aboutPanel).toContainText('https://github.com/maaoding/llm-reader')
    await expect(aboutPanel).toContainText('Electron（MIT）')
    await expect(aboutPanel).toContainText('epub.js（BSD-2-Clause）')
    await expect(aboutPanel).toContainText('React、React DOM（MIT）')
    await expect(aboutPanel).toContainText('THIRD_PARTY_NOTICES.md')
  } finally {
    await application.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
})
