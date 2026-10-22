import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { IpcMainInvokeEvent } from 'electron'
import type { SaveBookSessionInput, SessionTabsState } from '../../src/shared/contracts'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader, restartReader } from './support/electron-app'
import { enterReading, showLibrary } from './support/workspace'

type SaveTable = 'book_sessions' | 'session_tabs'
type SessionSaveHandler = (event: IpcMainInvokeEvent, payload: SaveBookSessionInput) => unknown
interface DelayedSaveFixture {
  original: SessionSaveHandler
  pauseNext: boolean
  release?: () => void
  drafts: string[]
  active: number
  maxActive: number
}
type DelayedSaveGlobal = typeof globalThis & { delayedSessionSave?: DelayedSaveFixture }
type SessionTabsReadHandler = (event: IpcMainInvokeEvent) => unknown
type SessionDeleteHandler = (event: IpcMainInvokeEvent, input: { bookId: string; conversationId?: string }) => unknown
interface DelayedDeleteFixture {
  original: SessionDeleteHandler
  started: boolean
  release?: () => void
}
type RecoveryFaultGlobal = typeof globalThis & {
  failedTabsRead?: SessionTabsReadHandler
  delayedSessionDelete?: DelayedDeleteFixture
}

const bookFixture = resolve('tests/fixtures/complex-reading.txt')
const sidebarDraft = '.right-sidebar [data-testid="followup-input"]'
const dialogDraft = '.assistant-dialog [data-testid="followup-input"]'
const baselineDraft = '已经保存的初始草稿'

function setSaveFailure(userData: string, table: SaveTable, enabled: boolean): void {
  const database = new DatabaseSync(join(userData, 'reader.sqlite3'))
  try {
    database.exec('PRAGMA busy_timeout = 5000')
    database.exec(`DROP TRIGGER IF EXISTS e2e_fail_${table}`)
    if (enabled) {
      // Fail at the real persistence boundary, preserving the production IPC,
      // transaction rollback, existing data and subsequent retry paths.
      database.exec(`CREATE TRIGGER e2e_fail_${table} BEFORE INSERT ON ${table}
        BEGIN SELECT RAISE(ABORT, 'Synthetic session persistence failure'); END`)
    }
  } finally { database.close() }
}

function clearSaveFailures(userData: string): void {
  if (!existsSync(join(userData, 'reader.sqlite3'))) return
  setSaveFailure(userData, 'book_sessions', false)
  setSaveFailure(userData, 'session_tabs', false)
}

function readStoredSessionTabs(userData: string) {
  const database = new DatabaseSync(join(userData, 'reader.sqlite3'), { readOnly: true })
  try { return database.prepare('SELECT * FROM session_tabs ORDER BY position').all() }
  finally { database.close() }
}

async function setTabsReadFailure(application: ElectronApplication, enabled: boolean): Promise<void> {
  await application.evaluate(({ ipcMain }, shouldFail) => {
    const state = globalThis as RecoveryFaultGlobal
    if (shouldFail) {
      const original = (ipcMain as unknown as { _invokeHandlers: Map<string, SessionTabsReadHandler> })._invokeHandlers.get('session-tabs:list')
      if (!original) throw new Error('Missing production session tab read handler')
      state.failedTabsRead = original
      ipcMain.removeHandler('session-tabs:list')
      ipcMain.handle('session-tabs:list', () => { throw new Error('Synthetic session tab read failure') })
    } else if (state.failedTabsRead) {
      ipcMain.removeHandler('session-tabs:list')
      ipcMain.handle('session-tabs:list', state.failedTabsRead)
      delete state.failedTabsRead
    }
  }, enabled)
}

