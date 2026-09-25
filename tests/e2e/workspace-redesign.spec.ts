import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader, restartReader } from './support/electron-app'
import { resizeWorkspace } from './support/workspace'
import type {} from '../../src/renderer/src/global'

async function assertFits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  for (const testId of ['nav-library', 'nav-archives', 'settings-button']) await expect(page.getByTestId(testId)).toBeInViewport()
}

test('opens the book overview, keeps live drafts and reader instance across pages, and restores the last workspace', async () => {
  const workspace = await createE2eWorkspace('llm-reader-workspace-')
  let application: ElectronApplication | undefined
  try {
    const fixture = join(workspace.root, '工作台.txt')
    await writeFile(fixture, '第一章 理解\n\n'+ '保留阅读位置与已输入的提问。\n\n'.repeat(120))
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture }); application = launched.application
    const page = launched.page
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-workspace-ready', 'true')
    await page.getByTestId('nav-archives').click()
    await expect(page.getByTestId('assistant-dialog')).toBeVisible()
    // 对话与归档页是常驻页面，不做入场动画。
    await expect(page.getByTestId('assistant-dialog')).toHaveCSS('animation-name', 'none')
    await expect(page.locator('.assistant-dialog-backdrop')).toHaveCSS('animation-name', 'none')
    // 归档页与书库同级：没有关闭按钮，离开走顶栏。
    await expect(page.getByTestId('assistant-dialog-close')).toHaveCount(0)
    await page.getByTestId('nav-library').click()
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-page', 'library')
    await page.getByTestId('book-item').click()
    await expect(page.getByTestId('book-overview')).toBeVisible()
    await expect(page.getByTestId('book-overview')).toContainText('尚未准备原文')
    await page.screenshot({ path: test.info().outputPath('book-overview.png'), animations: 'disabled' })
    await page.getByTestId('workspace-read').click()
    await expect(page.locator('.reader-document--txt')).toBeVisible()
    await expect(page.locator('.reader-header')).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: '阅读工具' })).toBeVisible()
    await expect(page.getByTestId('workspace-reading-position').locator('span')).not.toBeEmpty()
    await expect(page.getByTestId('workspace-reading-position').locator('strong')).toContainText(/%$/u)
    await expect(page.getByTestId('workspace-reading-progress')).toBeVisible()
    await expect(page.getByTestId('workspace-prepare')).toBeVisible()
    await expect(page.getByTestId('book-details-button')).toBeVisible()
    await expect(page.locator('.workspace-book-actions')).not.toContainText('书籍详情')
    await expect(page.getByTestId('highlights-tab')).toBeVisible()
    await expect(page.getByTestId('reader-assistant-toggle')).toHaveCount(0)
    await page.locator('.reader-document--txt').evaluate((node) => node.setAttribute('data-instance-check', 'preserved'))
    await expect(page.getByTestId('reader-contents-button')).toHaveAttribute('aria-pressed', 'false')
    await page.getByTestId('reader-contents-button').click()
    await expect(page.locator('.left-sidebar')).toBeVisible()
    await expect(page.locator('.sidebar-tabs')).toHaveCount(0)
    await expect(page.locator('.panel-close')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('reading-sidebar.png'), animations: 'disabled' })
    await page.getByTestId('reader-contents-button').click()
    await expect(page.locator('.left-sidebar')).toBeHidden()
    await page.getByTestId('highlights-tab').click()
    await expect(page.getByTestId('highlight-list')).toBeVisible()
    await page.getByTestId('highlights-tab').click()
    await expect(page.locator('.left-sidebar')).toBeHidden()
    const sidebar = page.locator('.right-sidebar')
    await sidebar.getByTestId('followup-input').fill('未配置服务也可以先写草稿')
    await expect(sidebar.locator('button[type=submit]')).toBeDisabled()
    for (const tab of ['overview', 'notes', 'conversation'] as const) await page.getByTestId(`workspace-tab-${tab}`).click()
    const conversation = page.getByTestId('assistant-dialog')
    await expect(conversation.getByTestId('followup-input')).toHaveValue('未配置服务也可以先写草稿')
    await expect(conversation.locator('.assistant-context-bar')).toHaveCount(0)
    await expect(conversation.getByTestId('book-preparation-open')).toHaveCount(0)
    await expect(conversation.locator('.composer-scope-controls')).toBeVisible()
    await expect(conversation.locator('.composer-hint')).toContainText('先设置模型服务')
    const composerOrder = await conversation.evaluate((element) => {
      const controls = element.querySelector('.composer-scope-controls')?.getBoundingClientRect()
      const input = element.querySelector('textarea')?.getBoundingClientRect()
      return Boolean(controls && input && controls.bottom <= input.top)
    })
    expect(composerOrder).toBe(true)
    await page.screenshot({ path: test.info().outputPath('conversation.png'), animations: 'disabled' })
    await page.getByTestId('workspace-prepare').click()
    await expect(page.getByTestId('book-preparation-dialog')).not.toContainText('0/0')
    await page.getByTestId('document-prepare').click()
    await expect(page.getByTestId('document-status')).toHaveText('原文已就绪')
    await page.getByTestId('book-preparation-dialog').getByRole('button', { name: '设置模型服务' }).click()
    await expect(page.getByTestId('settings-nav-model')).toHaveAttribute('aria-selected', 'true')
    await page.getByTestId('settings-close').click()
    await expect(page.getByTestId('book-preparation-dialog')).toBeVisible()
    await page.getByTestId('book-preparation-dialog').getByRole('button', { name: '设置含义查找服务' }).click()
    await expect(page.getByTestId('settings-nav-knowledge')).toHaveAttribute('aria-selected', 'true')
    await page.getByTestId('embedding-enabled').check()
    await page.getByTestId('embedding-url').fill('invalid-url')
    await page.locator('[data-service=embedding] > summary').click()
    await page.getByTestId('knowledge-save').click()
    await expect(page.getByTestId('embedding-url')).toBeFocused()
    await expect(page.locator('[data-service=embedding]')).toHaveAttribute('open', '')
    await page.getByTestId('embedding-url').fill('http://127.0.0.1:9/v1')
    await page.getByTestId('knowledge-save').click()
    await expect(page.getByTestId('embedding-model')).toBeFocused()
    await page.getByTestId('embedding-enabled').uncheck()
    await page.getByTestId('embedding-url').fill('')
    await page.getByTestId('settings-close').click()
    await expect(page.getByTestId('book-preparation-dialog')).toBeVisible()
    await page.getByTestId('preparation-close').click()
    await page.getByTestId('workspace-tab-reading').click()
    await expect(page.locator('.reader-document--txt')).toHaveAttribute('data-instance-check', 'preserved')
    await expect(sidebar.getByTestId('followup-input')).toHaveValue('未配置服务也可以先写草稿')
    await expect(sidebar.getByTestId('followup-input')).toHaveValue('未配置服务也可以先写草稿')
    await sidebar.getByRole('button', { name: '选中内容', exact: true }).click()
    await expect(sidebar).not.toContainText('先在阅读页选中原文，也可以切换到“整本书”。')
    await expect(sidebar).not.toContainText('前往阅读')
    await page.getByTestId('workspace-tab-overview').click()
    await page.getByTestId('workspace-ask').click()
    await expect(page.getByTestId('assistant-dialog').getByRole('button', { name: '选中内容', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('assistant-dialog').getByTestId('followup-input')).toHaveValue('')
    await page.getByTestId('assistant-dialog').getByTestId('recent-conversations').click()
    await expect(page.getByTestId('assistant-dialog').getByTestId('recent-conversation')).toHaveCount(1)
    await page.getByTestId('assistant-dialog').getByTestId('recent-conversation').click()
    await expect(page.getByTestId('assistant-dialog').getByTestId('followup-input')).toHaveValue('未配置服务也可以先写草稿')
    await expect(page.getByTestId('assistant-dialog').getByRole('button', { name: '整本书', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('workspace-tab-notes').click()
    const restarted = await restartReader(application, { userData: workspace.userData }); application = restarted.application
    await expect(restarted.page.getByTestId('notes-view')).toBeVisible()
    await expect(restarted.page.locator('.workspace-shell')).toHaveAttribute('data-workspace-ready', 'true')
    await restarted.page.getByTestId('workspace-prepare').click()
    await expect(restarted.page.getByTestId('document-status')).toHaveText('原文已就绪')
  } finally { await cleanupE2eWorkspace(application, workspace.root) }
})

test('browses partial chapter notes in pages and jumps valid originals while keeping unavailable sources inert', async () => {
  const workspace = await createE2eWorkspace('llm-reader-notes-ui-')
  let application: ElectronApplication | undefined
  try {
    const fixture = join(workspace.root, '同名章节笔记.txt')
    await writeFile(fixture, '第一章\n\n'+ '笔记来源原文，需要核对。\n\n'.repeat(160))
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture }); application = launched.application
    const page = launched.page
    await page.getByTestId('book-item').click()
    const bookId = (await page.evaluate(() => window.readerApi.listBooks()))[0].id
    const database = new DatabaseSync(join(workspace.userData, 'reader.sqlite3'))
    try {
      database.prepare("INSERT INTO book_documents(book_id,job_id,fingerprint,embedding_identity,version,status) VALUES(?,?,?,'fixture',2,'ready')").run(bookId, randomUUID(), 'fixture')
      database.prepare("INSERT INTO book_analysis(book_id,job_id,profile_id,model,fingerprint,status,session_id,extraction_done,overview) VALUES(?,?,?,'fixture','fixture','paused',?,1,?)").run(bookId, randomUUID(), randomUUID(), randomUUID(), '## 全书主旨\n\n概览保留 **重点** 与 [P1] 普通编号。')
      const sections = Array.from({ length: 13 }, (_, order) => ({ id: `s${order}`, chapterId: order < 12 ? 'first' : 'second', chapterTitle: '同名章节', order,
        blocks: [{ id: `p${order}`, text: '笔记来源原文，需要核对。', anchor: `txt:${8 + order * 15}:${20 + order * 15}`, kind: 'paragraph' as const, headingPath: [order < 12 ? '上篇' : '下篇', '同名章节'] }] }))
      for (const section of sections) {
        const note = section.order < 12 ? { summary: section.order === 0 ? '### 单条概述\n\n这是 *模型整理* 的笔记。' : '这是一条已完成的笔记。', claims: [{ text: '核对原文再判断。', sourceIds: [section.blocks[0].id, 'missing'] }], conditions: [], exceptions: [], concepts: [] } : null
        database.prepare('INSERT INTO book_sections(book_id,section_id,chapter_id,chapter_title,ordinal,content_json,note_json) VALUES(?,?,?,?,?,?,?)').run(bookId, section.id, section.chapterId, section.chapterTitle, section.order, JSON.stringify(section), note ? JSON.stringify(note) : null)
        const block = section.blocks[0]
        database.prepare('INSERT INTO book_blocks(book_id,block_id,section_id,chapter_id,chapter_title,ordinal,text,anchor,metadata_json,searchable) VALUES(?,?,?,?,?,?,?,?,?,1)').run(bookId, block.id, section.id, section.chapterId, section.chapterTitle, section.order, block.text, block.anchor, JSON.stringify(block))
      }
      database.prepare('INSERT INTO book_summaries(book_id,node_id,summary) VALUES(?,?,?)').run(bookId, 'chapter-first-final', '> 章节结论\n\n- 条件一\n- `条件二`\n\n```txt\n一段很长但可滚动的代码内容\n```')
    } finally { database.close() }
    await page.getByTestId('workspace-tab-notes').click()
    await expect(page.getByTestId('notes-chapter')).toHaveCount(2)
    await expect(page.getByTestId('chapter-note')).toHaveCount(10)
    await expect(page.locator('.note-summary .markdown-text blockquote')).toContainText('章节结论')
    await expect(page.locator('.note-summary .answer-code-block')).toContainText('一段很长但可滚动的代码内容')
    await expect(page.locator('.chapter-note').first().getByRole('heading', { name: '单条概述' })).toBeVisible()
    await expect(page.locator('.chapter-note').first().locator('[data-testid^="citation-"]')).toHaveCount(0)
    await page.getByTestId('workspace-tab-overview').click()
    await expect(page.locator('.workspace-summary').getByRole('heading', { name: '全书主旨' })).toBeVisible()
    await expect(page.locator('.workspace-summary')).toContainText('[P1] 普通编号')
    await expect(page.locator('.workspace-summary [data-testid^="citation-"]')).toHaveCount(0)
    await page.getByTestId('workspace-tab-notes').click()
    await expect(page.getByTestId('note-source-unavailable').first()).not.toHaveRole('button')
    await page.getByTestId('notes-load-more').click()
    await expect(page.getByTestId('chapter-note')).toHaveCount(12)
    await page.locator('.note-sources').first().locator('summary').click()
    await page.screenshot({ path: test.info().outputPath('chapter-notes.png'), animations: 'disabled' })
    await page.locator('.note-sources').first().getByRole('button').first().click()
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-page', 'reading')
    await expect(page.getByTestId('reader-return-button')).toBeVisible()
    await page.getByTestId('reader-return-button').click()
    await expect(page.getByTestId('reader-return-button')).toBeHidden()
    await page.getByTestId('workspace-tab-notes').click()
    await page.getByTestId('notes-chapter').nth(1).click()
    await expect(page.getByTestId('chapter-notes')).toContainText('本章笔记尚未生成')
    await expect(page.getByTestId('chapter-note')).toHaveCount(0)
  } finally { await cleanupE2eWorkspace(application, workspace.root) }
})

