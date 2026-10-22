import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import type { InsightArchiveRecord, SessionTabsState } from '../../src/shared/contracts'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader } from './support/electron-app'

type ReadMode = 'pending' | 'tabs-error' | 'archives-error' | 'ready'
interface RecoveryFixture {
  saved: SessionTabsState
  insights: InsightArchiveRecord[]
  writes: SessionTabsState[]
  mode: ReadMode
  release?: () => void
  readsCompleted: number
  closeReady: number
}
type RecoveryGlobal = typeof globalThis & { sessionTabsRecovery: RecoveryFixture }

async function installRecoveryFixture(application: ElectronApplication, page: Page, mode: ReadMode, empty = false, inactiveBook = false): Promise<SessionTabsState> {
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-session-tabs-state', 'ready')
  const data = await page.evaluate(async ({ emptyState, inactive }) => {
    const book = (await window.readerApi.listBooks())[0]
    await window.readerApi.saveInsight({
      bookId: book.id, conversationId: crypto.randomUUID(), selection: null,
      context: { scope: 'book', bookId: book.id, selection: null, passages: [], background: '', coverage: { covered: 0, total: 0 } },
      question: '需要保留的归档问题', answer: '需要保留的归档回答', model: 'recovery-fixture'
    })
    const insights = await window.readerApi.listAllInsights()
    localStorage.setItem('llm-reader.workspace', JSON.stringify({ bookId: inactive ? null : book.id, page: 'conversation', tabs: inactive ? [] : [{ bookId: book.id, page: 'reading' }] }))
    const saved: SessionTabsState = emptyState ? { activeIndex: null, tabs: [] } : {
      activeIndex: 1,
      tabs: [
        { kind: 'live', bookId: book.id, insightId: null, draft: '', webSearch: 'off' },
        { kind: 'archive', bookId: book.id, insightId: insights[0].id, draft: '读取失败也必须保留的归档草稿', webSearch: 'off' }
      ]
    }
    return { saved, insights }
  }, { emptyState: empty, inactive: inactiveBook })
  // Let the current renderer's normal debounce settle before installing fault handlers.
  await page.waitForTimeout(650)
  await application.evaluate(({ ipcMain }, input) => {
    const fixture: RecoveryFixture = { ...input.data, mode: input.mode, writes: [], readsCompleted: 0, closeReady: 0 }
    ;(globalThis as RecoveryGlobal).sessionTabsRecovery = fixture
    ipcMain.removeHandler('session-tabs:list')
    ipcMain.handle('session-tabs:list', async () => {
      if (fixture.mode === 'pending') await new Promise<void>((resolveRead) => { fixture.release = resolveRead })
      fixture.readsCompleted += 1
      if (fixture.mode === 'tabs-error') throw new Error('Synthetic session tab read failure')
      return fixture.saved
    })
    ipcMain.removeHandler('insights:list-all')
    ipcMain.handle('insights:list-all', () => {
      if (fixture.mode === 'archives-error') throw new Error('Synthetic archive read failure')
      return fixture.insights
    })
    ipcMain.removeHandler('session-tabs:save')
    ipcMain.handle('session-tabs:save', (_event, state: SessionTabsState) => {
      fixture.writes.push(state)
      fixture.saved = state
      return state
    })
    // Keep the disposable window alive so the real close handshake can be inspected.
    ipcMain.removeHandler('app:close-ready')
    ipcMain.handle('app:close-ready', () => { fixture.closeReady += 1 })
  }, { data, mode })
  await page.reload()
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-workspace-ready', 'true')
  return data.saved
}

async function fixtureState(application: ElectronApplication) {
  return application.evaluate(() => {
    const { saved, writes, readsCompleted, closeReady } = (globalThis as RecoveryGlobal).sessionTabsRecovery
    return { saved, writes, readsCompleted, closeReady }
  })
}

async function expectPreserved(application: ElectronApplication, saved: SessionTabsState): Promise<void> {
  // Cross the real 500ms autosave deadline; an incomplete restoration must never write.
  await new Promise<void>((resolveWait) => setTimeout(resolveWait, 700))
  expect(await fixtureState(application)).toMatchObject({ saved, writes: [] })
}

