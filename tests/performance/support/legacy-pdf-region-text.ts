import type { PdfRegionAnchor, PdfRegionTextItem, PdfRegionTextResult } from '../../../src/renderer/src/readers/pdf-text'

// Region extraction from 9ff41d9, before row-center totals were retained.
function intersectionArea(item: PdfRegionTextItem, region: PdfRegionAnchor): number {
  const width = Math.max(0, Math.min(item.right, region.right) - Math.max(item.left, region.left))
  const height = Math.max(0, Math.min(item.bottom, region.bottom) - Math.max(item.top, region.top))
  return width * height
}

function selectedByRegion(item: PdfRegionTextItem, region: PdfRegionAnchor): boolean {
  const itemArea = Math.max(0.000001, (item.right - item.left) * (item.bottom - item.top))
  const centerX = (item.left + item.right) / 2
  const centerY = (item.top + item.bottom) / 2
  const centerInside = centerX >= region.left && centerX <= region.right && centerY >= region.top && centerY <= region.bottom
  return centerInside || intersectionArea(item, region) / itemArea >= 0.15
}

function rowText(items: ReadonlyArray<PdfRegionTextItem>): string {
  const sorted = [...items].sort((left, right) => left.left - right.left)
  let output = ''
  let previous: PdfRegionTextItem | null = null
  for (const item of sorted) {
    const value = item.text.trim()
    if (!value) continue
    if (previous && output && !/\s$/u.test(output) && !/^\s/u.test(value)) {
      const previousHeight = Math.max(0.000001, previous.bottom - previous.top)
      const currentHeight = Math.max(0.000001, item.bottom - item.top)
      const gap = item.left - previous.right
      if (gap > Math.min(previousHeight, currentHeight) * 0.18) output += ' '
    }
    output += value
    previous = item
  }
  return output.trim()
}

export function previousExtractPdfRegionText(
  items: ReadonlyArray<PdfRegionTextItem>,
  region: PdfRegionAnchor
): PdfRegionTextResult | null {
  const selected = items.filter((item) => selectedByRegion(item, region) && item.text.trim().length > 0)
  if (selected.length === 0) return null

  const sorted = [...selected].sort((left, right) => {
    const vertical = left.top - right.top
    return Math.abs(vertical) > 0.0005 ? vertical : left.left - right.left
  })
  const rows: Array<{ center: number; height: number; items: PdfRegionTextItem[] }> = []
  for (const item of sorted) {
    const center = (item.top + item.bottom) / 2
    const height = Math.max(0.000001, item.bottom - item.top)
    let bestRow: (typeof rows)[number] | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const row of rows) {
      const distance = Math.abs(row.center - center)
      if (distance <= Math.min(row.height, height) * 0.6 && distance < bestDistance) {
        bestRow = row
        bestDistance = distance
      }
    }
    if (bestRow) {
      bestRow.items.push(item)
      bestRow.center = bestRow.items.reduce((sum, entry) => sum + (entry.top + entry.bottom) / 2, 0) / bestRow.items.length
      bestRow.height = Math.max(bestRow.height, height)
    } else {
      rows.push({ center, height, items: [item] })
    }
  }

  const text = rows
    .sort((left, right) => left.center - right.center)
    .map((row) => rowText(row.items))
    .filter(Boolean)
    .join('\n')
    .trim()
  if (!text) return null

  return {
    text,
    rawStart: Math.min(...selected.map((item) => item.rawStart)),
    rawEnd: Math.max(...selected.map((item) => item.rawEnd))
  }
}
