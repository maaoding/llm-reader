import {
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'
import { createCoveredEpubFixture } from './fixtures/covered-epub'
import {
  cleanupE2eWorkspace,
  createE2eWorkspace,
  launchReader,
  restartReader
} from './support/electron-app'

const complexTxt = resolve('tests/fixtures/complex-reading.txt')
const textPdf = resolve('tests/e2e/fixtures/text-reader.pdf')
const READING_PREFERENCES_KEY = 'llm-reader.reading-preferences'
const PAPER_THEME_PREFERENCE_KEY = 'llm-reader.paper-theme-preference'
const LEGACY_PAPER_THEME_MODE_KEY = 'llm-reader.paper-theme-mode'
const LIGHT_PAPER_BACKGROUND = 'rgb(253, 252, 249)'
const DARK_PAPER_BACKGROUND = 'rgb(34, 41, 45)'
const DARK_EYE_CARE_BACKGROUND = 'rgb(42, 38, 32)'
const DARK_EYE_CARE_INK = 'rgb(232, 223, 207)'

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

async function selectPaperTheme(page: Page, value: 'default' | 'eye-care'): Promise<void> {
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

test('migrates every legacy paper choice to default and removes obsolete layout fields', async () => {
  const workspace = await createE2eWorkspace('llm-reader-paper-legacy-')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: complexTxt })
    application = launched.application
    await launched.page.evaluate(({ readingKey, legacyModeKey, preferenceKey }) => {
      window.localStorage.setItem(readingKey, JSON.stringify({ paperTheme: 'sepia', pageMargin: 'wide' }))
      window.localStorage.setItem(legacyModeKey, 'custom')
      window.localStorage.removeItem(preferenceKey)
      window.localStorage.setItem('llm-reader.theme', 'dark')
    }, {
      readingKey: READING_PREFERENCES_KEY,
      legacyModeKey: LEGACY_PAPER_THEME_MODE_KEY,
      preferenceKey: PAPER_THEME_PREFERENCE_KEY
    })

    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application
    const page = restarted.page

    await openFirstBook(page)
    await expect(page.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'dark')
    await expect(page.locator('.reader-surface')).not.toHaveAttribute('data-paper-theme', 'sepia')
    const stored = await page.evaluate(({ readingKey, legacyModeKey, preferenceKey }) => ({
      reading: JSON.parse(window.localStorage.getItem(readingKey) ?? '{}') as Record<string, unknown>,
      legacy: window.localStorage.getItem(legacyModeKey),
      preference: window.localStorage.getItem(preferenceKey)
    }), {
      readingKey: READING_PREFERENCES_KEY,
      legacyModeKey: LEGACY_PAPER_THEME_MODE_KEY,
      preferenceKey: PAPER_THEME_PREFERENCE_KEY
    })
    expect(stored.preference).toBe('default')
    expect(stored.legacy).toBeNull()
    expect(stored.reading.paperTheme).toBe('light')
    expect(stored.reading).not.toHaveProperty('pageMargin')
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

test('maps eye-care to sepia or warm dark paper and persists the preference', async () => {
  const workspace = await createE2eWorkspace('llm-reader-paper-eye-care-')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: complexTxt })
    application = launched.application
    const { page } = launched

    await openFirstBook(page)
    await setInterfaceTheme(page, 'light')
    await selectPaperTheme(page, 'eye-care')
    await expect(page.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'sepia')

    await setInterfaceTheme(page, 'dark')
    await expect(page.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'dark-eye-care')
    await expect
      .poll(() => page.locator('.reader-document--txt').evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe(DARK_EYE_CARE_BACKGROUND)

    const restarted = await restartReader(application, { userData: workspace.userData })
    application = restarted.application
    const restoredPage = restarted.page

    await openFirstBook(restoredPage)
    await expect(restoredPage.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'dark-eye-care')
    expect(await restoredPage.evaluate((key: string) => window.localStorage.getItem(key), PAPER_THEME_PREFERENCE_KEY))
      .toBe('eye-care')

    await setInterfaceTheme(restoredPage, 'light')
    await expect(restoredPage.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'sepia')
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('returns to the default paper after switching back or restoring defaults', async () => {
  const workspace = await createE2eWorkspace('llm-reader-paper-back-')
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: complexTxt })
    application = launched.application
    const { page } = launched

    await openFirstBook(page)
    await selectPaperTheme(page, 'eye-care')
    await setInterfaceTheme(page, 'dark')
    await expect(page.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'dark-eye-care')

    await selectPaperTheme(page, 'default')
    await expect(page.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'dark')

    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-reading').click()
    await page.getByTestId('reading-reset').click()
    await expect(page.getByTestId('reading-paper-theme')).toHaveValue('default')
    await expect(page.getByTestId('reading-paper-theme').locator('option')).toHaveText(['默认', '护眼'])
    await page.getByTestId('settings-close').click()
    await expect(page.getByTestId('settings-modal')).toHaveCount(0)

    await expect(page.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'dark')
    expect(await page.evaluate((key: string) => window.localStorage.getItem(key), PAPER_THEME_PREFERENCE_KEY))
      .toBe('default')
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
    await selectPaperTheme(page, 'eye-care')
    await expect(page.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'dark-eye-care')

    const pdfBackground = await page.locator('.pdf-document').evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(pdfBackground).not.toBe(DARK_EYE_CARE_BACKGROUND)
    await expect(page.locator('.pdf-page-canvas').first()).toBeVisible()
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})

test('applies the warm dark eye-care palette inside a reflowable EPUB', async () => {
  const workspace = await createE2eWorkspace('llm-reader-paper-reflowable-')
  const fixture = join(workspace.root, 'reflowable.epub')
  await createCoveredEpubFixture(fixture)
  let application: ElectronApplication | undefined

  try {
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const { page } = launched

    await openFirstBook(page)
    const chapter = page.getByTestId('reader-host').frameLocator('iframe').first()
    await expect(chapter.getByText('封面与元数据窗口的桌面交互验证。')).toBeVisible({ timeout: 30_000 })
    await setInterfaceTheme(page, 'dark')
    await selectPaperTheme(page, 'eye-care')

    await expect(page.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'dark-eye-care')
    await expect(page.getByTestId('reader-host')).toHaveAttribute('data-epub-layout', 'reflowable')
    await expect.poll(() => chapter.locator('body').evaluate((element) => {
      const style = getComputedStyle(element)
      return { background: style.backgroundColor, color: style.color }
    })).toEqual({ background: DARK_EYE_CARE_BACKGROUND, color: DARK_EYE_CARE_INK })
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
    await selectPaperTheme(page, 'eye-care')
    await expect(page.locator('.reader-surface')).toHaveAttribute('data-paper-theme', 'dark-eye-care')
    await expect(page.getByTestId('reader-host')).toHaveAttribute('data-epub-layout', 'fixed')

    const injectedStyles = await chapter.locator('style').allTextContents()
    expect(injectedStyles.join('\n')).not.toContain('#2a2620')
    const bodyColor = await chapter.locator('body').evaluate((element) => getComputedStyle(element).color)
    expect(bodyColor).not.toBe(DARK_EYE_CARE_INK)
    const iframeBackground = await page.getByTestId('reader-host').locator('iframe').first()
      .evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(iframeBackground).toBe(LIGHT_PAPER_BACKGROUND)
  } finally {
    await cleanupE2eWorkspace(application, workspace.root)
  }
})
