import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader } from './support/electron-app'
import { enterReading, resizeWorkspace, showLibrary } from './support/workspace'

async function pickDestination(application: ElectronApplication, path: string | null): Promise<void> {
  await application.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => filePath ? { canceled: false, filePath } : { canceled: true, filePath: '' }
  }, path)
}

function bookTab(page: Page, id: string) {
  return page.getByTestId('book-tab').and(page.locator('[data-book-id="' + id + '"]'))
}

test('filters one book, exports only the frozen selection and clears selections when the view changes', async () => {
  test.setTimeout(90_000)
  const workspace = await createE2eWorkspace('reader-highlight-organizer-')
  let application: ElectronApplication | undefined
  try {
    const source = join(workspace.root, '证据阅读.txt')
    const other = join(workspace.root, '另一册.txt')
    const quote = '原文甲第一行。\n  原文甲第二行。'
    const text = '第一章 证据阅读\n\n' + quote + '\n\n原文乙需要对照。\n\n本书未选摘录。'
    await writeFile(source, text, 'utf8')
    await writeFile(other, '另一本书的摘录。', 'utf8')
    const launched = await launchReader({ userData: workspace.userData, importPath: source })
    application = launched.application
    const page = launched.page
    await showLibrary(page)
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, other)
    await page.getByTestId('import-book').click()
    await expect(page.getByTestId('reader-host')).toContainText('另一本书的摘录')

    const note = '观察与证据\n  批注第二行'
    const seeded = await page.evaluate(async ({ text, quote, note }) => {
      const api = window.readerApi
      const books = await api.listBooks()
      const book = books.find((item) => item.originalName === '证据阅读.txt')!
      const other = books.find((item) => item.originalName === '另一册.txt')!
      const save = async (quote: string, chapterTitle: string, note: string, tags: string[]) => {
        const start = text.indexOf(quote)
        const record = await api.saveHighlight({
          bookId: book.id, quote, chapterTitle, anchor: 'txt:' + start + ':' + (start + quote.length)
        })
        return api.updateHighlight({ bookId: book.id, highlightId: record.id, note, tags })
      }
      const first = await save(quote, '第一章', note, ['证据', 'Test'])
      const second = await save('原文乙需要对照。', '第二章', '另一条说明', ['证据', 'ＴＥＳＴ'])
      await save('本书未选摘录。', '第三章', '背景说明', ['背景'])
      await api.saveHighlight({ bookId: other.id, quote: '另一本书的摘录。', anchor: 'txt:0:9', chapterTitle: '全文' })
      return { first, second, otherId: other.id }
    }, { text, quote, note })
    await showLibrary(page)
    await page.getByTestId('book-item').and(page.locator('[data-book-id="' + seeded.first.bookId + '"]')).click()
    await enterReading(page)
    await resizeWorkspace(application, page, 1180, 800)
    await page.getByTestId('settings-button').click()
    await page.getByTestId('theme-light').click()
    await page.getByTestId('scale-100').click()
    await page.getByTestId('settings-close').click()
    await page.getByTestId('highlights-tab').click()

    const items = page.getByTestId('highlight-item')
    const tag = page.getByTestId('highlight-filter-tag')
    const query = page.getByTestId('highlight-filter-text')
    const mode = page.getByTestId('highlight-select-mode')
    const all = page.getByTestId('highlight-select-all')
    const count = page.getByTestId('highlight-selected-count')
    const save = page.getByTestId('highlight-export')
    const feedback = page.getByTestId('highlight-export-feedback')
    await expect(items).toHaveCount(3)
    await mode.click()
    await all.check()
    await expect(count).toHaveText('已选 3 条')
    await tag.selectOption('证据')
    await expect(items).toHaveCount(2)
    await expect(count).toHaveText('已选 0 条')
    await all.check()
    await query.fill('观察')
    await expect(items).toHaveCount(1)
    await expect(count).toHaveText('已选 0 条')
    await query.fill('第二章')
    await expect(items).toHaveCount(1)
    await expect(items).toContainText('原文乙')
    await query.fill('没有这一项')
    await expect(page.getByText('没有匹配的摘录')).toBeVisible()
    await query.fill('test')
    await expect(items).toHaveCount(2)
    await items.first().getByTestId('highlight-select-item').check()
    await expect(count).toHaveText('已选 1 条')
    await all.check()
    await expect(count).toHaveText('已选 2 条')
    await expect(page.getByTestId('highlight-result-count')).toHaveText('结果 · 2')
    const displayOrder = await items.locator('.highlight-quote').allTextContents()
    await page.screenshot({ path: test.info().outputPath('extract-selection-light.png'), animations: 'disabled' })

    await pickDestination(application, null)
    await save.click()
    await expect(save).toBeEnabled()
    await expect(feedback).toHaveCount(0)
    await expect(count).toHaveText('已选 2 条')
    await pickDestination(application, join(workspace.root, 'missing-directory', '摘录.md'))
    await save.click()
    await expect(feedback).toContainText('无法保存摘录文件')
    await expect(count).toHaveText('已选 2 条')

    const target = join(workspace.root, '所选摘录')
    await application.evaluate(({ dialog }, filePath) => {
      const state = globalThis as typeof globalThis & { finishExtractSave?: () => void }
      dialog.showSaveDialog = () => new Promise((resolve) => {
        state.finishExtractSave = () => resolve({ canceled: false, filePath })
      })
    }, target)
    await save.click()
    await expect.poll(() => application!.evaluate(() => Boolean((globalThis as { finishExtractSave?: () => void }).finishExtractSave))).toBe(true)
    await page.evaluate((record) => window.readerApi.updateHighlight({
      bookId: record.bookId, highlightId: record.id, note: '对话框打开后才保存的文字', tags: record.tags
    }), seeded.second)
    await application.evaluate(() => {
      const state = globalThis as { finishExtractSave?: () => void }
      state.finishExtractSave?.()
      delete state.finishExtractSave
    })
    await expect(feedback).toHaveText('已导出 2 条摘录到 所选摘录.md。')
    const markdown = await readFile(target + '.md', 'utf8')
    expect(markdown).toContain('证据阅读')
    expect(markdown).toContain('摘录 · 2')
    expect(markdown).toContain(quote)
    expect(markdown).toContain(note)
    expect(markdown).toContain(seeded.first.anchor)
    expect(markdown).toContain('另一条说明')
    expect(markdown.indexOf(displayOrder[0])).toBeLessThan(markdown.indexOf(displayOrder[1]))
    for (const excluded of ['本书未选摘录', '另一本书的摘录', '对话框打开后才保存的文字']) expect(markdown).not.toContain(excluded)

    await resizeWorkspace(application, page, 940, 600)
    await page.getByTestId('settings-button').click()
    await page.getByTestId('theme-dark').click()
    await page.getByTestId('scale-125').click()
    await page.getByTestId('settings-close').click()
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme', 'dark')
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-interface-scale', '125')
    await expect(page.getByTestId('reader-host').locator('.reader-document--txt')).toHaveCSS('color-scheme', 'dark')
    // Crossing the compact-window breakpoint closes the existing reading drawer.
    await expect(page.getByTestId('highlights-tab')).toHaveAttribute('aria-pressed', 'false')
    await page.getByTestId('highlights-tab').click()
    await expect(save).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath('extract-selection-dark.png'), animations: 'disabled' })

    const editedItem = items.and(page.locator('[data-highlight-id="' + seeded.first.id + '"]'))
    await editedItem.getByTestId('highlight-edit').click()
    const editor = page.getByTestId('highlight-edit-dialog')
    await expect(editor.getByTestId('highlight-note-save')).toBeInViewport()
    await editor.getByTestId('highlight-tags').fill('移出筛选')
    await page.screenshot({ path: test.info().outputPath('extract-editor-dark.png'), animations: 'disabled' })
    await editor.getByTestId('highlight-note-save').click()
    await expect(editedItem).toHaveCount(0)
    await expect(count).toHaveText('已选 1 条')
    await expect(page.getByTestId('highlights-tab')).toBeFocused()
    await mode.click()
    await mode.click()
    await expect(count).toHaveText('已选 0 条')
    await all.check()
    await bookTab(page, seeded.otherId).click()
    await expect(page.getByTestId('reader-host')).toContainText('另一本书的摘录')
    await page.getByTestId('highlights-tab').click()
    await expect(items).toHaveCount(1)
    await expect(items).toContainText('另一本书的摘录')
    await expect(query).toHaveValue('')
    await expect(mode).toHaveAttribute('aria-pressed', 'false')
    await expect(count).toHaveCount(0)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
