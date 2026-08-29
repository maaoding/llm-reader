import {
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { join } from 'node:path'
import { createSearchLinksEpubFixture } from './fixtures/search-links-epub'
import {
  cleanupE2eWorkspace,
  createE2eWorkspace,
  launchReader,
  restartReader
} from './support/electron-app'

async function currentChapter(page: Page): Promise<string> {
  return page.locator('.reader-column').getAttribute('data-current-chapter-title').then((value) => value ?? '')
}

async function activateEpubLink(page: Page, id: string): Promise<{
  activated: boolean
  internalHref: string | null
  href: string | null
}> {
  return page.getByTestId('reader-host').evaluate((host, targetId) => {
    for (const frame of host.querySelectorAll('iframe')) {
      const anchor = frame.contentDocument?.getElementById(targetId) as HTMLAnchorElement | null
      if (!anchor) continue
      const result = {
        activated: true,
        internalHref: anchor.dataset.readerInternalHref ?? null,
        href: anchor.getAttribute('href')
      }
      anchor.click()
      return result
    }
    return { activated: false, internalHref: null, href: null }
  }, id)
}

test('Ctrl+F searches EPUB, highlights navigation, preserves natural position and gates links', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-search-links-')
  const fixture = join(workspace.root, 'search-links.epub')
  await createSearchLinksEpubFixture(fixture)
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    let { page } = launched
    await expect(page.getByTestId('book-item').first()).toBeVisible()
    await page.getByTestId('book-item').first().click()
    await expect.poll(() => currentChapter(page)).toBe('第一章')

    await page.keyboard.press('Control+f')
    const input = page.getByTestId('reader-search-input')
    await expect(input).toBeFocused()
    await input.fill('SEARCHTOKEN')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('reader-search-result')).toHaveCount(2)
    await expect(page.getByText('找到 2 处')).toBeVisible()

    // 摘录中的命中词应以 <mark> 标出,非命中文本保持普通文本节点。
    const marks = page.getByTestId('reader-search-result').locator('mark')
    await expect(marks).toHaveCount(2)
    for (const mark of await marks.all()) {
      await expect(mark).toHaveText(/searchtoken/iu)
    }
    expect(page.getByTestId('reader-search-result').first().locator('p > span')).toHaveCount(0)

    await page.getByTestId('reader-search-result').last().click()
    await expect.poll(() => currentChapter(page)).toBe('第二章')
    await expect(page.getByTestId('reader-return-button')).toBeEnabled()
    await expect.poll(() => page.getByTestId('reader-host').evaluate((host) => (
      host.querySelectorAll('.llm-reader-temporary-highlight').length
    ))).toBeGreaterThan(0)

    await page.getByTestId('reader-return-button').click()
    await expect.poll(() => currentChapter(page)).toBe('第一章')

    const sameFragment = await activateEpubLink(page, 'same-fragment')
    expect(sameFragment).toEqual({
      activated: true,
      internalHref: 'chapter-1.xhtml#footnote',
      href: null
    })
    await expect.poll(() => currentChapter(page)).toBe('第一章')

    for (const id of [
      'external-http',
      'external-relative',
      'absolute-path',
      'path-traversal',
      'script-link',
      'mail-link'
    ]) {
      const blocked = await activateEpubLink(page, id)
      expect(blocked.activated).toBe(true)
      expect(blocked.internalHref).toBeNull()
      expect(blocked.href).toBeNull()
    }
    await expect.poll(() => currentChapter(page)).toBe('第一章')
    expect(application.windows()).toHaveLength(1)

    const crossChapter = await activateEpubLink(page, 'cross-chapter')
    expect(crossChapter.internalHref).toBe('chapter-2.xhtml#destination')
    await expect.poll(() => currentChapter(page)).toBe('第二章')

    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application
    page = restarted.page
    await expect(page.getByTestId('book-item').first()).toBeVisible()
    await page.getByTestId('book-item').first().click()
    await expect.poll(() => currentChapter(page)).toBe('第一章')
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
