import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../src/shared/contracts'

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener
  }
}))

import { readerApi } from '../../src/preload/index'

describe('preload ReaderApi', () => {
  it('exposes highlight list, save and delete through their dedicated IPC channels', async () => {
    const bookId = '45b45c27-b51d-4f49-8df7-480918cf2a0b'
    const highlight = {
      id: '5e9dc44f-5868-4d99-97c7-fcb79c179de6',
      bookId,
      quote: '原文句段',
      anchor: 'txt:4:12',
      chapterTitle: '第一章',
      createdAt: '2026-08-16T09:00:00.000Z'
    }
    electronMocks.invoke
      .mockResolvedValueOnce([highlight])
      .mockResolvedValueOnce(highlight)
      .mockResolvedValueOnce(true)

    await expect(readerApi.listHighlights(bookId)).resolves.toEqual([highlight])
    await expect(readerApi.saveHighlight({ bookId, quote: highlight.quote, anchor: highlight.anchor, chapterTitle: highlight.chapterTitle })).resolves.toEqual(highlight)
    await expect(readerApi.deleteHighlight(highlight.id)).resolves.toBe(true)

    expect(electronMocks.invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.highlightsList, bookId)
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.highlightsSave, { bookId, quote: highlight.quote, anchor: highlight.anchor, chapterTitle: highlight.chapterTitle })
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(3, IPC_CHANNELS.highlightsDelete, highlight.id)
  })

  it('exposes app info through its dedicated IPC channel', async () => {
    electronMocks.invoke.mockResolvedValueOnce({ version: '0.2.0' })

    await expect(readerApi.getAppInfo()).resolves.toEqual({ version: '0.2.0' })
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.appInfo)
  })

  beforeEach(() => {
    electronMocks.invoke.mockReset()
  })

  it('exposes book cover and details through their dedicated IPC channels', async () => {
    const id = '45b45c27-b51d-4f49-8df7-480918cf2a0b'
    electronMocks.invoke.mockResolvedValueOnce(null)
    electronMocks.invoke.mockResolvedValueOnce({ book: null })

    await expect(readerApi.getBookCover(id)).resolves.toBeNull()
    await expect(readerApi.getBookDetails(id)).resolves.toEqual({ book: null })

    expect(electronMocks.invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.booksCover, id)
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.booksDetails, id)
  })

  it('exposes insight history updates through the dedicated IPC channel', async () => {
    const bookId = '45b45c27-b51d-4f49-8df7-480918cf2a0b'
    const id = '05b45c27-b51d-4f49-8df7-480918cf2a0b'
    const history = [
      { role: 'user' as const, content: 'Question' },
      { role: 'assistant' as const, content: 'Answer', model: 'model' }
    ]
    electronMocks.invoke.mockResolvedValueOnce({ id, history })

    await expect(readerApi.updateInsightHistory({ bookId, id, history })).resolves.toEqual({ id, history })

    expect(electronMocks.invoke).toHaveBeenCalledOnce()
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.insightsUpdateHistory, { bookId, id, history })
  })
  it('exposes insight deletion through its dedicated IPC channel', async () => {
    const id = '45b45c27-b51d-4f49-8df7-480918cf2a0b'
    electronMocks.invoke.mockResolvedValueOnce(true)

    await expect(readerApi.deleteInsight(id)).resolves.toBe(true)

    expect(electronMocks.invoke).toHaveBeenCalledOnce()
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.insightsDelete, id)
    expect(electronMocks.exposeInMainWorld).toHaveBeenCalledWith('readerApi', readerApi)
  })
})
