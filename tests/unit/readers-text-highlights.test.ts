// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { parseTextParagraphs, TextReaderAdapter } from '../../src/renderer/src/readers/text-reader'

const adapters: TextReaderAdapter[] = []
const originalHighlight = Object.getOwnPropertyDescriptor(window, 'Highlight')
const originalCss = Object.getOwnPropertyDescriptor(window, 'CSS')
const highlightName = 'llm-reader-persistent'
const fallbackClass = 'llm-reader-persistent-fallback'

class NativeHighlight {
  constructor(readonly ranges: Range[]) {}
}

function installSupport(constructor = true, registry = true) {
  const highlights = new Map<string, NativeHighlight>()
  Object.defineProperty(window, 'Highlight', {
    configurable: true,
    value: constructor ? class extends NativeHighlight {
      constructor(...ranges: Range[]) { super(ranges) }
    } : undefined
  })
  Object.defineProperty(window, 'CSS', {
    configurable: true,
    value: { ...window.CSS, highlights: registry ? highlights : undefined }
  })
  return highlights
}

afterEach(() => {
  adapters.splice(0).forEach((adapter) => adapter.destroy())
  for (const [name, descriptor] of [['Highlight', originalHighlight], ['CSS', originalCss]] as const) {
    if (descriptor) Object.defineProperty(window, name, descriptor)
    else Reflect.deleteProperty(window, name)
  }
  document.body.replaceChildren()
})

async function setup(source: string) {
  const host = document.createElement('div')
  document.body.append(host)
  const adapter = new TextReaderAdapter(host, { bookId: 'synthetic-highlights' })
  adapters.push(adapter)
  await adapter.setTextMode('plain')
  await adapter.open(new TextEncoder().encode(source))
  return { host, adapter }
}

it('only reads range endpoints for native highlights spanning a 5,000-paragraph book', async () => {
  const registry = installSupport()
  const source = Array.from({ length: 5_000 }, (_, index) => `段落😀 ${index}`).join('\n\n')
  const { host, adapter } = await setup(source)
  const parsed = parseTextParagraphs(source)
  // Count accesses to paragraph elements independently from Range and DOM internals.
  const paragraphs = Reflect.get(adapter, 'paragraphs') as Array<{ element: HTMLElement }>
  let elementReads = 0
  for (const paragraph of paragraphs) {
    const element = paragraph.element
    Object.defineProperty(paragraph, 'element', { get: () => { elementReads++; return element } })
  }
  const spans = Array.from({ length: 20 }, (_, index) => ({ start: parsed[index].start, end: parsed.at(-1 - index)!.end }))
  await adapter.setHighlights(spans.map(({ start, end }) => ({ anchor: `txt:${start}:${end}` })))
  expect(elementReads).toBe(40)
  const ranges = registry.get(highlightName)!.ranges
  expect(ranges).toHaveLength(20)
  for (const [index, range] of ranges.entries()) {
    const expected = parsed.slice(index, parsed.length - index).map((paragraph) => paragraph.text).join('')
    expect(range.toString() === expected, `Native text range ${index} must cover the same paragraphs`).toBe(true)
  }
  expect(host.querySelectorAll(`.${fallbackClass}`)).toHaveLength(0)
  await adapter.setHighlights([{ anchor: 'https://invalid.example' }, { anchor: 'txt:999999:1000000' }])
  expect(registry.has(highlightName)).toBe(false)
  await adapter.setHighlights([])
  expect(registry.has(highlightName)).toBe(false)
})

it.each([[false, false], [true, false], [false, true]])(
  'keeps overlapping fallback highlights and clears obsolete classes with constructor=%s / registry=%s',
  async (constructor, registryAvailable) => {
    const registry = installSupport(constructor, registryAvailable)
    const source = '甲😀乙\n\n丙丁\n\n戊己'
    const parsed = parseTextParagraphs(source)
    const { host, adapter } = await setup(source)
    const paragraphs = [...host.querySelectorAll<HTMLElement>('[data-reader-paragraph]')]
    await adapter.setHighlights([
      { anchor: `txt:${parsed[0].start}:${parsed[1].end}` },
      { anchor: `txt:${parsed[1].start}:${parsed[2].end}` },
      { anchor: 'txt:90000:90001' }, { anchor: 'https://invalid.example' }
    ])
    expect(paragraphs.map((element) => element.classList.contains(fallbackClass))).toEqual([true, true, true])
    expect(registry.has(highlightName)).toBe(false)
    await adapter.setHighlights([{ anchor: `txt:${parsed[2].start}:${parsed[2].end}` }])
    expect(paragraphs.map((element) => element.classList.contains(fallbackClass))).toEqual([false, false, true])
    await adapter.setHighlights([])
    expect(host.querySelectorAll(`.${fallbackClass}`)).toHaveLength(0)
  }
)

it('rebuilds native Unicode ranges against the current DOM when switching plain text and Markdown', async () => {
  const registry = installSupport()
  const source = '# 标题\n\n甲**😀乙**丙。\n\n## 后文\n\n结束。'
  const start = Array.from(source.slice(0, source.indexOf('甲'))).length
  const end = Array.from(source.slice(0, source.indexOf('丙') + 1)).length
  const { host, adapter } = await setup(source)
  await adapter.setHighlights([{ anchor: `txt:${start}:${end}` }])
  const plain = registry.get(highlightName)!.ranges[0]
  expect(plain.toString()).toBe('甲**😀乙**丙')
  await adapter.setTextMode('markdown')
  const markdown = registry.get(highlightName)!.ranges[0]
  expect(markdown.toString()).toBe('甲😀乙丙')
  expect(markdown.startContainer.isConnected).toBe(true)
  expect(host.querySelectorAll(`.${fallbackClass}`)).toHaveLength(0)
  await adapter.setTextMode('plain')
  expect(registry.get(highlightName)!.ranges[0].toString()).toBe('甲**😀乙**丙')
  adapter.destroy()
  expect(registry.has(highlightName)).toBe(false)
})
