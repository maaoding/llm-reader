// @vitest-environment jsdom

import type { Contents, Location } from 'epubjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_READING_PREFERENCES,
  EpubReaderAdapter,
  fontFamilyStack,
  normalizeReadingPreferences,
  TextReaderAdapter,
  type ReadingPreferences
} from '../../src/renderer/src/readers'

const { epubFactory } = vi.hoisted(() => ({ epubFactory: vi.fn() }))

vi.mock('epubjs', () => ({ default: epubFactory }))

const FIRST_CFI = 'epubcfi(/6/2!/4/2/1:0)'
const LATER_CFI = 'epubcfi(/6/4!/4/2/1:12)'

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function createContents(markup = '<p>正文</p>'):
  Contents & { addStylesheetCss: ReturnType<typeof vi.fn> } {
  const fixture = document.implementation.createHTMLDocument('EPUB')
  fixture.body.innerHTML = markup
  return {
    content: fixture.body,
    document: fixture,
    window,
    sectionIndex: 0,
    addStylesheetCss: vi.fn()
  } as unknown as Contents & { addStylesheetCss: ReturnType<typeof vi.fn> }
}

function createEpubHarness(layout: 'reflowable' | 'pre-paginated' = 'reflowable') {
  const handlers = new Map<string, (...eventArguments: unknown[]) => void>()
  const contentHooks: Array<(contents: Contents) => void> = []
  const currentContents: Contents[] = []
  const rendition = {
    hooks: {
      content: {
        register: vi.fn((hook: (contents: Contents) => void) => contentHooks.push(hook))
      }
    },
    settings: { layout },
    location: undefined as Location | undefined,
    getContents: vi.fn(() => currentContents),
    on: vi.fn((event: string, handler: (...eventArguments: unknown[]) => void) => {
      handlers.set(event, handler)
    }),
    off: vi.fn(),
    display: vi.fn(async (target?: string) => {
      rendition.location = {
        start: { cfi: target ?? FIRST_CFI },
        end: { cfi: target ?? FIRST_CFI }
      } as Location
    }),
    annotations: { highlight: vi.fn(), remove: vi.fn() },
    started: Promise.resolve()
  }
  const book = {
    ready: Promise.resolve(),
    loaded: {
      metadata: Promise.resolve({ title: '阅读设置测试', creator: '作者', layout }),
      navigation: Promise.resolve({ toc: [] }),
      spine: Promise.resolve([{ index: 0 }, { index: 1 }])
    },
    renderTo: vi.fn(() => rendition),
    locations: { generate: vi.fn().mockResolvedValue([FIRST_CFI]) },
    spine: { get: vi.fn(() => ({ href: 'chapter.xhtml' })) },
    destroy: vi.fn()
  }
  epubFactory.mockReturnValue(book)
  return { book, contentHooks, currentContents, handlers, rendition }
}