async function expectRestored(application: ElectronApplication, page: Page, saved: SessionTabsState): Promise<void> {
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-session-tabs-state', 'ready')
  await expect(page.getByTestId('session-tabs-recovery')).toHaveCount(0)
  const tabs = page.getByTestId('assistant-session-tab')
  await expect(tabs).toHaveCount(2)
  await expect(tabs.nth(0)).toHaveAttribute('data-tab-kind', 'live')
  await expect(tabs.nth(1)).toHaveAttribute('data-tab-kind', 'archive')
  await expect(page.locator('.assistant-session-tab.is-active').getByTestId('assistant-session-tab')).toHaveAttribute('data-tab-kind', 'archive')
  await expect(page.locator('.assistant-dialog [data-testid="followup-input"]')).toHaveValue(saved.tabs[1].draft)
  await expect.poll(async () => (await fixtureState(application)).saved).toEqual(saved)
  await expect.poll(async () => (await fixtureState(application)).writes.length).toBeGreaterThan(0)
}

test('waits for a slow tab read before saving restored order, active tab and archive draft', async () => {
  const workspace = await createE2eWorkspace('llm-reader-slow-tab-recovery-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: resolve('tests/fixtures/complex-reading.txt') })
    application = launched.application
    const { page } = launched
    const saved = await installRecoveryFixture(application, page, 'pending')
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-session-tabs-state', 'loading')
    await expectPreserved(application, saved)
    await application.evaluate(() => {
      const fixture = (globalThis as RecoveryGlobal).sessionTabsRecovery
      fixture.mode = 'ready'
      fixture.release?.()
    })
    await expectRestored(application, page, saved)
  } finally { await cleanupE2eWorkspace(application, workspace.root) }
})

for (const mode of ['tabs-error', 'archives-error'] as const) {
  test(`${mode}: preserves saved tabs until retry finishes, and protects them if the app closes first`, async () => {
    const workspace = await createE2eWorkspace('llm-reader-failed-tab-recovery-')
    let application: ElectronApplication | undefined
    try {
      const launched = await launchReader({ userData: workspace.userData, importPath: resolve('tests/fixtures/complex-reading.txt') })
      application = launched.application
      const { page } = launched
      const saved = await installRecoveryFixture(application, page, mode)
      await expect(page.getByTestId('session-tabs-recovery')).toBeVisible()
      await expect(page.getByTestId('app-shell')).toHaveAttribute('data-session-tabs-state', 'error')
      await expectPreserved(application, saved)

      await application.evaluate(() => { (globalThis as RecoveryGlobal).sessionTabsRecovery.mode = 'ready' })
      await page.getByTestId('session-tabs-retry').click()
      await expectRestored(application, page, saved)

      // A second startup fails before restoration; the exit flush must preserve the prior save.
      await application.evaluate((_electron, readMode) => {
        const fixture = (globalThis as RecoveryGlobal).sessionTabsRecovery
        fixture.mode = readMode
        fixture.writes = []
      }, mode)
      await page.reload()
      await expect(page.getByTestId('app-shell')).toHaveAttribute('data-session-tabs-state', 'error')
      await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.send('app:before-close', 1) })
      await expect.poll(async () => (await fixtureState(application!)).closeReady).toBe(1)
      await expectPreserved(application, saved)
    } finally { await cleanupE2eWorkspace(application, workspace.root) }
  })
}

test('ignores a tab read that completes after the close handshake starts', async () => {
  const workspace = await createE2eWorkspace('llm-reader-closing-tab-recovery-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: resolve('tests/fixtures/complex-reading.txt') })
    application = launched.application
    const { page } = launched
    const saved = await installRecoveryFixture(application, page, 'pending')
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-session-tabs-state', 'loading')
    await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.send('app:before-close', 1) })
    await expect.poll(async () => (await fixtureState(application!)).closeReady).toBe(1)
    await application.evaluate(() => {
      const fixture = (globalThis as RecoveryGlobal).sessionTabsRecovery
      fixture.mode = 'ready'
      fixture.release?.()
    })
    await expect.poll(async () => (await fixtureState(application!)).readsCompleted).toBeGreaterThan(0)
    await expectPreserved(application, saved)
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-session-tabs-state', 'loading')
    await expect(page.locator('[data-testid="assistant-session-tab"][data-tab-kind="archive"]')).toHaveCount(0)
  } finally { await cleanupE2eWorkspace(application, workspace.root) }
})

