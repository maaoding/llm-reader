// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TextReadingMode } from '../../src/shared/contracts'
import { copy } from '../../src/shared/copy'
import { parseTextParagraphs, TextReaderAdapter } from '../../src/renderer/src/readers/text-reader'

const adapters: TextReaderAdapter[] = []
afterEach(() => {
  adapters.splice(0).forEach((adapter) => adapter.destroy())
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function setup(source: string, mode: TextReadingMode = 'plain') {
  const host = document.createElement('div')
  document.body.append(host)
  const onRelocated = vi.fn()
  const adapter = new TextReaderAdapter(host, { bookId: 'txt-navigation', onRelocated })
  adapters.push(adapter)
  await adapter.setTextMode(mode)
  const info = await adapter.open(new TextEncoder().encode(source))
  const paragraphs = [...host.querySelectorAll<HTMLElement>('[data-reader-paragraph]')]
  return { host, adapter, onRelocated, paragraphs, info }
}

describe('ordered TXT paragraph navigation', () => {
  it('keeps exact source spans across trimmed Unicode whitespace, empty blocks and unpaired surrogates', () => {
    const texts = ['😀甲\n𠮷乙', '# 第二章', '\uD800丙\uDC00', '👩🏽‍💻é尾']
    const source = `\uFEFF \t\n\n\u2003${texts[0]}\u3000\n\n \t\n\n${texts[1]}  \n\n${texts[2]}\n\n\t${texts[3]}\u00a0\n\n \t`
    const paragraphs = parseTextParagraphs(source)
    expect(paragraphs.map((paragraph) => paragraph.text)).toEqual(texts)
    expect(paragraphs.map((paragraph) => paragraph.heading)).toEqual([false, true, false, false])
    const points = Array.from(source)
    for (const paragraph of paragraphs) {
      expect(points.slice(paragraph.start, paragraph.end).join('')).toBe(paragraph.text)
      expect(paragraph.start).toBe(Array.from(source.slice(0, source.indexOf(paragraph.text))).length)
    }
    expect(parseTextParagraphs('\n\n\t \u3000\n')).toEqual([])
  })

  it.each(['plain', 'markdown'] as const)('keeps chapter membership and TOC depth in %s mode', async (mode) => {
    const source = '开篇内容😀\n\n# 第一章\n\n甲段落。\n\n| 左 | 右 |\n| --- | --- |\n| 甲 | 乙 |\n\n## 小节\n\n> 引用内容\n>\n> - 嵌套段落😀\n\n# 第二章\n\n最后一段。'
    const { adapter, paragraphs, onRelocated, info } = await setup(source, mode)
    expect(info.toc.map(({ label, depth }) => [label, depth])).toEqual([
      ['第一章', 0], ['小节', mode === 'markdown' ? 1 : 0], ['第二章', 0]
    ])
    const chapterStarts = ['# 第一章', '## 小节', '# 第二章'].map((heading) => Array.from(source.slice(0, source.indexOf(heading))).length)
    for (const paragraph of paragraphs) {
      const start = Number(paragraph.dataset.readerStart)
      const chapter = chapterStarts.filter((offset) => offset <= start).length - 1
      await adapter.goTo(`txt:${start}:${start}`)
      expect(onRelocated).toHaveBeenLastCalledWith(expect.objectContaining({
        chapterTitle: ['第一章', '小节', '第二章'][chapter] ?? copy('reader.txtOpening'),
        chapterHref: `txt:${chapterStarts[chapter] ?? 0}:${chapterStarts[chapter] ?? 0}`,
        locator: `txt:${start}:${start}`
      }))
    }
  })

  it('preserves Unicode offsets, paragraph ends, whitespace gaps and trailing positions', async () => {
    const source = '  甲😀乙\n\n  丙丁\n\n终点  '
    const { host, adapter, paragraphs } = await setup(source)
    const navigated: number[] = []
    paragraphs.forEach((paragraph, index) => { paragraph.scrollIntoView = () => { navigated.push(index) } })
    const cases = [
      [0, 0], [2, 0], [4, 0], [5, 0], [6, 1], [9, 1], [11, 1], [12, 2], [13, 2], [15, 2], [17, 2]
    ]
    expect(Array.from(source)).toHaveLength(17)
    for (const [offset, index] of cases) {
      await adapter.goTo(`txt:${offset}:${offset}`)
      expect(navigated.at(-1)).toBe(index)
    }
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 500, 600))
    const createRange = document.createRange.bind(document)
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      const range = createRange()
      range.getClientRects = () => [new DOMRect(0, 0, 50, 20)] as unknown as DOMRectList
      return range
    })
    await expect(adapter.selectAnchor('txt:3:5')).resolves.toBe(true)
    expect(adapter.getSelection()?.quote).toBe('😀乙')
  })

  it('bounds layout reads during long-book scrolling and handles jumps in both directions', async () => {
    vi.useFakeTimers()
    const { host, paragraphs, onRelocated } = await setup(Array.from({ length: 1024 }, (_, index) => `正文${index}😀`).join('\n\n'))
    Object.defineProperties(host, { scrollHeight: { value: 32_000 }, clientHeight: { value: 600 } })
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 500, 600))
    let layoutReads = 0
    paragraphs.forEach((paragraph, index) => {
      vi.spyOn(paragraph, 'getBoundingClientRect').mockImplementation(() => {
        layoutReads++
        return new DOMRect(0, 100 + index * 30 - host.scrollTop, 500, 20)
      })
    })
    for (const [scrollTop, expectedIndex] of [[0, 0], [27_000, 900], [30_702, 1023], [12, 1], [15_015, 501], [31_000, 1023], [0, 0]]) {
      onRelocated.mockClear()
      layoutReads = 0
      host.scrollTop = scrollTop
      host.dispatchEvent(new Event('wheel'))
      host.dispatchEvent(new Event('scroll'))
      await vi.advanceTimersByTimeAsync(20)
      const start = paragraphs[expectedIndex].dataset.readerStart!
      expect(onRelocated).toHaveBeenLastCalledWith(expect.objectContaining({ locator: `txt:${start}:${start}`, reason: 'natural' }))
      expect(layoutReads).toBeGreaterThan(0)
      expect(layoutReads).toBeLessThanOrEqual(14)
    }
  })

  it('selects the first cell of a visible Markdown table row when cell bottoms are equal', async () => {
    vi.useFakeTimers()
    const { host, paragraphs, onRelocated } = await setup('| 甲 | 乙 | 丙 |\n| --- | --- | --- |\n| A | B | C |\n| D | E | F |', 'markdown')
    expect(paragraphs).toHaveLength(9)
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 500, 40))
    paragraphs.forEach((paragraph, index) => {
      vi.spyOn(paragraph, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 100 + Math.floor(index / 3) * 30 - host.scrollTop, 100, 20))
    })
    for (const [scrollTop, expectedIndex] of [[35, 3], [42, 6], [0, 0]]) {
      host.scrollTop = scrollTop
      host.dispatchEvent(new Event('wheel'))
      host.dispatchEvent(new Event('scroll'))
      await vi.advanceTimersByTimeAsync(20)
      const start = paragraphs[expectedIndex].dataset.readerStart!
      expect(onRelocated).toHaveBeenLastCalledWith(expect.objectContaining({ locator: `txt:${start}:${start}`, reason: 'natural' }))
    }
  })

  it.each(['plain', 'markdown'] as const)('locates nested selection nodes without walking every paragraph in %s mode', async (mode) => {
    const source = Array.from({ length: 1_024 }, (_, index) => `段落${index} 甲**😀乙**丙。`).join('\n\n')
    const { adapter, paragraphs } = await setup(source, mode)
    const paragraph = paragraphs[1_000]
    const node = mode === 'markdown' ? paragraph.querySelector('strong')!.firstChild! : paragraph.firstChild!
    const start = node.textContent!.indexOf('😀'), end = start + '😀乙'.length
    const range = document.createRange()
    range.setStart(node, start); range.setEnd(node, end)
    const selection = document.getSelection()!
    selection.removeAllRanges(); selection.addRange(range)
    const contains = vi.spyOn(Node.prototype, 'contains')
    document.dispatchEvent(new Event('selectionchange'))
    const result = adapter.getSelection()!
    expect(result.quote).toBe('😀乙')
    const offsets = result.anchor.split(':').slice(1).map(Number)
    expect(Array.from(source).slice(...offsets).join('')).toBe('😀乙')
    expect(result.passages.some((passage) => passage.id === 'P1001')).toBe(true)
    expect(result.passages.reduce((sum, passage) => sum + Array.from(passage.text).length, 0)).toBeLessThanOrEqual(6_000)
    // Markdown also validates that both indexed endpoints still belong to their paragraph.
    expect(contains.mock.calls.length).toBeLessThanOrEqual(mode === 'markdown' ? 3 : 2)
    selection.removeAllRanges()
  })

  it('validates fresh Unicode bounds after reopening and restores the previous anchor after mode changes', async () => {
    const source = '# 标题😀\n\n甲**𠮷乙**丙  '
    const { adapter, onRelocated } = await setup(source)
    const offset = Array.from(source.slice(0, source.indexOf('𠮷'))).length
    const anchor = `txt:${offset}:${offset}`
    await adapter.goTo(anchor)
    await adapter.setTextMode('markdown')
    expect(onRelocated).toHaveBeenLastCalledWith(expect.objectContaining({ locator: anchor, progress: offset / Array.from(source).length }))
    await adapter.open(new TextEncoder().encode('😀终'))
    await adapter.goTo('txt:2:2')
    expect(onRelocated).toHaveBeenLastCalledWith(expect.objectContaining({ progress: 1 }))
    await expect(adapter.goTo('txt:3:3')).rejects.toThrow(copy('reader.txtInvalidAnchor'))
  })
})
