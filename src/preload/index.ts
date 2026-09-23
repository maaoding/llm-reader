import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IPC_CHANNELS,
  type BookExtractionApi,
  type AppUpdatePhase,
  type BookImportEvent,
  type LlmEvent,
  type ReaderApi
} from '@shared/contracts'

export const readerApi: ReaderApi = {
  copyText: (text) => ipcRenderer.invoke(IPC_CHANNELS.clipboardWriteText, text),
  getBookOcrPage: (input) => ipcRenderer.invoke(IPC_CHANNELS.documentOcrPage, input),
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
  getBookSession: (bookId) => ipcRenderer.invoke(IPC_CHANNELS.sessionsGet, bookId),
  listRecentBookSessions: (bookId) => ipcRenderer.invoke(IPC_CHANNELS.sessionsRecent, bookId),
  getRecentBookSession: (input) => ipcRenderer.invoke(IPC_CHANNELS.sessionsReadRecent, input),
  saveBookSession: (input) => ipcRenderer.invoke(IPC_CHANNELS.sessionsSave, input),
  deleteBookSession: (bookId, conversationId) => ipcRenderer.invoke(IPC_CHANNELS.sessionsDelete, conversationId ? { bookId, conversationId } : bookId),
  listSessionTabs: () => ipcRenderer.invoke(IPC_CHANNELS.sessionTabsList),
  saveSessionTabs: (input) => ipcRenderer.invoke(IPC_CHANNELS.sessionTabsSave, input),
  getProviderOverview: () => ipcRenderer.invoke(IPC_CHANNELS.providerOverview),
  createProviderProfile: (input) => ipcRenderer.invoke(IPC_CHANNELS.providerCreate, input),
  updateProviderProfile: (input) => ipcRenderer.invoke(IPC_CHANNELS.providerUpdate, input),
  activateProviderProfile: (id) => ipcRenderer.invoke(IPC_CHANNELS.providerActivate, id),
  deleteProviderProfile: (id) => ipcRenderer.invoke(IPC_CHANNELS.providerDelete, id),
  testProvider: () => ipcRenderer.invoke(IPC_CHANNELS.providerTest),
  testProviderConfiguration: (input) => ipcRenderer.invoke(IPC_CHANNELS.providerTestConfiguration, input),
  listProviderModels: (input) => ipcRenderer.invoke(IPC_CHANNELS.providerModels, input),
  listSystemFonts: () => ipcRenderer.invoke(IPC_CHANNELS.fontsList),
  getKnowledgeSettings: () => ipcRenderer.invoke(IPC_CHANNELS.knowledgeGet),
  saveKnowledgeSettings: (input) => ipcRenderer.invoke(IPC_CHANNELS.knowledgeSave, input),
  testKnowledgeSettings: (input) => ipcRenderer.invoke(IPC_CHANNELS.knowledgeTest, input),
  startSemanticIndex: (input) => ipcRenderer.invoke(IPC_CHANNELS.semanticStart, input),
  cancelSemanticIndex: (bookId) => ipcRenderer.invoke(IPC_CHANNELS.semanticCancel, bookId),
  startLlm: (request) => ipcRenderer.invoke(IPC_CHANNELS.llmStart, request),
  getBookAnalysis: (bookId) => ipcRenderer.invoke(IPC_CHANNELS.analysisGet, bookId),
  getBookNotesIndex: (bookId) => ipcRenderer.invoke(IPC_CHANNELS.notesIndex, bookId),
  getBookChapterNotes: (input) => ipcRenderer.invoke(IPC_CHANNELS.notesChapter, input),
  prepareBookDocument: (input) => ipcRenderer.invoke(IPC_CHANNELS.documentPrepare, input),
  cancelBookDocument: (bookId) => ipcRenderer.invoke(IPC_CHANNELS.documentCancel, bookId),
  searchBookDocument: (input) => ipcRenderer.invoke(IPC_CHANNELS.documentSearch, input),
  previewBookPage: (input) => ipcRenderer.invoke(IPC_CHANNELS.documentPreview, input),
  cancelBookPagePreview: (requestId) => ipcRenderer.invoke(IPC_CHANNELS.documentPreviewCancel, requestId),
  startBookAnalysis: (input) => ipcRenderer.invoke(IPC_CHANNELS.analysisStart, input),
  cancelBookAnalysis: (bookId) => ipcRenderer.invoke(IPC_CHANNELS.analysisCancel, bookId),
  onBookAnalysisEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]): void => listener(state)
    ipcRenderer.on(IPC_CHANNELS.analysisEvent, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.analysisEvent, handler)
  },
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

if (process.argv.includes('--llm-reader-extraction')) {
  const api: BookExtractionApi = {
    processPdf: (input) => ipcRenderer.invoke(IPC_CHANNELS.analysisPdf, input),
    submitPdfPage: (input) => ipcRenderer.invoke(IPC_CHANNELS.analysisPdfPageResult, input),
    onPdfPageRequest: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, input: Parameters<typeof listener>[0]): void => listener(input)
      ipcRenderer.on(IPC_CHANNELS.analysisPdfPageRequest, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.analysisPdfPageRequest, handler)
    },
    read: () => ipcRenderer.invoke(IPC_CHANNELS.analysisRead),
    append: (input) => ipcRenderer.invoke(IPC_CHANNELS.analysisAppend, input),
    finish: (input) => ipcRenderer.invoke(IPC_CHANNELS.analysisFinish, input),
    fail: (input) => ipcRenderer.invoke(IPC_CHANNELS.analysisFail, input)
  }
  contextBridge.exposeInMainWorld('bookExtractor', api)
} else {
  contextBridge.exposeInMainWorld('readerApi', readerApi)
}
