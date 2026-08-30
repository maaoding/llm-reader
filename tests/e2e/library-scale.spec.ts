import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BaseWindow, OpenDialogOptions } from 'electron'
import {
  cleanupE2eWorkspace,
  createE2eWorkspace,
  launchReader
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

async function createFileDropSource(page: Page, path: string): Promise<void> {
  await page.evaluate(() => {
    const previous = document.querySelector('[data-testid="e2e-file-source"]')
    previous?.remove()
    const input = document.createElement('input')
    input.type = 'file'
    input.dataset.testid = 'e2e-file-source'
    input.style.position = 'fixed'
    input.style.left = '-10000px'
    document.body.append(input)
  })
  await page.getByTestId('e2e-file-source').setInputFiles(path)
}

async function dispatchFileDrag(page: Page, type: 'dragenter' | 'dragleave' | 'drop'): Promise<void> {
  await page.evaluate((eventType) => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="e2e-file-source"]')
    if (!input?.files?.length) throw new Error('Missing disk-backed test file')
    const transfer = new DataTransfer()
    for (const file of input.files) transfer.items.add(file)
    window.dispatchEvent(new DragEvent(eventType, {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer
    }))
  }, type)
}

async function applyVisualAppearance(
  application: ElectronApplication,
  page: Page,
  width: number,
  height: number,
  theme: 'light' | 'dark',
  scale: '100' | '125'
): Promise<void> {
  await application.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height })
  await page.evaluate(({ nextTheme, nextScale }) => {
    document.documentElement.dataset.theme = nextTheme
    document.documentElement.dataset.themePreference = nextTheme
    document.documentElement.style.colorScheme = nextTheme
    const shell = document.querySelector<HTMLElement>('[data-testid="app-shell"]')
    if (shell) {
      shell.dataset.theme = nextTheme
      shell.dataset.themePreference = nextTheme
      shell.dataset.interfaceScale = nextScale
    }
  }, { nextTheme: theme, nextScale: scale })
  await page.waitForTimeout(200)
}

