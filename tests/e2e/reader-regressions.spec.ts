import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication
} from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'

async function writeEpubFixture(path: string, chapters: Array<{ file: string; label: string; head?: string; css?: string }>): Promise<void> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
  )

  const manifest = chapters
    .map((chapter) => `<item id="${chapter.file}" href="${chapter.file}.xhtml" media-type="application/xhtml+xml"/>`)
    .join('')
  const spine = chapters.map((chapter) => `<itemref idref="${chapter.file}"/>`).join('')
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:llm-reader-regression</dc:identifier>
    <dc:title>回归样本</dc:title><dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>${manifest}<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>
  <spine>${spine}</spine>
</package>`
  )

  const navItems = chapters
    .map((chapter) => `<li><a href="${chapter.file}.xhtml">${chapter.label}</a></li>`)
    .join('')
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body><nav epub:type="toc"><ol>${navItems}</ol></nav></body>
</html>`
  )

  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index]
    const paragraphs = Array.from(
      { length: 60 },
      (_, block) => `<p>第 ${index + 1} 章第 ${block + 1} 段。${'连续滚动内容'.repeat(8)}</p>`
    ).join('')
    zip.file(
      `OEBPS/${chapter.file}.xhtml`,
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    ${chapter.head ?? ''}
    <style>${chapter.css ?? 'html, body { margin: 0; padding: 0; } body { padding: 24px 36px 48px; } p { margin: 0 0 16px; }'}</style>
  </head>
  <body><h1>${chapter.label}</h1>${paragraphs}</body>
</html>`
    )
  }

  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await writeFile(path, bytes)
}

test('expands reflowable chapters whose CSS constrains html and body height', async () => {
  test.setTimeout(90_000)
  const testRoot = await mkdtemp(join(tmpdir(), 'llm-reader-chapter-height-'))
  const userData = join(testRoot, 'profile')
  const fixture = join(testRoot, 'constrained-height.epub')
  await writeEpubFixture(fixture, [
    { file: 'c1', label: '第一章', css: 'html, body { margin: 0; height: 100%; } body { columns: 2; column-gap: 20px; } p { margin: 0 0 16px; }' },
    { file: 'c2', label: '第二章', css: 'html, body { margin: 0; height: 100%; } body { columns: 2; column-gap: 20px; } p { margin: 0 0 16px; }' }
  ])
  let application: ElectronApplication | undefined

  try {
    application = await electron.launch({
      args: ['.'],
      env: { ...process.env, LLM_READER_USER_DATA: userData, LLM_READER_E2E_IMPORT: fixture }
    })
    const page = await application.firstWindow()
    await expect(page.getByTestId('book-item').first()).toBeVisible()
    await page.getByTestId('book-item').first().click()
    const frame = page.getByTestId('reader-host').locator('iframe').first()
    await expect(frame).toBeVisible()

    await expect
      .poll(() =>
        frame.evaluate((element) => {
          const frameElement = element as HTMLIFrameElement
          const document = frameElement.contentDocument
          if (!document) return 0
          return document.documentElement.scrollHeight
        })
      )
      .toBeGreaterThan(2_000)

    const dimensions = await page.getByTestId('reader-host').evaluate((host) => {
      const container = host.querySelector<HTMLElement>(':scope > .epub-container')
      const frameElement = host.querySelector<HTMLIFrameElement>('iframe')
      const document = frameElement?.contentDocument
      if (!container || !frameElement || !document) return null
      return {
        frameHeight: frameElement.getBoundingClientRect().height,
        documentWidth: document.documentElement.scrollWidth,
        frameWidth: frameElement.getBoundingClientRect().width
      }
    })
    expect(dimensions?.frameHeight).toBeGreaterThan(2_000)
    expect(dimensions?.documentWidth).toBeLessThanOrEqual((dimensions?.frameWidth ?? 0) + 2)
  } finally {
    await application?.close().catch(() => undefined)
    await rm(testRoot, { recursive: true, force: true })
  }
})

test('highlights only the TOC entry whose href matches the current chapter', async () => {
  test.setTimeout(90_000)
  const testRoot = await mkdtemp(join(tmpdir(), 'llm-reader-duplicate-toc-'))
  const userData = join(testRoot, 'profile')
  const fixture = join(testRoot, 'duplicate-toc.epub')
  await writeEpubFixture(fixture, [
    { file: 'c1', label: '相同章节' },
    { file: 'c2', label: '相同章节' },
    { file: 'c3', label: '相同章节' }
  ])
  let application: ElectronApplication | undefined

  try {
    application = await electron.launch({
      args: ['.'],
      env: { ...process.env, LLM_READER_USER_DATA: userData, LLM_READER_E2E_IMPORT: fixture }
    })
    const page = await application.firstWindow()
    await expect(page.getByTestId('book-item').first()).toBeVisible()
    await page.getByTestId('book-item').first().click()

    const tocItems = page.getByTestId('toc-item')
    const currentTocItems = page.locator('[data-testid="toc-item"][data-current="true"]')
    await expect(tocItems).toHaveCount(3)
    await expect(tocItems.first()).toHaveAttribute('data-current', 'true')
    await expect(currentTocItems).toHaveCount(1)

    await tocItems.nth(1).click()
    await expect(tocItems.nth(1)).toHaveAttribute('data-current', 'true')
    await expect(currentTocItems).toHaveCount(1)

    await page.waitForTimeout(400)
    for (let step = 0; step < 24; step += 1) {
      await page
        .getByTestId('reader-host')
        .locator(':scope > .epub-container')
        .evaluate((scroller) => {
          scroller.scrollBy(0, scroller.clientHeight * 0.7)
        })
      await page.waitForTimeout(260)
      if (await tocItems.nth(2).getAttribute('data-current') === 'true') break
    }

    await expect(tocItems.nth(2)).toHaveAttribute('data-current', 'true')
    await expect(currentTocItems).toHaveCount(1)
  } finally {
    await application?.close().catch(() => undefined)
    await rm(testRoot, { recursive: true, force: true })
  }
})

test('scales fixed-layout pages instead of clipping them below the viewport', async () => {
  test.setTimeout(90_000)
  const testRoot = await mkdtemp(join(tmpdir(), 'llm-reader-fixed-layout-'))
  const userData = join(testRoot, 'profile')
  const fixture = join(testRoot, 'fixed-layout.epub')
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
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0" prefix="rendition: http://www.idpf.org/vocab/rendition/#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:llm-reader-fixed-layout</dc:identifier>
    <dc:title>固定版式回归样本</dc:title><dc:language>zh-CN</dc:language>
    <meta property="rendition:layout">pre-paginated</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`
  )
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body><nav epub:type="toc"><ol><li><a href="c1.xhtml">第一页</a></li><li><a href="c2.xhtml">第二页</a></li></ol></nav></body>
</html>`
  )
  for (const [index, file] of ['c1', 'c2'].entries()) {
    const paragraphs = Array.from(
      { length: 40 },
      (_, block) => `<p>固定版式第 ${index + 1} 页第 ${block + 1} 段。</p>`
    ).join('')
    zip.file(
      `OEBPS/${file}.xhtml`,
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta name="viewport" content="width=800,height=1200"/>
    <style>html, body { margin: 0; width: 800px; height: 1200px; overflow: hidden; }</style>
  </head>
  <body><h1>第 ${index + 1} 页</h1>${paragraphs}</body>
</html>`
    )
  }
  await writeFile(fixture, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))

  let application: ElectronApplication | undefined
  try {
    application = await electron.launch({
      args: ['.'],
      env: { ...process.env, LLM_READER_USER_DATA: userData, LLM_READER_E2E_IMPORT: fixture }
    })
    const page = await application.firstWindow()
    await expect(page.getByTestId('book-item').first()).toBeVisible()
    await page.getByTestId('book-item').first().click()
    const frame = page.getByTestId('reader-host').locator('iframe').first()
    await expect(frame).toBeVisible()

    await expect
      .poll(() =>
        frame.evaluate((element) => {
          const frameElement = element as HTMLIFrameElement
          const body = frameElement.contentDocument?.body
          if (!body) return 'none'
          return getComputedStyle(body).transform
        })
      )
      .not.toBe('none')

    const clipped = await frame.evaluate((element) => {
      const frameElement = element as HTMLIFrameElement
      const document = frameElement.contentDocument
      if (!document?.body) return true
      return document.body.getBoundingClientRect().bottom > document.documentElement.clientHeight + 1
    })
    expect(clipped).toBe(false)

    const tocItems = page.getByTestId('toc-item')
    const currentTocItems = page.locator('[data-testid="toc-item"][data-current="true"]')
    await tocItems.nth(1).click()
    await expect(tocItems.nth(1)).toHaveAttribute('data-current', 'true')
    await expect(currentTocItems).toHaveCount(1)
  } finally {
    await application?.close().catch(() => undefined)
    await rm(testRoot, { recursive: true, force: true })
  }
})
