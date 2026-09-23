import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../src/shared/contracts'

type InvokeHandler = (event: unknown, ...values: unknown[]) => Promise<unknown>

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, InvokeHandler>(),
  removeHandler: vi.fn(),
  showOpenDialog: vi.fn(),
  writeText: vi.fn(),
  getVersion: vi.fn(() => '0.3.0')
}))

vi.mock('electron', () => ({
  app: { getVersion: electronMocks.getVersion },
  clipboard: { writeText: electronMocks.writeText },
  dialog: { showOpenDialog: electronMocks.showOpenDialog, showSaveDialog: vi.fn() },
  ipcMain: {
    removeHandler: electronMocks.removeHandler,
    handle: vi.fn((channel: string, handler: InvokeHandler) => electronMocks.handlers.set(channel, handler))
  }
}))

import { registerIpcHandlers } from '../../src/main/ipc'

function trustedEvent(): unknown {
  const frame = { url: 'llm-reader://app/index.html' }
  const sender = { id: 17, mainFrame: frame, isDestroyed: () => false }
  return { sender, senderFrame: frame }
}

function register(bookImporter: {
  isBusy: () => boolean
  importPaths: (paths: ReadonlyArray<string>) => Promise<unknown>
  cancel: () => void
}): void {
  registerIpcHandlers({
    window: {
      webContents: { id: 17 },
      minimize: vi.fn(),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      isMaximized: vi.fn(() => false),
      close: vi.fn()
    },
    library: {},
    bookImporter,
    provider: {},
    llm: {},
    updater: {},
    allowedRendererOrigins: new Set<string>(),
    completeClose: vi.fn()
  } as unknown as Parameters<typeof registerIpcHandlers>[0])
}

describe('book import IPC', () => {
  beforeEach(() => {
    electronMocks.handlers.clear()
    electronMocks.removeHandler.mockClear()
    electronMocks.showOpenDialog.mockReset()
    electronMocks.writeText.mockReset()
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
})
