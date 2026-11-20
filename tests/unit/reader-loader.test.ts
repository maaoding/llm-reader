import { expect, it, vi } from 'vitest'

const initialized = vi.hoisted(() => [] as string[])
vi.mock('../../src/renderer/src/readers/text-reader', () => {
  initialized.push('txt')
  return { TextReaderAdapter: class TextReader {} }
})
vi.mock('../../src/renderer/src/readers/epub-reader', () => {
  initialized.push('epub')
  return { EpubReaderAdapter: class EpubReader {} }
})
vi.mock('../../src/renderer/src/readers/pdf-reader', () => {
  initialized.push('pdf')
  return { PdfReaderAdapter: class PdfReader {} }
})

it('leaves unused readers unloaded and reuses the requested module on later opens', async () => {
  const { loadReaderAdapter } = await import('../../src/renderer/src/readers/reader-loader')
  expect(initialized).toEqual([])
  const txt = await loadReaderAdapter('txt')
  expect(initialized).toEqual(['txt'])
  expect(await loadReaderAdapter('txt')).toBe(txt)
  expect(initialized).toEqual(['txt'])
  const [epub, pdf] = await Promise.all([loadReaderAdapter('epub'), loadReaderAdapter('pdf')])
  expect(epub.name).toBe('EpubReader')
  expect(pdf.name).toBe('PdfReader')
  expect(initialized.slice().sort()).toEqual(['epub', 'pdf', 'txt'])
})
