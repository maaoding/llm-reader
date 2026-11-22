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
  it('exposes bounded conversation copy and file export through dedicated channels', async () => {
    const input = { markdown: '# 完整会话', title: '书名-会话' }
    electronMocks.invoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ canceled: true })
    await expect(readerApi.copyConversationMarkdown(input.markdown)).resolves.toBeUndefined()
    await expect(readerApi.exportConversationMarkdown(input)).resolves.toEqual({ canceled: true })
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.conversationMarkdownCopy, input.markdown)
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.conversationMarkdownExport, input)
  })
  it('exposes the reader API when preload initializes', async () => {
    vi.resetModules()
    const { readerApi: exposedApi } = await import('../../src/preload/index')

    expect(electronMocks.exposeInMainWorld).toHaveBeenCalledExactlyOnceWith('readerApi', exposedApi)
  })

  it('exposes extract actions through their dedicated IPC channels', async () => {
    const bookId = '45b45c27-b51d-4f49-8df7-480918cf2a0b'
    const highlight = {
      id: '5e9dc44f-5868-4d99-97c7-fcb79c179de6',
      bookId,
      quote: '原文句段',
      anchor: 'txt:4:12',
      chapterTitle: '第一章',
      createdAt: '2026-08-16T09:00:00.000Z',
      note: '',
      tags: []
    }
    const edit = { bookId, highlightId: highlight.id, note: '个人批注', tags: ['标签'] }
    const edited = { ...highlight, note: edit.note, tags: edit.tags }
    const selection = { bookId, highlightIds: [highlight.id] }
    electronMocks.invoke
      .mockResolvedValueOnce([highlight])
      .mockResolvedValueOnce(highlight)
      .mockResolvedValueOnce(edited)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ canceled: false, fileName: '摘录.md' })

    await expect(readerApi.listHighlights(bookId)).resolves.toEqual([highlight])
    await expect(readerApi.saveHighlight({ bookId, quote: highlight.quote, anchor: highlight.anchor, chapterTitle: highlight.chapterTitle })).resolves.toEqual(highlight)
    await expect(readerApi.updateHighlight(edit)).resolves.toEqual(edited)
    await expect(readerApi.deleteHighlight(highlight.id)).resolves.toBe(true)
    await expect(readerApi.exportHighlights(selection)).resolves.toEqual({ canceled: false, fileName: '摘录.md' })

    expect(electronMocks.invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.highlightsList, bookId)
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.highlightsSave, { bookId, quote: highlight.quote, anchor: highlight.anchor, chapterTitle: highlight.chapterTitle })
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(3, IPC_CHANNELS.highlightsUpdate, edit)
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(4, IPC_CHANNELS.highlightsDelete, highlight.id)
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(5, IPC_CHANNELS.highlightsExport, selection)
  })

  it('exposes distribution info and AI content reporting through dedicated IPC channels', async () => {
    const info = { version: '1.4.0', distribution: 'store' }
    electronMocks.invoke.mockResolvedValueOnce(info).mockResolvedValueOnce(undefined)

    await expect(readerApi.getAppInfo()).resolves.toEqual(info)
    await expect(readerApi.openAiContentReport()).resolves.toBeUndefined()
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.appInfo)
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.appReportAiContent)
  })

  it('uses the dedicated reading window channels and passes only state to event subscribers', async () => {
    const token = '5e9dc44f-5868-4d99-97c7-fcb79c179de6'
    const presentation = { token, mode: 'inactive' as const }
    electronMocks.invoke.mockResolvedValueOnce(false).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(token).mockResolvedValueOnce(undefined)
    await expect(readerApi.isWindowFullscreen()).resolves.toBe(false)
    await readerApi.setWindowFullscreen(true)
    await expect(readerApi.reserveAssistantWindow()).resolves.toBe(token)
    await readerApi.presentAssistantWindow(presentation)
    expect(electronMocks.invoke.mock.calls).toEqual([
      [IPC_CHANNELS.windowIsFullscreen],
      [IPC_CHANNELS.windowSetFullscreen, true],
      [IPC_CHANNELS.assistantWindowReserve],
      [IPC_CHANNELS.assistantWindowPresent, presentation]
    ])

    const changed = vi.fn()
    const shortcut = vi.fn()
    const closed = vi.fn()
    const unsubscribe = [readerApi.onWindowFullscreenChange(changed), readerApi.onWindowFullscreenShortcut(shortcut), readerApi.onAssistantWindowClosed(closed)]
    const calls = electronMocks.on.mock.calls
    calls[0][1]({}, 'true')
    calls[0][1]({}, true)
    calls[1][1]({}, 'ignored')
    calls[2][1]({}, { token })
    calls[2][1]({}, token)
    expect(changed).toHaveBeenCalledExactlyOnceWith(true)
    expect(shortcut).toHaveBeenCalledExactlyOnceWith()
    expect(closed).toHaveBeenCalledExactlyOnceWith(token)
    unsubscribe.forEach((remove) => remove())
    expect(electronMocks.removeListener.mock.calls).toEqual(calls)
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
  it('exposes archived insight reads and markdown export through their dedicated IPC channels', async () => {
    const insightId = '45b45c27-b51d-4f49-8df7-480918cf2a0b'
    electronMocks.invoke.mockResolvedValueOnce([])
    electronMocks.invoke.mockResolvedValueOnce([])
    electronMocks.invoke.mockResolvedValueOnce([])
    electronMocks.invoke.mockResolvedValueOnce({ canceled: false, fileName: '归档.md' })

    await expect(readerApi.listAllInsights()).resolves.toEqual([])
    await expect(readerApi.listInsightPreviews()).resolves.toEqual([])
    await expect(readerApi.readInsightArchives([insightId])).resolves.toEqual([])
    await expect(readerApi.exportInsights({ kind: 'all' })).resolves.toEqual({ canceled: false, fileName: '归档.md' })

    expect(electronMocks.invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.insightsListAll)
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.insightsListPreviews)
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(3, IPC_CHANNELS.insightsReadArchives, [insightId])
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(4, IPC_CHANNELS.insightsExport, { kind: 'all' })
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

  it('sends the literal recent-conversation query through its own IPC channel', async () => {
    const result = { matches: [], hasMore: false }
    electronMocks.invoke.mockResolvedValueOnce(result)
    await expect(readerApi.searchRecentBookSessions('中文 C++[编号]_%')).resolves.toEqual(result)
    expect(electronMocks.invoke).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.sessionsSearchRecent, '中文 C++[编号]_%')
  })

  it('invokes semantic lookup and cancels it by request identity', async () => {
    const input = { bookId: 'book', requestId: 'request', query: '含义' }
    const response = { status: 'fallback', reason: 'index-not-ready' }
    electronMocks.invoke.mockResolvedValueOnce(response).mockResolvedValueOnce(undefined)
    await expect(readerApi.searchBookSemantically(input)).resolves.toEqual(response)
    await expect(readerApi.cancelSemanticSearch(input.requestId)).resolves.toBeUndefined()
    expect(electronMocks.invoke.mock.calls).toEqual([
      [IPC_CHANNELS.semanticSearch, input],
      [IPC_CHANNELS.semanticSearchCancel, input.requestId]
    ])
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
})
