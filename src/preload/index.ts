import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IPC_CHANNELS,
  type AppUpdatePhase,
  type BookImportEvent,
  type LlmEvent,
  type ReaderApi
} from '@shared/contracts'

export const readerApi: ReaderApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.appInfo),
  getAppUpdatePhase: () => ipcRenderer.invoke(IPC_CHANNELS.appUpdatePhase),
  checkForAppUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.appUpdateCheck),
  downloadAppUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.appUpdateDownload),
  installAppUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.appUpdateInstall),
  onAppUpdateEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void =>
      listener(value as AppUpdatePhase)
    ipcRenderer.on(IPC_CHANNELS.appUpdateEvent, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.appUpdateEvent, handler)
  },
  listBooks: () => ipcRenderer.invoke(IPC_CHANNELS.booksList),
  importBooks: () => ipcRenderer.invoke(IPC_CHANNELS.booksImport),
  importDroppedBooks: (files) =>
    ipcRenderer.invoke(IPC_CHANNELS.booksImportDropped, files.map((file) => webUtils.getPathForFile(file))),
  cancelBookImport: () => ipcRenderer.invoke(IPC_CHANNELS.booksImportCancel),
  onBookImportEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void =>
      listener(value as BookImportEvent)
    ipcRenderer.on(IPC_CHANNELS.booksImportEvent, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.booksImportEvent, handler)
  },
  deleteBook: (bookId) => ipcRenderer.invoke(IPC_CHANNELS.booksDelete, bookId),
  readBook: (bookId) => ipcRenderer.invoke(IPC_CHANNELS.booksRead, bookId),
  getBookCover: (bookId) => ipcRenderer.invoke(IPC_CHANNELS.booksCover, bookId),
  getBookDetails: (bookId) => ipcRenderer.invoke(IPC_CHANNELS.booksDetails, bookId),
  updateBookMetadata: (bookId, title, author) =>
    ipcRenderer.invoke(IPC_CHANNELS.booksUpdateMetadata, bookId, title, author),
  updateBookProgress: (bookId, locator, progress) =>
    ipcRenderer.invoke(IPC_CHANNELS.booksUpdateProgress, bookId, locator, progress),
  listHighlights: (bookId) => ipcRenderer.invoke(IPC_CHANNELS.highlightsList, bookId),
  saveHighlight: (input) => ipcRenderer.invoke(IPC_CHANNELS.highlightsSave, input),
  deleteHighlight: (id) => ipcRenderer.invoke(IPC_CHANNELS.highlightsDelete, id),
  listInsights: (bookId) => ipcRenderer.invoke(IPC_CHANNELS.insightsList, bookId),
  listAllInsights: () => ipcRenderer.invoke(IPC_CHANNELS.insightsListAll),
  exportInsights: (scope) => ipcRenderer.invoke(IPC_CHANNELS.insightsExport, scope),
  saveInsight: (input) => ipcRenderer.invoke(IPC_CHANNELS.insightsSave, input),
  deleteInsight: (id) => ipcRenderer.invoke(IPC_CHANNELS.insightsDelete, id),
  updateInsightHistory: (input) => ipcRenderer.invoke(IPC_CHANNELS.insightsUpdateHistory, input),
  getProviderOverview: () => ipcRenderer.invoke(IPC_CHANNELS.providerOverview),
  createProviderProfile: (input) => ipcRenderer.invoke(IPC_CHANNELS.providerCreate, input),
  updateProviderProfile: (input) => ipcRenderer.invoke(IPC_CHANNELS.providerUpdate, input),
  activateProviderProfile: (id) => ipcRenderer.invoke(IPC_CHANNELS.providerActivate, id),
  deleteProviderProfile: (id) => ipcRenderer.invoke(IPC_CHANNELS.providerDelete, id),
  testProvider: () => ipcRenderer.invoke(IPC_CHANNELS.providerTest),
  testProviderConfiguration: (input) => ipcRenderer.invoke(IPC_CHANNELS.providerTestConfiguration, input),
  listProviderModels: (input) => ipcRenderer.invoke(IPC_CHANNELS.providerModels, input),
  listSystemFonts: () => ipcRenderer.invoke(IPC_CHANNELS.fontsList),
  startLlm: (request) => ipcRenderer.invoke(IPC_CHANNELS.llmStart, request),
  cancelLlm: (requestId) => ipcRenderer.invoke(IPC_CHANNELS.llmCancel, requestId),
  onLlmEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => listener(value as LlmEvent)
    ipcRenderer.on(IPC_CHANNELS.llmEvent, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.llmEvent, handler)
  },
  onBeforeClose: (listener) => {
    const handler = (): void => {
      void Promise.resolve(listener())
        .catch(() => undefined)
        .finally(() => ipcRenderer.invoke(IPC_CHANNELS.appCloseReady).catch(() => undefined))
    }
    ipcRenderer.on(IPC_CHANNELS.appBeforeClose, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.appBeforeClose, handler)
  },
  minimizeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.windowMinimize),
  toggleMaximizeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.windowToggleMaximize),
  closeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.windowClose),
  isWindowMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.windowIsMaximized),
  onWindowMaximizedChange: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void =>
      listener(value as boolean)
    ipcRenderer.on(IPC_CHANNELS.windowMaximizedChange, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.windowMaximizedChange, handler)
  }
}

contextBridge.exposeInMainWorld('readerApi', readerApi)
