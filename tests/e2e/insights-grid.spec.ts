import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { InsightArchiveRecord } from '../../src/shared/contracts'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader } from './support/electron-app'
import { resizeWorkspace } from './support/workspace'

async function expectColumns(page: Page, columns: 1 | 2): Promise<void> {
  await expect.poll(async () => page.locator('.insight-list').evaluate((list) => {
    const cards = [...list.children].map((card) => card.getBoundingClientRect())
    // Hover raises a card by 1px without changing its grid row.
    return Math.abs(cards[0].top - cards[1].top) <= 2 ? 2 : 1
  })).toBe(columns)
  const metrics = await page.locator('.insight-list').evaluate((list) => {
    const cards = [...list.children].map((card) => {
      const box = card.getBoundingClientRect(), footer = card.querySelector('footer')!.getBoundingClientRect()
      return { top: box.top, bottom: box.bottom, height: box.height, footerBottom: footer.bottom, width: box.width, scrollWidth: card.scrollWidth }
    })
    return { cards, overflow: list.scrollWidth - list.clientWidth }
  })
  expect(metrics.overflow).toBeLessThanOrEqual(1)
  for (const card of metrics.cards) {
    expect(card.scrollWidth - card.width).toBeLessThanOrEqual(1)
    expect(card.footerBottom).toBeLessThanOrEqual(card.bottom)
  }
  if (columns === 2) expect(Math.abs(metrics.cards[0].height - metrics.cards[1].height)).toBeLessThanOrEqual(1)
}

test('archive cards use two equal columns, retain actions at 125% and fall back to one column in a narrow window', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('reader-insights-grid-')
  const fixture = join(workspace.root, '较长的书籍名称用于检查问答集卡片的宽度和截断.txt')
  await writeFile(fixture, '第一章\n\n用于验证归档布局的原文。', 'utf8')
  const { application, page } = await launchReader({ userData: workspace.userData, importPath: fixture })
  try {
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-workspace-ready', 'true')
    await page.evaluate(async () => {
      const book = (await window.readerApi.listBooks())[0]
      const answers = ['短回答。', `## 较长回答\n\n${'这是一段需要保留三行预览和渐隐提示的回答。'.repeat(20)}\n\n\`\`\`text\n${'long-code'.repeat(100)}\n\`\`\``, `\`\`\`text\n${'long-code'.repeat(100)}\n\`\`\``]
      for (let index = 0; index < answers.length; index++) await window.readerApi.saveInsight({ bookId: book.id, conversationId: crypto.randomUUID(), selection: null,
        context: { scope: 'book', bookId: book.id, selection: null, passages: [], background: '', coverage: { covered: 0, total: 0 } },
        question: `布局问题 ${index + 1}：${'需要检查标题截断。'.repeat(8)}`, answer: answers[index], model: 'layout-fixture' })
    })
    await page.reload(); await expect(page.locator('.workspace-shell')).toHaveAttribute('data-workspace-ready', 'true')
    await page.getByTestId('nav-archives').click()
    await expect(page.getByTestId('insight-item')).toHaveCount(3)
    for (const [width, theme, scale] of [[1280, 'light', 100], [940, 'light', 125], [1280, 'dark', 125], [940, 'dark', 100]] as const) {
      await page.getByTestId('settings-button').click(); await page.getByTestId('settings-nav-appearance').click()
      await page.getByTestId(`theme-${theme}`).click(); await page.getByTestId(`scale-${scale}`).click()
      await page.getByTestId('settings-close').click()
      await resizeWorkspace(application, page, width, 800)
      const header = page.getByTestId('archives-header')
      await expect(page.getByTestId('assistant-dialog').locator(':scope > .modal-header')).toHaveCount(0)
      await expect(header.getByRole('heading', { name: '问答集', exact: true })).toHaveClass('visually-hidden')
      for (const testId of ['insights-search-input', 'insights-scope-all', 'insights-scope-book', 'insights-export-scope', 'nav-workbenches']) {
        await expect(header.getByTestId(testId)).toBeInViewport()
      }
      const toolbarBounds = await header.evaluate((element) => ({ height: element.getBoundingClientRect().height, overflow: element.scrollWidth - element.clientWidth }))
      expect(toolbarBounds.height).toBeLessThanOrEqual(72)
      expect(toolbarBounds.overflow).toBeLessThanOrEqual(1)
      await expectColumns(page, 2)
      await page.getByTestId('insight-item').first().getByTestId('insight-delete').click()
      await expect(page.getByTestId('insight-delete-confirm')).toBeVisible()
      await expectColumns(page, 2)
      await page.getByTestId('insight-delete-cancel').click()
      await page.screenshot({ path: test.info().outputPath(`archives-${theme}-${width}-${scale}.png`) })
    }
    // The production window has a 940px minimum; lower it only in this disposable test instance.
    await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setMinimumSize(320, 400) })
    await resizeWorkspace(application, page, 390, 800)
    expect(await page.getByTestId('archives-header').evaluate((header) => header.scrollWidth - header.clientWidth)).toBeLessThanOrEqual(1)
    await expect(page.getByTestId('insights-export-scope')).toBeInViewport()
    await expectColumns(page, 1)
    expect(await page.getByTestId('insight-item').first().evaluate((card) => card.getBoundingClientRect().right <= innerWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath('archives-dark-390.png') })
    await resizeWorkspace(application, page, 1280, 800)
    await page.getByTestId('insights-search-input').fill('短回答')
    await expect(page.getByTestId('insight-item')).toHaveCount(1)
    const card = page.getByTestId('insight-item')
    await expect(card.locator('.answer-text')).not.toHaveClass(/is-clamped/)
    await card.locator('.insight-content').focus(); await page.keyboard.press('Enter')
    await expect(page.getByTestId('assistant-dialog')).toBeVisible()
    await expect(page.getByTestId('answer-current')).toContainText('短回答')
  } finally { await cleanupE2eWorkspace(application, workspace.root) }
})

