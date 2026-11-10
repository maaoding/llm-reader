import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader, restartReader } from './support/electron-app'
import { enterReading, resizeWorkspace, showLibrary } from './support/workspace'

async function openExtracts(page: Page): Promise<void> {
  await showLibrary(page)
  await page.getByTestId('book-item').click()
  await enterReading(page)
  await page.getByTestId('highlights-tab').click()
}

function configureSaveFailure(path: string, fail: boolean): void {
  const database = new DatabaseSync(path)
  try {
    database.exec(fail
      ? "CREATE TRIGGER fail_annotation BEFORE UPDATE OF note ON highlights BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END"
      : 'DROP TRIGGER fail_annotation')
  } finally {
    database.close()
  }
}

test('keeps an unsaved extract draft, retries a failed write and restores the saved annotation after restart', async () => {
  const workspace = await createE2eWorkspace('reader-highlight-editor-')
  let application: ElectronApplication | undefined
  try {
    const path = join(workspace.root, '批注测试.txt')
    await writeFile(path, '第一章 摘录\n\n这句话保留在原文。\n\n下一段用于跳转。', 'utf8')
    const launched = await launchReader({ userData: workspace.userData, importPath: path })
    application = launched.application
    const page = launched.page
    await resizeWorkspace(application, page, 1180, 800)
    await openExtracts(page)
    await page.getByTestId('reader-host').locator('p').first().evaluate((paragraph) => {
      const range = document.createRange()
      range.selectNodeContents(paragraph)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    await page.getByTestId('action-save-highlight').click()
    const item = page.getByTestId('highlight-item')
    const edit = item.getByTestId('highlight-edit')
    await edit.click()
    const editor = page.getByTestId('highlight-edit-dialog')
    const note = '留待核对\n  第二行缩进'
    await editor.getByTestId('highlight-note').fill(note)
    await editor.getByTestId('highlight-tags').fill(' Test ，ｔｅｓｔ,  证据, ,')
    await expect(page.getByTestId('app-shell')).toHaveAttribute('inert', '')
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await expect(editor.getByRole('alert')).toContainText('请先保存或放弃')
    page.once('dialog', (dialog) => dialog.dismiss())
    await page.keyboard.press('Escape')
    await expect(editor.getByTestId('highlight-note')).toHaveValue(note)

    const databasePath = join(workspace.userData, 'reader.sqlite3')
    configureSaveFailure(databasePath, true)
    await editor.getByTestId('highlight-note-save').click()
    await expect(editor.getByRole('alert')).not.toContainText('请先保存或放弃')
    await expect(editor.getByRole('alert')).toBeVisible()
    await expect(editor.getByTestId('highlight-note')).toHaveValue(note)
    await expect(editor.getByTestId('highlight-tags')).toHaveValue(' Test ，ｔｅｓｔ,  证据, ,')
    await page.screenshot({ path: test.info().outputPath('annotation-retry-light.png'), animations: 'disabled' })
    configureSaveFailure(databasePath, false)
    await editor.getByTestId('highlight-note-save').click()
    await expect(editor).toHaveCount(0)
    await expect(edit).toBeFocused()
    await expect(item.locator('.highlight-note-preview')).toHaveText(note)
    await expect(item.locator('.highlight-tags li')).toHaveText(['Test', '证据'])

    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application
    await openExtracts(restarted.page)
    const saved = restarted.page.getByTestId('highlight-item')
    await expect(saved.locator('.highlight-quote')).toHaveText('这句话保留在原文。')
    await expect(saved.locator('.highlight-note-preview')).toHaveText(note)
    await saved.getByTestId('highlight-edit').click()
    const reopened = restarted.page.getByTestId('highlight-edit-dialog')
    await expect(reopened.getByTestId('highlight-note')).toHaveValue(note)
    await expect(reopened.getByTestId('highlight-tags')).toHaveValue('Test，证据')
    await reopened.getByTestId('highlight-note').fill('')
    await reopened.getByTestId('highlight-tags').fill('')
    await reopened.getByTestId('highlight-note-save').click()
    await expect(reopened).toHaveCount(0)
    await expect(saved.locator('.highlight-details')).toHaveCount(0)

    const rail = restarted.page.getByTestId('highlights-tab')
    await resizeWorkspace(application, restarted.page, 1180, 800)
    if (await rail.getAttribute('aria-pressed') !== 'true') await rail.click()
    await saved.getByTestId('highlight-edit').click()
    await resizeWorkspace(application, restarted.page, 940, 600)
    await expect(rail).toHaveAttribute('aria-pressed', 'false')
    await restarted.page.keyboard.press('Escape')
    await expect(reopened).toHaveCount(0)
    await expect(rail).toBeFocused()
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
