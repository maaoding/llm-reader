import {
  expect,
  test,
  type ElectronApplication,
  type Locator
} from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  cleanupE2eWorkspace,
  createE2eWorkspace,
  launchReader,
  restartReader
} from './support/electron-app'
import { hidePreparation, resizeWorkspace, showContents, showLibrary, showPreparation } from './support/workspace'

async function expectEnglishChrome(root: Locator, allowedChinese: readonly string[] = []): Promise<void> {
  const text = await root.evaluate((element: HTMLElement) => {
    const attributes = Array.from(element.querySelectorAll<HTMLElement>('[aria-label], [title], [placeholder]'))
      .filter((control) => !control.closest('[inert], [hidden]') && control.checkVisibility({ checkVisibilityCSS: true }))
      .flatMap((control) => ['aria-label', 'title', 'placeholder'].map((attribute) => control.getAttribute(attribute) ?? ''))
    return [element.innerText, ...attributes].join('\n')
  })
  const chrome = allowedChinese.reduce((content, allowed) => content.replaceAll(allowed, ''), text)
  expect(chrome.match(/[\p{Script=Han}]+/gu) ?? []).toEqual([])
}

test('switches the UI language to English, persists it and switches back', async () => {
  const workspace = await createE2eWorkspace('llm-reader-language-e2e-')
  const fixture = join(workspace.root, 'Reading fixture.txt')
  let application: ElectronApplication | undefined

  try {
    await writeFile(fixture, 'A sentence with a preserved quote: 原文。\n\nAnother paragraph for the search fixture.', 'utf8')
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const { page } = launched

    await showLibrary(page)
    await resizeWorkspace(application, page, 1180, 800)
    await page.getByTestId('settings-button').click()
    const appearanceNav = page.getByTestId('settings-nav-appearance')
    await expect(appearanceNav).toBeVisible()

    // 中文默认：外观区应出现语言切换控件，主题选项为中文。
    await expect(page.getByTestId('ui-language')).toBeVisible()
    await expect(page.getByTestId('theme-light')).toHaveText('浅色')
    await page.getByTestId('theme-light').click()
    await page.getByTestId('scale-100').click()

    await page.getByTestId('ui-language-en').click()

    // 立即生效：设置导航、主题选项与外观文案全部切换为英文。
    await expect(appearanceNav).toHaveText('Appearance')
    await expect(page.getByTestId('theme-light')).toHaveText('Light')
    await expect(page.getByTestId('theme-system')).toHaveText('System')
    await expect(page.getByTestId('theme-dark')).toHaveText('Dark')
    await expect(page.getByTestId('ui-language-en')).toHaveAttribute('aria-pressed', 'true')
    await expectEnglishChrome(page.getByTestId('settings-modal'), ['中文'])

    for (const [id, name] of [
      ['reading', 'Reading'], ['assistant', 'Selection actions'], ['persona', 'Assistant persona'],
      ['model', 'Model service'], ['knowledge', 'Reading enhancements'], ['backup', 'Backup and restore'], ['about', 'About']
    ]) {
      const tab = page.getByTestId(`settings-nav-${id}`)
      await expect(tab).toHaveText(name)
      await tab.click()
      if (id === 'knowledge') {
        const config = page.getByTestId('document-config')
        await config.locator('summary').first().click()
        await expect(config.getByRole('option', { name: 'PaddleOCR (select on page)', includeHidden: true })).toHaveCount(1)
      }
      await expectEnglishChrome(page.locator(`#settings-panel-${id}`))
    }
    await page.getByTestId('settings-nav-assistant').click()
    await expect(page.getByTestId('assistant-explain-label')).toHaveValue('Explain this')

    await page.getByTestId('settings-close').click()
    await expect(page.getByTestId('provider-connection-status')).toHaveAttribute('title', 'API not configured')
    await expectEnglishChrome(page.getByTestId('app-shell'))

    const archivedAt = await page.evaluate(async () => {
      const api = window.readerApi
      const [book] = await api.listBooks()
      const saved = await api.saveInsight({ bookId: book.id, selection: null,
        context: { scope: 'book', bookId: book.id, selection: null, passages: [], background: '', coverage: { covered: 0, total: 0 } },
        question: 'Sample question', answer: 'Sample answer retains 原文。', model: 'text-fixture' })
      return (await api.listInsights(book.id)).find((item) => item.id === saved.id)!.createdAt
    })

    // 持久化：重启后界面仍为英文。
    const restarted = await restartReader(application, { userData: workspace.userData, importPath: fixture })
    application = restarted.application
    const restartedPage = restarted.page
    await showLibrary(restartedPage)
    await restartedPage.getByTestId('settings-button').click()
    await expect(restartedPage.getByTestId('settings-nav-appearance')).toHaveText('Appearance')
    await expect(restartedPage.getByTestId('ui-language-en')).toHaveAttribute('aria-pressed', 'true')
    await restartedPage.getByTestId('settings-close').click()
    await restartedPage.getByTestId('nav-archives').click()
    const archive = restartedPage.getByTestId('insight-item')
    await expect(archive).toContainText('Sample answer retains 原文。')
    const expectedDate = await restartedPage.evaluate((date) => new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(new Date(date)).replace(/\s+/gu, ' '), archivedAt)
    await expect(archive.locator('footer')).toContainText(expectedDate)
    await expectEnglishChrome(restartedPage.getByTestId('app-shell'), ['原文'])
    await restartedPage.screenshot({ path: test.info().outputPath('saved-answers-en.png'), scale: 'css' })
    await restartedPage.getByTestId('nav-workbenches').click()
    await expect(restartedPage.getByTestId('workbench-new')).toHaveText('New workbench')
    await expectEnglishChrome(restartedPage.getByTestId('workbench-list-header'))

    // 切回中文并验证，划词默认值同步回到中文。
    await restartedPage.getByTestId('settings-button').click()
    await restartedPage.getByTestId('ui-language-zh').click()
    await expect(restartedPage.getByTestId('settings-nav-appearance')).toHaveText('外观')
    await expect(restartedPage.getByTestId('theme-light')).toHaveText('浅色')
    await restartedPage.getByTestId('settings-nav-assistant').click()
    await expect(restartedPage.getByTestId('assistant-explain-label')).toHaveValue('解释这段')
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('translates an open TXT and its search results without replacing the reader', async () => {
  const workspace = await createE2eWorkspace('llm-reader-language-txt-')
  let application: ElectronApplication | undefined
  try {
    const fixture = join(workspace.root, 'Continuous text.txt')
    await writeFile(fixture, 'An intact sample paragraph.\n\n'.repeat(36), 'utf8')
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const { page } = launched
    await showLibrary(page)
    await page.getByTestId('book-item').click()
    await showContents(page)
    await expect(page.getByTestId('toc-item')).toHaveText('全文')
    const reader = page.locator('.reader-document--txt')
    await reader.evaluate((node) => { node.dataset.languageFixture = 'original' })
    await page.getByTestId('reader-search-button').click()
    const query = page.getByTestId('reader-search-input')
    await query.fill('intact')
    await query.press('Enter')
    const hit = page.getByTestId('reader-search-result').first()
    await expect(hit).toContainText('全文')
    await page.getByTestId('settings-button').click()
    await page.getByTestId('ui-language-en').click()
    await page.getByTestId('settings-close').click()
    await expect(hit).toContainText('Full text')
    await expect(page.getByTestId('workspace-reading-position')).toContainText('Full text')
    await showContents(page)
    await expect(page.getByTestId('toc-item')).toHaveText('Full text')
    await expect(reader).toHaveAttribute('data-language-fixture', 'original')

    await showPreparation(page)
    await page.getByTestId('document-prepare').click()
    await expect(page.getByTestId('document-status')).toHaveText('Source text ready')
    await hidePreparation(page)
    await page.getByTestId('workspace-tab-notes').click()
    await expect(page.getByTestId('notes-chapter')).toContainText('Text sections')
    await expectEnglishChrome(page.getByTestId('notes-view'))
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('translates PDF tools and scan notices while keeping the open PDF and zoom', async () => {
  const workspace = await createE2eWorkspace('llm-reader-language-pdf-')
  let application: ElectronApplication | undefined
  try {
    const fixture = resolve('tests/e2e/fixtures/scanned-reader.pdf')
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const { page } = launched
    await showLibrary(page)
    await resizeWorkspace(application, page, 940, 600)
    await page.getByTestId('book-item').click()
    const sheet = page.locator('.pdf-page').first()
    await expect(sheet).toHaveAttribute('aria-label', '第 1 页')
    await page.getByTestId('reader-settings-button').click()
    const toolbar = page.getByTestId('pdf-toolbar')
    await toolbar.getByRole('button', { name: '放大', exact: true }).click()
    const zoom = await page.getByTestId('pdf-zoom-value').textContent()
    await sheet.evaluate((node) => { node.dataset.languageFixture = 'original' })
    await page.getByTestId('settings-button').click()
    await page.getByTestId('theme-dark').click()
    await page.getByTestId('scale-125').click()
    await page.getByTestId('ui-language-en').click()
    await page.getByTestId('settings-close').click()

    await expect(sheet).toHaveAttribute('data-language-fixture', 'original')
    await expect(sheet).toHaveAttribute('aria-label', 'Page 1')
    await expect(page.getByTestId('workspace-reading-position')).toContainText('Whole document')
    await expect(page.getByTestId('pdf-no-text-banner')).toContainText('This page has no selectable text')
    await expect(sheet.getByText('This page has no text layer')).toHaveCount(1)
    if (!await toolbar.isVisible()) await page.getByTestId('reader-settings-button').click()
    await expect(toolbar.getByRole('button', { name: 'Zoom in', exact: true })).toBeVisible()
    await expect(toolbar.getByRole('button', { name: 'Select image region' })).toBeVisible()
    await expect(page.getByTestId('pdf-zoom-value')).toHaveText(zoom!)
    await expectEnglishChrome(toolbar)
    await showPreparation(page)
    await expect(page.getByTestId('book-preparation-dialog').getByRole('heading', { name: 'Book preparation' })).toBeVisible()
    await expectEnglishChrome(page.getByTestId('book-preparation-dialog'), ['扫描 PDF 测试'])
    await hidePreparation(page)
    await page.getByTestId('book-details-button').click()
    const details = page.getByRole('dialog', { name: 'Book details' })
    const imported = details.locator('.book-details-row').filter({ has: page.getByText('Imported', { exact: true }) })
    await expect(imported.locator('dd')).toHaveText(/[A-Za-z]{3} \d{1,2}, \d{4}/u)
    await expectEnglishChrome(details, ['扫描 PDF 测试'])
    await page.screenshot({ path: test.info().outputPath('book-details-en-dark-125.png'), scale: 'css' })
    await page.getByTestId('book-details-close').click()
    await page.screenshot({ path: test.info().outputPath('pdf-tools-en-dark-125.png'), scale: 'css' })
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
