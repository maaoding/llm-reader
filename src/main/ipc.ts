import { app, dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { ZodError, type ZodType } from 'zod'
import { IPC_CHANNELS, type LlmEvent } from '@shared/contracts'
import { copy } from '@shared/copy'
import { AppError, toPublicError } from './errors'
import { listSystemFonts } from './fonts'
import { LibraryService } from './library-service'
import { LlmService } from './llm-service'
import { ProviderService } from './provider-service'
import {
  bookIdSchema,
  highlightIdSchema,
  highlightSchema,
  insightHistorySchema,
  insightIdSchema,
  insightSchema,
  llmRequestSchema,
  metadataSchema,
  progressSchema,
  providerSettingsSchema,
  requestIdSchema
} from './schemas'

interface IpcDependencies {
  window: BrowserWindow
  library: LibraryService
  provider: ProviderService
  llm: LlmService
  allowedRendererOrigins: ReadonlySet<string>
  completeClose: () => void
}

function trustedSender(event: IpcMainInvokeEvent, dependencies: IpcDependencies): boolean {
  if (event.sender.id !== dependencies.window.webContents.id) return false
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false
  try {
    const url = new URL(event.senderFrame.url)
    return (
      (url.protocol === 'llm-reader:' && url.hostname === 'app') ||
      dependencies.allowedRendererOrigins.has(url.origin)
    )
  } catch {
    return false
  }
}

function parse<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value)
}

function safeIpcError(error: unknown): Error {
  if (error instanceof ZodError) {
    return new Error(`[INVALID_INPUT] ${copy('error.invalidInput')}`)
  }
  const safe = toPublicError(error)
  return new Error(`[${safe.code}] ${safe.message}`)
}

function handle(
  channel: string,
  dependencies: IpcDependencies,
  callback: (event: IpcMainInvokeEvent, ...values: unknown[]) => unknown
): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, async (event, ...values) => {
    if (!trustedSender(event, dependencies)) {
      throw new Error(`[UNTRUSTED_SENDER] ${copy('error.untrustedSender')}`)
    }
    try {
      return await callback(event, ...values)
    } catch (error) {
      throw safeIpcError(error)
    }
  })
}

export function registerIpcHandlers(dependencies: IpcDependencies): void {
  handle(IPC_CHANNELS.appInfo, dependencies, () => ({ version: app.getVersion() }))
  handle(IPC_CHANNELS.booksList, dependencies, () => dependencies.library.listBooks())
  handle(IPC_CHANNELS.booksImport, dependencies, async () => {
    const result = await dialog.showOpenDialog(dependencies.window, {
      title: copy('dialog.importTitle'),
      properties: ['openFile'],
      filters: [{ name: copy('dialog.importFilter'), extensions: ['epub', 'txt'] }]
    })
    if (result.canceled || result.filePaths.length !== 1) return null
    return dependencies.library.importFromPath(result.filePaths[0])
  })
  handle(IPC_CHANNELS.booksRead, dependencies, (_event, value) =>
    dependencies.library.readBook(parse(bookIdSchema, value))
  )
  handle(IPC_CHANNELS.booksCover, dependencies, (_event, value) =>
    dependencies.library.getBookCover(parse(bookIdSchema, value))
  )
  handle(IPC_CHANNELS.booksDetails, dependencies, (_event, value) =>
    dependencies.library.getBookDetails(parse(bookIdSchema, value))
  )
  handle(IPC_CHANNELS.booksUpdateMetadata, dependencies, (_event, ...values) => {
    const input = parse(metadataSchema, { bookId: values[0], title: values[1], author: values[2] })
    return dependencies.library.updateBookMetadata(input.bookId, input.title, input.author)
  })
  handle(IPC_CHANNELS.booksUpdateProgress, dependencies, (_event, ...values) => {
    const input = parse(progressSchema, { bookId: values[0], locator: values[1], progress: values[2] })
    dependencies.library.updateBookProgress(input.bookId, input.locator, input.progress)
  })
  handle(IPC_CHANNELS.highlightsList, dependencies, (_event, value) =>
    dependencies.library.listHighlights(parse(bookIdSchema, value))
  )
  handle(IPC_CHANNELS.highlightsSave, dependencies, (_event, value) =>
    dependencies.library.saveHighlight(parse(highlightSchema, value))
  )
  handle(IPC_CHANNELS.highlightsDelete, dependencies, (_event, value) =>
    dependencies.library.deleteHighlight(parse(highlightIdSchema, value))
  )
  handle(IPC_CHANNELS.insightsList, dependencies, (_event, value) =>
    dependencies.library.listInsights(parse(bookIdSchema, value))
  )
  handle(IPC_CHANNELS.insightsSave, dependencies, (_event, value) =>
    dependencies.library.saveInsight(parse(insightSchema, value))
  )
  handle(IPC_CHANNELS.insightsDelete, dependencies, (_event, value) =>
    dependencies.library.deleteInsight(parse(insightIdSchema, value))
  )
  handle(IPC_CHANNELS.insightsUpdateHistory, dependencies, (_event, value) =>
    dependencies.library.updateInsightHistory(parse(insightHistorySchema, value))
  )
  handle(IPC_CHANNELS.providerGet, dependencies, () => dependencies.provider.getSettings())
  handle(IPC_CHANNELS.providerSave, dependencies, (_event, value) =>
    dependencies.provider.saveSettings(parse(providerSettingsSchema, value))
  )
  handle(IPC_CHANNELS.providerTest, dependencies, () => dependencies.provider.testConnection())
  handle(IPC_CHANNELS.fontsList, dependencies, () => listSystemFonts())
  handle(IPC_CHANNELS.llmStart, dependencies, (event, value) => {
    const request = parse(llmRequestSchema, value)
    const emit = (llmEvent: LlmEvent): void => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.llmEvent, llmEvent)
    }
    dependencies.llm.start(request, emit)
  })
  handle(IPC_CHANNELS.llmCancel, dependencies, (_event, value) => {
    dependencies.llm.cancel(parse(requestIdSchema, value))
  })
  handle(IPC_CHANNELS.windowMinimize, dependencies, () => {
    dependencies.window.minimize()
  })
  handle(IPC_CHANNELS.windowToggleMaximize, dependencies, () => {
    if (dependencies.window.isMaximized()) {
      dependencies.window.unmaximize()
    } else {
      dependencies.window.maximize()
    }
  })
  handle(IPC_CHANNELS.windowClose, dependencies, () => {
    dependencies.window.close()
  })
  handle(IPC_CHANNELS.windowIsMaximized, dependencies, () => dependencies.window.isMaximized())
  handle(IPC_CHANNELS.appCloseReady, dependencies, () => {
    setTimeout(dependencies.completeClose, 0)
  })
}

export function unregisterIpcHandlers(): void {
  Object.values(IPC_CHANNELS)
    .filter(
      (channel) =>
        channel !== IPC_CHANNELS.llmEvent &&
        channel !== IPC_CHANNELS.appBeforeClose &&
        channel !== IPC_CHANNELS.windowMaximizedChange
    )
    .forEach((channel) => ipcMain.removeHandler(channel))
}

export { AppError }
