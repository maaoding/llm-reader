import { execFile } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import type { BaseWindow, OpenDialogOptions } from 'electron'
import { createSearchLinksEpubFixture } from './fixtures/search-links-epub'

const execFileAsync = promisify(execFile)

async function localCalibreExecutable(): Promise<string | null> {
  const candidates = [
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map((directory) => join(directory, 'ebook-convert.exe')),
    process.env.ProgramFiles ? join(process.env.ProgramFiles, 'Calibre2', 'ebook-convert.exe') : '',
    process.env['ProgramFiles(x86)'] ? join(process.env['ProgramFiles(x86)'], 'Calibre2', 'ebook-convert.exe') : '',
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'calibre', 'ebook-convert.exe') : ''
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // Continue through the bounded standard candidate list.
    }
  }
  return null
}

test('imports real no-DRM MOBI/AZW3 through local Calibre and keeps their source formats', async () => {
  test.setTimeout(180_000)
  const calibre = await localCalibreExecutable()
  test.skip(!calibre, 'Local Calibre is not installed')
  if (!calibre) return

  const testRoot = await mkdtemp(join(tmpdir(), 'llm-reader-calibre-e2e-'))
  const epubPath = join(testRoot, 'source.epub')
  const mobiPath = join(testRoot, 'source.mobi')
  const azw3Path = join(testRoot, 'source.azw3')
  const userData = join(testRoot, 'profile')
  const visualDirectory = process.env.LLM_READER_VISUAL_DIR
  let application: ElectronApplication | undefined

  try {
    await createSearchLinksEpubFixture(epubPath)
    await execFileAsync(calibre, [epubPath, mobiPath], { timeout: 120_000, windowsHide: true })
    await execFileAsync(calibre, [epubPath, azw3Path], { timeout: 120_000, windowsHide: true })

    application = await electron.launch({
      args: ['.'],
      env: { ...process.env, LLM_READER_USER_DATA: userData }
    })
    const page = await application.firstWindow()
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))
    await expect(page.getByTestId('import-book')).toBeVisible()
    await application.evaluate(({ dialog }, sourcePaths) => {
      const runtime = globalThis as typeof globalThis & {
        __llmReaderCalibreDialogCall?: number
        __llmReaderCalibreFilter?: string[]
      }
      runtime.__llmReaderCalibreDialogCall = 0
      dialog.showOpenDialog = (async (_window: BaseWindow, options: OpenDialogOptions) => {
        const call = runtime.__llmReaderCalibreDialogCall ?? 0
        runtime.__llmReaderCalibreDialogCall = call + 1
        runtime.__llmReaderCalibreFilter = options.filters?.[0]?.extensions ?? []
        const filePath = sourcePaths[Math.min(call, sourcePaths.length - 1)]
        return { canceled: false, filePaths: [filePath], bookmarks: [] }
      }) as unknown as typeof dialog.showOpenDialog
    }, [mobiPath, azw3Path, mobiPath])

    await page.getByTestId('import-book').click()
    await expect(page.getByTestId('book-item')).toHaveCount(1, { timeout: 120_000 })
    await expect(page.getByTestId('book-item')).toHaveAttribute('data-source-format', 'mobi')
    await expect(page.locator('.format-chip')).toHaveText('MOBI')
    await expect(page.getByTestId('toc-item').first()).toBeVisible({ timeout: 120_000 })

    await page.getByTestId('library-tab').click()
    await page.getByTestId('import-book').click()
    await expect(page.getByTestId('book-item')).toHaveCount(2, { timeout: 120_000 })
    await expect(page.locator('[data-testid="book-item"][data-source-format="azw3"]')).toHaveCount(1)
    await expect(page.locator('.format-chip')).toHaveText('AZW3')
    await expect(page.getByTestId('toc-item').first()).toBeVisible({ timeout: 120_000 })

    await page.getByTestId('library-tab').click()
    const azw3Book = page.locator('.book-item').filter({
      has: page.locator('[data-testid="book-item"][data-source-format="azw3"]')
    })
    await azw3Book.getByTestId('book-info').click()
    await expect(page.getByTestId('book-details-modal')).toContainText('AZW3（经 Calibre 转换）')
    if (visualDirectory) {
      await page.screenshot({ path: join(visualDirectory, 'calibre-details-light-1440x900.png') })
    }
    await page.getByTestId('book-details-close').click()
    await page.getByTestId('import-book').click()
    await expect(page.getByTestId('book-item')).toHaveCount(2)
    await expect(page.getByText('这本书已在书库中，已为你打开。')).toBeVisible()
    const filterExtensions = await application.evaluate(() => (
      globalThis as typeof globalThis & { __llmReaderCalibreFilter?: string[] }
    ).__llmReaderCalibreFilter)
    expect(filterExtensions).toEqual(['epub', 'txt', 'pdf', 'mobi', 'azw3'])

    if (visualDirectory) {
      await expect(page.getByTestId('toc-item').first()).toBeVisible({ timeout: 120_000 })
      await page.getByTestId('library-tab').click()
      await page.getByTestId('settings-button').click()
      await page.getByTestId('theme-dark').click()
      await page.getByTestId('scale-125').click()
      await page.getByTestId('settings-close').click()
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(940, 600))
      await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme', 'dark')
      await page.screenshot({ path: join(visualDirectory, 'calibre-library-dark-940x600-125.png') })
    }
  } finally {
    await application?.close().catch(() => undefined)
    await rm(testRoot, { recursive: true, force: true })
  }
})