async function delayFailingSessionDelete(application: ElectronApplication): Promise<void> {
  await application.evaluate(({ ipcMain }) => {
    const original = (ipcMain as unknown as { _invokeHandlers: Map<string, SessionDeleteHandler> })._invokeHandlers.get('sessions:delete')
    if (!original) throw new Error('Missing production session delete handler')
    const fixture: DelayedDeleteFixture = { original, started: false }
    ;(globalThis as RecoveryFaultGlobal).delayedSessionDelete = fixture
    ipcMain.removeHandler('sessions:delete')
    ipcMain.handle('sessions:delete', async () => {
      fixture.started = true
      await new Promise<void>((release) => { fixture.release = release })
      throw new Error('Synthetic session delete failure')
    })
  })
}

async function releaseFailingSessionDelete(application: ElectronApplication): Promise<void> {
  await application.evaluate(({ ipcMain }) => {
    const state = globalThis as RecoveryFaultGlobal
    const fixture = state.delayedSessionDelete
    if (!fixture) return
    fixture.release?.()
    ipcMain.removeHandler('sessions:delete')
    ipcMain.handle('sessions:delete', fixture.original)
    delete state.delayedSessionDelete
  })
}

async function openSavedSession(page: Page): Promise<string> {
  await showLibrary(page)
  await expect(page.getByTestId('book-item')).toHaveCount(1)
  const bookId = await page.getByTestId('book-item').getAttribute('data-book-id')
  expect(bookId).toBeTruthy()
  await page.getByTestId('book-item').click()
  await enterReading(page)
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-session-tabs-state', 'ready')
  await page.locator(sidebarDraft).fill(baselineDraft)
  await expect.poll(() => page.evaluate(async (id) => (await window.readerApi.getBookSession(id))?.draft, bookId!)).toBe(baselineDraft)
  await expect.poll(() => page.evaluate(async () => (await window.readerApi.listSessionTabs()).tabs.length)).toBe(1)
  return bookId!
}

async function expectSaveFailure(page: Page): Promise<void> {
  const recovery = page.getByTestId('session-save-recovery')
  await expect(recovery).toBeVisible()
  await expect(recovery).toHaveAttribute('role', 'alert')
  await expect(recovery).toContainText('尚未保存')
  await expect(page.getByTestId('session-save-retry')).toBeEnabled()
}

async function delayNextSessionSave(application: ElectronApplication): Promise<void> {
  await application.evaluate(({ ipcMain }) => {
    // This inspection is confined to the disposable Electron test process.
    // Keep the original trusted handler so resumed writes still use the real DB.
    const original = (ipcMain as unknown as { _invokeHandlers: Map<string, SessionSaveHandler> })._invokeHandlers.get('sessions:save')
    if (!original) throw new Error('Missing production session save handler')
    const fixture: DelayedSaveFixture = { original, pauseNext: true, drafts: [], active: 0, maxActive: 0 }
    ;(globalThis as DelayedSaveGlobal).delayedSessionSave = fixture
    ipcMain.removeHandler('sessions:save')
    ipcMain.handle('sessions:save', async (event, input: SaveBookSessionInput) => {
      fixture.drafts.push(input.draft)
      fixture.active += 1
      fixture.maxActive = Math.max(fixture.maxActive, fixture.active)
      try {
        if (fixture.pauseNext) {
          fixture.pauseNext = false
          await new Promise<void>((release) => { fixture.release = release })
        }
        return await original(event, input)
      } finally { fixture.active -= 1 }
    })
  })
}

async function releaseDelayedSave(application: ElectronApplication, restore = false): Promise<void> {
  await application.evaluate(({ ipcMain }, shouldRestore) => {
    const fixture = (globalThis as DelayedSaveGlobal).delayedSessionSave
    if (!fixture) return
    fixture.release?.()
    if (shouldRestore) {
      ipcMain.removeHandler('sessions:save')
      ipcMain.handle('sessions:save', fixture.original)
      delete (globalThis as DelayedSaveGlobal).delayedSessionSave
    }
  }, restore)
}

