import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../src/shared/contracts'

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  getPathForFile: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener
  },
  webUtils: {
    getPathForFile: electronMocks.getPathForFile
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

  it('exposes provider profile management and model discovery through dedicated IPC channels', async () => {
    const overview = { profiles: [], activeProfileId: null }
    const profileInput = {
      name: '日常', baseUrl: 'https://models.example.test', model: 'reader', apiKey: 'secret'
    }
    const modelInput = { baseUrl: profileInput.baseUrl, apiKey: 'secret' }
    electronMocks.invoke
      .mockResolvedValueOnce(overview)
      .mockResolvedValueOnce(overview)
      .mockResolvedValueOnce({ models: ['reader'], truncated: false })

    await expect(readerApi.getProviderOverview()).resolves.toEqual(overview)
    await expect(readerApi.createProviderProfile(profileInput)).resolves.toEqual(overview)
    await expect(readerApi.listProviderModels(modelInput)).resolves.toEqual({ models: ['reader'], truncated: false })

    expect(electronMocks.invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.providerOverview)
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.providerCreate, profileInput)
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(3, IPC_CHANNELS.providerModels, modelInput)
  })

  beforeEach(() => {
    electronMocks.invoke.mockReset()
    electronMocks.on.mockReset()
    electronMocks.removeListener.mockReset()
    electronMocks.getPathForFile.mockReset()
  })

  it('keeps dropped file paths inside preload and exposes batch controls', async () => {
    const file = { name: 'reader.epub' } as File
    const result = {
      total: 1,
      processed: 1,
      imported: 0,
      duplicates: 0,
      failed: 1,
      skipped: 0,
      canceled: false,
      items: [{ status: 'failed', fileName: 'reader.epub', code: 'EPUB_INVALID', message: 'EPUB 文件无效。' }]
    }
    electronMocks.getPathForFile.mockReturnValue('C:\\private\\reader.epub')
    electronMocks.invoke.mockResolvedValueOnce(result).mockResolvedValueOnce(undefined)

    await expect(readerApi.importDroppedBooks([file])).resolves.toEqual(result)
    await expect(readerApi.cancelBookImport()).resolves.toBeUndefined()

    expect(electronMocks.getPathForFile).toHaveBeenCalledWith(file)
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.booksImportDropped, ['C:\\private\\reader.epub'])
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.booksImportCancel)
    expect(result).not.toHaveProperty('path')
  })

  it('opens the native batch picker through one path-free API call', async () => {
    electronMocks.invoke.mockResolvedValueOnce(null)

    await expect(readerApi.importBooks()).resolves.toBeNull()

    expect(electronMocks.invoke).toHaveBeenCalledOnce()
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.booksImport)
  })

  it('subscribes to import progress and removes the exact listener', () => {
    const listener = vi.fn()
    const unsubscribe = readerApi.onBookImportEvent(listener)
    const handler = electronMocks.on.mock.calls[0][1]
    const event = { type: 'started' as const, total: 3 }

    handler({}, event)
    unsubscribe()

    expect(electronMocks.on).toHaveBeenCalledWith(IPC_CHANNELS.booksImportEvent, handler)
    expect(listener).toHaveBeenCalledWith(event)
    expect(electronMocks.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.booksImportEvent, handler)
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

  it('exposes book deletion through its dedicated IPC channel', async () => {
    const id = '45b45c27-b51d-4f49-8df7-480918cf2a0b'
    electronMocks.invoke.mockResolvedValueOnce(true)

    await expect(readerApi.deleteBook(id)).resolves.toBe(true)

    expect(electronMocks.invoke).toHaveBeenCalledOnce()
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.booksDelete, id)
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
  it('exposes global insight listing and markdown export through their dedicated IPC channels', async () => {
    electronMocks.invoke.mockResolvedValueOnce([])
    electronMocks.invoke.mockResolvedValueOnce({ canceled: false, fileName: '归档.md' })

    await expect(readerApi.listAllInsights()).resolves.toEqual([])
    await expect(readerApi.exportInsights({ kind: 'all' })).resolves.toEqual({ canceled: false, fileName: '归档.md' })

    expect(electronMocks.invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.insightsListAll)
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.insightsExport, { kind: 'all' })
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
