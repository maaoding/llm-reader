import {
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { join } from 'node:path'
import type { BaseWindow, OpenDialogOptions } from 'electron'
import { createCoveredEpubFixture } from './fixtures/covered-epub'
import {
  cleanupE2eWorkspace,
  createE2eWorkspace,
  launchReader,
  restartReader
} from './support/electron-app'

async function stubImportDialog(application: ElectronApplication, paths: string[]): Promise<void> {
  await application.evaluate(({ dialog }, selectedPaths) => {
    dialog.showOpenDialog = (async (_window: BaseWindow, options: OpenDialogOptions) => {
      const hasMultiSelection = options.properties?.includes('multiSelections') ?? false
      if (!hasMultiSelection) throw new Error('Expected multiSelections')
      return { canceled: false, filePaths: selectedPaths, bookmarks: [] }
    }) as unknown as typeof dialog.showOpenDialog
  }, paths)
}

async function expectEveryShelfCoverLoaded(page: Page, count: number): Promise<void> {
  const covers = page.getByTestId('book-cover')
  await expect(covers).toHaveCount(count)
  for (let index = 0; index < count; index += 1) {
    const cover = covers.nth(index)
    await expect(cover).toHaveAttribute('data-has-cover', 'true')
    await expect.poll(() => cover.locator('img').evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0)
  }
}

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

test('renders multiple lazy shelf covers at 125 percent and restores them after restart', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-multiple-covers-')
  const fixtures = await Promise.all(Array.from({ length: 3 }, async (_, index) => {
    const path = join(workspace.root, `covered-${index + 1}.epub`)
    await createCoveredEpubFixture(path, {
      identifier: `urn:uuid:llm-reader-covered-${index + 1}`,
      title: `封面样本 ${index + 1}`
    })
    return path
  }))
  let application: ElectronApplication | undefined

  try {
    let launched = await launchReader({ userData: workspace.userData })
    application = launched.application
    let { page } = launched
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 820)
    })
    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-appearance').click()
    await page.getByTestId('scale-125').click()
    await page.getByTestId('settings-close').click()

    await stubImportDialog(application, fixtures)
    await page.getByTestId('import-book').click()
    await expect(page.getByTestId('book-import-summary')).toContainText('已导入 3 本')
    await page.getByTestId('book-import-close').click()
    await expectEveryShelfCoverLoaded(page, 3)

    launched = await restartReader(application, { userData: workspace.userData })
    application = launched.application
    page = launched.page
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-interface-scale', '125')
    await expectEveryShelfCoverLoaded(page, 3)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