test('shows failed autosaves and retries the latest live draft before restoring it after restart', async () => {
  const workspace = await createE2eWorkspace('llm-reader-live-save-recovery-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: bookFixture })
    application = launched.application
    let page = launched.page
    const bookId = await openSavedSession(page)

    setSaveFailure(workspace.userData, 'book_sessions', true)
    await page.locator(sidebarDraft).fill('第一次保存失败的草稿')
    await expectSaveFailure(page)
    const screenshot = test.info().outputPath('session-save-failed.png')
    await page.screenshot({ path: screenshot, animations: 'disabled' })
    await test.info().attach('session-save-failed', { path: screenshot, contentType: 'image/png' })
    expect(await page.evaluate(async (id) => (await window.readerApi.getBookSession(id))?.draft, bookId)).toBe(baselineDraft)

    const latestDraft = '失败后继续编辑的最新草稿，重试必须保存这一版'
    await page.locator(sidebarDraft).fill(latestDraft)
    // Cross the normal debounce while the write is still failing. Recovery must
    // remain visible without depending on an expiring toast or another edit.
    await page.waitForTimeout(700)
    await expectSaveFailure(page)
    await expect(page.locator(sidebarDraft)).toHaveValue(latestDraft)
    setSaveFailure(workspace.userData, 'book_sessions', false)
    await page.getByTestId('session-save-retry').click()
    await expect(page.getByTestId('session-save-recovery')).toHaveCount(0)
    await expect.poll(() => page.evaluate(async (id) => (await window.readerApi.getBookSession(id))?.draft, bookId)).toBe(latestDraft)

    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application
    page = restarted.page
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-workspace-ready', 'true')
    await expect(page.locator(sidebarDraft)).toHaveValue(latestDraft)
    await expect(page.getByTestId('session-save-recovery')).toHaveCount(0)
  } finally {
    clearSaveFailures(workspace.userData)
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('preserves saved archive tabs on a failed write and retries their current draft', async () => {
  const workspace = await createE2eWorkspace('llm-reader-tab-save-recovery-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: bookFixture })
    application = launched.application
    let page = launched.page
    const bookId = await openSavedSession(page)
    const archiveId = await page.evaluate(async (id) => {
      const insight = await window.readerApi.saveInsight({
        bookId: id, conversationId: crypto.randomUUID(), selection: null,
        context: { scope: 'book', bookId: id, selection: null, passages: [], background: '', coverage: { covered: 0, total: 0 } },
        question: '用于验证归档草稿保存的问题', answer: '用于验证归档草稿保存的回答', model: 'save-recovery-fixture'
      })
      return insight.id
    }, bookId)
    await page.reload()
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-workspace-ready', 'true')
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-session-tabs-state', 'ready')
    await page.getByTestId('nav-archives').click()
    await page.getByTestId('insight-item').locator('.insight-content').click()
    await page.locator(dialogDraft).fill('已保存的归档草稿')
    const readArchiveDraft = () => page.evaluate(async (id) => (await window.readerApi.listSessionTabs()).tabs.find((tab) => tab.insightId === id)?.draft, archiveId)
    await expect.poll(readArchiveDraft).toBe('已保存的归档草稿')
    const savedTabs = await page.evaluate(() => window.readerApi.listSessionTabs())

    setSaveFailure(workspace.userData, 'session_tabs', true)
    await page.locator(dialogDraft).fill('失败的归档草稿')
    await expectSaveFailure(page)
    expect(await page.evaluate(() => window.readerApi.listSessionTabs())).toEqual(savedTabs)
    const latestDraft = '归档草稿的最新修改'
    await page.locator(dialogDraft).fill(latestDraft)
    await page.waitForTimeout(700)
    await expectSaveFailure(page)
    setSaveFailure(workspace.userData, 'session_tabs', false)
    await page.getByTestId('session-save-retry').click()
    await expect.poll(readArchiveDraft).toBe(latestDraft)
    await expect(page.getByTestId('session-save-recovery')).toHaveCount(0)

    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application
    page = restarted.page
    await expect(page.getByTestId('assistant-dialog')).toBeVisible()
    await expect(page.getByTestId('assistant-session-tab')).toHaveCount(2)
    await expect(page.locator('.assistant-session-tab.is-active').getByTestId('assistant-session-tab')).toHaveAttribute('data-tab-kind', 'archive')
    await expect(page.locator(dialogDraft)).toHaveValue(latestDraft)
  } finally {
    clearSaveFailures(workspace.userData)
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('serializes a slow retry with newer edits and keeps retry busy until the latest draft is saved', async () => {
  const workspace = await createE2eWorkspace('llm-reader-ordered-save-recovery-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: bookFixture })
    application = launched.application
    const { page } = launched
    const bookId = await openSavedSession(page)
    setSaveFailure(workspace.userData, 'book_sessions', true)
    const failedDraft = '即将重试的第一版草稿'
    await page.locator(sidebarDraft).fill(failedDraft)
    await expectSaveFailure(page)
    setSaveFailure(workspace.userData, 'book_sessions', false)
    await delayNextSessionSave(application)
    await page.getByTestId('session-save-retry').click()
    await expect.poll(() => application!.evaluate(() => (globalThis as DelayedSaveGlobal).delayedSessionSave?.drafts.length)).toBe(1)
    await expect(page.getByTestId('session-save-retry')).toBeDisabled()

    const latestDraft = '慢速重试尚未结束时又编辑的新草稿'
    await page.locator(sidebarDraft).fill(latestDraft)
    await page.waitForTimeout(700)
    await expect(page.getByTestId('session-save-retry')).toBeDisabled()
    expect(await application.evaluate(() => (globalThis as DelayedSaveGlobal).delayedSessionSave?.drafts)).toEqual([failedDraft])
    expect(await page.evaluate(async (id) => (await window.readerApi.getBookSession(id))?.draft, bookId)).toBe(baselineDraft)

    await releaseDelayedSave(application)
    await expect.poll(() => page.evaluate(async (id) => (await window.readerApi.getBookSession(id))?.draft, bookId)).toBe(latestDraft)
    await expect(page.getByTestId('session-save-recovery')).toHaveCount(0)
    expect(await application.evaluate(() => {
      const fixture = (globalThis as DelayedSaveGlobal).delayedSessionSave!
      return { drafts: fixture.drafts, maxActive: fixture.maxActive }
    })).toEqual({ drafts: [failedDraft, latestDraft], maxActive: 1 })
  } finally {
    clearSaveFailures(workspace.userData)
    if (application) await releaseDelayedSave(application, true).catch(() => undefined)
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('cancels a real window close when saving fails and remains editable until saving and closing again', async () => {
  const workspace = await createE2eWorkspace('llm-reader-close-save-recovery-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: bookFixture })
    application = launched.application
    let page = launched.page
    const bookId = await openSavedSession(page)
    setSaveFailure(workspace.userData, 'book_sessions', true)
    await page.locator(sidebarDraft).fill('退出前还没保存的草稿')
    await page.getByTestId('window-close').click()
    await expect(page.getByTestId('session-save-recovery')).toContainText('已取消退出')
    // Exercise the actual BrowserWindow close handshake and cross its former
    // 1.5-second force-close deadline, rather than only sending a renderer event.
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 2_000))
    expect(page.isClosed()).toBe(false)
    expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    const latestDraft = '取消退出后继续修改的草稿'
    await page.locator(sidebarDraft).fill(latestDraft)
    await page.waitForTimeout(700)
    await expectSaveFailure(page)
    expect(await page.evaluate(async (id) => (await window.readerApi.getBookSession(id))?.draft, bookId)).toBe(baselineDraft)

    setSaveFailure(workspace.userData, 'book_sessions', false)
    await page.getByTestId('session-save-retry').click()
    await expect(page.getByTestId('session-save-recovery')).toHaveCount(0)
    await expect.poll(() => page.evaluate(async (id) => (await window.readerApi.getBookSession(id))?.draft, bookId)).toBe(latestDraft)
    expect(page.isClosed()).toBe(false)
    const closed = page.waitForEvent('close')
    await page.getByTestId('window-close').click()
    await closed
    await application.close().catch(() => undefined)
    application = undefined

    const restarted = await launchReader({ userData: workspace.userData })
    application = restarted.application
    page = restarted.page
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-workspace-ready', 'true')
    await expect(page.locator(sidebarDraft)).toHaveValue(latestDraft)
  } finally {
    clearSaveFailures(workspace.userData)
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('does not resurrect a cleared conversation when failed saves are retried', async () => {
  const workspace = await createE2eWorkspace('llm-reader-cleared-save-recovery-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: bookFixture })
    application = launched.application
    let page = launched.page
    const bookId = await openSavedSession(page)
    const oldSession = await page.evaluate((id) => window.readerApi.getBookSession(id), bookId)
    expect(oldSession).not.toBeNull()
    setSaveFailure(workspace.userData, 'book_sessions', true)
    setSaveFailure(workspace.userData, 'session_tabs', true)
    await page.locator(sidebarDraft).fill('清空之后绝不能再次出现的草稿')
    await expectSaveFailure(page)
    await page.getByTestId('assistant-expand-button').click()
    await page.getByTestId('conversation-clear').click()
    await page.getByTestId('conversation-clear-confirm').click()
    await expect(page.locator(dialogDraft)).toHaveValue('')
    await expect.poll(() => page.evaluate((input) => window.readerApi.getRecentBookSession(input), { bookId, conversationId: oldSession!.conversationId })).toBeNull()
    await page.waitForTimeout(700)
    await expectSaveFailure(page)

    clearSaveFailures(workspace.userData)
    await page.getByTestId('session-save-retry').click()
    await expect(page.getByTestId('session-save-recovery')).toHaveCount(0)
    await expect.poll(() => page.evaluate(async (id) => (await window.readerApi.getBookSession(id))?.draft, bookId)).toBe('')
    expect(await page.evaluate((input) => window.readerApi.getRecentBookSession(input), { bookId, conversationId: oldSession!.conversationId })).toBeNull()
    expect(await page.evaluate((id) => window.readerApi.listRecentBookSessions(id), bookId)).toEqual([])

    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application
    page = restarted.page
    await expect(page.getByTestId('assistant-dialog')).toBeVisible()
    await expect(page.locator(dialogDraft)).toHaveValue('')
    expect(await page.evaluate((id) => window.readerApi.listRecentBookSessions(id), bookId)).toEqual([])
  } finally {
    clearSaveFailures(workspace.userData)
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('forgets a deleted book and its failed save without recreating its session or tabs', async () => {
  const workspace = await createE2eWorkspace('llm-reader-deleted-save-recovery-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: bookFixture })
    application = launched.application
    let page = launched.page
    await openSavedSession(page)
    setSaveFailure(workspace.userData, 'book_sessions', true)
    await page.locator(sidebarDraft).fill('删书以后不能被保存重试复活的草稿')
    await expectSaveFailure(page)
    await page.getByTestId('book-details-button').click()
    await page.getByTestId('book-details-delete').click()
    await page.getByTestId('book-details-delete-confirm').click()
    await expect(page.getByTestId('book-details-modal')).toHaveCount(0)
    await expect(page.getByTestId('book-item')).toHaveCount(0)
    await expect(page.getByTestId('session-save-recovery')).toHaveCount(0)
    clearSaveFailures(workspace.userData)
    await page.waitForTimeout(700)
    expect(await page.evaluate(() => window.readerApi.listBooks())).toEqual([])
    await expect.poll(() => page.evaluate(() => window.readerApi.listSessionTabs())).toEqual({ activeIndex: null, tabs: [] })

    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application
    page = restarted.page
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-workspace-ready', 'true')
    await expect(page.getByTestId('book-item')).toHaveCount(0)
    await expect(page.getByTestId('assistant-session-tab')).toHaveCount(0)
    await expect(page.getByTestId('session-save-recovery')).toHaveCount(0)
    const database = new DatabaseSync(join(workspace.userData, 'reader.sqlite3'), { readOnly: true })
    try {
      expect(database.prepare('SELECT COUNT(*) AS count FROM book_sessions').get()?.count).toBe(0)
      expect(database.prepare('SELECT COUNT(*) AS count FROM book_session_history').get()?.count).toBe(0)
    } finally { database.close() }
  } finally {
    clearSaveFailures(workspace.userData)
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('keeps new archive edits in the window until failed tab restoration can finish and be saved', async () => {
  const workspace = await createE2eWorkspace('llm-reader-restore-close-save-recovery-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: bookFixture })
    application = launched.application
    let page = launched.page
    const bookId = await openSavedSession(page)
    await page.waitForTimeout(700)
    const fixture = await page.evaluate(async (id) => {
      const archiveIds: string[] = []
      for (const question of ['之前打开的归档问题', '读取失败后新开的归档问题']) {
        const insight = await window.readerApi.saveInsight({
          bookId: id, conversationId: crypto.randomUUID(), selection: null,
          context: { scope: 'book', bookId: id, selection: null, passages: [], background: '', coverage: { covered: 0, total: 0 } },
          question, answer: '只用于验证标签恢复与保存的合成回答', model: 'restore-save-recovery-fixture'
        })
        archiveIds.push(insight.id)
      }
      const saved: SessionTabsState = {
        activeIndex: 1,
        tabs: [
          { kind: 'live', bookId: id, insightId: null, draft: '', webSearch: 'off' },
          { kind: 'archive', bookId: id, insightId: archiveIds[0], draft: '旧标签尚未读取也不能覆盖的草稿', webSearch: 'off' }
        ]
      }
      await window.readerApi.saveSessionTabs(saved)
      return { archiveIds, saved }
    }, bookId)
    const originalRows = readStoredSessionTabs(workspace.userData)
    await setTabsReadFailure(application, true)
    await page.reload()
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-workspace-ready', 'true')
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-session-tabs-state', 'error')
    await expect(page.getByTestId('session-tabs-recovery')).toBeVisible()
    await page.getByTestId('nav-archives').click()
    await page.getByTestId('insight-item').filter({ hasText: '读取失败后新开的归档问题' }).locator('.insight-content').click()
    const latestDraft = '读取失败后新开的归档草稿，退出不能丢失'
    await page.locator(dialogDraft).fill(latestDraft)
    await page.getByTestId('window-close').click()
    await expect(page.getByTestId('session-save-recovery')).toContainText('已取消退出')
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 2_000))
    expect(page.isClosed()).toBe(false)
    await expect(page.locator(dialogDraft)).toHaveValue(latestDraft)
    expect(readStoredSessionTabs(workspace.userData)).toEqual(originalRows)

    await setTabsReadFailure(application, false)
    await page.getByTestId('session-tabs-retry').click()
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-session-tabs-state', 'ready')
    await expect(page.getByTestId('session-tabs-recovery')).toHaveCount(0)
    await expect(page.getByTestId('assistant-session-tab')).toHaveCount(3)
    await page.locator(`[data-testid="assistant-session-tab"][data-tab-id="archive-${fixture.archiveIds[1]}"]`).click()
    await expect(page.locator(dialogDraft)).toHaveValue(latestDraft)
    await page.getByTestId('session-save-retry').click()
    await expect(page.getByTestId('session-save-recovery')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.readerApi.listSessionTabs())).toEqual({
      activeIndex: 2,
      tabs: [...fixture.saved.tabs, { kind: 'archive', bookId, insightId: fixture.archiveIds[1], draft: latestDraft, webSearch: 'off' }]
    })
    const closed = page.waitForEvent('close')
    await page.getByTestId('window-close').click()
    await closed
    await application.close().catch(() => undefined)
    application = undefined

    const restarted = await launchReader({ userData: workspace.userData })
    application = restarted.application
    page = restarted.page
    await expect(page.getByTestId('assistant-dialog')).toBeVisible()
    await expect(page.getByTestId('assistant-session-tab')).toHaveCount(3)
    await expect(page.locator(dialogDraft)).toHaveValue(latestDraft)
  } finally {
    if (application) await setTabsReadFailure(application, false).catch(() => undefined)
    clearSaveFailures(workspace.userData)
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('blocks editing during a pending clear and preserves the draft when deletion fails', async () => {
  const workspace = await createE2eWorkspace('llm-reader-clear-failure-save-recovery-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: bookFixture })
    application = launched.application
    let page = launched.page
    const bookId = await openSavedSession(page)
    const originalSession = await page.evaluate((id) => window.readerApi.getBookSession(id), bookId)
    expect(originalSession).not.toBeNull()
    await page.getByTestId('assistant-expand-button').click()
    await delayFailingSessionDelete(application)
    await page.getByTestId('conversation-clear').click()
    await page.getByTestId('conversation-clear-confirm').click()
    await expect.poll(() => application!.evaluate(() => (globalThis as RecoveryFaultGlobal).delayedSessionDelete?.started)).toBe(true)
    await expect(page.locator('.assistant-dialog-body')).toHaveAttribute('inert', '')
    // Native focus and keyboard input must not modify a draft while the clear is
    // unresolved, even though the old text remains visible in the textarea.
    await page.locator(dialogDraft).evaluate((element) => (element as HTMLTextAreaElement).focus())
    expect(await page.locator(dialogDraft).evaluate((element) => document.activeElement === element)).toBe(false)
    await page.keyboard.insertText('清空过程中不允许写入的文字')
    await expect(page.locator(dialogDraft)).toHaveValue(baselineDraft)
    expect(await page.evaluate((id) => window.readerApi.getBookSession(id), bookId)).toEqual(originalSession)

    await releaseFailingSessionDelete(application)
    await expect(page.locator('.toast')).toContainText('对话保存失败')
    await expect(page.locator('.assistant-dialog-body')).not.toHaveAttribute('inert', '')
    await expect(page.locator(dialogDraft)).toHaveValue(baselineDraft)
    const editedDraft = '清空失败后仍能继续编辑并保存的草稿'
    await page.locator(dialogDraft).fill(editedDraft)
    await expect.poll(() => page.evaluate(async (id) => (await window.readerApi.getBookSession(id))?.draft, bookId)).toBe(editedDraft)
    expect((await page.evaluate((id) => window.readerApi.getBookSession(id), bookId))?.conversationId).toBe(originalSession!.conversationId)

    // The next clear uses the restored production handler. Later autosaves and
    // exit flushing must not reinsert the original conversation after success.
    await page.getByTestId('conversation-clear').click()
    await page.getByTestId('conversation-clear-confirm').click()
    await expect(page.locator(dialogDraft)).toHaveValue('')
    await expect.poll(() => page.evaluate((input) => window.readerApi.getRecentBookSession(input), { bookId, conversationId: originalSession!.conversationId })).toBeNull()
    await expect.poll(() => page.evaluate(async (id) => (await window.readerApi.getBookSession(id))?.draft, bookId)).toBe('')

    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application
    page = restarted.page
    await expect(page.getByTestId('assistant-dialog')).toBeVisible()
    await expect(page.locator(dialogDraft)).toHaveValue('')
    expect(await page.evaluate((id) => window.readerApi.listRecentBookSessions(id), bookId)).toEqual([])
  } finally {
    if (application) await releaseFailingSessionDelete(application).catch(() => undefined)
    clearSaveFailures(workspace.userData)
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
