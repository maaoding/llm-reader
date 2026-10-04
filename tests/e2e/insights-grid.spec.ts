import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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
      await expectColumns(page, 2)
      await page.getByTestId('insight-item').first().getByTestId('insight-delete').click()
      await expect(page.getByTestId('insight-delete-confirm')).toBeVisible()
      await expectColumns(page, 2)
      await page.screenshot({ path: test.info().outputPath(`archives-${theme}-${width}-${scale}.png`) })
      await page.getByTestId('insight-delete-cancel').click()
    }
    // The production window has a 940px minimum; lower it only in this disposable test instance.
    await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setMinimumSize(320, 400) })
    await resizeWorkspace(application, page, 390, 800)
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
