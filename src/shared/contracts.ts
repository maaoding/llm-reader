export const IPC_CHANNELS = {
  appBeforeClose: 'app:before-close',
  appCloseReady: 'app:close-ready',
  booksList: 'books:list',
  booksImport: 'books:import',
  booksRead: 'books:read',
  booksUpdateMetadata: 'books:update-metadata',
  booksCover: 'books:cover',
  booksDetails: 'books:details',
  booksUpdateProgress: 'books:update-progress',
  insightsList: 'insights:list',
  insightsSave: 'insights:save',
  insightsDelete: 'insights:delete',
  providerGet: 'provider:get',
  providerSave: 'provider:save',
  providerTest: 'provider:test',
  fontsList: 'fonts:list',
  llmStart: 'llm:start',
  llmCancel: 'llm:cancel',
  llmEvent: 'llm:event'
} as const

export type BookFormat = 'epub' | 'txt'

export interface BookRecord {
  id: string
  title: string
  author: string | null
  format: BookFormat
  originalName: string
  importedAt: string
  lastOpenedAt: string | null
  lastLocator: string | null
  progress: number
}

export interface ImportedBookResult {
  book: BookRecord
  duplicate: boolean
}

export interface BookPayload {
  book: BookRecord
  bytes: Uint8Array
}

export type BookCoverMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'

export interface BookCoverPayload {
  mimeType: BookCoverMimeType
  bytes: Uint8Array
}

export interface BookMetadata {
  language: string | null
  publisher: string | null
  publishedAt: string | null
  identifier: string | null
  description: string | null
}

export interface BookDetails {
  book: BookRecord
  fileSizeBytes: number
  metadata: BookMetadata
  cover: BookCoverPayload | null
}

export interface TocItem {
  id: string
  label: string
  href: string
  depth: number
}

export interface Passage {
  id: string
  text: string
  anchor: string
}

export interface SelectionContext {
  bookId: string
  quote: string
  anchor: string
  chapterTitle: string
  passages: Passage[]
}

export type LlmAction = 'explain' | 'context' | 'ask'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface LlmRequest {
  requestId: string
  action: LlmAction
  question: string
  selection: SelectionContext
  history: ChatMessage[]
}

export interface LlmUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export type LlmEvent =
  | { requestId: string; type: 'delta'; delta: string }
  | { requestId: string; type: 'usage'; usage: LlmUsage }
  | { requestId: string; type: 'completed'; model: string }
  | { requestId: string; type: 'error'; code: string; message: string; retryable: boolean }

export interface ProviderSettings {
  baseUrl: string
  model: string
  hasApiKey: boolean
}

export interface SaveProviderSettingsInput {
  baseUrl: string
  model: string
  apiKey?: string
}

export interface ProviderTestResult {
  ok: boolean
  message: string
}

export interface SavedInsight {
  id: string
  bookId: string
  selection: SelectionContext
  question: string
  answer: string
  model: string
  createdAt: string
}

export interface SaveInsightInput {
  bookId: string
  selection: SelectionContext
  question: string
  answer: string
  model: string
}

export interface ReaderApi {
  listBooks(): Promise<BookRecord[]>
  importBook(): Promise<ImportedBookResult | null>
  readBook(bookId: string): Promise<BookPayload>
  getBookCover(bookId: string): Promise<BookCoverPayload | null>
  getBookDetails(bookId: string): Promise<BookDetails>
  updateBookMetadata(bookId: string, title: string, author: string | null): Promise<BookRecord>
  updateBookProgress(bookId: string, locator: string, progress: number): Promise<void>
  listInsights(bookId: string): Promise<SavedInsight[]>
  saveInsight(input: SaveInsightInput): Promise<SavedInsight>
  deleteInsight(id: string): Promise<boolean>
  getProviderSettings(): Promise<ProviderSettings>
  saveProviderSettings(input: SaveProviderSettingsInput): Promise<ProviderSettings>
  testProvider(): Promise<ProviderTestResult>
  listSystemFonts(): Promise<string[]>
  startLlm(request: LlmRequest): Promise<void>
  cancelLlm(requestId: string): Promise<void>
  onLlmEvent(listener: (event: LlmEvent) => void): () => void
  onBeforeClose(listener: () => void | Promise<void>): () => void
}