test('renders an offscreen archive preview on scroll and finds matches beyond its visible lines', async () => {
  const workspace = await createE2eWorkspace('reader-insights-previews-')
  const fixture = join(workspace.root, '问答集预览.txt')
  await writeFile(fixture, '问答集预览\n\n用于打开归档完整回答的正文。', 'utf8')
  const { application, page } = await launchReader({ userData: workspace.userData, importPath: fixture })
  try {
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-workspace-ready', 'true')
    const tail = '归档回答末尾的匹配词'
    const targetId = await page.evaluate(async (tailMarker) => {
      const book = (await window.readerApi.listBooks())[0]
      const context = { scope: 'book' as const, bookId: book.id, selection: null, passages: [], background: '', coverage: { covered: 0, total: 0 } }
      const target = await window.readerApi.saveInsight({
        bookId: book.id, selection: null, context, question: '需要滚动才显示预览的归档',
        answer: `## 预览标题\n\n**保留强调**和\`代码术语\`。\n\n${'这段内容让答案超出卡片的三行预览。'.repeat(25)}\n\n${tailMarker}`,
        model: 'preview-fixture'
      })
      for (let index = 0; index < 31; index += 1) {
        await window.readerApi.saveInsight({
          bookId: book.id, selection: null, context, question: `其他归档 ${index + 1}`,
          answer: '另一条回答。', model: 'preview-fixture'
        })
      }
      return target.id
    }, tail)
    await page.reload()
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-workspace-ready', 'true')
    await page.getByTestId('book-item').click()
    await expect(page.locator('.reader-surface')).toHaveClass(/is-ready/u)
    await page.getByTestId('nav-archives').click()
    await expect(page.getByTestId('insight-item')).toHaveCount(32)
    const target = page.locator(`[data-insight-id="${targetId}"]`)
    await expect(target.locator('.answer-text')).toHaveCount(0)
    await target.scrollIntoViewIfNeeded()
    await expect(target.locator('.answer-text strong')).toHaveText('保留强调')
    await expect(target.locator('.answer-code-inline')).toHaveText('代码术语')
    await expect(target.locator('.answer-text')).toHaveClass(/is-clamped/u)

    await page.getByTestId('insights-search-input').fill(tail)
    await expect(page.getByTestId('insight-item')).toHaveCount(1)
    await expect(target.locator('.answer-text mark')).toHaveText(tail)
    await target.locator('.insight-content').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('answer-current')).toContainText(tail)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

type PendingArchiveWindow = typeof globalThis & { releaseArchiveRead?: () => void }

test('ignores a delayed archive read when the reader leaves the list or opens another archive', async () => {
  const workspace = await createE2eWorkspace('reader-insight-pending-')
  const fixture = join(workspace.root, '归档切换.txt')
  await writeFile(fixture, '归档切换\n\n用于检查连续打开归档的测试正文。', 'utf8')
  const { application, page } = await launchReader({ userData: workspace.userData, importPath: fixture })
  try {
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-workspace-ready', 'true')
    const archives = await page.evaluate(async () => {
      const book = (await window.readerApi.listBooks())[0]
      const context = { scope: 'book' as const, bookId: book.id, selection: null, passages: [], background: '', coverage: { covered: 0, total: 0 } }
      for (const label of ['等待读取', '最后选择']) {
        await window.readerApi.saveInsight({
          bookId: book.id, selection: null, context, question: label,
          answer: `${label}的完整归档回答`, model: 'pending-fixture'
        })
      }
      return window.readerApi.listAllInsights()
    })
    const [fast, slow] = ['最后选择', '等待读取'].map((question) => archives.find((archive) => archive.question === question)!)
    await application.evaluate(({ ipcMain }, { archives, slowId }) => {
      const runtime = globalThis as PendingArchiveWindow
      ipcMain.removeHandler('insights:read-archives')
      ipcMain.handle('insights:read-archives', (_event, ids: string[]) => {
        const selected = archives.filter((archive) => ids.includes(archive.id))
        if (!ids.includes(slowId)) return selected
        return new Promise<InsightArchiveRecord[]>((resolveRead) => {
          runtime.releaseArchiveRead = () => {
            delete runtime.releaseArchiveRead
            resolveRead(selected)
          }
        })
      })
    }, { archives, slowId: slow.id })
    await page.reload()
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-session-tabs-state', 'ready')

    const slowCard = page.locator(`[data-insight-id="${slow.id}"] .insight-content`)
    const startSlowRead = async (): Promise<void> => {
      await page.getByTestId('nav-archives').click()
      await slowCard.click()
      await expect(slowCard).toHaveAttribute('aria-busy', 'true')
      await expect.poll(() => application.evaluate(() => Boolean((globalThis as PendingArchiveWindow).releaseArchiveRead))).toBe(true)
    }
    const releaseSlowRead = async (): Promise<void> => {
      await application.evaluate(() => (globalThis as PendingArchiveWindow).releaseArchiveRead?.())
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    }

    await startSlowRead()
    await page.getByTestId('nav-library').click()
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-page', 'library')
    await releaseSlowRead()
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-page', 'library')

    await startSlowRead()
    await page.locator(`[data-insight-id="${fast.id}"] .insight-content`).click()
    await expect(page.getByTestId('answer-current')).toContainText(fast.answer)
    await releaseSlowRead()
    await expect(page.getByTestId('answer-current')).toContainText(fast.answer)
    await expect(page.locator('.assistant-session-tab-select[data-tab-kind="archive"]')).toHaveCount(1)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
