// @vitest-environment jsdom

import type { NavItem } from 'epubjs'
import { describe, expect, it, vi } from 'vitest'
import { buildBoundedPassages, codePointLength } from '../../src/renderer/src/readers/context'
import {
  flattenToc,
  isEpubCfi,
  isSafeInternalHref,
  sanitizeContents
} from '../../src/renderer/src/readers/epub-reader'
import { createReaderAdapter, TextReaderAdapter } from '../../src/renderer/src/readers'
import {
  makeTextAnchor,
  parseTextAnchor,
  parseTextParagraphs
} from '../../src/renderer/src/readers/text-reader'

const { epubFactory } = vi.hoisted(() => ({ epubFactory: vi.fn() }))

vi.mock('epubjs', () => ({ default: epubFactory }))

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

describe('bounded reader context', () => {
  it('uses Unicode code points and keeps the selected region inside a 6,000-character window', () => {
    const capturedSlices: Array<[number, number]> = []
    const longText = `${'前'.repeat(3_100)}😀${'后'.repeat(3_100)}`
    const passages = buildBoundedPassages(
      [
        {
          id: 'P1',
          text: longText,
          anchorForSlice: (start, end) => {
            capturedSlices.push([start, end])
            return `slice:${start}:${end}`
          }
        }
      ],
      { startBlock: 0, startOffset: 3_100, endBlock: 0, endOffset: 3_101 }
    )

    expect(passages).toHaveLength(1)
    expect(codePointLength(passages[0].text)).toBe(6_000)
    expect(passages[0].text).toContain('😀')
    expect(passages[0].anchor).toBe(
      `slice:${capturedSlices[0][0]}:${capturedSlices[0][1]}`
    )
  })

  it('retains stable paragraph IDs when the context window excludes distant blocks', () => {
    const passages = buildBoundedPassages(
      Array.from({ length: 10 }, (_, index) => ({
        id: `P${index + 1}`,
        text: String(index).repeat(1_000),
        anchorForSlice: (start, end) => `${index}:${start}:${end}`
      })),
      { startBlock: 7, startOffset: 500, endBlock: 7, endOffset: 501 }
    )

    expect(passages.some((passage) => passage.id === 'P8')).toBe(true)
    expect(passages.every((passage) => /^P\d+$/u.test(passage.id))).toBe(true)
    expect(passages.reduce((total, passage) => total + codePointLength(passage.text), 0)).toBeLessThanOrEqual(
      6_000
    )
  })
})

describe('TXT adapter', () => {
  it('parses code-point anchors and detects chapter headings', () => {
    const text = '😀 前言\n\n# 第一章\n\n正文'
    const paragraphs = parseTextParagraphs(text)

    expect(paragraphs.map((paragraph) => paragraph.text)).toEqual(['😀 前言', '# 第一章', '正文'])
    expect(paragraphs[1].heading).toBe(true)
    expect(paragraphs[1].start).toBe(codePointLength('😀 前言\n\n'))
    expect(parseTextAnchor(makeTextAnchor(2, 5), 10)).toEqual({ start: 2, end: 5 })
    expect(parseTextAnchor('txt:5:2', 10)).toBeNull()
    expect(parseTextAnchor('file:///secret', 10)).toBeNull()
  })

  it('renders text literally, returns metadata and creates a chapter TOC', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const adapter = createReaderAdapter('txt', host, { bookId: 'book-1' })

    const info = await adapter.open(bytes('# 第一章\n\n<script>不会执行</script>\n\n第二段'))

    expect(info.metadata).toEqual({ title: '第一章', author: null })
    expect(info.toc).toEqual([
      expect.objectContaining({ label: '第一章', href: 'txt:0:0', depth: 0 })
    ])
    expect(host.querySelector('script:not(:first-child)')).toBeNull()
    expect(host.textContent).toContain('<script>不会执行</script>')
    expect(adapter).toBeInstanceOf(TextReaderAdapter)
    adapter.destroy()
    host.remove()
  })

  it('builds a selection context with a character anchor and stable passage IDs', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const onSelectionChanged = vi.fn()
    const adapter = new TextReaderAdapter(host, { bookId: 'book-2', onSelectionChanged })
    await adapter.open(bytes('# 第一章\n\n甲😀乙\n\n丙丁'))

    const paragraph = host.querySelector<HTMLElement>('[data-reader-paragraph="1"]')!
    const textNode = paragraph.firstChild!
    const range = document.createRange()
    range.setStart(textNode, 1)
    range.setEnd(textNode, 4)
    const nativeSelection = document.getSelection()!
    nativeSelection.removeAllRanges()
    nativeSelection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))

    expect(adapter.getSelection()).toMatchObject({
      bookId: 'book-2',
      quote: '😀乙',
      anchor: 'txt:8:10',
      chapterTitle: '第一章'
    })
    expect(adapter.getSelection()?.passages.map((passage) => passage.id)).toEqual(['P1', 'P2', 'P3'])
    expect(onSelectionChanged).toHaveBeenLastCalledWith(adapter.getSelection())

    nativeSelection.removeAllRanges()
    adapter.destroy()
    host.remove()
  })

  it('restores a valid location, highlights locally and rejects untrusted anchors', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const onRelocated = vi.fn()
    const adapter = new TextReaderAdapter(host, { bookId: 'book-3', onRelocated })
    await adapter.open(bytes('第一段\n\n第二段'), 'txt:5:5')

    expect(onRelocated).toHaveBeenCalledWith({ locator: 'txt:5:5', progress: 0.625, chapterProgress: 0.625, chapterTitle: '全文', chapterHref: 'txt:0:0', reason: 'restore' })
    await adapter.highlight('txt:5:8')
    expect(
      host.querySelector('[data-reader-paragraph="1"]')?.classList.contains(
        'llm-reader-temporary-fallback'
      )
    ).toBe(true)
    adapter.clearHighlight()
    expect(
      host.querySelector('[data-reader-paragraph="1"]')?.classList.contains(
        'llm-reader-temporary-fallback'
      )
    ).toBe(false)
    await expect(adapter.goTo('https://example.com')).rejects.toThrow('无效的 TXT 定位锚点')

    adapter.destroy()
    host.remove()
  })

  it('fails clearly for invalid UTF-8 instead of rendering replacement characters', async () => {
    const host = document.createElement('div')
    const adapter = new TextReaderAdapter(host, { bookId: 'book-4' })

    await expect(adapter.open(new Uint8Array([0xff, 0xfe]))).rejects.toThrow()
  })
})

