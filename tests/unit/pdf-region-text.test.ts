import { expect, it } from 'vitest'
import { extractPdfRegionText, type PdfRegionAnchor, type PdfRegionTextItem } from '../../src/renderer/src/readers/pdf-text'
import { previousExtractPdfRegionText } from '../performance/support/legacy-pdf-region-text'

const region: PdfRegionAnchor = { pageNumber: 1, left: 0, top: 0, right: 1, bottom: 1 }

function glyphs(count: number): PdfRegionTextItem[] {
  return Array.from({ length: count }, (_, index) => ({
    text: index % 2 ? '😀' : '甲', rawStart: index, rawEnd: index + 1,
    left: index / (count + 1), right: (index + 0.5) / (count + 1), top: 0.2, bottom: 0.22
  }))
}

it('bounds geometry reads while merging 2,000 glyph fragments on one line', () => {
  let reads = 0
  const items = glyphs(2_000).map((item) => new Proxy(item, {
    get: (target, key, receiver) => { if (key === 'top' || key === 'bottom') reads++; return Reflect.get(target, key, receiver) }
  }))
  const result = extractPdfRegionText(items, region)
  expect(result).toEqual({ text: '甲😀'.repeat(1_000), rawStart: 0, rawEnd: 2_000 })
  expect(reads).toBeLessThan(2_000 * 20)
})

it('preserves the original row centers through drifting glyph baselines and height changes', () => {
  const samples: PdfRegionTextItem[][] = [
    [], glyphs(30),
    Array.from({ length: 60 }, (_, index) => ({
      text: ` ${index}😀 `, rawStart: index * 4, rawEnd: index * 4 + 3,
      left: (index % 10) / 12, right: (index % 10) / 12 + 0.02,
      top: 0.1 + Math.floor(index / 10) * 0.04 + (index % 5) * 0.00049,
      bottom: 0.115 + Math.floor(index / 10) * 0.04 + (index % 3) * 0.001
    }))
  ]
  // Fixed generated fixtures exercise tie distances without relying on timing or randomness.
  let seed = 17
  const next = () => { seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0; return seed / 2 ** 32 }
  for (let fixture = 0; fixture < 100; fixture++) {
    samples.push(Array.from({ length: 40 }, (_, index) => {
      const top = Math.floor(next() * 8) * 0.07 + next() * 0.012
      const left = next() * 0.9
      return {
        text: index % 9 ? `${index}𠮷` : ' \t ', rawStart: index * 3, rawEnd: index * 3 + 2,
        left, right: Math.min(1, left + 0.01 + next() * 0.05), top, bottom: top + 0.003 + next() * 0.025
      }
    }))
  }
  for (const items of samples) for (const selection of [region, { ...region, left: 0.1, right: 0.45, top: 0.09, bottom: 0.4 }]) {
    expect(extractPdfRegionText(items, selection)).toEqual(previousExtractPdfRegionText(items, selection))
  }
})

it('keeps input fragments unchanged across repeated and differently scoped regions', () => {
  const items = glyphs(100).reverse()
  const before = structuredClone(items)
  for (const selection of [region, { ...region, right: 0.5 }, region]) {
    expect(extractPdfRegionText(items, selection)).toEqual(previousExtractPdfRegionText(items, selection))
  }
  expect(items).toEqual(before)
})