test('adapts the workspace, drawers and preparation to every supported scale in light and dark windows', async () => {
  test.setTimeout(240_000)
  const workspace = await createE2eWorkspace('llm-reader-workspace-matrix-')
  let application: ElectronApplication | undefined
  try {
    const fixture = join(workspace.root, '适配.txt')
    await writeFile(fixture, '第一章 窗口适配\n\n'+ '正文空间应优先保留，所有操作都可以访问。\n\n'.repeat(60))
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture }); application = launched.application
    const page = launched.page
    await page.getByTestId('book-item').click()
    for (const [width, height] of [[1440, 900], [1180, 760], [940, 600]]) {
      await resizeWorkspace(application, page, width, height)
      for (const theme of ['light', 'dark']) for (const scale of [90, 100, 110, 125]) {
        const label = `${width}-${height}-${theme}-${scale}`
        await page.getByTestId('settings-button').click()
        await page.getByTestId('settings-nav-appearance').click()
        await page.getByTestId(`theme-${theme}`).click()
        await page.getByTestId(`scale-${scale}`).click()
        await assertFits(page)
        await page.screenshot({ path: test.info().outputPath(`settings-${label}.png`), scale: 'css', animations: 'disabled' })
        await page.getByTestId('settings-close').click()
        await page.getByTestId('workspace-tab-overview').click()
        await assertFits(page)
        await page.getByTestId('workspace-read').click()
        await expect(page.locator('.reader-header')).toHaveCount(0)
        await expect(page.getByRole('navigation', { name: '阅读工具' })).toBeInViewport()
        await expect(page.getByTestId('workspace-reading-position')).toBeInViewport()
        await expect(page.getByTestId('workspace-reading-progress')).toBeInViewport()
        await expect(page.getByTestId('book-details-button')).toBeInViewport()
        await expect(page.getByTestId('highlights-tab')).toBeInViewport()
        await expect(page.getByTestId('reader-assistant-toggle')).toHaveCount(0)
        if (width < 1180) {
          await page.getByTestId('reader-contents-button').click()
          await expect(page.locator('.left-sidebar')).toBeVisible()
          await expect(page.locator('.sidebar-tabs')).toHaveCount(0)
          await page.getByTestId('reader-contents-button').click()
          await expect(page.locator('.left-sidebar')).toBeHidden()
          // 窄窗口下左侧抽屉覆盖正文，右侧助手区仍停靠并保留宽度。
          await expect(page.locator('.right-sidebar')).toBeVisible()
          await expect(page.locator('.right-sidebar').getByTestId('followup-input')).toBeInViewport()
          await expect.poll(() => page.getByTestId('reader-host').evaluate((host) => {
            const panel = document.querySelector<HTMLElement>('.right-sidebar')
            if (!panel) return false
            return host.getBoundingClientRect().right <= panel.getBoundingClientRect().left + 1
          })).toBe(true)
        } else {
          await page.locator('.right-sidebar').getByTestId('followup-input').fill('草稿 ' + label)
          await expect(page.locator('.right-sidebar').getByTestId('followup-input')).toBeInViewport()
        }
        await assertFits(page)
        await page.screenshot({ path: test.info().outputPath(`reading-${label}.png`), scale: 'css', animations: 'disabled' })
        await page.getByTestId('workspace-prepare').click()
        await page.getByTestId('book-preparation-dialog').getByRole('button', { name: '设置含义查找服务' }).scrollIntoViewIfNeeded()
        await assertFits(page)
        await page.screenshot({ path: test.info().outputPath(`preparation-${label}.png`), scale: 'css', animations: 'disabled' })
        await page.getByTestId('preparation-close').click()
      }
    }
  } finally { await cleanupE2eWorkspace(application, workspace.root) }
})
