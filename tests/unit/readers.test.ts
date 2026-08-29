// @vitest-environment jsdom

import type { NavItem } from 'epubjs'
import { describe, expect, it, vi } from 'vitest'
import { buildBoundedPassages, codePointLength } from '../../src/renderer/src/readers/context'
import {
  flattenToc,
  isEpubCfi,
  isSafeInternalHref,
  resolveInternalSpineHref,
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

  it('searches Chinese and case-insensitive English across TXT chapters with stable anchors', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const adapter = new TextReaderAdapter(host, { bookId: 'txt-search' })
    await adapter.open(bytes('# 第一章\n\nAlpha 与中文命中。alpha\n\n# 第二章\n\n这里也有中文命中。'))

    const english = await adapter.search('ALPHA')
    expect(english).toHaveLength(2)
    expect(english.every((result) => result.chapterTitle === '第一章')).toBe(true)
    expect(english.map((result) => result.anchor)).toEqual([
      expect.stringMatching(/^txt:\d+:\d+$/u),
      expect.stringMatching(/^txt:\d+:\d+$/u)
    ])

    const chinese = await adapter.search('中文命中')
    expect(chinese.map((result) => result.chapterTitle)).toEqual(['第一章', '第二章'])
    expect(await adapter.search('不存在')).toEqual([])

    adapter.destroy()
    host.remove()
  })

  it('caps TXT results and discards searches superseded by a newer query', async () => {
    const host = document.createElement('div')
    const adapter = new TextReaderAdapter(host, { bookId: 'txt-search-limit' })
    const paragraphs = Array.from({ length: 260 }, (_, index) => (
      index === 259 ? '最终目标' : `重复词 ${index}`
    )).join('\n\n')
    await adapter.open(bytes(paragraphs))

    expect(await adapter.search('重复词')).toHaveLength(200)
    const stale = adapter.search('重复词')
    const latest = adapter.search('最终目标')
    await expect(stale).resolves.toEqual([])
    await expect(latest).resolves.toEqual([
      expect.objectContaining({ excerpt: '最终目标', chapterTitle: '全文' })
    ])

    adapter.destroy()
  })

  it('fails clearly for invalid UTF-8 instead of rendering replacement characters', async () => {
    const host = document.createElement('div')
    const adapter = new TextReaderAdapter(host, { bookId: 'book-4' })

    await expect(adapter.open(new Uint8Array([0xff, 0xfe]))).rejects.toThrow()
  })
})

