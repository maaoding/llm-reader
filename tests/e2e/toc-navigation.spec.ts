import {
  expect,
  test,
  type ElectronApplication
} from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createNestedEpubFixture } from './fixtures/nested-epub'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader, restartReader } from './support/electron-app'

function rgbChannels(value: string): [number, number, number] {
  const channels = value
    .match(/rgba?\(([^)]+)\)/)?.[1]
    .split(',')
    .slice(0, 3)
    .map((part) => Number(part.trim()))
  if (!channels || channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) {
    throw new Error(`Expected an RGB color, received: ${value}`)
  }
  return channels as [number, number, number]
}

function relativeLuminance(value: string): number {
  const linear = rgbChannels(value).map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background))
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

test('keeps a TXT filename when front matter is generic and omits duplicated book TOC runs', async () => {
  test.setTimeout(90_000)
  const workspace = await createE2eWorkspace('llm-reader-txt-front-matter-')
  const fixture = join(workspace.root, '文学批评入门 - 汤拥华.txt')
  const chapterLabels = ['第一章 起点', '第二章 边界', '第三章 关系', '第四章 结论']
  const frontToc = chapterLabels.map((label) => `${label}本章提要`).join('\n\n')
  const body = chapterLabels
    .map((label, index) => `${label}\n\n${`第 ${index + 1} 章正文内容。`.repeat(40)}`)
    .join('\n\n')
  await writeFile(
    fixture,
    `图书在版编目（CIP）数据\n\n${frontToc}\n\n${body}\n\n${chapterLabels.join('\n\n')}`,
    'utf8'
  )
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    let { page } = launched

    await expect(page.getByTestId('book-item').first()).toBeVisible()
    await page.evaluate(async () => {
      const readerApi = (window as unknown as {
        readerApi: {
          listBooks(): Promise<Array<{ id: string }>>
          updateBookMetadata(bookId: string, title: string, author: string | null): Promise<unknown>
        }
      }).readerApi
      const [book] = await readerApi.listBooks()
      await readerApi.updateBookMetadata(book.id, '图书在版编目（CIP）数据', null)
    })
    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application
    page = restarted.page
    await expect(page.getByTestId('book-item').first()).toContainText('图书在版编目（CIP）数据')
    await page.getByTestId('book-item').first().click()
    await expect(page.locator('.reader-heading h1')).toHaveText('文学批评入门 - 汤拥华')
    await expect(page.getByTestId('toc-item')).toHaveCount(chapterLabels.length)
    await expect(page.getByTestId('toc-item')).toHaveText(chapterLabels)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('nested TOC collapses via disclosure without jumping and navigates without CFI highlight', async () => {
  test.setTimeout(90_000)
  const workspace = await createE2eWorkspace('llm-reader-toc-')
  const fixture = join(workspace.root, 'nested-toc.epub')
  await createNestedEpubFixture(fixture)
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const { page } = launched

    await expect(page.getByTestId('book-item').first()).toBeVisible()
    await page.getByTestId('book-item').first().click()
    await expect(page.getByTestId('reader-host').locator('iframe')).not.toHaveCount(0)

    await page.getByRole('button', { name: '目录', exact: true }).click()

    const tocItems = page.getByTestId('toc-item')
    const disclosure = page.getByTestId('toc-disclosure')

    // 默认展开：第一部 + 概念边界 + 第二章，第一部带 disclosure。
    await expect(tocItems).toHaveCount(3)
    await expect(tocItems.locator('svg')).toHaveCount(0)
    await expect(disclosure).toHaveCount(1)
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true')

    // disclosure 只负责折叠，不触发跳转；折叠后子项隐藏。
    await disclosure.click()
    await expect(tocItems).toHaveCount(1)
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByText('无法跳转到这个章节')).toHaveCount(0)

    // 再点恢复展开。
    await disclosure.click()
    await expect(tocItems).toHaveCount(3)
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true')

    // 点击目录标题才跳转：第二章 href 走 goTo，不进入 CFI highlight。
    await tocItems.filter({ hasText: '第二章' }).click()
    await expect
      .poll(() =>
        page.getByTestId('reader-host').evaluate((host) => {
          for (const frame of host.querySelectorAll('iframe')) {
            const document = frame.contentDocument
            if (document?.body?.textContent?.includes('后续加载章节也应继承当前阅读偏好')) {
              return true
            }
          }
          return false
        })
      )
      .toBe(true)

    await expect(page.getByText('无效的 EPUB 高亮锚点')).toHaveCount(0)
    await expect(page.getByText('无法跳转到这个章节')).toHaveCount(0)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('EPUB keeps authored black text on a light page in dark mode', async () => {
  test.setTimeout(90_000)
  const workspace = await createE2eWorkspace('llm-reader-dark-')
  const fixture = join(workspace.root, 'dark-readability.epub')
  await createNestedEpubFixture(fixture)
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const { page } = launched
    await expect(page.getByTestId('book-item').first()).toBeVisible()
    await page.getByTestId('book-item').first().click()
    await expect(page.getByTestId('reader-host').locator('iframe')).not.toHaveCount(0)

    await page.getByTestId('settings-button').click()
    await page.getByTestId('theme-dark').click()
    await page.getByTestId('settings-close').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    await expect
      .poll(async () => {
        const colors = await page.getByTestId('reader-host').evaluate((host) => {
          const frame = host.querySelector('iframe')
          const body = frame?.contentDocument?.body
          if (!frame || !body) return null
          const bodyBg = getComputedStyle(body).backgroundColor
          const frameBg = getComputedStyle(frame).backgroundColor
          const transparent = bodyBg === 'rgba(0, 0, 0, 0)' || bodyBg === 'transparent'
          return { textColor: getComputedStyle(body).color, effectiveBg: transparent ? frameBg : bodyBg }
        })
        if (!colors) return 0
        return contrastRatio(colors.textColor, colors.effectiveBg)
      })
      .toBeGreaterThanOrEqual(4.5)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
