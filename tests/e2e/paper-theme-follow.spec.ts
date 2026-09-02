import {
  expect,
  test,
  type ElectronApplication,
  type Page
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

const complexTxt = resolve('tests/fixtures/complex-reading.txt')
const textPdf = resolve('tests/e2e/fixtures/text-reader.pdf')
const READING_PREFERENCES_KEY = 'llm-reader.reading-preferences'
const PAPER_THEME_MODE_KEY = 'llm-reader.paper-theme-mode'
const LIGHT_PAPER_BACKGROUND = 'rgb(253, 252, 249)'
const DARK_PAPER_BACKGROUND = 'rgb(34, 41, 45)'
const DARK_PAPER_INK = 'rgb(231, 233, 230)'

async function openFirstBook(page: Page): Promise<void> {
  await page.getByTestId('book-item').first().click()
  await expect(page.getByTestId('reader-host')).toBeVisible()
}

async function setInterfaceTheme(page: Page, preference: 'light' | 'dark'): Promise<void> {
  await page.getByTestId('settings-button').click()
  await page.getByTestId('settings-nav-appearance').click()
  await page.getByTestId(`theme-${preference}`).click()
  await page.getByTestId('settings-close').click()
  await expect(page.getByTestId('settings-modal')).toHaveCount(0)
}

async function selectPaperTheme(page: Page, value: string): Promise<void> {
  await page.getByTestId('settings-button').click()
  await page.getByTestId('settings-nav-reading').click()
  await page.getByTestId('reading-paper-theme').selectOption(value)
  await page.getByTestId('settings-close').click()
  await expect(page.getByTestId('settings-modal')).toHaveCount(0)
}

async function createFixedLayoutEpub(path: string): Promise<void> {
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
    <dc:identifier id="book-id">urn:uuid:llm-reader-paper-follow-fixed</dc:identifier>
    <dc:title>固定版式纸张样本</dc:title><dc:language>zh-CN</dc:language>
    <meta property="rendition:layout">pre-paginated</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/></spine>
</package>`
  )
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body><nav epub:type="toc"><ol><li><a href="c1.xhtml">第一页</a></li></ol></nav></body>
</html>`
  )
  zip.file(
    'OEBPS/c1.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta name="viewport" content="width=800,height=1200"/>
    <style>html, body { margin: 0; width: 800px; height: 1200px; overflow: hidden; }</style>
  </head>
  <body><h1>第一页</h1><p>固定版式内容颜色不应被阅读纸张反色。</p></body>
</html>`
  )
  await writeFile(path, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}

test('migrates legacy paper choices to follow the interface theme', async () => {
  const workspace = await createE2eWorkspace('llm-reader-paper-legacy-')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: complexTxt })
    application = launched.application
    await launched.page.evaluate(({ readingKey, modeKey }: { readingKey: string; modeKey: string }) => {
      window.localStorage.setItem(readingKey, JSON.stringify({ paperTheme: 'sepia' }))
      window.localStorage.removeItem(modeKey)
      window.localStorage.setItem('llm-reader.theme', 'dark')
    }, { readingKey: READING_PREFERENCES_KEY, modeKey: PAPER_THEME_MODE_KEY })

    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application
    const page = restarted.page

    await openFirstBook(page)
    await expect(page.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'dark')
    await expect(page.locator('.reader-surface')).not.toHaveAttribute('data-paper-theme', 'sepia')
    expect(await page.evaluate((modeKey: string) => window.localStorage.getItem(modeKey), PAPER_THEME_MODE_KEY))
      .toBe('interface')
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('applies the interface theme to an open TXT book immediately', async () => {
  const workspace = await createE2eWorkspace('llm-reader-paper-txt-')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: complexTxt })
    application = launched.application
    const { page } = launched

    await openFirstBook(page)
    await setInterfaceTheme(page, 'light')
    await expect(page.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'light')
    await expect
      .poll(() => page.locator('.reader-document--txt').evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe(LIGHT_PAPER_BACKGROUND)

    await setInterfaceTheme(page, 'dark')
    await expect(page.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'dark')
    await expect
      .poll(() => page.locator('.reader-document--txt').evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe(DARK_PAPER_BACKGROUND)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('follows system light/dark switches while the preference is system', async () => {
  const workspace = await createE2eWorkspace('llm-reader-paper-system-')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData })
    application = launched.application
    const { page } = launched

    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'dark')

    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'light')
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('keeps a manual sepia paper across interface switches and restarts', async () => {
  const workspace = await createE2eWorkspace('llm-reader-paper-sepia-')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: complexTxt })
    application = launched.application
    const { page } = launched

    await openFirstBook(page)
    await selectPaperTheme(page, 'sepia')
    await expect(page.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'sepia')

    await setInterfaceTheme(page, 'dark')
    await expect(page.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'sepia')

    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application
    const restoredPage = restarted.page

    await openFirstBook(restoredPage)
    await expect(restoredPage.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'sepia')
    expect(await restoredPage.evaluate((modeKey: string) => window.localStorage.getItem(modeKey), PAPER_THEME_MODE_KEY))
      .toBe('custom')

    await setInterfaceTheme(restoredPage, 'light')
    await expect(restoredPage.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'sepia')
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('follows the interface again after switching back or restoring defaults', async () => {
  const workspace = await createE2eWorkspace('llm-reader-paper-back-')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: complexTxt })
    application = launched.application
    const { page } = launched

    await openFirstBook(page)
    await selectPaperTheme(page, 'sepia')
    await setInterfaceTheme(page, 'dark')
    await expect(page.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'sepia')

    await selectPaperTheme(page, 'interface')
    await expect(page.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'dark')

    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-reading').click()
    await page.getByTestId('reading-reset').click()
    await expect(page.getByTestId('reading-paper-theme')).toHaveValue('interface')
    await page.getByTestId('settings-close').click()
    await expect(page.getByTestId('settings-modal')).toHaveCount(0)

    await expect(page.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'dark')
    expect(await page.evaluate((modeKey: string) => window.localStorage.getItem(modeKey), PAPER_THEME_MODE_KEY))
      .toBe('interface')
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('keeps PDF page colors while the surrounding area follows the dark interface', async () => {
  const workspace = await createE2eWorkspace('llm-reader-paper-pdf-')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: textPdf })
    application = launched.application
    const { page } = launched

    await openFirstBook(page)
    await expect(page.getByTestId('pdf-reader')).toBeVisible({ timeout: 60_000 })

    await setInterfaceTheme(page, 'dark')
    await expect(page.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'dark')

    const pdfBackground = await page.locator('.pdf-document').evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(pdfBackground).not.toBe(DARK_PAPER_BACKGROUND)
    await expect(page.locator('.pdf-page-canvas').first()).toBeVisible()
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('keeps fixed-layout EPUB page colors while the surrounding area follows the dark interface', async () => {
  const workspace = await createE2eWorkspace('llm-reader-paper-fixed-')
  const fixture = join(workspace.root, 'fixed-layout.epub')
  await createFixedLayoutEpub(fixture)
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const { page } = launched

    await openFirstBook(page)
    const chapter = page.getByTestId('reader-host').frameLocator('iframe').first()
    await expect(chapter.getByText('固定版式内容颜色不应被阅读纸张反色。')).toBeVisible({ timeout: 30_000 })

    await setInterfaceTheme(page, 'dark')
    await expect(page.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'dark')

    const injectedStyles = await chapter.locator('style').allTextContents()
    expect(injectedStyles.join('\n')).not.toContain(DARK_PAPER_BACKGROUND)
    const bodyColor = await chapter.locator('body').evaluate((element) => getComputedStyle(element).color)
    expect(bodyColor).not.toBe(DARK_PAPER_INK)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
