import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONVERSATION_COPY_MAX_LENGTH, CONVERSATION_EXPORT_MAX_LENGTH, IPC_CHANNELS } from '../../src/shared/contracts'
import { pdfImageRegionAnchor } from '../../src/shared/pdf-image-region'

type InvokeHandler = (event: unknown, ...values: unknown[]) => Promise<unknown>

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, InvokeHandler>(),
  removeHandler: vi.fn(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  writeText: vi.fn(),
  openExternal: vi.fn(),
  requestClose: vi.fn(),
  respondToClose: vi.fn(),
  updatePhase: vi.fn(() => ({ status: 'idle' })),
  installUpdate: vi.fn(),
  getVersion: vi.fn(() => '0.3.0')
}))
const fonts = vi.hoisted(() => ({ list: vi.fn() }))
const conversationFile = vi.hoisted(() => ({ defaultName: vi.fn(), write: vi.fn() }))
vi.mock('../../src/main/conversation-export', () => ({ conversationExportDefaultName: conversationFile.defaultName, writeConversationMarkdown: conversationFile.write }))
vi.mock('../../src/main/fonts', () => ({ listSystemFonts: fonts.list }))

vi.mock('electron', () => ({
  app: { getVersion: electronMocks.getVersion },
  clipboard: { writeText: electronMocks.writeText },
  shell: { openExternal: electronMocks.openExternal },
  dialog: { showOpenDialog: electronMocks.showOpenDialog, showSaveDialog: electronMocks.showSaveDialog },
  ipcMain: {
    removeHandler: electronMocks.removeHandler,
    handle: vi.fn((channel: string, handler: InvokeHandler) => electronMocks.handlers.set(channel, handler))
  }
}))

import { registerIpcHandlers } from '../../src/main/ipc'
import { LibraryStorage } from '../../src/main/library-storage'

function trustedEvent(): unknown {
  const frame = { url: 'llm-reader://app/index.html' }
  const sender = { id: 17, mainFrame: frame, isDestroyed: () => false }
  return { sender, senderFrame: frame }
}

function register(bookImporter: {
  isBusy: () => boolean
  importPaths: (paths: ReadonlyArray<string>) => Promise<unknown>
  cancel: () => void
}, extras: { library?: unknown; llm?: unknown; storage?: unknown; database?: unknown } = {}): void {
  registerIpcHandlers({
    window: {
      webContents: { id: 17 },
      minimize: vi.fn(),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      isMaximized: vi.fn(() => false),
      close: vi.fn()
    },
    library: extras.library ?? {},
    bookImporter,
    provider: {},
    llm: extras.llm ?? {},
    storage: extras.storage,
    database: extras.database,
    updater: { getPhase: electronMocks.updatePhase, install: electronMocks.installUpdate },
    allowedRendererOrigins: new Set<string>(),
    requestClose: electronMocks.requestClose,
    respondToClose: electronMocks.respondToClose
  } as unknown as Parameters<typeof registerIpcHandlers>[0])
}

