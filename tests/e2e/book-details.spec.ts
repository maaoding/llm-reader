import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication
} from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCoveredEpubFixture } from './fixtures/covered-epub'

test('shows the extracted shelf cover and book details modal', async () => {
  test.setTimeout(120_000)
  const testRoot = await mkdtemp(join(tmpdir(), 'llm-reader-book-details-'))
  const userData = join(testRoot, 'profile')
  const fixture = join(testRoot, 'details.epub')
  const visualDirectory = process.env.LLM_READER_VISUAL_DIR
  await createCoveredEpubFixture(fixture)
  let application: ElectronApplication | undefined

  try {
    application = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        LLM_READER_USER_DATA: userData,
        LLM_READER_E2E_IMPORT: fixture
      }
    })
    const page = await application.firstWindow()
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
    await application?.close().catch(() => undefined)
    await rm(testRoot, { recursive: true, force: true })
  }
})
