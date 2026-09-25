import { expect, test, type ElectronApplication, type Locator } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader } from './support/electron-app'
import { resizeWorkspace } from './support/workspace'

async function selectNodeContents(locator: Locator): Promise<void> {
  await locator.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
}

test('keeps the full conversation scope compact and shows only blocking context hints', async () => {
  const workspace = await createE2eWorkspace('llm-reader-scope-ui-')
  let application: ElectronApplication | undefined
  try {
    const fixture = join(workspace.root, '提问范围.txt')
    await writeFile(fixture, '第一章\n\n'+ '选择这段原文提问。\n\n'.repeat(60))
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const page = launched.page
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-workspace-ready', 'true')
    await page.getByTestId('book-item').click()
    await page.getByTestId('workspace-tab-reading').click()
    const sidebar = page.locator('.right-sidebar')
    await expect(sidebar.locator('.composer-hint')).toContainText('先设置模型服务')
    await page.getByTestId('assistant-expand-button').click()

    const conversation = page.getByTestId('assistant-dialog')
    const scopeControls = conversation.locator('.composer-scope-controls')
    await expect(scopeControls).toBeVisible()
    await expect(conversation.locator('.composer-hint')).toContainText('先设置模型服务')
    await expect(page.getByTestId('workspace-prepare')).toBeVisible()
    const scopeLayout = await scopeControls.evaluate((element) => {
      const label = element.querySelector('span')?.getBoundingClientRect()
      const options = element.querySelector('.analysis-scope')?.getBoundingClientRect()
      return label && options ? { gap: options.left - label.right, centerDelta: Math.abs((options.top + options.bottom - label.top - label.bottom) / 2) } : null
    })
    expect(scopeLayout).not.toBeNull()
    expect(scopeLayout!.gap).toBeGreaterThanOrEqual(0)
    expect(scopeLayout!.gap).toBeLessThanOrEqual(16)
    expect(scopeLayout!.centerDelta).toBeLessThanOrEqual(3)

    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-model').click()
    await page.getByTestId('provider-profile-name').fill('范围控件测试')
    await page.getByTestId('provider-base-url').fill('http://127.0.0.1:9/v1')
    await page.getByTestId('provider-model').fill('mock-scope-ui')
    await page.getByTestId('provider-api-key').fill('test-only-key')
    await page.getByTestId('provider-save').click()
    await page.getByTestId('provider-activate').click()
    await page.getByTestId('settings-close').click()
    await expect(conversation.locator('.composer-hint')).toContainText('先准备原文')
    await conversation.locator('.composer-hint button').click()
    await expect(page.getByTestId('book-preparation-dialog')).toBeVisible()
    await page.getByTestId('preparation-close').click()
    await page.getByTestId('workspace-prepare').click()
    await page.getByTestId('document-prepare').click()
    await expect(page.getByTestId('document-status')).toHaveText('原文已就绪')
    await page.getByTestId('preparation-close').click()
    await expect(conversation.locator('.composer-hint')).toHaveCount(0)
    await expect(page.locator('.toast')).toHaveCount(0)

    for (const [width, height] of [[940, 600], [1180, 760], [1440, 900]]) {
      await resizeWorkspace(application, page, width, height)
      for (const theme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: theme })
        await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme', theme)
        await expect(scopeControls).toBeInViewport()
        await expect(page.getByTestId('workspace-prepare')).toBeInViewport()
        await page.screenshot({ path: test.info().outputPath(`conversation-scope-${width}-${theme}.png`), animations: 'disabled' })
      }
    }

    await scopeControls.getByRole('button', { name: '选中内容' }).click()
    await expect(scopeControls.getByRole('button', { name: '选中内容' })).toHaveAttribute('aria-pressed', 'true')
    await expect(conversation.locator('.composer-hint')).toContainText('尚未选中原文')
    await expect(conversation.locator('button[type="submit"]')).toBeDisabled()
    await page.getByTestId('workspace-tab-reading').click()
    await selectNodeContents(page.getByTestId('reader-host').locator('p').first())
    await expect(page.getByTestId('selection-toolbar')).toBeVisible()
    await page.getByTestId('action-ask').click()
    await page.getByTestId('assistant-expand-button').click()
    await expect(scopeControls.getByRole('button', { name: '选中内容' })).toHaveAttribute('aria-pressed', 'true')
    await expect(conversation.locator('.composer-hint')).toHaveCount(0)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