describe('book import IPC', () => {
  it('allows backup while settings enumerate fonts and allows font queries during maintenance', async () => {
    const storage = await LibraryStorage.open(join(tmpdir(), `reader-ipc-${randomUUID()}`))
    register({ isBusy: () => false, importPaths: vi.fn(), cancel: vi.fn() }, { storage, database: {} })
    let finishFonts!: (value: string[]) => void
    const fontResult = new Promise<string[]>(resolve => { finishFonts = resolve })
    fonts.list.mockReturnValue(fontResult)
    let cancelPicker!: (value: { canceled: boolean; filePaths: string[] }) => void
    electronMocks.showOpenDialog.mockReturnValue(new Promise(resolve => { cancelPicker = resolve }))
    const fontQuery = electronMocks.handlers.get(IPC_CHANNELS.fontsList)!(trustedEvent())
    const backup = electronMocks.handlers.get(IPC_CHANNELS.backupCreate)!(trustedEvent(), {})
    try {
      expect(electronMocks.showOpenDialog).toHaveBeenCalledOnce()
      expect(storage.locked).toBe(true)
      const secondFontQuery = electronMocks.handlers.get(IPC_CHANNELS.fontsList)!(trustedEvent())
      finishFonts(['Synthetic font'])
      await expect(fontQuery).resolves.toEqual(['Synthetic font'])
      await expect(secondFontQuery).resolves.toEqual(['Synthetic font'])
      cancelPicker({ canceled: true, filePaths: [] })
      await expect(backup).resolves.toBeNull()
      expect(storage.locked).toBe(false)
    } finally {
      finishFonts([]); cancelPicker({ canceled: true, filePaths: [] })
      await Promise.allSettled([fontQuery, backup])
    }
  })

  it('still refuses backup while a library import IPC is pending even before its busy flag is set', async () => {
    const storage = await LibraryStorage.open(join(tmpdir(), `reader-ipc-${randomUUID()}`))
    let finish!: () => void
    const importing = new Promise<void>(resolve => { finish = resolve })
    register({ isBusy: () => false, importPaths: () => importing, cancel: vi.fn() }, { storage, database: {} })
    const operation = electronMocks.handlers.get(IPC_CHANNELS.booksImportDropped)!(trustedEvent(), ['/tmp/sample.txt'])
    try {
      await expect(electronMocks.handlers.get(IPC_CHANNELS.backupCreate)!(trustedEvent(), {})).rejects.toThrow('BACKUP_BUSY')
      expect(electronMocks.showOpenDialog).not.toHaveBeenCalled()
    } finally { finish(); await operation }
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await expect(electronMocks.handlers.get(IPC_CHANNELS.backupCreate)!(trustedEvent(), {})).resolves.toBeNull()
  })

  it('keeps backup IPC behind the trusted main-frame boundary', async () => {
    register({ isBusy: () => false, importPaths: vi.fn(), cancel: vi.fn() }, { storage: { pendingPreferences: { token: 'private' } } })
    await expect(electronMocks.handlers.get(IPC_CHANNELS.backupPreferences)!({ sender: { id: 99 } })).rejects.toThrow('UNTRUSTED_SENDER')
    expect(electronMocks.showOpenDialog).not.toHaveBeenCalled()
  })

  it('refuses arbitrary storage keys before opening a backup destination dialog', async () => {
    register({ isBusy: () => false, importPaths: vi.fn(), cancel: vi.fn() })
    await expect(electronMocks.handlers.get(IPC_CHANNELS.backupCreate)!(trustedEvent(), { 'api-key': 'synthetic-secret' })).rejects.toThrow('INVALID_INPUT')
    expect(electronMocks.showOpenDialog).not.toHaveBeenCalled()
  })

  it('blocks new library mutations while maintenance owns the storage lock', async () => {
    const importPaths = vi.fn()
    register({ isBusy: () => false, importPaths, cancel: vi.fn() }, { storage: { locked: true } })
    await expect(electronMocks.handlers.get(IPC_CHANNELS.booksImportDropped)!(trustedEvent(), ['/tmp/sample.txt'])).rejects.toThrow('BACKUP_BUSY')
    expect(importPaths).not.toHaveBeenCalled()
  })

  it('opens only recorded HTTP(S) web sources for the requested book and trusted main frame', async () => {
    const bookId = randomUUID(), otherBookId = randomUUID(), url = 'https://evidence.example/recorded'
    const recorded = vi.fn((id: string, value: string) => id === bookId && value === url)
    register({ isBusy: () => false, importPaths: async () => null, cancel: () => undefined }, { library: { hasRecordedWebSource: recorded } })
    const handler = electronMocks.handlers.get(IPC_CHANNELS.webSourceOpen)!
    electronMocks.openExternal.mockReset()
    await expect(handler(trustedEvent(), { bookId, url })).resolves.toBe(true)
    expect(electronMocks.openExternal).toHaveBeenCalledExactlyOnceWith(url)
    for (const bad of ['javascript:alert(1)', 'file:///C:/secret', 'data:text/html,script', 'https://user:password@example.com']) {
      await expect(handler(trustedEvent(), { bookId, url: bad })).rejects.toThrow('[INVALID_INPUT]')
    }
    await expect(handler(trustedEvent(), { bookId: otherBookId, url })).rejects.toThrow('[INVALID_INPUT]')
    await expect(handler(trustedEvent(), { bookId, url: 'https://unrecorded.example' })).rejects.toThrow('[INVALID_INPUT]')
    await expect(handler({ sender: { id: 99 }, senderFrame: null }, { bookId, url })).rejects.toThrow('[UNTRUSTED_SENDER]')
    expect(electronMocks.openExternal).toHaveBeenCalledOnce()
  })

  beforeEach(() => {
    electronMocks.handlers.clear()
    electronMocks.removeHandler.mockClear()
    electronMocks.showOpenDialog.mockReset()
    electronMocks.showSaveDialog.mockReset().mockResolvedValue({ canceled: true })
    conversationFile.defaultName.mockReset().mockReturnValue('conversation.md')
    conversationFile.write.mockReset().mockResolvedValue('conversation.md')
    electronMocks.writeText.mockReset()
    electronMocks.requestClose.mockReset()
    electronMocks.respondToClose.mockReset()
    electronMocks.updatePhase.mockReset().mockReturnValue({ status: 'idle' })
    electronMocks.installUpdate.mockReset()
    fonts.list.mockReset().mockResolvedValue([])
  })

  afterEach(() => { vi.useRealTimers() })

  it('accepts only validated close decisions from the trusted renderer', async () => {
    vi.useFakeTimers()
    register({ isBusy: () => false, importPaths: async () => null, cancel: () => undefined })
    const handler = electronMocks.handlers.get(IPC_CHANNELS.appCloseReady)!
    const response = { requestId: 2, approved: false }
    await handler(trustedEvent(), response)
    expect(electronMocks.respondToClose).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    expect(electronMocks.respondToClose).toHaveBeenCalledExactlyOnceWith(response)
    for (const value of [undefined, { approved: true }, { requestId: 0, approved: true }, { requestId: 2, approved: 'yes' }, { ...response, ignored: true }]) {
      await expect(handler(trustedEvent(), value)).rejects.toThrow('[INVALID_INPUT]')
    }
    await expect(handler({ sender: { id: 99 }, senderFrame: null }, response)).rejects.toThrow('[UNTRUSTED_SENDER]')
    await vi.runAllTimersAsync()
    expect(electronMocks.respondToClose).toHaveBeenCalledOnce()
  })

  it('runs update installation only after the same save-before-close guard approves it', async () => {
    register({ isBusy: () => false, importPaths: async () => null, cancel: () => undefined })
    const handler = electronMocks.handlers.get(IPC_CHANNELS.appUpdateInstall)!
    await handler(trustedEvent())
    expect(electronMocks.requestClose).not.toHaveBeenCalled()
    electronMocks.updatePhase.mockReturnValue({ status: 'downloaded' })
    electronMocks.installUpdate.mockReturnValue(true)
    await handler(trustedEvent())
    expect(electronMocks.requestClose).toHaveBeenCalledOnce()
    expect(electronMocks.installUpdate).not.toHaveBeenCalled()
    const cancel = vi.fn()
    expect(electronMocks.requestClose.mock.calls[0][0](cancel)).toBe(true)
    expect(electronMocks.installUpdate).toHaveBeenCalledExactlyOnceWith(cancel)
  })

  it('reports an installer failure so the close guard can restore the workspace', async () => {
    register({ isBusy: () => false, importPaths: async () => null, cancel: () => undefined })
    electronMocks.updatePhase.mockReturnValue({ status: 'downloaded' })
    electronMocks.installUpdate.mockReturnValue(false)
    await electronMocks.handlers.get(IPC_CHANNELS.appUpdateInstall)!(trustedEvent())
    expect(electronMocks.requestClose.mock.calls[0][0]()).toBe(false)
  })

  it('validates conversation copy independently of OCR and rejects forged senders', async () => {
    register({ isBusy: () => false, importPaths: async () => null, cancel: () => undefined })
    const handler = electronMocks.handlers.get(IPC_CHANNELS.conversationMarkdownCopy)!
    await handler(trustedEvent(), 'x'.repeat(CONVERSATION_COPY_MAX_LENGTH))
    expect(electronMocks.writeText).toHaveBeenCalledOnce()
    await expect(handler(trustedEvent(), 'x'.repeat(CONVERSATION_COPY_MAX_LENGTH + 1))).rejects.toThrow('[INVALID_INPUT]')
    await expect(handler(trustedEvent(), 'before\0after')).rejects.toThrow('[INVALID_INPUT]')
    await expect(handler(trustedEvent(), { markdown: 'forged' })).rejects.toThrow('[INVALID_INPUT]')
    const frame = { url: 'llm-reader://app/index.html' }
    await expect(handler({ sender: { id: 99, mainFrame: frame }, senderFrame: frame }, 'forged')).rejects.toThrow('UNTRUSTED_SENDER')
    await expect(handler({ ...trustedEvent() as object, senderFrame: { url: 'llm-reader://app/book.html' } }, 'forged')).rejects.toThrow('UNTRUSTED_SENDER')
    expect(electronMocks.writeText).toHaveBeenCalledOnce()
  })

  it('exports only validated Markdown to a native-dialog destination and treats cancellation neutrally', async () => {
    register({ isBusy: () => false, importPaths: async () => null, cancel: () => undefined })
    const handler = electronMocks.handlers.get(IPC_CHANNELS.conversationMarkdownExport)!
    const input = { title: '当前会话', markdown: 'x'.repeat(CONVERSATION_EXPORT_MAX_LENGTH) }
    await expect(handler(trustedEvent(), input)).resolves.toEqual({ canceled: true })
    expect(conversationFile.write).not.toHaveBeenCalled()
    electronMocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:/chosen/conversation.md' })
    await expect(handler(trustedEvent(), input)).resolves.toEqual({ canceled: false, fileName: 'conversation.md' })
    expect(conversationFile.write).toHaveBeenCalledExactlyOnceWith('C:/chosen/conversation.md', input.markdown)
    const dialogs = electronMocks.showSaveDialog.mock.calls.length
    await expect(handler(trustedEvent(), { ...input, markdown: 'x'.repeat(CONVERSATION_EXPORT_MAX_LENGTH + 1) })).rejects.toThrow('INVALID_INPUT')
    await expect(handler(trustedEvent(), { ...input, filePath: 'C:/forged.md' })).rejects.toThrow('INVALID_INPUT')
    await expect(handler({ sender: { id: 99 } }, input)).rejects.toThrow('UNTRUSTED_SENDER')
    await expect(handler({ ...trustedEvent() as object, senderFrame: { url: 'llm-reader://app/book.html' } }, input)).rejects.toThrow('UNTRUSTED_SENDER')
    expect(electronMocks.showSaveDialog).toHaveBeenCalledTimes(dialogs)
    conversationFile.write.mockRejectedValueOnce(new Error('private-path-and-content'))
    await expect(handler(trustedEvent(), { title: 'small', markdown: '# 保留' })).rejects.not.toThrow('private-path-and-content')
  })

  it('writes bounded text to the clipboard only from the trusted main frame', async () => {
    register({ isBusy: () => false, importPaths: async () => null, cancel: () => undefined })
    const handler = electronMocks.handlers.get(IPC_CHANNELS.clipboardWriteText)!
    const text = '# 原文\n\n**逐字复制**'
    await handler(trustedEvent(), text)
    expect(electronMocks.writeText).toHaveBeenCalledWith(text)
    await expect(handler(trustedEvent(), 'x'.repeat(40_001))).rejects.toThrow('[INVALID_INPUT]')
    await expect(handler(trustedEvent(), { text })).rejects.toThrow('[INVALID_INPUT]')
    const frame = { url: 'llm-reader://app/index.html' }
    await expect(handler({ sender: { id: 99, mainFrame: frame }, senderFrame: frame }, text)).rejects.toThrow('[UNTRUSTED_SENDER]')
    const childFrame = { url: 'llm-reader://app/book.html' }
    await expect(handler({ ...trustedEvent() as object, senderFrame: childFrame }, text)).rejects.toThrow('[UNTRUSTED_SENDER]')
    expect(electronMocks.writeText).toHaveBeenCalledTimes(1)
  })

  it('opens the native picker with multi-selection and forwards the ordered paths', async () => {
    const paths = ['C:\\books\\first.epub', 'C:\\books\\second.txt']
    const batch = { total: 2, processed: 2, imported: 2, duplicates: 0, failed: 0, skipped: 0, canceled: false, items: [] }
    const bookImporter = {
      isBusy: vi.fn(() => false),
      importPaths: vi.fn(async () => batch),
      cancel: vi.fn()
    }
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: paths })
    register(bookImporter)

    await expect(electronMocks.handlers.get(IPC_CHANNELS.booksImport)?.(trustedEvent())).resolves.toEqual(batch)

    expect(electronMocks.showOpenDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ properties: ['openFile', 'multiSelections'] })
    )
    expect(bookImporter.importPaths).toHaveBeenCalledWith(paths)
  })

  it('rejects empty or forged dropped-path invocations before import', async () => {
    const bookImporter = {
      isBusy: vi.fn(() => false),
      importPaths: vi.fn(async () => null),
      cancel: vi.fn()
    }
    register(bookImporter)
    const handler = electronMocks.handlers.get(IPC_CHANNELS.booksImportDropped)

    await expect(handler?.(trustedEvent(), [])).rejects.toThrow('[INVALID_INPUT]')
    await expect(handler?.(trustedEvent(), [''])).rejects.toThrow('[INVALID_INPUT]')

    const forgedFrame = { url: 'llm-reader://app/index.html' }
    const forgedEvent = { sender: { id: 99, mainFrame: forgedFrame }, senderFrame: forgedFrame }
    await expect(handler?.(forgedEvent, ['C:\\books\\forged.epub'])).rejects.toThrow('[UNTRUSTED_SENDER]')
    expect(bookImporter.importPaths).not.toHaveBeenCalled()
  })

  it('reports the batch-size limit before parsing oversized imports', async () => {
    const oversized = Array.from({ length: 301 }, (_, index) => `C:\\books\\book-${index}.epub`)
    const bookImporter = {
      isBusy: vi.fn(() => false),
      importPaths: vi.fn(async () => null),
      cancel: vi.fn()
    }
    register(bookImporter)

    electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: oversized })
    const picker = electronMocks.handlers.get(IPC_CHANNELS.booksImport)
    await expect(picker?.(trustedEvent())).rejects.toThrow('[IMPORT_BATCH_TOO_LARGE]')

    const dropped = electronMocks.handlers.get(IPC_CHANNELS.booksImportDropped)
    await expect(dropped?.(trustedEvent(), oversized)).rejects.toThrow('[IMPORT_BATCH_TOO_LARGE]')

    expect(bookImporter.importPaths).not.toHaveBeenCalled()
  })

  it('forwards cancel only from the trusted renderer', async () => {
    const bookImporter = {
      isBusy: vi.fn(() => true),
      importPaths: vi.fn(async () => null),
      cancel: vi.fn()
    }
    register(bookImporter)
    const handler = electronMocks.handlers.get(IPC_CHANNELS.booksImportCancel)

    await expect(handler?.(trustedEvent())).resolves.toBeUndefined()
    expect(bookImporter.cancel).toHaveBeenCalledOnce()
  })

  it('accepts visual requests only for an existing PDF book after validating the image and rectangle', async () => {
    const bookId = randomUUID()
    const bounds = { pageNumber: 1, left: 0.1, top: 0.2, right: 0.7, bottom: 0.8 }
    const request = { requestId: randomUUID(), conversationId: randomUUID(), scope: 'visual', action: 'ask',
      question: '这里是什么？', history: [], imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      selection: { kind: 'pdf-image-region', bookId, ...bounds, anchor: pdfImageRegionAnchor(bounds) } }
    const start = vi.fn()
    const listBooks = vi.fn(() => [{ id: bookId, format: 'txt' }])
    register({ isBusy: () => false, importPaths: async () => null, cancel: () => undefined },
      { library: { listBooks }, llm: { start } })
    const handler = electronMocks.handlers.get(IPC_CHANNELS.llmStart)!
    await expect(handler(trustedEvent(), request)).rejects.toThrow('[BOOK_NOT_FOUND]')
    expect(start).not.toHaveBeenCalled()
    listBooks.mockReturnValue([{ id: bookId, format: 'pdf' }])
    await expect(handler(trustedEvent(), { ...request, imageDataUrl: 'data:text/plain;base64,QQ==' })).rejects.toThrow('[INVALID_INPUT]')
    await expect(handler(trustedEvent(), { ...request, selection: { ...request.selection, right: 1.2 } })).rejects.toThrow('[INVALID_INPUT]')
    await expect(handler(trustedEvent(), request)).resolves.toBeUndefined()
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ scope: 'visual', imageDataUrl: request.imageDataUrl }), expect.any(Function))
  })
})
