import { showLibrary, enterReading, resizeWorkspace } from './support/workspace'
import {
  expect,
  test,
  type ElectronApplication
} from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'
import { createNestedEpubFixture } from './fixtures/nested-epub'
import { createCoveredEpubFixture } from './fixtures/covered-epub'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader, restartReader } from './support/electron-app'

for (const [theme, width, height, scale] of [['light', 1180, 800, 100], ['dark', 940, 600, 125]] as const) {
  test(`keeps a chapter visible when closing its TOC immediately after leaving a cover (${theme})`, async () => {
    const workspace = await createE2eWorkspace('llm-reader-cover-toc-resize-')
    const fixture = join(workspace.root, 'cover-navigation.epub')
    await createCoveredEpubFixture(fixture)
    const zip = await JSZip.loadAsync(await readFile(fixture))
    zip.file('OEBPS/content.opf', (await zip.file('OEBPS/content.opf')!.async('string'))
      .replace('</manifest>', '<item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/></manifest>')
      .replace('<spine>', '<spine><itemref idref="cover-page"/>'))
    zip.file('OEBPS/cover.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="images/cover.png" alt="合成封面" style="width:100%;height:1000px"/></body></html>')
    zip.file('OEBPS/nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml#destination">目标章节</a></li></ol></nav></body></html>')
    zip.file('OEBPS/chapter.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>目标章节</title></head><body><h1 id="destination">目标章节</h1>${Array.from({ length: 160 }, (_, i) => `<p id="p${i}">目标章节原文 ${i}。${'目录关闭与尺寸变化应保留当前正文位置。'.repeat(6)}</p>`).join('')}</body></html>`)
    await writeFile(fixture, await zip.generateAsync({ type: 'nodebuffer' }))
    let application: ElectronApplication | undefined
    try {
      const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
      application = launched.application
      const { page } = launched
      await resizeWorkspace(application, page, width, height)
      await page.getByTestId('settings-button').click()
      await page.getByTestId(`theme-${theme}`).click()
      await page.getByTestId(`scale-${scale}`).click()
      await page.getByTestId('settings-close').click()
      await showLibrary(page)
      await page.getByTestId('book-item').click()
      await enterReading(page)
      await expect(page.getByTestId('reader-host').frameLocator('iframe').first().getByAltText('合成封面')).toBeVisible()
      await page.getByTestId('reader-contents-button').click()
      await page.getByTestId('toc-item').click()
      await expect.poll(() => page.getByTestId('reader-host').evaluate((host) => [...host.querySelectorAll('iframe')]
        .some((frame) => frame.contentDocument?.getElementById('destination')))).toBe(true)
      await page.getByTestId('reader-contents-button').click()
      await expect.poll(() => page.getByTestId('reader-host').evaluate((host) => {
        const container = host.querySelector<HTMLElement>('.epub-container')
        // clientWidth excludes the EPUB's vertical scrollbar; compare outer bounds.
        return container ? Math.abs(container.getBoundingClientRect().width - host.getBoundingClientRect().width) : Infinity
      })).toBeLessThanOrEqual(2)
      const paragraph = page.getByTestId('reader-host').frameLocator('.epub-view[ref="1"] iframe').locator('#p0')
      await expect(paragraph).toBeInViewport()
      await expect.poll(() => page.getByTestId('reader-host').evaluate((host) => {
        const frame = host.querySelector<HTMLIFrameElement>('.epub-view[ref="1"] iframe')
        return Boolean(frame?.contentDocument?.body && frame.contentDocument.body.getBoundingClientRect().width <= frame.clientWidth + 2)
      })).toBe(true)
      await paragraph.evaluate((element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        const selection = window.getSelection()!
        selection.removeAllRanges(); selection.addRange(range)
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      })
      await expect(page.getByTestId('selection-toolbar')).toBeVisible()
      await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '目标章节')
      await page.screenshot({ path: test.info().outputPath(`cover-toc-${theme}.png`) })
    } finally { await cleanupE2eWorkspace(application, workspace.root) }
  })
}

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

    await showLibrary(page); await expect(page.getByTestId('book-item').first()).toBeVisible()
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
    await showLibrary(page); await page.getByTestId('book-item').first().click(); await enterReading(page)
    await expect(page.locator('.workspace-book-title h1')).toHaveText('文学批评入门 - 汤拥华')
    await page.getByTestId('reader-contents-button').click()
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

    await showLibrary(page); await expect(page.getByTestId('book-item').first()).toBeVisible()
    await showLibrary(page); await page.getByTestId('book-item').first().click(); await enterReading(page)
    await expect(page.getByTestId('reader-host').locator('iframe')).not.toHaveCount(0)

    await page.getByTestId('reader-contents-button').click()

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
    await expect(page.locator('.reader-column')).toHaveAttribute('data-current-chapter-title', '第二章')
    for (const [theme, width, height, scale] of [['light', 1180, 800, 100], ['dark', 940, 600, 125]] as const) {
      await resizeWorkspace(application, page, width, height)
      await page.getByTestId('settings-button').click()
      await page.getByTestId('settings-nav-appearance').click()
      await page.getByTestId(`theme-${theme}`).click()
      await page.getByTestId(`scale-${scale}`).click()
      await page.getByTestId('settings-close').click()
      await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme', theme)
      await expect(page.getByTestId('app-shell')).toHaveAttribute('data-interface-scale', String(scale))
      // Theme/scale attributes update before epub.js finishes sizing the chapter iframe.
      await expect.poll(() => page.getByTestId('reader-host').evaluate((host) => {
        const container = host.querySelector('.epub-container')
        const frames = [...host.querySelectorAll('iframe')]
        return container && frames.length
          ? Math.max(...frames.map((frame) => Math.abs(frame.clientWidth - container.clientWidth)))
          : Number.POSITIVE_INFINITY
      })).toBeLessThan(4)
      const visualDirectory = process.env.LLM_READER_VISUAL_DIR
      if (visualDirectory) {
        await mkdir(visualDirectory, { recursive: true })
        await page.screenshot({ path: join(visualDirectory, `epub-toc-${theme}-${width}x${height}-${scale}.png`) })
      }
    }
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
    await showLibrary(page); await expect(page.getByTestId('book-item').first()).toBeVisible()
    await showLibrary(page); await page.getByTestId('book-item').first().click(); await enterReading(page)
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
