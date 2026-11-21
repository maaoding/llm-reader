import { expect, test, type ElectronApplication } from '@playwright/test'
import type { BaseWindow, OpenDialogOptions } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC_CHANNELS, type HighlightRecord, type InsightArchiveRecord } from '../../src/shared/contracts'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader } from './support/electron-app'
import { enterReading, showLibrary } from './support/workspace'

interface ReadFault {
  blocked: boolean
  calls: number
  records: HighlightRecord[] | InsightArchiveRecord[]
}

type FaultProcess = typeof globalThis & { __listReadFaults?: Record<string, ReadFault> }

// Fault only the read boundary in a disposable app. Records are first saved and
// read through the real library APIs; preload and renderer permissions stay intact.
async function failListRead(
  application: ElectronApplication,
  channel: string,
  records: ReadFault['records']
): Promise<void> {
  await application.evaluate(({ ipcMain }, input) => {
    const process = globalThis as FaultProcess
    process.__listReadFaults ??= {}
    const state: ReadFault = { blocked: true, calls: 0, records: input.records }
    process.__listReadFaults[input.channel] = state
    ipcMain.removeHandler(input.channel)
    ipcMain.handle(input.channel, () => {
      state.calls += 1
      if (state.blocked) throw new Error('[READ_FAILED] Injected local list read failure.')
      return state.records
    })
  }, { channel, records })
}

async function allowListRead(application: ElectronApplication, channel: string): Promise<void> {
  await application.evaluate((_electron, name) => {
    const state = (globalThis as FaultProcess).__listReadFaults?.[name]
    if (!state) throw new Error('Missing list read fault')
    state.blocked = false
  }, channel)
}

async function listReadCalls(application: ElectronApplication, channel: string): Promise<number> {
  return application.evaluate((_electron, name) => (globalThis as FaultProcess).__listReadFaults?.[name]?.calls ?? 0, channel)
}

const quote = '供恢复测试使用的原文。'

