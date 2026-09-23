// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { PreparedOcrPage } from '../../src/shared/contracts'
import { OcrPageReader } from '../../src/renderer/src/OcrPageReader'

const getBookOcrPage = vi.fn(), copyText = vi.fn(), onSelection = vi.fn(), onNavigate = vi.fn(), onPrepare = vi.fn()
const page: PreparedOcrPage = { status: 'ready', revision: '7157b869-f3e8-48f9-a62a-7a2747c10718', pageNumber: 1, pageCount: 3, text: '😀独立复核\n<script>原样显示</script>' }
const component = (number = 1) => <OcrPageReader key={number} bookId="book" pageNumber={number} onSelection={onSelection} onNavigate={onNavigate} onClose={vi.fn()} onPrepare={onPrepare} />
beforeEach(() => {
  vi.stubGlobal('React', React); vi.stubGlobal('readerApi', { getBookOcrPage, copyText })
  getBookOcrPage.mockResolvedValue(page); copyText.mockResolvedValue(undefined); onNavigate.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); vi.resetAllMocks(); vi.unstubAllGlobals() })

it('selects literal OCR text with page evidence, copies it and clears the selection when closed', async () => {
  const view = render(component())
  const text = await screen.findByTestId('ocr-reading-text')
  expect(text.querySelector('script')).toBeNull()
  act(() => {
    const range = document.createRange(); range.setStart(text.firstChild!, 0); range.setEnd(text.firstChild!, 6)
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  expect(onSelection).toHaveBeenLastCalledWith(expect.objectContaining({ quote: '😀独立复核', anchor: expect.stringMatching(/^pdfocr:1:0:5:/u), passages: [expect.objectContaining({ sources: [{ page: 1, anchor: 'pdfpos:1:0', precision: 'block' }] })] }))
  fireEvent.click(screen.getByTestId('ocr-reading-copy'))
  await screen.findByText('已复制')
  expect(copyText).toHaveBeenCalledWith(page.text)
  expect(getBookOcrPage).toHaveBeenCalledTimes(1)
  view.unmount()
  expect(onSelection).toHaveBeenLastCalledWith(null)
})

it('ignores a late page read after navigation and bounds page navigation', async () => {
  let release!: (value: PreparedOcrPage) => void
  getBookOcrPage.mockImplementationOnce(() => new Promise<PreparedOcrPage>((resolve) => { release = resolve }))
  const view = render(component())
  getBookOcrPage.mockResolvedValueOnce({ ...page, pageNumber: 2, text: '第二页' })
  view.rerender(component(2))
  await waitFor(() => expect(screen.getByTestId('ocr-reading-text').textContent).toBe('第二页'))
  await act(async () => { release(page) })
  expect(screen.getByTestId('ocr-reading-text').textContent).toBe('第二页')
  fireEvent.change(screen.getByTestId('ocr-reading-page'), { target: { value: '600' } })
  fireEvent.submit(screen.getByTestId('ocr-reading-page').closest('form')!)
  await screen.findByText('请输入 1 至 3 之间的 PDF 页码。')
  expect(onNavigate).not.toHaveBeenCalled()
  fireEvent.click(screen.getByTestId('ocr-reading-next'))
  await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(3))
})

it('retries reads on request, offers preparation without starting it and disables copying blank pages', async () => {
  getBookOcrPage.mockRejectedValueOnce(new Error('读取失败')).mockResolvedValueOnce({ status: 'unprepared' })
  const view = render(component())
  await screen.findByText('读取失败')
  fireEvent.click(screen.getByText('重试'))
  await screen.findByTestId('ocr-reading-prepare')
  expect(onPrepare).not.toHaveBeenCalled()
  fireEvent.click(screen.getByTestId('ocr-reading-prepare'))
  expect(onPrepare).toHaveBeenCalledOnce()
  getBookOcrPage.mockResolvedValueOnce({ ...page, pageNumber: 2, text: '' })
  view.rerender(component(2))
  await screen.findByText('本页未识别到文字，可查看 PDF 原页核对。')
  expect((screen.getByTestId('ocr-reading-copy') as HTMLButtonElement).disabled).toBe(true)
  expect(screen.queryByTestId('ocr-reading-text')).toBeNull()
})

it('does not show an old copy result on a newly opened page', async () => {
  let complete!: () => void
  const view = render(component())
  await screen.findByTestId('ocr-reading-text')
  copyText.mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve }))
  fireEvent.click(screen.getByTestId('ocr-reading-copy'))
  getBookOcrPage.mockResolvedValueOnce({ ...page, pageNumber: 2, text: '第二页' })
  view.rerender(component(2))
  await waitFor(() => expect(screen.getByTestId('ocr-reading-text').textContent).toBe('第二页'))
  await act(async () => { complete() })
  expect(screen.queryByText('已复制')).toBeNull()
  expect((screen.getByTestId('ocr-reading-copy') as HTMLButtonElement).disabled).toBe(false)
})
