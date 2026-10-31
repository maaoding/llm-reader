// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { buildBoundedPassages, type ContextBlock, type ContextFocus } from '../../src/renderer/src/readers/context'
import { TextReaderAdapter } from '../../src/renderer/src/readers/text-reader'

const adapters: TextReaderAdapter[] = []
afterEach(() => {
  adapters.splice(0).forEach((adapter) => adapter.destroy())
  document.getSelection()?.removeAllRanges()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

function blocks(texts: string[], known = true): ContextBlock[] {
  return texts.map((text, index) => ({
    id: `P${index + 1}`, text,
    ...(known && index % 3 !== 2 ? { codePointLength: Array.from(text).length } : {}),
    anchorForSlice: (start: number, end: number) => `${index}:${start}:${end}`
  }))
}

it('preserves passage text, IDs and anchors with mixed known lengths, empty blocks and Unicode', () => {
  const texts = ['甲😀乙丙', '', '𠮷丁 é', '\uD800A\uDC00', '👩🏽‍💻终点']
  const known = blocks(texts), counted = blocks(texts, false)
  const focuses: ContextFocus[] = [
    { startBlock: 0, startOffset: 0, endBlock: 0, endOffset: 1 },
    { startBlock: 0, startOffset: 3, endBlock: 4, endOffset: 100 },
    { startBlock: 2, startOffset: 1, endBlock: 3, endOffset: 2 },
    { startBlock: 4, startOffset: 3, endBlock: 4, endOffset: 4 },
    { startBlock: -10, startOffset: -1, endBlock: 10, endOffset: 100 }
  ]
  for (const focus of focuses) for (const maximum of [-1, 0, 1, 7, 12, 6_000]) {
    expect(buildBoundedPassages(known, focus, maximum)).toEqual(buildBoundedPassages(counted, focus, maximum))
  }
})

it('falls back to counting when supplied lengths are missing or structurally impossible', () => {
  const text = '甲😀乙𠮷丙 é', focus = { startBlock: 0, startOffset: 5, endBlock: 0, endOffset: 7 }
  const expected = buildBoundedPassages(blocks([text], false), focus, 7)
  for (const codePointLength of [undefined, Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, -1, 0, 1, 1.5, text.length + 1]) {
    const input = [{ ...blocks([text], false)[0], codePointLength }]
    expect(buildBoundedPassages(input, focus, 7)).toEqual(expected)
  }
})

it('keeps lazy chapter access bounded when only some blocks supply their parsed lengths', () => {
  const visited: number[] = []
  const input = {
    length: 50_000,
    at: (index: number) => {
      if (Math.abs(index - 25_000) > 6) throw new Error('Read outside the context window')
      visited.push(index)
      return {
        id: `P${index}`, text: '甲😀'.repeat(500),
        ...(index % 2 === 0 ? { codePointLength: 1_000 } : {}),
        anchorForSlice: (start: number, end: number) => `${index}:${start}:${end}`
      }
    }
  }
  const result = buildBoundedPassages(input, { startBlock: 25_000, startOffset: 500, endBlock: 25_000, endOffset: 501 })
  expect(result[0].anchor).toBe('24997:507:1000')
  expect(result.at(-1)!.anchor).toBe('25003:0:495')
  expect(result.reduce((sum, passage) => sum + Array.from(passage.text).length, 0)).toBe(5_988)
  expect(visited).toHaveLength(13)
  expect(new Set(visited).size).toBe(13)
})

it('reuses the parsed length instead of recounting a 100,000-code-point paragraph', () => {
  const text = '甲😀'.repeat(50_000), focus = { startBlock: 0, startOffset: 0, endBlock: 0, endOffset: 20 }
  const known = blocks([text]), counted = blocks([text], false)
  const points = vi.spyOn(String.prototype, 'codePointAt')
  const expected = buildBoundedPassages(counted, focus)
  const before = points.mock.calls.length
  points.mockClear()
  const actual = buildBoundedPassages(known, focus)
  const after = points.mock.calls.length
  expect(actual).toEqual(expected)
  expect(actual).toEqual([{ id: 'P1', text: '甲😀'.repeat(3_000), anchor: '0:0:6000' }])
  expect(before).toBe(106_000)
  expect(after).toBeLessThanOrEqual(6_000)
})

it.each(['plain', 'markdown'] as const)('reuses current paragraph bounds during an actual %s selection', async (mode) => {
  const host = document.createElement('div')
  document.body.append(host)
  const adapter = new TextReaderAdapter(host, { bookId: `parsed-context-length-${mode}` })
  adapters.push(adapter)
  await adapter.setTextMode(mode)
  await adapter.open(new TextEncoder().encode('甲😀'.repeat(50_000)))
  const node = host.querySelector('p')!.firstChild!, range = document.createRange()
  range.setStart(node, 0); range.setEnd(node, 30)
  const selection = document.getSelection()!
  selection.removeAllRanges(); selection.addRange(range)
  const points = vi.spyOn(String.prototype, 'codePointAt')
  document.dispatchEvent(new Event('selectionchange'))
  const reads = points.mock.calls.length
  const selected = adapter.getSelection()
  expect(selected).toMatchObject({ quote: '甲😀'.repeat(10), anchor: 'txt:0:20' })
  expect(selected!.passages).toEqual([{ id: 'P1', text: '甲😀'.repeat(3_000), anchor: 'txt:0:6000' }])
  expect(reads).toBeLessThanOrEqual(6_100)
})

it('uses raw Markdown length when a formatted selection is near the end of a long paragraph', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const adapter = new TextReaderAdapter(host, { bookId: 'raw-markdown-context-length' })
  adapters.push(adapter)
  await adapter.setTextMode('markdown')
  const source = '甲😀'.repeat(5_000) + ' **末**'
  await adapter.open(new TextEncoder().encode(source))
  const node = host.querySelector('strong')!.firstChild!, range = document.createRange()
  range.setStart(node, 0); range.setEnd(node, 1)
  const selection = document.getSelection()!
  selection.removeAllRanges(); selection.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  expect(adapter.getSelection()).toMatchObject({
    quote: '末', anchor: 'txt:10003:10004',
    passages: [{ id: 'P1', text: Array.from(source).slice(4_006).join(''), anchor: 'txt:4006:10006' }]
  })
})