describe('reading preferences', () => {
  beforeEach(() => {
    epubFactory.mockReset()
  })

  it('normalizes untrusted persisted values to the supported range and choices', () => {
    expect(
      normalizeReadingPreferences({
        fontScale: 200,
        lineHeight: 'invalid',
        indent: 'invalid'
      } as unknown as ReadingPreferences)
    ).toEqual({
      fontScale: 140,
      lineHeight: 'original',
      indent: 'original',
      fontFamily: null,
      contentWidth: 'original',
      paperTheme: 'light',
      paragraphSpacing: 'original'
    })
    expect(
      normalizeReadingPreferences({
        fontScale: 79.6,
        lineHeight: '1.7',
        indent: '2em',
        fontFamily: ' 微软雅黑 '
      })
    ).toEqual({
      fontScale: 80,
      lineHeight: '1.7',
      indent: '2em',
      fontFamily: '微软雅黑',
      contentWidth: 'original',
      paperTheme: 'light',
      paragraphSpacing: 'original'
    })
    expect(
      normalizeReadingPreferences({
        fontScale: 100,
        lineHeight: 'original',
        indent: 'original',
        fontFamily: '   '
      })
    ).toEqual({
      fontScale: 100,
      lineHeight: 'original',
      indent: 'original',
      fontFamily: null,
      contentWidth: 'original',
      paperTheme: 'light',
      paragraphSpacing: 'original'
    })
    expect(
      normalizeReadingPreferences({
        fontScale: 100,
        lineHeight: 'original',
        indent: 'original',
        fontFamily: 'x'.repeat(129)
      })
    ).toEqual({
      fontScale: 100,
      lineHeight: 'original',
      indent: 'original',
      fontFamily: null,
      contentWidth: 'original',
      paperTheme: 'light',
      paragraphSpacing: 'original'
    })
  })

  it('keeps older persisted preferences compatible and validates the new layout choices', () => {
    expect(
      normalizeReadingPreferences({
        fontScale: 110,
        lineHeight: '1.7',
        indent: 'none',
        fontFamily: null
      } as ReadingPreferences)
    ).toEqual({
      fontScale: 110,
      lineHeight: '1.7',
      indent: 'none',
      fontFamily: null,
      contentWidth: 'original',
      paperTheme: 'light',
      paragraphSpacing: 'original'
    })
    expect(
      normalizeReadingPreferences({
        ...DEFAULT_READING_PREFERENCES,
        contentWidth: 'wide',
        paragraphSpacing: 'relaxed'
      })
    ).toEqual({
      ...DEFAULT_READING_PREFERENCES,
      contentWidth: 'wide',
      paragraphSpacing: 'relaxed'
    })
  })

  it('builds font family stacks with compact fallback variants', () => {
    expect(fontFamilyStack('宋体')).toEqual(['宋体'])
    expect(fontFamilyStack('仓耳今楷05 W04')).toEqual(['仓耳今楷05 W04', '仓耳今楷05W04'])
    expect(fontFamilyStack('O\'Reilly Serif')).toEqual(['O\'Reilly Serif', 'O\'ReillySerif'])
  })

  it('normalizes paper themes and applies independent paper colors to TXT', async () => {
    expect(
      normalizeReadingPreferences({
        fontScale: 100,
        lineHeight: 'original',
        indent: 'original',
        fontFamily: null,
        contentWidth: 'original',
        paragraphSpacing: 'original',
        paperTheme: 'sepia'
      })
    ).toEqual({
      ...DEFAULT_READING_PREFERENCES,
      paperTheme: 'sepia'
    })
    expect(
      normalizeReadingPreferences({
        ...DEFAULT_READING_PREFERENCES,
        paperTheme: 'invalid'
      } as unknown as ReadingPreferences)
    ).toEqual(DEFAULT_READING_PREFERENCES)

    const host = document.createElement('div')
    document.body.append(host)
    const adapter = new TextReaderAdapter(host, { bookId: 'txt-paper' })
    await adapter.open(bytes(['# 第一章', '', '第一段'].join(String.fromCharCode(10))))

    const root = host.querySelector<HTMLElement>('.reader-document--txt')!
    expect(root.style.backgroundColor).toBe('rgb(253, 252, 249)')
    expect(root.style.color).toBe('rgb(41, 54, 60)')

    await adapter.setPreferences({ ...DEFAULT_READING_PREFERENCES, paperTheme: 'dark' })
    expect(root.style.backgroundColor).toBe('rgb(34, 41, 45)')
    expect(root.style.color).toBe('rgb(231, 233, 230)')
    expect(root.style.colorScheme).toBe('dark')

    adapter.destroy()
    host.remove()
  })

  it('injects the selected EPUB paper theme into the current chapter', async () => {
    const harness = createEpubHarness()
    const host = document.createElement('div')
    document.body.append(host)
    const adapter = new EpubReaderAdapter(host, { bookId: 'epub-paper' })
    await adapter.open(new Uint8Array([1, 2, 3]))

    const contents = createContents('<p>当前章节正文</p>')
    harness.currentContents.push(contents)
    harness.contentHooks[0](contents)

    await adapter.setPreferences({ ...DEFAULT_READING_PREFERENCES, paperTheme: 'sepia' })
    let css = contents.addStylesheetCss.mock.calls.at(-1)?.[0] as string
    expect(css).toContain('color-scheme: light')
    expect(css).toContain('background-color: #f6ecd8 !important')
    expect(css).toContain('color: #433c2e !important')

    await adapter.setPreferences({ ...DEFAULT_READING_PREFERENCES, paperTheme: 'dark' })
    css = contents.addStylesheetCss.mock.calls.at(-1)?.[0] as string
    expect(css).toContain('color-scheme: dark')
    expect(css).toContain('background-color: #22292d !important')
    expect(css).toContain('color: #e7e9e6 !important')

    adapter.destroy()
    host.remove()
  })

  it('applies and clears persistent TXT highlights and tags navigation relocations', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const onRelocated = vi.fn()
    const adapter = new TextReaderAdapter(host, { bookId: 'txt-highlights', onRelocated })
    await adapter.open(bytes(['# 第一章', '', '第一段'].join(String.fromCharCode(10))))

    await adapter.setHighlights([{ anchor: 'txt:7:10' }])
    expect(host.querySelector('.llm-reader-persistent-fallback')).not.toBeNull()

    await adapter.goTo('txt:0:0')
    expect(onRelocated).toHaveBeenLastCalledWith({
      locator: 'txt:0:0',
      progress: 0,
      chapterProgress: 0,
      chapterTitle: '第一章',
      reason: 'navigation'
    })

    await adapter.setHighlights([])
    expect(host.querySelector('.llm-reader-persistent-fallback')).toBeNull()
    adapter.destroy()
    host.remove()
  })

  it('reapplies and removes persistent EPUB highlights through rendition annotations', async () => {
    const harness = createEpubHarness()
    const host = document.createElement('div')
    document.body.append(host)
    const adapter = new EpubReaderAdapter(host, { bookId: 'epub-highlights' })
    await adapter.open(new Uint8Array([1, 2, 3]))

    await adapter.setHighlights([{ anchor: FIRST_CFI }])
    expect(harness.rendition.annotations.highlight).toHaveBeenCalledWith(
      FIRST_CFI,
      { persistent: true },
      undefined,
      'llm-reader-persistent-highlight',
      expect.objectContaining({ fill: '#7cbd9a' })
    )

    await adapter.setHighlights([])
    expect(harness.rendition.annotations.remove).toHaveBeenCalledWith(FIRST_CFI, 'highlight')

    adapter.destroy()
    host.remove()
  })

  it('updates TXT typography immediately and restores its existing defaults', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const adapter = new TextReaderAdapter(host, { bookId: 'txt-preferences' })
    await adapter.open(bytes('# 标题\n\n第一段\n\n第二段'))

    const root = host.querySelector<HTMLElement>('.reader-document--txt')!
    const selectionStyle = root.querySelector('style')?.textContent ?? ''
    expect(selectionStyle).toContain('.reader-document ::selection')
    expect(selectionStyle).toContain('rgba(240, 220, 160, 0.55)')

    await adapter.setPreferences({
      ...DEFAULT_READING_PREFERENCES,
      fontScale: 125,
      lineHeight: '1.7',
      indent: '2em',
      fontFamily: '微软雅黑',
      contentWidth: 'narrow',
      paragraphSpacing: 'compact'
    })

    const paragraphs = Array.from(root.querySelectorAll<HTMLParagraphElement>('p'))
    expect(root.style.fontSize).toBe('125%')
    expect(root.style.fontFamily).toBe('"微软雅黑"')
    expect(root.style.maxWidth).toBe('640px')
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs.every((paragraph) => paragraph.style.lineHeight === '1.7')).toBe(true)
    expect(paragraphs.every((paragraph) => paragraph.style.textIndent === '2em')).toBe(true)
    expect(paragraphs.every((paragraph) => paragraph.style.marginBottom === '0.8em')).toBe(true)
    expect(root.querySelector('h2')?.getAttribute('style')).not.toContain('text-indent')
    expect(root.querySelector('h2')?.style.marginBottom).toBe('1.2em')

    await adapter.setPreferences({ ...DEFAULT_READING_PREFERENCES })
    expect(root.style.fontSize).toBe('')
    expect(root.style.fontFamily).toBe('')
    expect(root.style.maxWidth).toBe('760px')
    expect(root.style.lineHeight).toBe('1.82')
    expect(paragraphs.every((paragraph) => paragraph.style.lineHeight === '')).toBe(true)
    expect(paragraphs.every((paragraph) => paragraph.style.textIndent === '')).toBe(true)
    expect(paragraphs.every((paragraph) => paragraph.style.marginBottom === '1.35em')).toBe(true)

    adapter.destroy()
    host.remove()
  })

  it('applies EPUB preferences to loaded and future chapters and restores the current CFI once', async () => {
    const harness = createEpubHarness()
    const host = document.createElement('div')
    document.body.append(host)
    const adapter = new EpubReaderAdapter(host, { bookId: 'epub-preferences' })
    await adapter.setPreferences({
      ...DEFAULT_READING_PREFERENCES,
      fontScale: 120,
      lineHeight: '1.9',
      indent: '2em',
      fontFamily: '宋体',
      contentWidth: 'standard',
      paragraphSpacing: 'relaxed'
    })
    await adapter.open(new Uint8Array([1, 2, 3]))

    const current = createContents('<p>普通正文</p><blockquote><p>引文</p></blockquote>')
    harness.currentContents.push(current)
    harness.contentHooks[0](current)
    const initialCss = current.addStylesheetCss.mock.calls.at(-1)?.[0] as string
    expect(initialCss).toContain('::selection')
    expect(initialCss).toContain('font-size: 120%')
    expect(initialCss).toContain('line-height: 1.9')
    expect(initialCss).toContain('text-indent: 2em')
    expect(initialCss).toContain('max-width: 760px')
    expect(initialCss).toContain('margin-inline: auto')
    expect(initialCss).toContain('margin-block-start: 0')
    expect(initialCss).toContain('margin-block-end: 1.8em')
    expect(initialCss).toContain('blockquote *')
    expect(initialCss).toContain('body, body :not(pre, code, kbd, samp, var)')
    expect(initialCss).toContain("@font-face { font-family: 'llm-reader-selected-font'; src: local('宋体'); }")
    expect(initialCss).toContain("font-family: 'llm-reader-selected-font', '宋体' !important")
    expect(initialCss).toContain('ui-monospace')

    harness.handlers.get('relocated')?.({
      start: { cfi: LATER_CFI, percentage: 0.6, index: 1 }
    })
    await adapter.setPreferences({
      ...DEFAULT_READING_PREFERENCES,
      fontScale: 110,
      indent: 'none',
      contentWidth: 'wide',
      paragraphSpacing: 'compact'
    })

    expect(harness.rendition.display).toHaveBeenCalledTimes(2)
    expect(harness.rendition.display).toHaveBeenLastCalledWith(LATER_CFI)
    const updatedCss = current.addStylesheetCss.mock.calls.at(-1)?.[0] as string
    expect(updatedCss).toContain('font-size: 110%')
    expect(updatedCss).not.toContain('line-height')
    expect(updatedCss).toContain('text-indent: 0')
    expect(updatedCss).toContain('max-width: 920px')
    expect(updatedCss).toContain('margin-block-end: 0.8em')
    expect(updatedCss).not.toContain('font-family')

    const future = createContents('<p>下一章</p>')
    harness.contentHooks[0](future)
    expect(future.addStylesheetCss).toHaveBeenLastCalledWith(
      updatedCss,
      'llm-reader-reading-preferences'
    )

    const injectedStyle = current.document.createElement('style')
    injectedStyle.id = 'epubjs-inserted-css-llm-reader-reading-preferences'
    current.document.head.append(injectedStyle)
    await adapter.setPreferences({ ...DEFAULT_READING_PREFERENCES })
    expect(
      current.document.getElementById('epubjs-inserted-css-llm-reader-reading-preferences')
    ).toBeNull()
    expect(harness.rendition.display).toHaveBeenCalledTimes(3)
    expect(harness.rendition.display).toHaveBeenLastCalledWith(LATER_CFI)

    const defaultFuture = createContents('<p>恢复默认后的章节</p>')
    harness.contentHooks[0](defaultFuture)
    const defaultCss = defaultFuture.addStylesheetCss.mock.calls.at(-1)?.[0] as string
    expect(defaultCss).toContain('::selection')
    expect(defaultCss).not.toContain('font-size')
    expect(defaultCss).not.toContain('line-height')
    expect(defaultCss).not.toContain('text-indent')
    expect(defaultCss).not.toContain('max-width')
    expect(defaultCss).not.toContain('margin-block')

    for (let index = 0; index < 5; index += 1) {
      harness.handlers.get('relocated')?.({
        start: { cfi: `epubcfi(/6/4!/4/2/1:${index})`, percentage: 0.7, index: 1 }
      })
    }
    expect(harness.rendition.display).toHaveBeenCalledTimes(3)

    adapter.destroy()
    host.remove()
  })

  it('escapes font family names when injecting EPUB CSS', async () => {
    const harness = createEpubHarness()
    const host = document.createElement('div')
    const adapter = new EpubReaderAdapter(host, { bookId: 'epub-font-escape' })
    await adapter.open(new Uint8Array([1, 2, 3]))

    const contents = createContents('<p>正文</p>')
    harness.currentContents.push(contents)
    harness.contentHooks[0](contents)
    await adapter.setPreferences({
      ...DEFAULT_READING_PREFERENCES,
      fontScale: 100,
      lineHeight: 'original',
      indent: 'original',
      fontFamily: "O'Reilly Serif"
    })

    const css = contents.addStylesheetCss.mock.calls.at(-1)?.[0] as string
    expect(css).toContain("src: local('O\\'Reilly Serif'), local('O\\'ReillySerif')")
    expect(css).toContain("font-family: 'llm-reader-selected-font', 'O\\'Reilly Serif', 'O\\'ReillySerif' !important")

    adapter.destroy()
    host.remove()
  })

  it('writes spaced font family names with a compact fallback variant', async () => {
    const harness = createEpubHarness()
    const host = document.createElement('div')
    const adapter = new EpubReaderAdapter(host, { bookId: 'epub-font-stack' })
    await adapter.open(new Uint8Array([1, 2, 3]))

    const contents = createContents('<p>正文</p>')
    harness.currentContents.push(contents)
    harness.contentHooks[0](contents)
    await adapter.setPreferences({
      ...DEFAULT_READING_PREFERENCES,
      fontScale: 100,
      lineHeight: 'original',
      indent: 'original',
      fontFamily: '仓耳今楷05 W04'
    })

    const css = contents.addStylesheetCss.mock.calls.at(-1)?.[0] as string
    expect(css).toContain("src: local('仓耳今楷05 W04'), local('仓耳今楷05W04')")
    expect(css).toContain("font-family: 'llm-reader-selected-font', '仓耳今楷05 W04', '仓耳今楷05W04' !important")

    adapter.destroy()
    host.remove()
  })

  it('does not override or reflow fixed-layout EPUB contents', async () => {
    const harness = createEpubHarness('pre-paginated')
    const host = document.createElement('div')
    const adapter = new EpubReaderAdapter(host, { bookId: 'fixed-layout' })
    await adapter.setPreferences({
      ...DEFAULT_READING_PREFERENCES,
      fontScale: 140,
      lineHeight: '1.5',
      indent: '2em',
      contentWidth: 'narrow',
      paragraphSpacing: 'relaxed'
    })
    await adapter.open(new Uint8Array([1, 2, 3]))

    const contents = createContents('<img src="cover.jpg" alt="封面">')
    harness.currentContents.push(contents)
    harness.contentHooks[0](contents)
    await adapter.setPreferences({
      ...DEFAULT_READING_PREFERENCES,
      fontScale: 120,
      lineHeight: '1.7',
      indent: 'none',
      contentWidth: 'wide',
      paragraphSpacing: 'compact'
    })

    const fixedCss = contents.addStylesheetCss.mock.calls.at(-1)?.[0] as string
    expect(fixedCss).toContain('::selection')
    expect(fixedCss).not.toContain('font-size')
    expect(fixedCss).not.toContain('line-height')
    expect(fixedCss).not.toContain('text-indent')
    expect(fixedCss).not.toContain('font-family')
    expect(fixedCss).not.toContain('max-width')
    expect(fixedCss).not.toContain('margin-block')
    expect(harness.rendition.display).toHaveBeenCalledOnce()

    adapter.destroy()
  })
})
