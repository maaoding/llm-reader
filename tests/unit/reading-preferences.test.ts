// @vitest-environment jsdom

import type { Contents, Location } from 'epubjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_READING_PREFERENCES,
  EpubReaderAdapter,
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
    ).toEqual({ fontScale: 140, lineHeight: 'original', indent: 'original' })
    expect(
      normalizeReadingPreferences({
        fontScale: 79.6,
        lineHeight: '1.7',
        indent: '2em'
      })
    ).toEqual({ fontScale: 80, lineHeight: '1.7', indent: '2em' })
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

    await adapter.setPreferences({ fontScale: 125, lineHeight: '1.7', indent: '2em' })

    const paragraphs = Array.from(root.querySelectorAll<HTMLParagraphElement>('p'))
    expect(root.style.fontSize).toBe('125%')
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs.every((paragraph) => paragraph.style.lineHeight === '1.7')).toBe(true)
    expect(paragraphs.every((paragraph) => paragraph.style.textIndent === '2em')).toBe(true)
    expect(root.querySelector('h2')?.getAttribute('style')).not.toContain('text-indent')

    await adapter.setPreferences({ ...DEFAULT_READING_PREFERENCES })
    expect(root.style.fontSize).toBe('')
    expect(root.style.lineHeight).toBe('1.82')
    expect(paragraphs.every((paragraph) => paragraph.style.lineHeight === '')).toBe(true)
    expect(paragraphs.every((paragraph) => paragraph.style.textIndent === '')).toBe(true)

    adapter.destroy()
    host.remove()
  })

  it('applies EPUB preferences to loaded and future chapters and restores the current CFI once', async () => {
    const harness = createEpubHarness()
    const host = document.createElement('div')
    document.body.append(host)
    const adapter = new EpubReaderAdapter(host, { bookId: 'epub-preferences' })
    await adapter.setPreferences({ fontScale: 120, lineHeight: '1.9', indent: '2em' })
    await adapter.open(new Uint8Array([1, 2, 3]))

    const current = createContents('<p>普通正文</p><blockquote><p>引文</p></blockquote>')
    harness.currentContents.push(current)
    harness.contentHooks[0](current)
    const initialCss = current.addStylesheetCss.mock.calls.at(-1)?.[0] as string
    expect(initialCss).toContain('::selection')
    expect(initialCss).toContain('font-size: 120%')
    expect(initialCss).toContain('line-height: 1.9')
    expect(initialCss).toContain('text-indent: 2em')
    expect(initialCss).toContain('blockquote *')

    harness.handlers.get('relocated')?.({
      start: { cfi: LATER_CFI, percentage: 0.6, index: 1 }
    })
    await adapter.setPreferences({ fontScale: 110, lineHeight: 'original', indent: 'none' })

    expect(harness.rendition.display).toHaveBeenCalledTimes(2)
    expect(harness.rendition.display).toHaveBeenLastCalledWith(LATER_CFI)
    const updatedCss = current.addStylesheetCss.mock.calls.at(-1)?.[0] as string
    expect(updatedCss).toContain('font-size: 110%')
    expect(updatedCss).not.toContain('line-height')
    expect(updatedCss).toContain('text-indent: 0')

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

    for (let index = 0; index < 5; index += 1) {
      harness.handlers.get('relocated')?.({
        start: { cfi: `epubcfi(/6/4!/4/2/1:${index})`, percentage: 0.7, index: 1 }
      })
    }
    expect(harness.rendition.display).toHaveBeenCalledTimes(3)

    adapter.destroy()
    host.remove()
  })

  it('does not override or reflow fixed-layout EPUB contents', async () => {
    const harness = createEpubHarness('pre-paginated')
    const host = document.createElement('div')
    const adapter = new EpubReaderAdapter(host, { bookId: 'fixed-layout' })
    await adapter.setPreferences({ fontScale: 140, lineHeight: '1.5', indent: '2em' })
    await adapter.open(new Uint8Array([1, 2, 3]))

    const contents = createContents('<img src="cover.jpg" alt="封面">')
    harness.currentContents.push(contents)
    harness.contentHooks[0](contents)
    await adapter.setPreferences({ fontScale: 120, lineHeight: '1.7', indent: 'none' })

    const fixedCss = contents.addStylesheetCss.mock.calls.at(-1)?.[0] as string
    expect(fixedCss).toContain('::selection')
    expect(fixedCss).not.toContain('font-size')
    expect(fixedCss).not.toContain('line-height')
    expect(fixedCss).not.toContain('text-indent')
    expect(harness.rendition.display).toHaveBeenCalledOnce()

    adapter.destroy()
  })
})
