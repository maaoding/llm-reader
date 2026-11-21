import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader } from './support/electron-app'
import { enterReading, resizeWorkspace, showLibrary } from './support/workspace'

async function chooseDirectory(app: ElectronApplication, directory: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, directory)
}

async function openBackup(page: Page): Promise<void> {
  await page.getByTestId('settings-button').click()
  await page.getByTestId('settings-nav-backup').click()
  await expect(page.getByTestId('backup-create')).toBeEnabled()
}

for (const [theme, width, height, scale] of [['light', 1180, 800, 100], ['dark', 940, 600, 125]] as const) {
  test(`backs up and restores a saved workspace at ${theme}/${width}/${scale}`, async () => {
    test.setTimeout(90_000)
    const workspace = await createE2eWorkspace('llm-reader-backup-')
    const source = join(workspace.root, '往返恢复.txt'), backups = join(workspace.root, 'backups')
    await mkdir(backups)
    await writeFile(source, '第一章 证据\n\n结论必须有原文支持。\n\n'.repeat(160))
    let application: ElectronApplication | undefined
    try {
      let launched = await launchReader({ userData: workspace.userData, importPath: source, env: { LLM_READER_E2E_NO_RELAUNCH: '1' } })
      application = launched.application
      let page = launched.page
      await resizeWorkspace(application, page, width, height)
      await showLibrary(page)
      await page.getByTestId('book-item').click()
      await enterReading(page)
      await expect(page.getByTestId('app-shell')).toHaveAttribute('data-session-tabs-state', 'ready')
      await page.locator('.right-sidebar [data-testid="followup-input"]').fill('备份时的未发送草稿')
      const bookId = await page.evaluate(async () => {
        const api = window.readerApi
        const id = (await api.listBooks())[0].id
        const highlight = await api.saveHighlight({ bookId: id, quote: '原文支持', anchor: 'txt:20:24', chapterTitle: '第一章' })
        await api.updateHighlight({ bookId: id, highlightId: highlight.id, note: '备份中的批注\n  保留缩进', tags: ['证据', '待核对'] })
        await api.saveInsight({ bookId: id, selection: { bookId: id, quote: '原文支持', anchor: 'txt:20:24', chapterTitle: '第一章',
          passages: [{ id: 'P1', text: '结论必须有原文支持。', anchor: 'txt:20:24' }] },
          question: '依据是什么？', answer: '结论必须有原文支持。', model: 'synthetic' })
        await api.createProviderProfile({ name: 'Synthetic', baseUrl: 'https://test.invalid', model: 'mock', apiKey: 'synthetic-backup-secret' })
        const workbench = await api.createWorkbench({ name: '备份工作台', bookIds: [id] })
        await api.saveWorkbench({ id: workbench.id, name: workbench.name, bookIds: [id], draft: '多书草稿', turns: [], webSearch: 'off', persona: null })
        await api.prepareBookDocument({ bookId: id })
        return id
      })
      await expect.poll(() => page.evaluate(async (id) => (await window.readerApi.getBookAnalysis(id)).document?.status, bookId)).toBe('ready')
      await page.getByTestId('settings-button').click()
      await page.getByTestId(`theme-${theme}`).click()
      await page.getByTestId(`scale-${scale}`).click()
      await page.getByTestId('settings-nav-backup').click()
      await chooseDirectory(application, backups)
      await page.getByTestId('backup-create').click()
      await expect(page.getByTestId('backup-success')).toContainText('备份已保存')
      await expect(page.getByTestId('session-close-saving')).toHaveCount(0)
      const packagePath = join(backups, (await readdir(backups))[0])
      const manifest = JSON.parse(await readFile(join(packagePath, 'manifest.json'), 'utf8'))
      expect(manifest.summary).toMatchObject({ books: 1, highlights: 1, insights: 1, sessions: 1, workbenches: 1 })
      expect(manifest.credentialsIncluded).toBe(false)
      await page.screenshot({ path: test.info().outputPath(`backup-${theme}.png`) })

      await page.getByTestId('settings-close').click()
      await page.locator('.right-sidebar [data-testid="followup-input"]').fill('恢复前的另一份草稿')
      await expect.poll(() => page.evaluate(async (id) => (await window.readerApi.getBookSession(id))?.draft, bookId)).toBe('恢复前的另一份草稿')
      await openBackup(page)
      await chooseDirectory(application, packagePath)
      await page.getByTestId('backup-select').click()
      await expect(page.getByTestId('backup-preview')).toContainText('1 本书')
      await page.screenshot({ path: test.info().outputPath(`restore-${theme}.png`) })
      const relaunchReceipt = join(workspace.root, 'relaunch.json')
      const packaged = await application.evaluate(({ app }, receipt) => {
        if (!app.isPackaged) return false
        // Installed applications always relaunch, regardless of source-test flags.
        // Record that request; Playwright owns the next launch and its debugger ports.
        const { writeFileSync } = process.getBuiltinModule('node:fs')!
        app.relaunch = () => writeFileSync(receipt, JSON.stringify({ executable: app.getPath('exe'), userData: app.getPath('userData') }))
        return true
      }, relaunchReceipt)
      page.once('dialog', (dialog) => dialog.accept())
      const closed = application.waitForEvent('close')
      await page.getByTestId('backup-restore').click()
      await closed
      application = undefined
      if (packaged) {
        const receipt = JSON.parse(await readFile(relaunchReceipt, 'utf8'))
        expect(receipt.userData).toBe(workspace.userData)
        expect(receipt.executable).toBe(process.env.LLM_READER_E2E_EXECUTABLE)
      }

      // The real app exits after saving the active pointer; the test owns its next launch.
      launched = await launchReader({ userData: workspace.userData, env: { LLM_READER_E2E_NO_RELAUNCH: '1' } })
      application = launched.application; page = launched.page
      await resizeWorkspace(application, page, width, height)
      await expect(page.getByTestId('app-shell')).toHaveAttribute('data-workspace-ready', 'true')
      await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme', theme)
      await expect(page.getByTestId('app-shell')).toHaveAttribute('data-interface-scale', String(scale))
      const restored = await page.evaluate(async (id) => ({
        books: await window.readerApi.listBooks(), session: await window.readerApi.getBookSession(id),
        highlights: await window.readerApi.listHighlights(id), insights: await window.readerApi.listInsights(id),
        analysis: await window.readerApi.getBookAnalysis(id), providers: await window.readerApi.getProviderOverview(),
        workbenches: await window.readerApi.listWorkbenches()
      }), bookId)
      expect(restored.books).toHaveLength(1)
      expect(restored.session?.draft).toBe('备份时的未发送草稿')
      expect(restored.highlights).toEqual([expect.objectContaining({
        bookId, quote: '原文支持', anchor: 'txt:20:24', note: '备份中的批注\n  保留缩进', tags: ['证据', '待核对']
      })])
      expect(restored.insights).toHaveLength(1)
      expect(restored.analysis.document?.status).toBe('ready')
      expect(restored.providers.profiles).toEqual([])
      expect(restored.workbenches[0].draft).toBe('多书草稿')
      const state = JSON.parse(await readFile(join(workspace.userData, 'library-state.json'), 'utf8'))
      expect(state.current).toMatch(/^restored-/u)
      expect(state.pending).toBeUndefined()
      const original = new DatabaseSync(join(workspace.userData, 'reader.sqlite3'), { readOnly: true })
      try { expect(original.prepare('SELECT draft FROM book_sessions WHERE book_id = ?').get(bookId)?.draft).toBe('恢复前的另一份草稿') }
      finally { original.close() }
      // Cancelling the native picker leaves the restored library editable.
      await openBackup(page)
      await application.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }) })
      await page.getByTestId('backup-select').click()
      await expect(page.getByTestId('session-close-saving')).toHaveCount(0)
      await expect(page.getByTestId('backup-create')).toBeEnabled()
      await expect(page.getByTestId('backup-preview')).toHaveCount(0)
      await writeFile(join(packagePath, 'library', (await readdir(join(packagePath, 'library')))[0]), 'corrupted after restore')
      await chooseDirectory(application, packagePath)
      await page.getByTestId('backup-select').click()
      await expect(page.getByTestId('backup-error')).toContainText('备份无效')
      await expect(page.getByTestId('session-close-saving')).toHaveCount(0)
      expect(await page.evaluate(async () => (await window.readerApi.listBooks()).length)).toBe(1)
    } finally { await cleanupE2eWorkspace(application, workspace.root) }
  })
}
