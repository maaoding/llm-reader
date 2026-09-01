import {
  expect,
  test,
  type ElectronApplication
} from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'
import {
  cleanupE2eWorkspace,
  createE2eWorkspace,
  launchReader,
  restartReader
} from './support/electron-app'

async function createTwoChapterEpub(path: string): Promise<void> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
  )
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:llm-reader-typography-e2e</dc:identifier>
    <dc:title>排版设置样本</dc:title><dc:creator>LLM Reader</dc:creator><dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-2" href="chapter-2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="chapter-1"/><itemref idref="chapter-2"/></spine>
</package>`
  )
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
  <nav epub:type="toc"><ol><li><a href="chapter-1.xhtml">第一章</a></li><li><a href="chapter-2.xhtml">第二章</a></li></ol></nav>
</body></html>`
  )
  for (const [file, title, text] of [
    ['chapter-1.xhtml', '第一章', '页边距应当只在全书开头和结尾出现。'],
    ['chapter-2.xhtml', '第二章', '这里检验章节之间的排版不会被纵向边距打断。']
  ] as const) {
    zip.file(
      `OEBPS/${file}`,
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>
  <h1>${title}</h1><p>${text}</p>
  ${Array.from({ length: 24 }, (_, index) => `<p>${title}段落 ${index + 1}，用于稳定连续滚动布局。</p>`).join('\n')}
</body></html>`
    )
  }
  await writeFile(path, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}

test('adjusts page margins and alignment for TXT and keeps them across restarts', async () => {
  const workspace = await createE2eWorkspace('llm-reader-typography-txt-')
  const fixture = resolve('tests/fixtures/complex-reading.txt')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const { page } = launched

    await page.getByTestId('book-item').first().click()
    await expect(page.getByTestId('reader-host')).toContainText('复杂概念')

    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-reading').click()
    await page.getByTestId('reading-page-margin').selectOption('wide')
    await page.getByTestId('reading-text-align').selectOption('justify')

    const txtDocument = page.locator('.reader-document--txt')
    await expect
      .poll(() => txtDocument.evaluate((element) => {
        const style = getComputedStyle(element)
        return {
          paddingTop: style.paddingTop,
          paddingLeft: style.paddingLeft,
          paragraphAlign: getComputedStyle(element.querySelector('p')!).textAlign
        }
      }))
      .toEqual({
        paddingTop: '72px',
        paddingLeft: '96px',
        paragraphAlign: 'justify'
      })

    await page.getByTestId('settings-close').click()
    await expect(page.getByTestId('settings-modal')).toHaveCount(0)

    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application
    const restoredPage = restarted.page
    await restoredPage.getByTestId('book-item').first().click()
    await expect(restoredPage.getByTestId('reader-host')).toContainText('复杂概念')
    await expect
      .poll(() => restoredPage.locator('.reader-document--txt').evaluate((element) => {
        const style = getComputedStyle(element)
        return {
          paddingTop: style.paddingTop,
          paddingLeft: style.paddingLeft,
          paragraphAlign: getComputedStyle(element.querySelector('p')!).textAlign
        }
      }))
      .toEqual({
        paddingTop: '72px',
        paddingLeft: '96px',
        paragraphAlign: 'justify'
      })
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('applies EPUB page margins and alignment inside the rendered chapter', async () => {
  const workspace = await createE2eWorkspace('llm-reader-typography-epub-')
  const fixture = join(workspace.root, 'typography.epub')
  await createTwoChapterEpub(fixture)
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const { page } = launched

    await page.getByTestId('book-item').first().click()
    const chapterFrame = page.getByTestId('reader-host').frameLocator('iframe').first()
    await expect(chapterFrame.getByText('页边距应当只在全书开头和结尾出现。')).toBeVisible()

    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-reading').click()
    await page.getByTestId('reading-page-margin').selectOption('standard')
    await page.getByTestId('reading-text-align').selectOption('justify')

    await expect
      .poll(() => chapterFrame.locator('html').evaluate((element) => {
        const style = getComputedStyle(element)
        const paragraph = element.ownerDocument.querySelector('p')
        return {
          paddingTop: style.paddingTop,
          paragraphAlign: paragraph ? getComputedStyle(paragraph).textAlign : ''
        }
      }))
      .toEqual({
        paddingTop: '48px',
        paragraphAlign: 'justify'
      })

    const paddingLeft = await chapterFrame.locator('html').evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).paddingLeft)
    )
    expect(paddingLeft).toBeGreaterThan(28)
    expect(paddingLeft).toBeLessThanOrEqual(72)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
