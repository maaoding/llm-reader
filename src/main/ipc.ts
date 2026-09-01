import { app, dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { ZodError, type ZodType } from 'zod'
import { IPC_CHANNELS, type LlmEvent } from '@shared/contracts'
import { copy } from '@shared/copy'
import { BookImportCoordinator, MAX_BOOK_IMPORT_BATCH } from './book-import-coordinator'
import { AppError, toPublicError } from './errors'
import { listSystemFonts } from './fonts'
import { LibraryService } from './library-service'
import { LlmService } from './llm-service'
import { ProviderService } from './provider-service'
import { UpdaterService } from './updater-service'
import {
  bookIdSchema,
  bookImportPathsSchema,
  createProviderProfileSchema,
  highlightIdSchema,
  highlightSchema,
  insightExportScopeSchema,
  insightHistorySchema,
  insightIdSchema,
  insightSchema,
  llmRequestSchema,
  metadataSchema,
  progressSchema,
  providerConfigurationSchema,
  providerModelListSchema,
  providerProfileIdSchema,
  requestIdSchema,
  updateProviderProfileSchema
} from './schemas'

interface IpcDependencies {
  window: BrowserWindow
  library: LibraryService
  bookImporter: BookImportCoordinator
  provider: ProviderService
  llm: LlmService
  updater: UpdaterService
  allowedRendererOrigins: ReadonlySet<string>
  completeClose: () => void
}

let bookImportDialogOpen = false

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

function parseBatchPaths(value: unknown): string[] {
  if (Array.isArray(value) && value.length > MAX_BOOK_IMPORT_BATCH) {
    throw new AppError('IMPORT_BATCH_TOO_LARGE', copy('error.importBatchTooLarge'))
  }
  return parse(bookImportPathsSchema, value)
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
  handle(IPC_CHANNELS.appUpdatePhase, dependencies, () => dependencies.updater.getPhase())
  handle(IPC_CHANNELS.appUpdateCheck, dependencies, () => dependencies.updater.check('manual'))
  handle(IPC_CHANNELS.appUpdateDownload, dependencies, () => dependencies.updater.download())
  handle(IPC_CHANNELS.appUpdateInstall, dependencies, () => dependencies.updater.install())
  handle(IPC_CHANNELS.booksList, dependencies, () => dependencies.library.listBooks())
  handle(IPC_CHANNELS.booksImport, dependencies, async () => {
    if (bookImportDialogOpen || dependencies.bookImporter.isBusy()) {
      throw new AppError('IMPORT_BUSY', copy('error.importBusy'))
    }
    bookImportDialogOpen = true
    try {
      const result = await dialog.showOpenDialog(dependencies.window, {
        title: copy('dialog.importTitle'),
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: copy('dialog.importFilter'), extensions: ['epub', 'txt', 'pdf', 'mobi', 'azw3'] }]
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return dependencies.bookImporter.importPaths(parseBatchPaths(result.filePaths))
    } finally {
      bookImportDialogOpen = false
    }
  })
  handle(IPC_CHANNELS.booksImportDropped, dependencies, (_event, value) => {
    if (bookImportDialogOpen) throw new AppError('IMPORT_BUSY', copy('error.importBusy'))
    return dependencies.bookImporter.importPaths(parseBatchPaths(value))
  })
  handle(IPC_CHANNELS.booksImportCancel, dependencies, () => {
    dependencies.bookImporter.cancel()
  })
  handle(IPC_CHANNELS.booksRead, dependencies, (_event, value) =>
    dependencies.library.readBook(parse(bookIdSchema, value))
  )
  handle(IPC_CHANNELS.booksDelete, dependencies, (_event, value) =>
    dependencies.library.deleteBook(parse(bookIdSchema, value))
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
  handle(IPC_CHANNELS.insightsListAll, dependencies, () =>
    dependencies.library.listAllInsights()
  )
  handle(IPC_CHANNELS.insightsExport, dependencies, async (_event, value) => {
    const scope = parse(insightExportScopeSchema, value)
    const result = await dialog.showSaveDialog(dependencies.window, {
      title: copy('dialog.exportTitle'),
      defaultPath: dependencies.library.insightExportDefaultName(scope),
      filters: [{ name: copy('dialog.exportFilter'), extensions: ['md'] }]
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    const fileName = await dependencies.library.exportInsights(scope, result.filePath)
    return { canceled: false, fileName }
  })
  handle(IPC_CHANNELS.insightsSave, dependencies, (_event, value) =>
    dependencies.library.saveInsight(parse(insightSchema, value))
  )
  handle(IPC_CHANNELS.insightsDelete, dependencies, (_event, value) =>
    dependencies.library.deleteInsight(parse(insightIdSchema, value))
  )
  handle(IPC_CHANNELS.insightsUpdateHistory, dependencies, (_event, value) =>
    dependencies.library.updateInsightHistory(parse(insightHistorySchema, value))
  )
  handle(IPC_CHANNELS.providerOverview, dependencies, () => dependencies.provider.getOverview())
  handle(IPC_CHANNELS.providerCreate, dependencies, (_event, value) =>
    dependencies.provider.createProfile(parse(createProviderProfileSchema, value))
  )
  handle(IPC_CHANNELS.providerUpdate, dependencies, (_event, value) =>
    dependencies.provider.updateProfile(parse(updateProviderProfileSchema, value))
  )
  handle(IPC_CHANNELS.providerActivate, dependencies, (_event, value) =>
    dependencies.provider.activateProfile(parse(providerProfileIdSchema, value))
  )
  handle(IPC_CHANNELS.providerDelete, dependencies, (_event, value) =>
    dependencies.provider.deleteProfile(parse(providerProfileIdSchema, value))
  )
  handle(IPC_CHANNELS.providerTest, dependencies, () => dependencies.provider.testConnection())
  handle(IPC_CHANNELS.providerTestConfiguration, dependencies, (_event, value) =>
    dependencies.provider.testConfiguration(parse(providerConfigurationSchema, value))
  )
  handle(IPC_CHANNELS.providerModels, dependencies, (_event, value) =>
    dependencies.provider.listModels(parse(providerModelListSchema, value))
  )
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
  bookImportDialogOpen = false
  Object.values(IPC_CHANNELS)
    .filter(
      (channel) =>
        channel !== IPC_CHANNELS.llmEvent &&
        channel !== IPC_CHANNELS.appBeforeClose &&
        channel !== IPC_CHANNELS.appUpdateEvent &&
        channel !== IPC_CHANNELS.booksImportEvent &&
        channel !== IPC_CHANNELS.windowMaximizedChange
    )
    .forEach((channel) => ipcMain.removeHandler(channel))
}

export { AppError }
