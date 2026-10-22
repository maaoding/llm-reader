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
  it('exposes the reader API when preload initializes', async () => {
    vi.resetModules()
    const { readerApi: exposedApi } = await import('../../src/preload/index')

    expect(electronMocks.exposeInMainWorld).toHaveBeenCalledExactlyOnceWith('readerApi', exposedApi)
  })

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
  })

  it('exposes the per-book temporary session through its dedicated IPC channels', async () => {
    const bookId = '45b45c27-b51d-4f49-8df7-480918cf2a0b'
    const input = {
      bookId,
      conversationId: '05b45c27-b51d-4f49-8df7-480918cf2a0b',
      scope: 'book' as const,
      selection: null,
      draft: '未发送草稿',
      turns: []
    }
    const record = { ...input, updatedAt: '2026-09-11T09:00:00.000Z' }
    electronMocks.invoke
      .mockResolvedValueOnce(record)
      .mockResolvedValueOnce(record)
      .mockResolvedValueOnce(true)

    await expect(readerApi.getBookSession(bookId)).resolves.toEqual(record)
    await expect(readerApi.saveBookSession(input)).resolves.toEqual(record)
    await expect(readerApi.deleteBookSession(bookId)).resolves.toBe(true)

    expect(electronMocks.invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.sessionsGet, bookId)
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.sessionsSave, input)
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(3, IPC_CHANNELS.sessionsDelete, bookId)
  })

  it('exposes the open session tabs list through its dedicated IPC channels', async () => {
    const state = {
      activeIndex: 1,
      tabs: [
        { kind: 'live' as const, bookId: '45b45c27-b51d-4f49-8df7-480918cf2a0b', insightId: null, draft: '' },
        { kind: 'archive' as const, bookId: '45b45c27-b51d-4f49-8df7-480918cf2a0b', insightId: '05b45c27-b51d-4f49-8df7-480918cf2a0b', draft: '归档草稿' }
      ]
    }
    electronMocks.invoke.mockResolvedValueOnce(state).mockResolvedValueOnce(state)

    await expect(readerApi.listSessionTabs()).resolves.toEqual(state)
    await expect(readerApi.saveSessionTabs(state)).resolves.toEqual(state)

    expect(electronMocks.invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.sessionTabsList)
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.sessionTabsSave, state)
  })

  it('waits for a successful save before approving the matching close request', async () => {
    let finish!: (approved: boolean) => void
    const listener = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve }))
    const unsubscribe = readerApi.onBeforeClose(listener)
    const handler = electronMocks.on.mock.calls[0][1]

    handler({}, 7)
    await Promise.resolve()
    expect(listener).toHaveBeenCalledOnce()
    expect(electronMocks.invoke).not.toHaveBeenCalled()
    finish(true)
    await vi.waitFor(() => expect(electronMocks.invoke).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.appCloseReady, { requestId: 7, approved: true }))
    unsubscribe()
    expect(electronMocks.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.appBeforeClose, handler)
  })

  it.each([
    { name: 'a rejected save', listener: () => Promise.reject(new Error('write failed')) },
    { name: 'a synchronous save exception', listener: () => { throw new Error('write failed') } },
    { name: 'an explicit refusal', listener: () => false }
  ])('keeps the window open after $name', async ({ listener }) => {
    readerApi.onBeforeClose(listener)
    electronMocks.on.mock.calls[0][1]({}, 8)
    await vi.waitFor(() => expect(electronMocks.invoke).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.appCloseReady, { requestId: 8, approved: false }))
  })

  it('ignores close events without a valid request identity', async () => {
    const listener = vi.fn(() => true)
    readerApi.onBeforeClose(listener)
    const handler = electronMocks.on.mock.calls[0][1]
    for (const requestId of [undefined, 0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) handler({}, requestId)
    await Promise.resolve()
    expect(listener).not.toHaveBeenCalled()
    expect(electronMocks.invoke).not.toHaveBeenCalled()
  })

  it('notifies the renderer when a failed installation cancels a saved close', () => {
    const listener = vi.fn()
    const unsubscribe = readerApi.onCloseCancelled(listener)
    const handler = electronMocks.on.mock.calls[0][1]
    handler({})
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
    expect(electronMocks.on).toHaveBeenCalledWith(IPC_CHANNELS.appCloseCancelled, handler)
    expect(electronMocks.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.appCloseCancelled, handler)
  })
})