describe('EPUB adapter safety utilities', () => {
  it('restores the last locator once and never redisplays it for relocation events', async () => {
    const handlers = new Map<string, (...eventArguments: unknown[]) => void>()
    const display = vi.fn().mockResolvedValue(undefined)
    const generateLocations = vi.fn().mockResolvedValue(['epubcfi(/6/2!/4/1:0)'])
    const rendition = {
      hooks: {
        content: {
          register: vi.fn()
        }
      },
      on: vi.fn((event: string, handler: (...eventArguments: unknown[]) => void) => {
        handlers.set(event, handler)
      }),
      off: vi.fn(),
      display,
      annotations: {
        highlight: vi.fn(),
        remove: vi.fn()
      }
    }
    const book = {
      ready: Promise.resolve(),
      loaded: {
        metadata: Promise.resolve({ title: '恢复位置测试', creator: '作者' }),
        navigation: Promise.resolve({ toc: [] }),
        spine: Promise.resolve([{ index: 0 }, { index: 1 }])
      },
      renderTo: vi.fn(() => rendition),
      locations: { generate: generateLocations },
      spine: { get: vi.fn(() => ({ href: 'chapter.xhtml' })) },
      destroy: vi.fn()
    }
    epubFactory.mockReturnValue(book)
    const host = document.createElement('div')
    const onRelocated = vi.fn()
    const adapter = createReaderAdapter('epub', host, {
      bookId: 'epub-restore-once',
      onRelocated
    })
    const restoredLocator = 'epubcfi(/6/4!/4/2/1:12)'

    await adapter.open(new Uint8Array([1, 2, 3]), restoredLocator)

    expect(book.renderTo).toHaveBeenCalledOnce()
    expect(generateLocations).toHaveBeenCalledOnce()
    expect(display).toHaveBeenCalledOnce()
    expect(display).toHaveBeenLastCalledWith(restoredLocator)

    for (let index = 0; index < 20; index += 1) {
      handlers.get('relocated')?.({
        start: {
          cfi: `epubcfi(/6/4!/4/2/1:${index})`,
          percentage: 0.7 - index / 100,
          index: 1
        }
      })
    }

    expect(onRelocated).toHaveBeenCalledTimes(20)
    expect(display).toHaveBeenCalledOnce()
    expect(book.renderTo).toHaveBeenCalledOnce()

    adapter.destroy()
  })

  it('opens epub.js in continuous sandboxed mode and exposes selection/location callbacks', async () => {
    const handlers = new Map<string, (...eventArguments: unknown[]) => void>()
    const contentHooks: Array<(contents: never) => void> = []
    const annotations = {
      highlight: vi.fn(),
      remove: vi.fn()
    }
    const rendition = {
      hooks: {
        content: {
          register: vi.fn((hook: (contents: never) => void) => contentHooks.push(hook))
        }
      },
      on: vi.fn((event: string, handler: (...eventArguments: unknown[]) => void) => {
        handlers.set(event, handler)
      }),
      off: vi.fn(),
      display: vi.fn().mockResolvedValue(undefined),
      annotations
    }
    const book = {
      ready: Promise.resolve(),
      loaded: {
        metadata: Promise.resolve({ title: '复杂系统', creator: '作者' }),
        navigation: Promise.resolve({
          toc: [{ id: 'chapter', label: '第一章', href: 'chapter.xhtml' }]
        }),
        spine: Promise.resolve([{ index: 0 }])
      },
      renderTo: vi.fn(() => rendition),
      locations: { generate: vi.fn().mockResolvedValue(['epubcfi(/6/2!/4/1:0)']) },
      spine: { get: vi.fn(() => ({ href: 'chapter.xhtml' })) },
      destroy: vi.fn()
    }
    epubFactory.mockReturnValue(book)
    const host = document.createElement('div')
    document.body.append(host)
    const onSelectionChanged = vi.fn()
    const onRelocated = vi.fn()
    const adapter = createReaderAdapter('epub', host, {
      bookId: 'epub-1',
      onSelectionChanged,
      onRelocated
    })

    const info = await adapter.open(new Uint8Array([1, 2, 3]))

    expect(info).toEqual({
      metadata: { title: '复杂系统', author: '作者' },
      toc: [{ id: 'chapter', label: '第一章', href: 'chapter.xhtml', depth: 0 }]
    })
    expect(book.renderTo).toHaveBeenCalledWith(
      host,
      expect.objectContaining({
        manager: 'continuous',
        flow: 'scrolled-doc',
        allowScriptedContent: false
      })
    )
    expect(contentHooks).toHaveLength(1)

    const content = document.createElement('section')
    content.innerHTML = '<p>甲😀乙</p><p>后文</p>'
    document.body.append(content)
    const firstText = content.querySelector('p')!.firstChild!
    const range = document.createRange()
    range.setStart(firstText, 1)
    range.setEnd(firstText, 4)
    const nativeSelection = document.getSelection()!
    nativeSelection.removeAllRanges()
    nativeSelection.addRange(range)
    const contents = {
      content,
      window,
      sectionIndex: 0,
      cfiFromRange: vi.fn(() => 'epubcfi(/6/2!/4/2/1:0,/1:0,/1:1)')
    }
    handlers.get('selected')?.('epubcfi(/6/2!/4/2/1:1,/1:0,/1:3)', contents)

    expect(onSelectionChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bookId: 'epub-1',
        quote: '😀乙',
        anchor: 'epubcfi(/6/2!/4/2/1:1,/1:0,/1:3)',
        chapterTitle: '第一章'
      })
    )
    expect(adapter.getSelection()?.passages.map((passage) => passage.id)).toEqual(['P1', 'P2'])

    handlers.get('relocated')?.({
      start: { cfi: 'epubcfi(/6/2!/4/1:0)', percentage: 0.25, index: 0 }
    })
    expect(onRelocated).toHaveBeenCalledWith({
      locator: 'epubcfi(/6/2!/4/1:0)',
      progress: 0.25,
      chapterProgress: 0.25,
      chapterTitle: '第一章',
      chapterHref: 'chapter.xhtml',
      reason: 'restore'
    })

    await adapter.goTo('chapter.xhtml')
    await adapter.highlight('epubcfi(/6/2!/4/1:0)')
    expect(annotations.highlight).toHaveBeenCalledWith(
      'epubcfi(/6/2!/4/1:0)',
      { temporary: true },
      undefined,
      'llm-reader-temporary-highlight',
      expect.any(Object)
    )
    await expect(adapter.goTo('https://example.com')).rejects.toThrow('不受信任')

    nativeSelection.removeAllRanges()
    adapter.destroy()
    expect(book.destroy).toHaveBeenCalledOnce()
    content.remove()
    host.remove()
  })

  it('flattens safe TOC links while preserving nesting depth', () => {
    const toc = flattenToc([
      {
        id: 'one',
        label: ' 第一章 ',
        href: 'chapter-1.xhtml',
        subitems: [{ id: 'sub', label: '小节', href: 'chapter-1.xhtml#sub' }]
      },
      { id: 'bad', label: '外部', href: 'https://example.com' }
    ] as NavItem[])

    expect(toc).toEqual([
      { id: 'one', label: '第一章', href: 'chapter-1.xhtml', depth: 0 },
      { id: 'sub', label: '小节', href: 'chapter-1.xhtml#sub', depth: 1 }
    ])
    expect(isSafeInternalHref('../chapter.xhtml')).toBe(true)
    expect(isSafeInternalHref('javascript:alert(1)')).toBe(false)
    expect(isEpubCfi('epubcfi(/6/2!/4/1:0)')).toBe(true)
    expect(isEpubCfi('chapter.xhtml')).toBe(false)
  })

  it('removes active content and blocks links before EPUB content is exposed', () => {
    const fixture = document.implementation.createHTMLDocument('EPUB')
    fixture.body.innerHTML = `
      <script>window.evil = true</script>
      <iframe src="https://example.com"></iframe>
      <img src="https://example.com/tracker.png" onerror="alert(1)">
      <a href="https://example.com" target="_blank">离开</a>
      <p onclick="alert(2)">安全正文</p>
    `
    const contents = { content: fixture.body } as never

    sanitizeContents(contents)

    expect(fixture.querySelector('script,iframe')).toBeNull()
    expect(fixture.querySelector('img')?.hasAttribute('src')).toBe(false)
    expect(fixture.querySelector('img')?.hasAttribute('onerror')).toBe(false)
    expect(fixture.querySelector('p')?.hasAttribute('onclick')).toBe(false)
    expect(fixture.querySelector('a')?.hasAttribute('href')).toBe(false)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    fixture.querySelector('a')?.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
  })
})