test('keeps single-file import opening behavior and summarizes a mixed multi-file batch', async () => {
  const workspace = await createE2eWorkspace('llm-reader-batch-e2e-')
  let application: ElectronApplication | undefined

  try {
    const singlePath = join(workspace.root, 'single-reading.txt')
    const firstPath = join(workspace.root, 'first-batch.txt')
    const duplicatePath = join(workspace.root, 'duplicate-batch.txt')
    const brokenPaths = Array.from({ length: 18 }, (_, index) => join(workspace.root, `broken-batch-${index + 1}.epub`))
    await Promise.all([
      writeFile(singlePath, '单本导入后应自动打开这段正文。', 'utf8'),
      writeFile(firstPath, '批量导入中的唯一正文。', 'utf8'),
      writeFile(duplicatePath, '批量导入中的唯一正文。', 'utf8'),
      ...brokenPaths.map((path) => writeFile(path, 'not-an-epub', 'utf8'))
    ])

    const launched = await launchReader({ userData: workspace.userData })
    application = launched.application
    const { page } = launched
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1536, 864))

    await stubImportDialog(application, [singlePath])
    await page.getByTestId('import-book').click()
    await expect(page.getByTestId('reader-host')).toContainText('单本导入后应自动打开这段正文。')
    await expect(page.getByTestId('book-import-dialog')).toHaveCount(0)

    await page.getByTestId('library-tab').click()
    await stubImportDialog(application, [firstPath, duplicatePath, ...brokenPaths])
    await page.getByTestId('import-book').click()

    const dialog = page.getByTestId('book-import-dialog')
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('book-import-summary')).toContainText('已导入 1 本 · 重复 1 本 · 失败 18 本 · 跳过 0 本')
    await expect(page.getByTestId('book-import-failure')).toHaveCount(18)
    await expect(page.getByTestId('book-import-failure').first()).toContainText('broken-batch-1.epub')
    await expect(dialog).not.toContainText(workspace.root)
    await expect(page.getByTestId('library-tab')).toHaveClass(/is-active/u)
    await expect(page.getByTestId('reader-host')).toContainText('单本导入后应自动打开这段正文。')
    await expect(page.getByTestId('book-item')).toHaveCount(2)

    const visualDirectory = process.env.LLM_READER_VISUAL_DIR
    if (visualDirectory) {
      await mkdir(visualDirectory, { recursive: true })
      await page.screenshot({ path: join(visualDirectory, 'book-import-summary-light-1536x864-100.png') })
      await applyVisualAppearance(application, page, 940, 600, 'dark', '125')
      await page.screenshot({ path: join(visualDirectory, 'book-import-summary-dark-940x600-125.png') })
    }

    await page.getByTestId('book-import-close').click()
    await expect(page.getByTestId('book-import-dialog')).toHaveCount(0)
    await expect(page.getByTestId('import-book')).toBeFocused()
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('shows the whole-window drop target, hides it on leave, and imports a real dropped file', async () => {
  const workspace = await createE2eWorkspace('llm-reader-drop-e2e-')
  let application: ElectronApplication | undefined

  try {
    const fixture = join(workspace.root, 'dropped-reading.txt')
    await writeFile(fixture, '真实文件拖入后可直接阅读。', 'utf8')
    const launched = await launchReader({ userData: workspace.userData })
    application = launched.application
    const { page } = launched
    const initialUrl = page.url()
    await expect(page.getByTestId('app-shell')).toBeVisible()
    const visualDirectory = process.env.LLM_READER_VISUAL_DIR
    if (visualDirectory) {
      await mkdir(visualDirectory, { recursive: true })
      await applyVisualAppearance(application, page, 1536, 864, 'light', '100')
    }
    await createFileDropSource(page, fixture)

    await dispatchFileDrag(page, 'dragenter')
    await expect(page.getByTestId('book-drop-overlay')).toContainText('释放以导入书籍')
    if (visualDirectory) {
      await page.waitForTimeout(200)
      await page.screenshot({ path: join(visualDirectory, 'book-drop-overlay-light-1536x864-100.png') })
    }
    await dispatchFileDrag(page, 'dragleave')
    await expect(page.getByTestId('book-drop-overlay')).toHaveCount(0)

    if (visualDirectory) {
      await applyVisualAppearance(application, page, 940, 600, 'dark', '125')
      await dispatchFileDrag(page, 'dragenter')
      await expect(page.getByTestId('book-drop-overlay')).toBeVisible()
      await page.waitForTimeout(200)
      await page.screenshot({ path: join(visualDirectory, 'book-drop-overlay-dark-940x600-125.png') })
      await dispatchFileDrag(page, 'dragleave')
    }

    await dispatchFileDrag(page, 'dragenter')
    await dispatchFileDrag(page, 'drop')
    await expect(page.getByTestId('reader-host')).toContainText('真实文件拖入后可直接阅读。')
    await page.getByTestId('library-tab').click()
    await expect(page.getByTestId('book-item')).toHaveCount(1)
    expect(page.url()).toBe(initialUrl)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('cancels after the active item, keeps partial results, and marks remaining files skipped', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-cancel-e2e-')
  let application: ElectronApplication | undefined

  try {
    const slowPath = join(workspace.root, 'current-large.txt')
    await writeFile(slowPath, '取消请求到达时，当前条目仍应完成。', 'utf8')
    const remainingPaths = Array.from({ length: 80 }, (_, index) => join(workspace.root, `remaining-${index}.txt`))
    await Promise.all(remainingPaths.map((path, index) => writeFile(path, `未处理条目 ${index}`, 'utf8')))

    const launched = await launchReader({
      userData: workspace.userData,
      env: { LLM_READER_E2E_IMPORT_DELAY_MS: '75' }
    })
    application = launched.application
    const { page } = launched
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(940, 600))
    await stubImportDialog(application, [slowPath, ...remainingPaths])
    await page.getByTestId('import-book').click()

    const dialog = page.getByTestId('book-import-dialog')
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await createFileDropSource(page, remainingPaths[0])
    await dispatchFileDrag(page, 'dragenter')
    await expect(page.getByTestId('book-drop-overlay')).toContainText('正在导入书籍')
    await dispatchFileDrag(page, 'dragleave')
    await expect(page.getByTestId('book-drop-overlay')).toHaveCount(0)

    const visualDirectory = process.env.LLM_READER_VISUAL_DIR
    if (visualDirectory) {
      await mkdir(visualDirectory, { recursive: true })
      await applyVisualAppearance(application, page, 1536, 864, 'light', '100')
      await page.screenshot({ path: join(visualDirectory, 'book-import-progress-light-1536x864-100.png') })
      await applyVisualAppearance(application, page, 940, 600, 'dark', '125')
      await page.screenshot({ path: join(visualDirectory, 'book-import-progress-dark-940x600-125.png') })
    }

    await page.getByTestId('book-import-cancel').click()
    await expect(page.getByTestId('book-import-summary')).toBeVisible()
    await expect(page.getByTestId('book-import-summary')).toContainText('导入已停止。')
    const summary = (await page.getByTestId('book-import-summary').textContent()) ?? ''
    const skipped = Number(summary.match(/跳过 (\d+) 本/u)?.[1] ?? '0')
    expect(skipped).toBeGreaterThan(0)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('renders and scrolls a 300-book library and opens its last visible entry', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-300-e2e-')
  let application: ElectronApplication | undefined

  try {
    const fixtureDirectory = join(workspace.root, 'books')
    await mkdir(fixtureDirectory, { recursive: true })
    const paths = Array.from({ length: 300 }, (_, index) => join(fixtureDirectory, `scale-book-${String(index + 1).padStart(3, '0')}.txt`))
    await Promise.all(paths.map((path, index) => writeFile(path, `规模化书库正文 ${index + 1}`, 'utf8')))

    const launched = await launchReader({ userData: workspace.userData })
    application = launched.application
    const { page } = launched
    await stubImportDialog(application, paths)
    await page.getByTestId('import-book').click()
    await expect(page.getByTestId('book-import-summary')).toContainText('已导入 300 本', { timeout: 120_000 })
    await page.getByTestId('book-import-close').click()
    const items = page.getByTestId('book-item')
    await expect(items).toHaveCount(300)

    const library = page.getByTestId('library-list')
    await library.evaluate((element) => {
      element.scrollTop = element.scrollHeight
      element.dispatchEvent(new Event('scroll'))
    })
    const last = items.last()
    await last.scrollIntoViewIfNeeded()
    await expect(last).toBeVisible()
    await last.click()
    await expect(page.locator('.reader-heading h1')).toContainText('规模化书库正文')
    await expect(page.getByTestId('reader-host')).toContainText('规模化书库正文')
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