test('keeps an archive read error visible and retries without claiming saved answers are empty', async () => {
  const workspace = await createE2eWorkspace('reader-insights-read-recovery-')
  let application: ElectronApplication | undefined
  try {
    const fixture = join(workspace.root, '问答集恢复.txt')
    await writeFile(fixture, `${quote}\n\n读取失败不代表本机归档已经被删除。`, 'utf8')
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const { page } = launched
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-workspace-ready', 'true')
    const saved = await page.evaluate(async () => {
      const book = (await window.readerApi.listBooks())[0]
      await window.readerApi.saveInsight({
        bookId: book.id, conversationId: crypto.randomUUID(), selection: null,
        context: { scope: 'book', bookId: book.id, selection: null, passages: [], background: '', coverage: { covered: 0, total: 0 } },
        question: '读取出错时，归档是否仍然保留？', answer: '归档仍在本机，重试读取后可以恢复。', model: 'local-fixture'
      })
      return window.readerApi.listAllInsights()
    })
    expect(saved).toHaveLength(1)
    await failListRead(application, IPC_CHANNELS.insightsListAll, saved)
    await page.reload()
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-workspace-ready', 'true')
    await page.getByTestId('nav-archives').click()
    const error = page.getByTestId('insights-load-error')
    await expect(error).toBeVisible()
    await expect(page.getByTestId('insights-view').getByText('还没有归档的回答', { exact: true })).toHaveCount(0)
    await expect(page.getByTestId('insight-item')).toHaveCount(0)

    // The previous toast vanished after 3.2 seconds; the actionable error must remain.
    await page.waitForTimeout(3_400)
    await expect(error).toBeVisible()
    const beforeRetry = await listReadCalls(application, IPC_CHANNELS.insightsListAll)
    await page.getByTestId('insights-retry').click()
    await expect.poll(() => listReadCalls(application!, IPC_CHANNELS.insightsListAll)).toBeGreaterThan(beforeRetry)
    await expect(error).toBeVisible()
    await expect(page.getByTestId('insights-view').getByText('还没有归档的回答', { exact: true })).toHaveCount(0)

    await allowListRead(application, IPC_CHANNELS.insightsListAll)
    await page.getByTestId('insights-retry').click()
    await expect(error).toHaveCount(0)
    await expect(page.getByTestId('insight-item')).toHaveCount(1)
    await expect(page.getByTestId('insight-item')).toContainText(saved[0].answer)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('keeps an extract read error separate from an empty book and restores extracts on retry', async () => {
  const workspace = await createE2eWorkspace('reader-highlights-read-recovery-')
  let application: ElectronApplication | undefined
  try {
    const fixture = join(workspace.root, '摘录恢复.txt')
    await writeFile(fixture, `${quote}\n\n读取失败不代表已经保存的摘录消失。`, 'utf8')
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const { page } = launched
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-workspace-ready', 'true')
    const saved = await page.evaluate(async (text) => {
      const book = (await window.readerApi.listBooks())[0]
      await window.readerApi.saveHighlight({ bookId: book.id, quote: text, anchor: `txt:0:${Array.from(text).length}`, chapterTitle: '全文' })
      return window.readerApi.listHighlights(book.id)
    }, quote)
    expect(saved).toHaveLength(1)
    await failListRead(application, IPC_CHANNELS.highlightsList, saved)
    await page.reload()
    await showLibrary(page)
    await page.getByTestId('book-item').first().click()
    await enterReading(page)
    await page.getByTestId('highlights-tab').click()
    const error = page.getByTestId('highlights-load-error')
    await expect(error).toBeVisible()
    await expect(page.getByTestId('highlight-list').getByText('还没有摘录', { exact: true })).toHaveCount(0)
    await expect(page.getByTestId('highlight-item')).toHaveCount(0)
    await page.waitForTimeout(3_400)
    await expect(error).toBeVisible()

    await allowListRead(application, IPC_CHANNELS.highlightsList)
    await page.getByTestId('highlights-retry').click()
    await expect(error).toHaveCount(0)
    await expect(page.getByTestId('highlight-item')).toHaveCount(1)
    await expect(page.getByTestId('highlight-item')).toContainText(quote)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('ignores an old book extract failure after another book has loaded its own extracts', async () => {
  const workspace = await createE2eWorkspace('reader-highlights-stale-error-')
  let application: ElectronApplication | undefined
  try {
    const firstPath = join(workspace.root, '旧书.txt')
    const secondPath = join(workspace.root, '当前书.txt')
    await Promise.all([
      writeFile(firstPath, '旧书原文。\n\n这本书的请求会延迟失败。', 'utf8'),
      writeFile(secondPath, '当前书原文。\n\n这本书的摘录应该正常显示。', 'utf8')
    ])
    const launched = await launchReader({ userData: workspace.userData })
    application = launched.application
    const { page } = launched
    await showLibrary(page)
    await application.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async (_window: BaseWindow, options: OpenDialogOptions) => {
        if (!options.properties?.includes('multiSelections')) throw new Error('Expected multiSelections')
        return { canceled: false, filePaths: paths, bookmarks: [] }
      }) as unknown as typeof dialog.showOpenDialog
    }, [firstPath, secondPath])
    await page.getByTestId('import-book').click()
    await expect(page.getByTestId('book-import-summary')).toContainText('已导入 2 本')
    await page.getByTestId('book-import-close').click()
    const fixture = await page.evaluate(async () => {
      const books = await window.readerApi.listBooks()
      const first = books.find((book) => book.originalName === '旧书.txt')!
      const second = books.find((book) => book.originalName === '当前书.txt')!
      await window.readerApi.saveHighlight({ bookId: second.id, quote: '当前书原文。', anchor: 'txt:0:6', chapterTitle: '全文' })
      return { firstId: first.id, secondId: second.id, records: await window.readerApi.listHighlights(second.id) }
    })
    await application.evaluate(({ ipcMain }, input) => {
      const process = globalThis as typeof globalThis & { __lateHighlightFailure?: { pending: boolean; reject?: () => void } }
      const fault = { pending: false } as { pending: boolean; reject?: () => void }
      process.__lateHighlightFailure = fault
      ipcMain.removeHandler(input.channel)
      ipcMain.handle(input.channel, (_event, bookId: string) => {
        if (bookId !== input.firstId) return input.records
        fault.pending = true
        return new Promise<HighlightRecord[]>((_resolve, reject) => {
          fault.reject = () => reject(new Error('[READ_FAILED] Old book extract request failed.'))
        })
      })
    }, { ...fixture, channel: IPC_CHANNELS.highlightsList })

    await page.locator(`[data-testid="book-item"][data-book-id="${fixture.firstId}"]`).click()
    await enterReading(page)
    await expect.poll(() => application!.evaluate(() => (globalThis as typeof globalThis & {
      __lateHighlightFailure?: { pending: boolean }
    }).__lateHighlightFailure?.pending ?? false)).toBe(true)
    await showLibrary(page)
    await page.locator(`[data-testid="book-item"][data-book-id="${fixture.secondId}"]`).click()
    await enterReading(page)
    await page.getByTestId('highlights-tab').click()
    await expect(page.getByTestId('highlight-item')).toHaveCount(1)
    await expect(page.getByTestId('highlight-item')).toContainText('当前书原文。')

    await application.evaluate(() => {
      const fault = (globalThis as typeof globalThis & { __lateHighlightFailure?: { reject?: () => void } }).__lateHighlightFailure
      if (!fault?.reject) throw new Error('Old book request was not pending')
      fault.reject()
    })
    // A subsequent IPC round trip and animation frame let the rejected reply be
    // handled before checking that the current book's UI remains unchanged.
    await page.evaluate(async (bookId) => {
      await window.readerApi.listHighlights(bookId)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }, fixture.secondId)
    await expect(page.getByTestId('highlights-load-error')).toHaveCount(0)
    await expect(page.getByTestId('highlight-item')).toHaveCount(1)
    await expect(page.getByTestId('highlight-item')).toContainText('当前书原文。')
    await expect(page.getByTestId('highlight-list').locator('.sidebar-loading')).toHaveCount(0)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
