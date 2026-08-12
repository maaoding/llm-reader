import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'

interface EpubSnapshot {
  key: number
  spine: number
  block: number
  ratio: number
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  refs: number[]
}

interface PersistedPosition {
  locator: string
  progress: number
}

const EPUB_CHAPTER_COUNT = 5
const EPUB_BLOCKS_PER_CHAPTER = 28

async function createLongEpubFixture(path: string): Promise<void> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
  )

  const manifestItems = Array.from(
    { length: EPUB_CHAPTER_COUNT },
    (_, index) =>
      `<item id="chapter-${index + 1}" href="chapter-${index + 1}.xhtml" media-type="application/xhtml+xml"/>`
  ).join('\n    ')
  const spineItems = Array.from(
    { length: EPUB_CHAPTER_COUNT },
    (_, index) => `<itemref idref="chapter-${index + 1}"/>`
  ).join('\n    ')

  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:llm-reader-upward-scroll</dc:identifier>
    <dc:title>连续向上滚动回归样本</dc:title>
    <dc:creator>LLM Reader</dc:creator>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="plate" href="images/plate.svg" media-type="image/svg+xml"/>
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`
  )

  const navItems = Array.from(
    { length: EPUB_CHAPTER_COUNT },
    (_, index) => `<li><a href="chapter-${index + 1}.xhtml">第 ${index + 1} 章</a></li>`
  ).join('')
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body><nav epub:type="toc"><ol>${navItems}</ol></nav></body>
</html>`
  )

  zip.file(
    'OEBPS/images/plate.svg',
    `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="420" viewBox="0 0 960 420">
  <rect width="960" height="420" fill="#e5eaed"/>
  <path d="M80 320 L280 150 L450 270 L650 90 L880 300" fill="none" stroke="#586f7e" stroke-width="14"/>
</svg>`
  )

  for (let chapter = 0; chapter < EPUB_CHAPTER_COUNT; chapter += 1) {
    const paragraphs = Array.from({ length: EPUB_BLOCKS_PER_CHAPTER }, (_, block) => {
      const repeatedText =
        '阅读位置必须随着人的动作自然前进，章节加载和资源变化不能把已经读过的位置重新拉回。'
      return `<p data-e2e-block="${chapter}:${block + 1}">第 ${chapter + 1} 章第 ${block + 1} 段。${repeatedText.repeat(3)}</p>`
    }).join('\n    ')
    const plate = chapter === 1 || chapter === 3
      ? `<figure data-e2e-block="${chapter}:${EPUB_BLOCKS_PER_CHAPTER + 1}"><img src="images/plate.svg" alt="章节示意图"/></figure>`
      : ''

    zip.file(
      `OEBPS/chapter-${chapter + 1}.xhtml`,
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>第 ${chapter + 1} 章</title>
    <style>
      html, body { margin: 0; padding: 0; }
      body { padding: 28px 42px 48px; }
      h1 { margin: 0 0 24px; }
      p { margin: 0 0 18px; }
      figure { margin: 24px 0; }
      img { display: block; width: 100%; height: auto; }
    </style>
  </head>
  <body>
    <h1 data-e2e-block="${chapter}:0">第 ${chapter + 1} 章</h1>
    ${paragraphs}
    ${plate}
  </body>
</html>`
    )
  }

  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await writeFile(path, bytes)
}

async function installContainerObserver(page: Page): Promise<void> {
  await page.getByTestId('reader-host').evaluate((host) => {
    interface MountState {
      container: Element | null
      mounts: number
      observer: MutationObserver | null
    }
    const testWindow = window as typeof window & { __epubMountState?: MountState }
    testWindow.__epubMountState?.observer?.disconnect()
    const state: MountState = { container: null, mounts: 0, observer: null }
    const update = (): void => {
      const container = host.querySelector(':scope > .epub-container')
      if (container && container !== state.container) {
        state.container = container
        state.mounts += 1
      }
    }
    const observer = new MutationObserver(update)
    state.observer = observer
    testWindow.__epubMountState = state
    observer.observe(host, { childList: true })
    update()
  })
}

async function readContainerMounts(page: Page): Promise<{ mounts: number; sameContainer: boolean }> {
  return page.getByTestId('reader-host').evaluate((host) => {
    interface MountState {
      container: Element | null
      mounts: number
    }
    const testWindow = window as typeof window & { __epubMountState?: MountState }
    const current = host.querySelector(':scope > .epub-container')
    return {
      mounts: testWindow.__epubMountState?.mounts ?? 0,
      sameContainer: Boolean(current && testWindow.__epubMountState?.container === current)
    }
  })
}

async function readEpubSnapshot(page: Page): Promise<EpubSnapshot> {
  return page.getByTestId('reader-host').evaluate((host) => {
    const scroller = host.querySelector<HTMLElement>(':scope > .epub-container')
    if (!scroller) throw new Error('EPUB scroll container is missing')

    const scrollerBounds = scroller.getBoundingClientRect()
    const probeY = scrollerBounds.top + 16
    const refs: number[] = []
    const blocks: Array<{ top: number; spine: number; block: number }> = []

    for (const view of scroller.querySelectorAll<HTMLElement>('.epub-view[ref]')) {
      const spine = Number(view.getAttribute('ref'))
      if (!Number.isInteger(spine)) continue
      refs.push(spine)
      const frame = view.querySelector<HTMLIFrameElement>('iframe')
      const frameDocument = frame?.contentDocument
      if (!frame || !frameDocument) continue
      if (
        getComputedStyle(view).visibility === 'hidden' ||
        getComputedStyle(frame).visibility === 'hidden'
      ) {
        continue
      }
      const frameTop = frame.getBoundingClientRect().top

      for (const element of frameDocument.querySelectorAll<HTMLElement>('[data-e2e-block]')) {
        const rawBlock = element.dataset.e2eBlock?.split(':')[1]
        const block = Number(rawBlock)
        if (!Number.isInteger(block)) continue
        blocks.push({
          top: frameTop + element.getBoundingClientRect().top,
          spine,
          block
        })
      }
    }

    blocks.sort((left, right) => left.top - right.top)
    if (blocks.length === 0) throw new Error('EPUB logical position blocks are not ready')

    let anchorIndex = 0
    for (let index = 0; index < blocks.length; index += 1) {
      if (blocks[index].top <= probeY) anchorIndex = index
      else break
    }
    const anchor = blocks[anchorIndex]
    const next = blocks[anchorIndex + 1]
    const span = Math.max(1, (next?.top ?? anchor.top + 1) - anchor.top)
    const ratio = Math.max(0, Math.min(0.999, (probeY - anchor.top) / span))

    return {
      key: anchor.spine * 1000 + anchor.block * 10 + ratio,
      spine: anchor.spine,
      block: anchor.block,
      ratio,
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      refs: [...new Set(refs)].sort((left, right) => left - right)
    }
  })
}

async function waitForStableSnapshot(page: Page): Promise<EpubSnapshot> {
  let previous: EpubSnapshot | null = null
  let current: EpubSnapshot | null = null
  let stableReadings = 0

  for (let attempt = 0; attempt < 14; attempt += 1) {
    await page.waitForTimeout(60)
    current = await readEpubSnapshot(page)
    if (
      previous &&
      Math.abs(current.key - previous.key) < 0.02 &&
      Math.abs(current.scrollTop - previous.scrollTop) < 2 &&
      Math.abs(current.scrollHeight - previous.scrollHeight) < 2
    ) {
      stableReadings += 1
      if (stableReadings >= 2) return current
    } else {
      stableReadings = 0
    }
    previous = current
  }

  if (!current) throw new Error('EPUB position was never readable')
  return current
}

async function scrollByViewport(page: Page, multiplier: number): Promise<EpubSnapshot> {
  await page
    .getByTestId('reader-host')
    .locator(':scope > .epub-container')
    .evaluate((scroller, amount) => {
      scroller.scrollBy(0, scroller.clientHeight * amount)
    }, multiplier)
  return waitForStableSnapshot(page)
}

function readPersistedPosition(userData: string): PersistedPosition | null {
  const database = new DatabaseSync(join(userData, 'reader.sqlite3'), { readOnly: true })
  try {
    const row = database
      .prepare('SELECT last_locator AS locator, progress FROM books ORDER BY imported_at LIMIT 1')
      .get() as { locator?: unknown; progress?: unknown } | undefined
    if (typeof row?.locator !== 'string' || typeof row.progress !== 'number') return null
    return { locator: row.locator, progress: row.progress }
  } finally {
    database.close()
  }
}

function fixtureSpineFromCfi(locator: string): number | null {
  const match = /^epubcfi\(\/6\/(\d+)(?:\[[^\]]*\])?!/u.exec(locator)
  if (!match) return null
  const packageStep = Number(match[1])
  if (!Number.isInteger(packageStep) || packageStep < 2 || packageStep % 2 !== 0) return null
  return packageStep / 2 - 1
}

test('continuously scrolls back through prepended EPUB chapters without restoring an old locator', async () => {
  test.setTimeout(120_000)
  const testRoot = await mkdtemp(join(tmpdir(), 'llm-reader-epub-upward-'))
  const userData = join(testRoot, 'profile')
  const fixture = join(testRoot, 'upward-scroll.epub')
  await createLongEpubFixture(fixture)
  let application: ElectronApplication | undefined

  try {
    application = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        LLM_READER_USER_DATA: userData,
        LLM_READER_E2E_IMPORT: fixture
      }
    })
    let page = await application.firstWindow()
    await expect(page.getByTestId('book-item').first()).toBeVisible()
    await installContainerObserver(page)
    await page.getByTestId('book-item').first().click()
    await expect(page.getByTestId('reader-host').locator('.epub-container')).toBeVisible()
    await expect(page.getByTestId('reader-host').locator('iframe')).not.toHaveCount(0)

    let downward = await waitForStableSnapshot(page)
    for (let step = 0; step < 100 && downward.spine < EPUB_CHAPTER_COUNT - 1; step += 1) {
      downward = await scrollByViewport(page, 0.65)
    }
    expect(downward.spine, `last downward snapshot: ${JSON.stringify(downward)}`).toBe(
      EPUB_CHAPTER_COUNT - 1
    )

    await page.waitForTimeout(550)
    downward = await waitForStableSnapshot(page)
    await expect.poll(() => readContainerMounts(page)).toEqual({ mounts: 1, sameContainer: true })

    await expect
      .poll(() => readPersistedPosition(userData), { timeout: 5_000 })
      .toEqual(
        expect.objectContaining({
          locator: expect.stringMatching(/^epubcfi\(/u),
          progress: expect.any(Number)
        })
      )
    const savedAtBottom = readPersistedPosition(userData)
    if (!savedAtBottom) throw new Error('EPUB position was not persisted before restart')
    expect(fixtureSpineFromCfi(savedAtBottom.locator)).toBeGreaterThanOrEqual(3)

    await application.close()
    application = undefined

    application = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        LLM_READER_USER_DATA: userData
      }
    })
    page = await application.firstWindow()
    await expect(page.getByTestId('book-item').first()).toBeVisible()
    await installContainerObserver(page)
    await page.getByTestId('book-item').first().click()
    await expect(page.getByTestId('reader-host').locator('iframe')).not.toHaveCount(0)

    let previous = await waitForStableSnapshot(page)
    expect(previous.spine).toBeGreaterThanOrEqual(3)
    expect(previous.refs).not.toContain(0)
    const persistedMilestones: PersistedPosition[] = [savedAtBottom]
    let milestoneSpine = previous.spine
    let stalledSteps = 0
    let reachedTop = false

    for (let step = 0; step < 160; step += 1) {
      const before = previous
      const after = await scrollByViewport(page, -0.55)

      expect(
        after.key,
        `logical position rebounded at step ${step}: ${JSON.stringify({ before, after })}`
      ).toBeLessThanOrEqual(before.key + 0.35)

      if (after.key < before.key - 0.1) stalledSteps = 0
      else stalledSteps += 1
      expect(stalledSteps, `upward scroll stalled near ${JSON.stringify(after)}`).toBeLessThan(10)

      if (after.scrollTop > before.scrollTop + 4) {
        expect(
          after.key,
          `prepend compensation moved the logical position backward: ${JSON.stringify({ before, after })}`
        ).toBeLessThanOrEqual(before.key + 0.15)
      }

      previous = after
      if (after.spine < milestoneSpine) {
        milestoneSpine = after.spine
        await page.waitForTimeout(750)
        const persisted = readPersistedPosition(userData)
        if (persisted) persistedMilestones.push(persisted)
      }

      if (after.spine === 0 && after.block <= 1 && after.scrollTop < 120) {
        reachedTop = true
        break
      }
    }

    expect(reachedTop, `final upward snapshot: ${JSON.stringify(previous)}`).toBe(true)
    expect(previous.spine).toBe(0)
    expect(previous.block).toBeLessThanOrEqual(1)
    expect(previous.scrollTop).toBeLessThan(120)
    await expect.poll(() => readContainerMounts(page)).toEqual({ mounts: 1, sameContainer: true })

    await page.waitForTimeout(750)
    const savedAtTop = readPersistedPosition(userData)
    if (!savedAtTop) throw new Error('EPUB position was not persisted at the top')
    persistedMilestones.push(savedAtTop)

    expect(savedAtTop.locator).not.toBe(savedAtBottom.locator)
    expect(fixtureSpineFromCfi(savedAtTop.locator)).toBe(0)
    for (let index = 1; index < persistedMilestones.length; index += 1) {
      const earlier = persistedMilestones[index - 1]
      const later = persistedMilestones[index]
      expect(later.progress).toBeLessThanOrEqual(earlier.progress + 0.02)
      expect(fixtureSpineFromCfi(later.locator)).toBeLessThanOrEqual(
        fixtureSpineFromCfi(earlier.locator) ?? Number.POSITIVE_INFINITY
      )
      if (index > 1) expect(later.locator).not.toBe(savedAtBottom.locator)
    }
  } finally {
    await application?.close().catch(() => undefined)
    await rm(testRoot, { recursive: true, force: true })
  }
})
