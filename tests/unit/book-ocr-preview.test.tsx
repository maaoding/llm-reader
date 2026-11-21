// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BookOcrPreview } from '../../src/renderer/src/BookOcrPreview'
import { loadPdfPreview } from '../../src/renderer/src/readers/pdf-preview'
import type { BookPagePreview } from '../../src/shared/contracts'

vi.mock('../../src/renderer/src/readers/pdf-preview', () => ({ loadPdfPreview: vi.fn() }))
const previewBookPage = vi.fn(), cancelBookPagePreview = vi.fn(), writeText = vi.fn()
const result: BookPagePreview = { pageNumber: 1, pageCount: 2, text: '# 原文\n\n第一段。\n第二段。', cached: false, processor: 'vision', model: 'fixture' }
beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('readerApi', { previewBookPage, cancelBookPagePreview, copyText: writeText })
  vi.mocked(loadPdfPreview).mockResolvedValue({ pageCount: 2, imageDataUrl: 'data:image/jpeg;base64,Zg==' })
  previewBookPage.mockResolvedValue(result); cancelBookPagePreview.mockResolvedValue(undefined); writeText.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals() })
const open = () => render(<BookOcrPreview bookId="book" documentReady={true} disabled={false} suspended={false} onBusyChange={vi.fn()} />)
async function initialPreview() {
  fireEvent.click(screen.getByTestId('ocr-preview-start'))
  await waitFor(() => expect(screen.getByTestId('ocr-preview-text').textContent).toBe(result.text))
}

it('keeps the successful text after a failed refresh and retries recognition explicitly', async () => {
  open(); await initialPreview()
  previewBookPage.mockRejectedValueOnce(new Error('识别失败'))
  fireEvent.click(screen.getByTestId('ocr-preview-refresh'))
  await waitFor(() => expect(screen.getByTestId('ocr-preview-error').textContent).toContain('识别失败'))
  expect(screen.getByTestId('ocr-preview-text').textContent).toBe(result.text)
  expect(screen.getByTestId('ocr-preview-start').textContent).toBe('重试这一页')
  previewBookPage.mockResolvedValueOnce({ ...result, text: '重试后的完整文字' })
  fireEvent.click(screen.getByTestId('ocr-preview-start'))
  await waitFor(() => expect(screen.getByTestId('ocr-preview-text').textContent).toBe('重试后的完整文字'))
  expect(previewBookPage.mock.calls.map(([input]) => input.force)).toEqual([false, true, true])
  expect(loadPdfPreview).toHaveBeenCalledTimes(1)
  expect(screen.getByText('重新识别会再次发送此页，可能消耗服务额度；失败时保留上次结果。 新结果需点击“重新准备原文”后才会用于检索和笔记。')).toBeDefined()
})

it('copies the original text, lets users retry clipboard errors and ignores stale copy feedback', async () => {
  open(); await initialPreview()
  writeText.mockRejectedValueOnce(new Error('Unavailable'))
  fireEvent.click(screen.getByTestId('ocr-preview-copy'))
  await screen.findByText('复制失败，可选中下方文字手动复制。')
  fireEvent.click(screen.getByTestId('ocr-preview-copy'))
  await waitFor(() => expect(screen.getByTestId('ocr-preview-copy').textContent).toBe('已复制'))
  expect(writeText).toHaveBeenLastCalledWith(result.text)
  let done!: () => void
  writeText.mockImplementationOnce(() => new Promise<void>((resolve) => { done = resolve }))
  fireEvent.click(screen.getByTestId('ocr-preview-copy'))
  fireEvent.change(screen.getByTestId('ocr-preview-page'), { target: { value: '2' } })
  await act(async () => { done() })
  expect(screen.queryByTestId('ocr-preview-result')).toBeNull()
  expect(screen.queryByText('已复制')).toBeNull()
  expect(previewBookPage).toHaveBeenCalledTimes(1)
})

it('keeps the last result on cancellation and ignores a late refresh after a successful retry', async () => {
  open(); await initialPreview()
  let release!: (value: BookPagePreview) => void
  previewBookPage.mockImplementationOnce(() => new Promise<BookPagePreview>((resolve) => { release = resolve }))
  fireEvent.click(screen.getByTestId('ocr-preview-refresh'))
  await waitFor(() => expect(previewBookPage).toHaveBeenCalledTimes(2))
  fireEvent.click(screen.getByTestId('ocr-preview-cancel'))
  expect(screen.getByTestId('ocr-preview-text').textContent).toBe(result.text)
  expect(cancelBookPagePreview).toHaveBeenCalledWith(previewBookPage.mock.calls[1][0].requestId)
  previewBookPage.mockResolvedValueOnce({ ...result, text: '新的结果' })
  fireEvent.click(screen.getByTestId('ocr-preview-start'))
  await waitFor(() => expect(screen.getByTestId('ocr-preview-text').textContent).toBe('新的结果'))
  await act(async () => { release({ ...result, text: '迟到的结果' }) })
  expect(screen.getByTestId('ocr-preview-text').textContent).toBe('新的结果')
})
