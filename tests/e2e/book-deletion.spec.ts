import { expect, test, type ElectronApplication } from '@playwright/test'
import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  cleanupE2eWorkspace,
  createE2eWorkspace,
  launchReader
} from './support/electron-app'

const fixture = resolve('tests/fixtures/complex-reading.txt')

async function expectStoredTxtRemoved(userData: string): Promise<void> {
  await expect
    .poll(async () => {
      try {
        return (await readdir(join(userData, 'library'))).filter((name) => name.endsWith('.txt'))
      } catch {
        return []
      }
    })
    .toEqual([])
}

test('deletes an unopened book from its details modal and keeps it gone after restart', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-delete-unopened-')
  let application: ElectronApplication | undefined

  try {
    let launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    let { page } = launched

    const bookItem = page.getByTestId('book-item')
    const modal = page.getByTestId('book-details-modal')
    const deleteButton = page.getByTestId('book-details-delete')
    const confirmation = page.getByTestId('book-details-delete-confirmation')
    await expect(bookItem).toHaveCount(1)

    await page.getByTestId('book-info').click()
    await expect(modal).toBeVisible()
    await deleteButton.click()
    await expect(confirmation).toBeVisible()
    await expect(confirmation).toContainText('删除')
    await expect(confirmation).toContainText('句段收藏与归档')
    await page.getByTestId('book-details-delete-cancel').click()
    await expect(confirmation).toHaveCount(0)
    await expect(modal).toBeVisible()
    await expect(bookItem).toHaveCount(1)

    await deleteButton.click()
    await page.getByTestId('book-details-delete-confirm').click()
    await expect(modal).toHaveCount(0)
    await expect(bookItem).toHaveCount(0)
    await expect(page.locator('.toast')).toContainText('已删除')
    await expectStoredTxtRemoved(workspace.userData)

    await application.close()
    application = undefined
    launched = await launchReader({ userData: workspace.userData })
    application = launched.application
    ;({ page } = launched)
    await expect(page.getByTestId('book-item')).toHaveCount(0)
    await expect(page.getByText('书库为空')).toBeVisible()
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('deleting the currently open book from details closes its reader session and cleans local files', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-delete-active-')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const { page } = launched

    await page.getByTestId('book-item').first().click()
    await expect(page.getByTestId('reader-host')).toContainText('复杂概念')
    await page.getByTestId('book-details-button').click()
    await expect(page.getByTestId('book-details-modal')).toBeVisible()
    await page.getByTestId('book-details-delete').click()
    await expect(page.getByTestId('book-details-delete-confirmation')).toBeVisible()
    await page.getByTestId('book-details-delete-confirm').click()

    await expect(page.getByTestId('book-details-modal')).toHaveCount(0)
    await expect(page.getByTestId('book-item')).toHaveCount(0)
    await expect(page.getByTestId('welcome-state')).toContainText('从一本书开始')
    await expect(page.locator('.reader-header h1')).toHaveCount(0)
    await expect(page.locator('.toast')).toContainText('已删除')
    await expectStoredTxtRemoved(workspace.userData)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
