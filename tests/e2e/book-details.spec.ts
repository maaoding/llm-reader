import {
  expect,
  test,
  type ElectronApplication
} from '@playwright/test'
import { join } from 'node:path'
import { createCoveredEpubFixture } from './fixtures/covered-epub'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader } from './support/electron-app'

test('shows the extracted shelf cover and book details modal', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-book-details-')
  const fixture = join(workspace.root, 'details.epub')
  const visualDirectory = process.env.LLM_READER_VISUAL_DIR
  await createCoveredEpubFixture(fixture)
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const { page } = launched
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 820)
    })
    const shelfCover = page.getByTestId('book-cover').first()
    await expect(shelfCover).toBeVisible()
    await expect(shelfCover).toHaveAttribute('data-has-cover', 'true')
    await expect.poll(() => shelfCover.locator('img').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    if (visualDirectory) {
      await page.screenshot({ path: join(visualDirectory, 'book-details-shelf-cover.png') })
    }

    const infoButton = page.getByTestId('book-info').first()
    await infoButton.click()
    const modal = page.getByTestId('book-details-modal')
    await expect(modal).toBeVisible()
    await expect(modal).toContainText('带封面的元数据样本')
    await expect(modal).toContainText('示例出版社')
    await expect(modal).toContainText('zh-CN')
    await expect(modal).toContainText('urn:isbn:9787111111111')
    await expect(modal).toContainText('用于验证书籍信息窗口显示对阅读有参考价值的常用元数据。')
    await expect(modal.getByTestId('book-details-cover').locator('img')).toBeVisible()
    if (visualDirectory) {
      await page.screenshot({ path: join(visualDirectory, 'book-details-modal.png') })
    }

    await page.getByTestId('book-details-close').click()
    await expect(modal).toHaveCount(0)
    await expect(infoButton).toBeFocused()

    await page.getByTestId('book-item').first().click()
    const headerInfoButton = page.getByTestId('book-details-button')
    await expect(headerInfoButton).toBeVisible()
    await headerInfoButton.click()
    await expect(modal).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
    await expect(headerInfoButton).toBeFocused()
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