describe('EPUB adapter safety utilities', () => {
  it('loads, searches and unloads EPUB spine sections in reading order', async () => {
    const documents = ['第一章包含 SearchTerm。', '第二章也包含 searchterm。'].map((content) => {
      const fixture = document.implementation.createHTMLDocument('EPUB search')
      fixture.body.innerHTML = `<p>${content}</p>`
      return fixture
    })
    const sections = documents.map((fixture, index) => ({
      href: `chapter-${index + 1}.xhtml`,
      document: fixture,
      contents: fixture.documentElement,
      load: vi.fn().mockResolvedValue(fixture.documentElement),
      find: vi.fn(() => [{
        cfi: `epubcfi(/6/${(index + 1) * 2}!/4/2/1:4)`,
        excerpt: fixture.body.textContent ?? ''
      }]),
      cfiFromRange: vi.fn(() => `epubcfi(/6/${(index + 1) * 2}!/4/2/1:4)`),
      unload: vi.fn()
    }))
    const rendition = {
      hooks: { content: { register: vi.fn() } },
      on: vi.fn(),
      off: vi.fn(),
      display: vi.fn().mockResolvedValue(undefined),
      annotations: { highlight: vi.fn(), remove: vi.fn() }
    }
    const book = {
      ready: Promise.resolve(),
      loaded: {
        metadata: Promise.resolve({ title: '搜索样本', creator: '作者' }),
        navigation: Promise.resolve({ toc: [
          { id: 'one', label: '第一章', href: 'chapter-1.xhtml' },
          { id: 'two', label: '第二章', href: 'chapter-2.xhtml' }
        ] }),
        spine: Promise.resolve([{ index: 0 }, { index: 1 }])
      },
      load: vi.fn().mockResolvedValue(undefined),
      renderTo: vi.fn(() => rendition),
      locations: { generate: vi.fn().mockResolvedValue(['epubcfi(/6/2!/4/1:0)']) },
      spine: {
        get: vi.fn((target: number | string) => {
          if (typeof target === 'number') return sections[target] ?? null
          const href = target.split('#', 1)[0]
          return sections.find((section) => section.href === href) ?? null
        })
      },
      destroy: vi.fn()
    }
    epubFactory.mockReturnValue(book)
    const adapter = createReaderAdapter('epub', document.createElement('div'), { bookId: 'epub-search' })
    await adapter.open(new Uint8Array([1, 2, 3]))

    expect(await adapter.search('SEARCHTERM')).toEqual([
      expect.objectContaining({ chapterTitle: '第一章', excerpt: '第一章包含 SearchTerm。' }),
      expect.objectContaining({ chapterTitle: '第二章', excerpt: '第二章也包含 searchterm。' })
    ])
    expect(sections.every((section) => section.load.mock.calls.length === 1)).toBe(true)
    expect(sections.every((section) => section.find.mock.calls.length === 1)).toBe(true)
    expect(sections.every((section) => section.unload.mock.calls.length === 1)).toBe(true)

    adapter.destroy()
  })

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
    expect(isSafeInternalHref('../chapter.xhtml')).toBe(false)
    expect(isSafeInternalHref('%2e%2e/chapter.xhtml')).toBe(false)
    expect(isSafeInternalHref('javascript:alert(1)')).toBe(false)
    expect(resolveInternalSpineHref(
      'Text/chapter-1.xhtml',
      'chapter-2.xhtml#note',
      ['Text/chapter-1.xhtml', 'Text/chapter-2.xhtml']
    )).toBe('Text/chapter-2.xhtml#note')
    expect(resolveInternalSpineHref(
      'Text/chapter-1.xhtml',
      '#note',
      ['Text/chapter-1.xhtml', 'Text/chapter-2.xhtml']
    )).toBe('Text/chapter-1.xhtml#note')
    expect(resolveInternalSpineHref(
      'Text/chapter-1.xhtml',
      'missing.xhtml',
      ['Text/chapter-1.xhtml', 'Text/chapter-2.xhtml']
    )).toBeNull()
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

  it('keeps only resolved spine links keyboard-accessible and delegates their navigation', () => {
    const fixture = document.implementation.createHTMLDocument('EPUB links')
    fixture.body.innerHTML = `
      <a id="safe" href="chapter-2.xhtml#note">下一章</a>
      <a id="external" href="https://example.com">外部</a>
      <a id="traversal" href="../secret.xhtml">穿越</a>
    `
    const onInternalLink = vi.fn()
    sanitizeContents({ content: fixture.body } as never, {
      resolveInternalHref: (href) => href === 'chapter-2.xhtml#note'
        ? 'Text/chapter-2.xhtml#note'
        : null,
      onInternalLink
    })

    const safe = fixture.querySelector<HTMLElement>('#safe')!
    expect(safe.getAttribute('data-reader-internal-href')).toBe('Text/chapter-2.xhtml#note')
    expect(safe.getAttribute('role')).toBe('link')
    expect(safe.getAttribute('tabindex')).toBe('0')
    safe.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(onInternalLink).toHaveBeenCalledWith('Text/chapter-2.xhtml#note')

    expect(fixture.querySelector('#external')?.hasAttribute('href')).toBe(false)
    expect(fixture.querySelector('#external')?.hasAttribute('tabindex')).toBe(false)
    expect(fixture.querySelector('#traversal')?.hasAttribute('data-reader-internal-href')).toBe(false)
  })
})

describe('splitSearchExcerpt', () => {
  it('splits an excerpt around case-insensitive query hits', async () => {
    const { splitSearchExcerpt } = await import('../../src/renderer/src/readers/search')
    expect(splitSearchExcerpt('读书的边界在于边界感', '边界')).toEqual([
      { text: '读书的', hit: false },
      { text: '边界', hit: true },
      { text: '在于', hit: false },
      { text: '边界', hit: true },
      { text: '感', hit: false }
    ])
    expect(splitSearchExcerpt('Model and model', 'MODEL')).toEqual([
      { text: 'Model', hit: true },
      { text: ' and ', hit: false },
      { text: 'model', hit: true }
    ])
  })

  it('returns one plain segment when the query cannot match the collapsed excerpt', async () => {
    const { splitSearchExcerpt } = await import('../../src/renderer/src/readers/search')
    expect(splitSearchExcerpt('一段被折叠的摘录', '')).toEqual([{ text: '一段被折叠的摘录', hit: false }])
    expect(splitSearchExcerpt('一段被折叠的摘录', '不存在')).toEqual([{ text: '一段被折叠的摘录', hit: false }])
  })
})
