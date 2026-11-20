import { expect, test, type ElectronApplication } from '@playwright/test'
import type { BaseWindow, IpcMainInvokeEvent, OpenDialogOptions } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { IPC_CHANNELS, type BookPayload, type BookRecord } from '../../src/shared/contracts'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader } from './support/electron-app'
import { showLibrary } from './support/workspace'

type LoadingProcess = typeof globalThis & {
  __readerLoadRace?: { pending: boolean; release?: () => void }
}

test('keeps the open book selected when another book finishes updating its title', async () => {
  const workspace = await createE2eWorkspace('reader-metadata-race-')
  let application: ElectronApplication | undefined
  try {
    const firstPath = join(workspace.root, 'Original filename.txt')
    const secondPath = join(workspace.root, 'Second book.txt')
    await writeFile(firstPath, 'First book title\n\nFirst book text.', 'utf8')
    await writeFile(secondPath, 'Second book\n\nSecond book text.', 'utf8')
    const launched = await launchReader({ userData: workspace.userData })
    application = launched.application
    const { page } = launched
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-workspace-ready', 'true')
    await application.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as unknown as typeof dialog.showOpenDialog
    }, [firstPath, secondPath])
    await page.getByTestId('import-book').click()
    await expect(page.getByTestId('book-import-summary')).toContainText('已导入 2 本')
    await page.getByTestId('book-import-close').click()
    const books = await page.evaluate(() => window.readerApi.listBooks())
    const first = books.find((book) => book.title === 'Original filename')!
    const second = books.find((book) => book.title === 'Second book')!

    await application.evaluate(({ ipcMain }, channel) => {
      type UpdateMetadata = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<BookRecord>
      const original = (ipcMain as unknown as { _invokeHandlers: Map<string, UpdateMetadata> })._invokeHandlers.get(channel)!
      const state: NonNullable<LoadingProcess['__readerLoadRace']> = { pending: false }
      ;(globalThis as LoadingProcess).__readerLoadRace = state
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (event, ...args) => {
        const result = await original(event, ...args)
        state.pending = true
        await new Promise<void>((resolveUpdate) => { state.release = resolveUpdate })
        return result
      })
    }, IPC_CHANNELS.booksUpdateMetadata)
    await page.locator(`[data-testid="book-item"][data-book-id="${first.id}"]`).click()
    await expect.poll(() => application!.evaluate(() => (globalThis as LoadingProcess).__readerLoadRace?.pending)).toBe(true)
    await showLibrary(page)
    await page.locator(`[data-testid="book-item"][data-book-id="${second.id}"]`).click()
    await expect(page.getByTestId('reader-host')).toContainText('Second book text.')

    await application.evaluate(() => (globalThis as LoadingProcess).__readerLoadRace!.release!())
    await expect(page.locator(`[data-testid="book-tab"][data-book-id="${first.id}"]`)).toContainText('First book title')
    await expect(page.locator(`[data-testid="book-tab"][data-book-id="${second.id}"]`)).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.workspace-book-identity h1')).toHaveText('Second book')
    await expect(page.getByTestId('reader-host')).toContainText('Second book text.')
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

for (const outcome of ['success', 'failure'] as const) {
  test(`keeps the current PDF when an earlier TXT load finishes with ${outcome}`, async () => {
    const workspace = await createE2eWorkspace('reader-loading-race-')
    let application: ElectronApplication | undefined
    try {
      const txt = join(workspace.root, '迟到的书.txt')
      await writeFile(txt, '# 迟到的书\n\n这段正文不应替换已经打开的 PDF。', 'utf8')
      const launched = await launchReader({ userData: workspace.userData })
      application = launched.application
      const { page } = launched
      await expect(page.locator('.workspace-shell')).toHaveAttribute('data-workspace-ready', 'true')
      await application.evaluate(({ dialog }, paths) => {
        dialog.showOpenDialog = (async (_window: BaseWindow, options: OpenDialogOptions) => {
          if (!options.properties?.includes('multiSelections')) throw new Error('Expected batch import')
          return { canceled: false, filePaths: paths, bookmarks: [] }
        }) as unknown as typeof dialog.showOpenDialog
      }, [txt, resolve('tests/e2e/fixtures/text-reader.pdf')])
      await page.getByTestId('import-book').click()
      await expect(page.getByTestId('book-import-summary')).toContainText('已导入 2 本')
      await page.getByTestId('book-import-close').click()
      const payloads = await page.evaluate(async () => Promise.all((await window.readerApi.listBooks()).map(async (book) => {
        const payload = await window.readerApi.readBook(book.id)
        return { book: payload.book, bytes: Array.from(payload.bytes) }
      })))
      const first = payloads.find((payload) => payload.book.format === 'txt')!.book
      const second = payloads.find((payload) => payload.book.format === 'pdf')!.book
      // Delay only this disposable app's read boundary. The real preload,
      // format module loading and reader construction still run in the renderer.
      await application.evaluate(({ ipcMain }, input) => {
        const state: NonNullable<LoadingProcess['__readerLoadRace']> = { pending: false }
        ;(globalThis as LoadingProcess).__readerLoadRace = state
        const records = new Map(input.payloads.map((payload) => [payload.book.id, {
          book: payload.book, bytes: new Uint8Array(payload.bytes)
        }]))
        ipcMain.removeHandler(input.channel)
        ipcMain.handle(input.channel, (_event, bookId: string) => {
          const payload = records.get(bookId)
          if (!payload) throw new Error('Missing test book')
          if (bookId !== input.firstId) return payload
          state.pending = true
          return new Promise<BookPayload>((resolveRead, rejectRead) => {
            state.release = () => input.outcome === 'success'
              ? resolveRead(payload)
              : rejectRead(new Error('[READ_FAILED] Delayed test book failure.'))
          })
        })
      }, { channel: IPC_CHANNELS.booksRead, payloads, firstId: first.id, outcome })

      await page.locator(`[data-testid="book-item"][data-book-id="${first.id}"]`).click()
      await expect.poll(() => application!.evaluate(() => (globalThis as LoadingProcess).__readerLoadRace?.pending)).toBe(true)
      await showLibrary(page)
      await page.locator(`[data-testid="book-item"][data-book-id="${second.id}"]`).click()
      await expect(page.getByTestId('pdf-reader')).toBeVisible()
      await expect(page.locator('.pdf-page')).toHaveCount(3)
      await expect.poll(() => page.locator('.pdf-page-canvas').first().evaluate((canvas) => (canvas as HTMLCanvasElement).width)).toBeGreaterThan(0)

      await application.evaluate(() => {
        const release = (globalThis as LoadingProcess).__readerLoadRace?.release
        if (!release) throw new Error('Expected a pending TXT read')
        release()
      })
      await page.evaluate(async () => {
        await window.readerApi.listBooks()
        await new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())))
      })
      await expect(page.locator(`[data-testid="book-tab"][data-book-id="${second.id}"]`)).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByTestId('pdf-reader')).toBeVisible()
      await expect(page.locator('.pdf-page')).toHaveCount(3)
      await expect(page.locator('.reader-document--txt')).toHaveCount(0)
    } finally {
      await cleanupE2eWorkspace(application, workspace.root)
    }
  })
}
