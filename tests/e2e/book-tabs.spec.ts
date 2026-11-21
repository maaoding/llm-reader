import { expect, test, type ElectronApplication } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BaseWindow, OpenDialogOptions } from 'electron'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader, restartReader } from './support/electron-app'
import { resizeWorkspace } from './support/workspace'

const TITLES = [
  '第一本复杂系统的读法',
  '第二本思考的快与慢',
  '第三本系统的结构之美',
  '第四本技术的本质演进',
  '第五本规模的简单法则',
  '第六本理论的极限边界'
]

async function stubImportDialog(application: ElectronApplication, paths: string[]): Promise<void> {
  await application.evaluate(({ dialog }, selectedPaths) => {
    dialog.showOpenDialog = (async (_window: BaseWindow, options: OpenDialogOptions) => {
      const hasMultiSelection = options.properties?.includes('multiSelections') ?? false
      if (!hasMultiSelection) throw new Error('Expected multiSelections')
      return { canceled: false, filePaths: selectedPaths, bookmarks: [] }
    }) as unknown as typeof dialog.showOpenDialog
  }, paths)
}

test('opens one topbar tab per book, remembers each book page and closes back to the library', async () => {
  const workspace = await createE2eWorkspace('llm-reader-book-tabs-')
  let application: ElectronApplication | undefined

  try {
    const paths = TITLES.map((title) => join(workspace.root, `${title}.txt`))
    await Promise.all(paths.map((path, index) => writeFile(path, `${TITLES[index]}\n\n${TITLES[index]}的正文。`, 'utf8')))
    const launched = await launchReader({ userData: workspace.userData })
    application = launched.application
    let page = launched.page
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-workspace-ready', 'true')
    await stubImportDialog(application, paths)
    await page.getByTestId('import-book').click()
    await expect(page.getByTestId('book-import-summary')).toContainText('已导入 6 本')
    await page.getByTestId('book-import-close').click()

    // 只导入、尚未打开任何书时不产生标签。
    await expect(page.getByTestId('book-item')).toHaveCount(6)
    await expect(page.getByTestId('book-tab')).toHaveCount(0)

    const tabs = page.getByTestId('book-tab')
    const closeTab = (index: number) => page.getByTestId('book-tab-close').nth(index)
    // 重启后 page 会换成新窗口，定位器必须每次从当前 page 取。
    const openFromLibrary = async (index: number): Promise<void> => {
      await page.getByTestId('nav-library').click()
      await page.getByTestId('book-item').filter({ hasText: TITLES[index] }).click()
      await expect.poll(async () => ({
        page: await page.locator('.workspace-shell').getAttribute('data-page'),
        titles: await page.locator('.workspace-book-title h1').evaluateAll((elements) => elements.map((element) => element.textContent))
      })).toEqual({ page: 'reading', titles: [TITLES[index]] })
      await expect(page.locator('.reader-document--txt')).toBeVisible()
    }

    await openFromLibrary(0)
    await expect(tabs).toHaveCount(1)
    await expect(tabs.first()).toContainText(TITLES[0])
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')

    await openFromLibrary(1)
    await expect(tabs).toHaveCount(2)
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'false')
    await page.getByTestId('workspace-tab-notes').click()

    // 每个标签保留自己的阅读或章节笔记页面。
    await tabs.first().click()
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-page', 'reading')
    await expect(page.locator('.workspace-book-title h1')).toHaveText(TITLES[0])
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')

    // 关闭非活动标签只移除该标签，当前书籍与页面不受影响。
    await openFromLibrary(2)
    await expect(tabs).toHaveCount(3)
    await closeTab(0).click()
    await expect(tabs).toHaveCount(2)
    await expect(page.locator('.workspace-book-title h1')).toHaveText(TITLES[2])
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-page', 'reading')

    // 关闭活动标签回到书库，其余标签保留。
    await closeTab(1).click()
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-page', 'library')
    await expect(tabs).toHaveCount(1)
    await expect(tabs.first()).toContainText(TITLES[1])

    await resizeWorkspace(application, page, 940, 600)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

    // 重启恢复标签列表；上次停在书库时不自动打开书籍。
    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application
    page = restarted.page
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-workspace-ready', 'true')
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-page', 'library')
    await expect(page.getByTestId('book-tab')).toHaveCount(1)
    await expect(page.locator('.workspace-bookbar')).toHaveCount(0)

    // 从标签重新打开，落在它上次所在的章节笔记页。
    await page.getByTestId('book-tab').first().click()
    await expect(page.locator('.workspace-book-title h1')).toHaveText(TITLES[1])
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-page', 'notes')

    // 窄窗口下标签条溢出时，新激活的标签会被带回可见范围。
    for (let index = 2; index < TITLES.length; index += 1) await openFromLibrary(index)
    await expect(page.getByTestId('book-tab')).toHaveCount(5)
    await expect.poll(() => page.evaluate(() => {
      const strip = document.querySelector('.workspace-book-tabs') as HTMLElement
      const active = strip.querySelector('.workspace-book-tab.is-active') as HTMLElement | null
      if (!active) return false
      const stripRect = strip.getBoundingClientRect()
      const activeRect = active.getBoundingClientRect()
      return strip.scrollWidth > strip.clientWidth && activeRect.left >= stripRect.left - 1 && activeRect.right <= stripRect.right + 1
    })).toBe(true)

    // 拖拽重排：把最后一个标签拖到最前，活动书籍不变。
    const tabTitles = async (): Promise<string[]> => page.getByTestId('book-tab').evaluateAll((elements) => elements.map((element) => element.textContent ?? ''))
    const orderBeforeDrag = await tabTitles()
    await page.getByTestId('book-tab').last().dragTo(page.getByTestId('book-tab').first())
    await expect.poll(tabTitles).toEqual([orderBeforeDrag[orderBeforeDrag.length - 1], ...orderBeforeDrag.slice(0, -1)])
    await expect(page.getByTestId('book-tab').first()).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.workspace-book-title h1')).toHaveText(TITLES[5])

    // 关闭活动标签回到书库，其余标签保留。
    await closeTab(0).click()
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-page', 'library')
    await expect(page.getByTestId('book-tab')).toHaveCount(4)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