for (const edit of ['untouched', 'changed', 'cleared'] as const) {
  test(`restores an archive opened before retry while respecting its ${edit} draft`, async () => {
    const workspace = await createE2eWorkspace('llm-reader-edited-tab-recovery-')
    let application: ElectronApplication | undefined
    try {
      const launched = await launchReader({ userData: workspace.userData, importPath: resolve('tests/fixtures/complex-reading.txt') })
      application = launched.application
      const { page } = launched
      const saved = await installRecoveryFixture(application, page, 'tabs-error')
      await expect(page.getByTestId('session-tabs-recovery')).toBeVisible()
      await page.getByTestId('nav-archives').click()
      await page.getByTestId('insight-item').first().locator('.insight-content').click()
      const draft = page.locator('.assistant-dialog [data-testid="followup-input"]')
      await expect(draft).toHaveValue('')
      if (edit !== 'untouched') {
        await draft.fill('本轮重新写的草稿')
        if (edit === 'cleared') await draft.fill('')
        saved.tabs[1].draft = edit === 'cleared' ? '' : '本轮重新写的草稿'
      }
      await application.evaluate(() => { (globalThis as RecoveryGlobal).sessionTabsRecovery.mode = 'ready' })
      await page.getByTestId('session-tabs-retry').click()
      await expectRestored(application, page, saved)
    } finally { await cleanupE2eWorkspace(application, workspace.root) }
  })
}

test('retains a saved empty live tab even when its book is not currently open', async () => {
  const workspace = await createE2eWorkspace('llm-reader-inactive-tab-recovery-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: resolve('tests/fixtures/complex-reading.txt') })
    application = launched.application
    const { page } = launched
    const saved = await installRecoveryFixture(application, page, 'ready', false, true)
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-session-tabs-state', 'ready')
    await expect.poll(async () => (await fixtureState(application!)).writes.length).toBeGreaterThan(0)
    await expect.poll(async () => (await fixtureState(application!)).saved).toEqual(saved)
    // With no current book, startup stays in the library. Open the restored archive to inspect its tabs.
    await page.getByTestId('nav-archives').click()
    await page.getByTestId('insight-item').first().locator('.insight-content').click()
    await expectRestored(application, page, saved)
  } finally { await cleanupE2eWorkspace(application, workspace.root) }
})

test('respects an archive tab closed before retry and allows reopening it afterward', async () => {
  const workspace = await createE2eWorkspace('llm-reader-closed-tab-recovery-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: resolve('tests/fixtures/complex-reading.txt') })
    application = launched.application
    const { page } = launched
    const saved = await installRecoveryFixture(application, page, 'tabs-error')
    await expect(page.getByTestId('session-tabs-recovery')).toBeVisible()
    await page.getByTestId('nav-archives').click()
    await page.getByTestId('insight-item').first().locator('.insight-content').click()
    const archiveTab = page.locator('[data-testid="assistant-session-tab"][data-tab-kind="archive"]')
    await expect(archiveTab).toHaveCount(1)
    await archiveTab.locator('..').getByTestId('assistant-session-tab-close').click()
    await expect(archiveTab).toHaveCount(0)
    await expectPreserved(application, saved)

    await application.evaluate(() => { (globalThis as RecoveryGlobal).sessionTabsRecovery.mode = 'ready' })
    await page.getByTestId('session-tabs-retry').click()
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-session-tabs-state', 'ready')
    await expect(archiveTab).toHaveCount(0)
    await expect.poll(async () => (await fixtureState(application!)).saved).toEqual({ activeIndex: 0, tabs: [saved.tabs[0]] })

    await page.getByTestId('nav-archives').click()
    await page.getByTestId('insight-item').first().locator('.insight-content').click()
    await expect(archiveTab).toHaveCount(1)
    await expect(page.locator('.assistant-dialog [data-testid="followup-input"]')).toHaveValue('')
    await expect.poll(async () => (await fixtureState(application!)).saved.tabs).toHaveLength(2)
  } finally { await cleanupE2eWorkspace(application, workspace.root) }
})

test('treats an empty saved tab list as restored and persists newly opened tabs', async () => {
  const workspace = await createE2eWorkspace('llm-reader-empty-tab-recovery-')
  let application: ElectronApplication | undefined
  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: resolve('tests/fixtures/complex-reading.txt') })
    application = launched.application
    const { page } = launched
    await installRecoveryFixture(application, page, 'ready', true)
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-session-tabs-state', 'ready')
    await expect.poll(async () => (await fixtureState(application!)).saved.tabs).toMatchObject([{ kind: 'live' }])
  } finally { await cleanupE2eWorkspace(application, workspace.root) }
})
