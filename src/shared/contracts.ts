import type { ReaderSearchResult } from './reader-search'

export const IPC_CHANNELS = {
  clipboardWriteText: 'clipboard:write-text',
  documentOcrPage: 'document:ocr-page',
  appBeforeClose: 'app:before-close',
  appCloseReady: 'app:close-ready',
  appInfo: 'app:info',
  appUpdatePhase: 'app:update-phase',
  appUpdateCheck: 'app:update-check',
  appUpdateDownload: 'app:update-download',
  appUpdateInstall: 'app:update-install',
  appUpdateEvent: 'app:update-event',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:is-maximized',
  windowMaximizedChange: 'window:maximized-change',
  booksList: 'books:list',
  booksImport: 'books:import',
  booksImportDropped: 'books:import-dropped',
  booksImportCancel: 'books:import-cancel',
  booksImportEvent: 'books:import-event',
  booksDelete: 'books:delete',
  booksRead: 'books:read',
  booksUpdateMetadata: 'books:update-metadata',
  booksCover: 'books:cover',
  booksDetails: 'books:details',
  booksUpdateProgress: 'books:update-progress',
  highlightsList: 'highlights:list',
  highlightsSave: 'highlights:save',
  highlightsDelete: 'highlights:delete',
  insightsList: 'insights:list',
  insightsListAll: 'insights:list-all',
  insightsSave: 'insights:save',
  insightsDelete: 'insights:delete',
  insightsUpdateHistory: 'insights:update-history',
  insightsExport: 'insights:export',
  sessionsGet: 'sessions:get',
  sessionsRecent: 'sessions:recent',
  sessionsReadRecent: 'sessions:read-recent',
  sessionsSave: 'sessions:save',
  sessionsDelete: 'sessions:delete',
  sessionTabsList: 'session-tabs:list',
  sessionTabsSave: 'session-tabs:save',
  providerOverview: 'provider:overview',
  providerCreate: 'provider:create',
  providerUpdate: 'provider:update',
  providerActivate: 'provider:activate',
  providerDelete: 'provider:delete',
  providerTest: 'provider:test',
  providerTestConfiguration: 'provider:test-configuration',
  providerModels: 'provider:models',
  fontsList: 'fonts:list',
  knowledgeGet: 'knowledge:get',
  knowledgeSave: 'knowledge:save',
  knowledgeTest: 'knowledge:test',
  semanticStart: 'semantic:start',
  semanticCancel: 'semantic:cancel',
  analysisGet: 'analysis:get',
  notesIndex: 'notes:index',
  notesChapter: 'notes:chapter',
  documentPrepare: 'document:prepare',
  documentCancel: 'document:cancel',
  documentSearch: 'document:search',
  documentPreview: 'document:preview',
  documentPreviewCancel: 'document:preview-cancel',
  analysisRead: 'analysis:read',
  analysisPdf: 'analysis:pdf',
  analysisPdfPageRequest: 'analysis:pdf-page-request',
  analysisPdfPageResult: 'analysis:pdf-page-result',
  analysisStart: 'analysis:start',
  analysisAppend: 'analysis:append',
  analysisFinish: 'analysis:finish',
  analysisCancel: 'analysis:cancel',
  analysisFail: 'analysis:fail',
  analysisEvent: 'analysis:event',
  llmStart: 'llm:start',
  llmCancel: 'llm:cancel',
  llmEvent: 'llm:event'
} as const

export type BookFormat = 'epub' | 'txt' | 'pdf'
export interface PreparedDocumentSearch {
  available: boolean
  results: ReaderSearchResult[]
}

export interface BookPagePreviewInput {
  bookId: string
  requestId: string
  pageNumber: number
  pageCount: number
  imageDataUrl: string
  force?: boolean
}

export interface BookPagePreview {
  pageNumber: number
  pageCount: number
  text: string
  cached: boolean
  processor: DocumentProcessor
  model?: string
}

export type PreparedOcrPage =
  | { status: 'unprepared' | 'unsupported' }
  | { status: 'ready'; revision: string; pageNumber: number; pageCount: number; text: string }
export type BookSourceFormat = BookFormat | 'mobi' | 'azw3'

export interface AppInfo {
  version: string
}

export type AppUpdatePhase =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'upToDate' }
  | { status: 'available'; version: string; releaseNotes: string | null }
  | { status: 'downloading'; percent: number }
  | { status: 'downloaded'; version: string; releaseNotes: string | null }
  | { status: 'error' }
  | { status: 'unsupported' }

export interface BookRecord {
  id: string
  title: string
  author: string | null
  format: BookFormat
  sourceFormat: BookSourceFormat
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

export type BookImportItemResult =
  | { status: 'imported'; fileName: string; book: BookRecord }
  | { status: 'duplicate'; fileName: string; book: BookRecord }
  | { status: 'failed'; fileName: string; code: string; message: string }

export interface BookImportBatchResult {
  total: number
  processed: number
  imported: number
  duplicates: number
  failed: number
  skipped: number
  canceled: boolean
  items: BookImportItemResult[]
}

export type BookImportEvent =
  | { type: 'started'; total: number }
  | { type: 'itemStarted'; total: number; processed: number; fileName: string }
  | {
      type: 'progress'
      total: number
      processed: number
      fileName: string
      imported: number
      duplicates: number
      failed: number
    }
  | { type: 'cancelRequested'; total: number; processed: number }
  | { type: 'completed'; result: BookImportBatchResult }

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
  chapterTitle?: string
  blockId?: string
  chapterId?: string
  /** Local evidence priority, retained across input-budget retries. */
  evidenceRole?: 'nearby' | 'chapter' | 'extension'
  nodeId?: string
  unitId?: string
  headingPath?: string[]
  sources?: SourceRange[]
  unitRange?: { start: number; end: number }
  tableSlice?: TableSlice
}

/** Character offsets use Unicode code points; PDF coordinates retain their supplied coordinate system. */
export interface SourceRange {
  anchor: string
  page?: number
  bbox?: { left: number; top: number; right: number; bottom: number; origin: 'TOPLEFT' | 'BOTTOMLEFT'; width?: number; height?: number }
  start?: number
  end?: number
  textStart?: number
  textEnd?: number
  /** A provider can locate the table but cannot identify the page of an individual row. */
  precision: 'text' | 'block' | 'table'
}
export interface DocumentNode {
  id: string
  parentId: string | null
  title: string
  level: number
  order: number
  anchor: string
  kind: 'section' | 'group'
}
export interface TableCell {
  id: string
  row: number
  column: number
  rowSpan: number
  columnSpan: number
  header: boolean
  rowHeader?: boolean
  text: string
  sources?: SourceRange[]
}
export interface DocumentTable {
  rows: number
  columns: number
  cells: TableCell[]
  captionIds: string[]
  noteIds: string[]
}
export interface TableSlice {
  rows: number[]
  cells: { id: string; start: number; end: number; textStart: number; textEnd: number; header: boolean; rows?: number[] }[]
}
export type DocumentUnitKind = 'heading' | 'paragraph' | 'list' | 'note' | 'table' | 'caption' | 'formula' | 'header' | 'footer' | 'unknown'
export interface DocumentUnit {
  id: string
  nodeId: string
  order: number
  kind: DocumentUnitKind
  text: string
  sources: SourceRange[]
  relatedIds: string[]
  table?: DocumentTable
  /** Only explicitly labelled furniture is excluded. Unknown content remains searchable. */
  searchable: boolean
}
export interface DocumentDiagnostic {
  code: 'missing-body' | 'unknown-structure' | 'unlinked-note' | 'table-degraded' | 'suspected-duplicate'
  page?: number
  unitId?: string
}
export interface NormalizedDocument {
  version: number
  nodes: DocumentNode[]
  units: DocumentUnit[]
  diagnostics: DocumentDiagnostic[]
  pageCount?: number
}
export interface BookDocumentState {
  status: 'empty' | 'preparing' | 'paused' | 'ready' | 'error'
  jobId: string
  version: number
  characters: number
  completed: number
  total: number
  message?: string
  diagnostics: DocumentDiagnostic[]
  ocrProgress?: { completed: number; total: number }
}
export interface PrepareBookDocumentInput { bookId: string; rebuild?: boolean }

export interface BookNotesIndex {
  bookId: string
  revision: string
  overview: string | null
  chapters: { id: string; title: string; headingPath: string[]; completed: number; total: number }[]
}
export interface BookChapterNotesInput { bookId: string; chapterId: string; cursor?: string }
export interface BookNotePoint {
  text: string
  sources: Passage[]
  missingSources: boolean
  term?: string
  aliases?: string[]
}
export interface BookChapterNotesPage {
  bookId: string
  chapterId: string
  revision: string
  summary: string | null
  notes: { id: string; summary: string; claims: BookNotePoint[]; conditions: BookNotePoint[]; exceptions: BookNotePoint[]; concepts: BookNotePoint[] }[]
  nextCursor?: string
}

export interface DocumentBlock extends Passage {
  kind: DocumentUnitKind
  searchable?: boolean
}

export interface DocumentSection {
  id: string
  chapterId: string
  chapterTitle: string
  order: number
  blocks: DocumentBlock[]
}

export type BookAnalysisStage = 'sections' | 'chapters' | 'overview'

export interface BookAnalysisProgress {
  stage: BookAnalysisStage
  completed: number
  total: number
  round?: number
  retryAttempt?: number
}

export interface BookAnalysisFailure {
  stage: BookAnalysisStage
  code: string
  message: string
  occurredAt: string
  attempt: number
  responseCharacters?: number
}

export interface BookAnalysisState {
  bookId: string
  jobId: string
  status: 'empty' | 'extracting' | 'analyzing' | 'paused' | 'ready' | 'error' | 'unsupported' | 'stale'
  profileId: string
  model: string
  sections: number
  completedSections: number
  characters: number
  message?: string
  usage?: LlmUsage
  progress?: BookAnalysisProgress
  failures?: BookAnalysisFailure[]
  semantic?: SemanticIndexState
  documentProcessor?: DocumentProcessor
  document?: BookDocumentState
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export interface RequestSettings {
  timeoutMs?: number
  extraBody?: Record<string, JsonValue>
  /** Public settings only expose whether encrypted headers exist. */
  hasCustomHeaders?: boolean
}
export interface RequestSettingsInput extends RequestSettings {
  /** Omit to retain headers for the same endpoint; null clears them. */
  customHeaders?: Record<string, string> | null
}
export type ProviderProtocol = 'openai' | 'anthropic'
export type DocumentProcessor = 'none' | 'mineru-local' | 'mineru-cloud' | 'docling' | 'vision' | 'mistral-ocr' | 'unstructured'
export interface EmbeddingSettings extends RequestSettings { enabled: boolean; baseUrl: string; model: string }
export interface RerankSettings extends RequestSettings { enabled: boolean; baseUrl: string; model: string }
export interface DocumentSettings extends RequestSettings {
  processor: DocumentProcessor; baseUrl: string; ocr: boolean; language: 'ch' | 'en'
  model?: string; compatibility?: ProviderCompatibility; protocol?: ProviderProtocol
}
export interface KnowledgeSettings {
  embedding: EmbeddingSettings & { hasApiKey: boolean }
  rerank: RerankSettings & { hasApiKey: boolean }
  document: DocumentSettings & { hasApiKey: boolean }
}
/** Omitted keys preserve the saved secret only when the endpoint is unchanged; null removes it. */
export interface SaveKnowledgeSettingsInput {
  embedding: EmbeddingSettings & RequestSettingsInput & { apiKey?: string | null }
  /** Older clients omit this field; preserve the existing configuration in that case. */
  rerank?: RerankSettings & RequestSettingsInput & { apiKey?: string | null }
  document: DocumentSettings & RequestSettingsInput & { apiKey?: string | null }
}
export interface TestKnowledgeSettingsInput extends SaveKnowledgeSettingsInput { target: 'embedding' | 'rerank' | 'document' }
export interface SemanticIndexState {
  status: 'disabled' | 'empty' | 'indexing' | 'paused' | 'ready' | 'error' | 'stale'
  completed: number
  total: number
  model: string
  message?: string
}
export interface StartSemanticIndexInput { bookId: string; rebuild?: boolean }

export interface StartBookAnalysisInput {
  bookId: string
  profileId: string
  rebuild?: boolean
}

export interface BookExtractionInput {
  bookId: string
  jobId: string
}

export interface BookExtractionBatch extends BookExtractionInput {
  sections: DocumentSection[]
  document?: NormalizedDocument
}

export interface BookExtractionApi {
  read(): Promise<{ input: BookExtractionInput; payload: BookPayload }>
  append(input: BookExtractionBatch): Promise<void>
  finish(input: BookExtractionInput): Promise<void>
  fail(input: BookExtractionInput): Promise<void>
  processPdf(input: BookExtractionInput & { pageCount: number }): Promise<void>
  submitPdfPage(input: PdfOcrPageRequest & { imageDataUrl: string | null }): Promise<void>
  onPdfPageRequest(listener: (input: PdfOcrPageRequest) => void): () => void
}
export interface PdfOcrPageRequest extends BookExtractionInput { pageNumber: number }

export type RerankReason = 'ranked' | 'disabled' | 'not-ready' | 'insufficient-candidates' | 'configuration' |
  'timeout' | 'rate-limit' | 'authentication' | 'server' | 'http' | 'redirect' | 'too-large' | 'invalid-response' | 'network'
export interface RerankRecord {
  status: 'applied' | 'skipped' | 'fallback'
  model: string
  candidateCount: number
  elapsedMs: number
  reason: RerankReason
}

export interface ContextSnapshot {
  scope: 'selection' | 'book'
  bookId: string
  selection: SelectionContext | null
  passages: Passage[]
  background: string
  coverage: { covered: number; total: number }
  planningUsage?: LlmUsage
  rerank?: RerankRecord
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

interface LlmRequestBase {
  requestId: string
  conversationId: string
  action: LlmAction
  question: string
  history: ChatMessage[]
}

export type LlmRequest = LlmRequestBase & (
  | { scope?: 'selection'; selection: SelectionContext }
  | { scope: 'book'; bookId: string; selection?: never }
)

export interface LlmUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export type LlmEvent =
  | { requestId: string; type: 'context'; context: ContextSnapshot }
  | { requestId: string; type: 'delta'; delta: string }
  | { requestId: string; type: 'usage'; usage: LlmUsage }
  | { requestId: string; type: 'completed'; model: string }
  | { requestId: string; type: 'error'; code: string; message: string; retryable: boolean }

export type ProviderCompatibility = 'auto' | 'opencode-go'

export interface ProviderSettings extends RequestSettings {
  baseUrl: string
  model: string
  hasApiKey: boolean
  compatibility: ProviderCompatibility
  protocol?: ProviderProtocol
}

export interface ProviderProfile extends ProviderSettings {
  id: string
  name: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface ProviderOverview {
  profiles: ProviderProfile[]
  activeProfileId: string | null
}

export interface CreateProviderProfileInput extends RequestSettingsInput {
  name: string
  baseUrl: string
  model: string
  apiKey?: string
  compatibility?: ProviderCompatibility
  protocol?: ProviderProtocol
}

export interface UpdateProviderProfileInput extends CreateProviderProfileInput {
  id: string
}

export interface ProviderConfigurationInput extends RequestSettingsInput {
  testMode?: 'text' | 'stream'
  profileId?: string
  baseUrl: string
  model: string
  apiKey?: string
  compatibility?: ProviderCompatibility
  protocol?: ProviderProtocol
}

export interface ProviderModelListInput extends RequestSettingsInput {
  profileId?: string
  baseUrl: string
  apiKey?: string
  compatibility?: ProviderCompatibility
  protocol?: ProviderProtocol
}

export interface ProviderModelList {
  models: string[]
  truncated: boolean
}

export interface ProviderTestResult {
  ok: boolean
  message: string
}

export interface ArchivedChatMessage {
  role: 'user' | 'assistant'
  content: string
  model?: string
  context?: ContextSnapshot
}

export interface SavedInsight {
  id: string
  conversationId: string
  bookId: string
  selection: SelectionContext | null
  context?: ContextSnapshot
  question: string
  answer: string
  model: string
  createdAt: string
  history: ArchivedChatMessage[]
}

export interface InsightBookRef {
  id: string
  title: string
  author: string | null
  format: BookFormat
}

export interface InsightArchiveRecord extends SavedInsight {
  book: InsightBookRef
}

export type InsightExportScope =
  | { kind: 'all' }
  | { kind: 'book'; bookId: string }
  | { kind: 'insight'; insightId: string }

export type InsightExportResult = { canceled: true } | { canceled: false; fileName: string }

export interface SaveInsightInput {
  bookId: string
  conversationId?: string
  selection: SelectionContext | null
  context?: ContextSnapshot
  question: string
  answer: string
  model: string
}

export interface UpdateInsightHistoryInput {
  bookId: string
  id: string
  history: ArchivedChatMessage[]
}

/** 临时会话中可持久化的一轮：流式中的轮次不入库，状态只保留已结束的两种。 */
export interface BookSessionTurn {
  id: string
  action: LlmAction
  actionLabel: string
  question: string
  answer: string
  model: string
  status: 'completed' | 'error'
  saved?: boolean
  error?: string
  usage?: LlmUsage
  selection?: SelectionContext | null
  context?: ContextSnapshot | null
}

/** 当前会话；最近的不同会话另行保留，切换选区不会覆盖它们。 */
export interface BookSessionRecord {
  bookId: string
  conversationId: string
  scope: 'selection' | 'book'
  selection: SelectionContext | null
  draft: string
  turns: BookSessionTurn[]
  updatedAt: string
}

export interface SaveBookSessionInput {
  bookId: string
  conversationId: string
  scope: 'selection' | 'book'
  selection: SelectionContext | null
  draft: string
  turns: BookSessionTurn[]
}

export interface BookSessionSummary {
  conversationId: string
  scope: 'selection' | 'book'
  title: string
  turnCount: number
  updatedAt: string
}

export const RECENT_BOOK_SESSION_LIMIT = 20

/** 打开的会话标签：归档标签必须带 insightId，草稿只对归档标签生效。 */
export interface SessionTabRecord {
  kind: 'live' | 'archive'
  bookId: string
  insightId: string | null
  draft: string
}

export interface SessionTabsState {
  activeIndex: number | null
  tabs: SessionTabRecord[]
}

export interface HighlightRecord {
  id: string
  bookId: string
  quote: string
  anchor: string
  chapterTitle: string
  createdAt: string
}

export interface SaveHighlightInput {
  bookId: string
  quote: string
  anchor: string
  chapterTitle: string
}

export interface ReaderApi {
  copyText(text: string): Promise<void>
  getBookOcrPage(input: { bookId: string; pageNumber: number }): Promise<PreparedOcrPage>
  getAppInfo(): Promise<AppInfo>
  getAppUpdatePhase(): Promise<AppUpdatePhase>
  checkForAppUpdate(): Promise<AppUpdatePhase>
  downloadAppUpdate(): Promise<AppUpdatePhase>
  installAppUpdate(): Promise<void>
  onAppUpdateEvent(listener: (phase: AppUpdatePhase) => void): () => void
  listBooks(): Promise<BookRecord[]>
  importBooks(): Promise<BookImportBatchResult | null>
  importDroppedBooks(files: File[]): Promise<BookImportBatchResult>
  cancelBookImport(): Promise<void>
  onBookImportEvent(listener: (event: BookImportEvent) => void): () => void
  deleteBook(bookId: string): Promise<boolean>
  readBook(bookId: string): Promise<BookPayload>
  getBookCover(bookId: string): Promise<BookCoverPayload | null>
  getBookDetails(bookId: string): Promise<BookDetails>
  updateBookMetadata(bookId: string, title: string, author: string | null): Promise<BookRecord>
  updateBookProgress(bookId: string, locator: string, progress: number): Promise<void>
  listHighlights(bookId: string): Promise<HighlightRecord[]>
  saveHighlight(input: SaveHighlightInput): Promise<HighlightRecord>
  deleteHighlight(id: string): Promise<boolean>
  listInsights(bookId: string): Promise<SavedInsight[]>
  listAllInsights(): Promise<InsightArchiveRecord[]>
  exportInsights(scope: InsightExportScope): Promise<InsightExportResult>
  saveInsight(input: SaveInsightInput): Promise<SavedInsight>
  deleteInsight(id: string): Promise<boolean>
  updateInsightHistory(input: UpdateInsightHistoryInput): Promise<SavedInsight>
  getBookSession(bookId: string): Promise<BookSessionRecord | null>
  listRecentBookSessions(bookId: string): Promise<BookSessionSummary[]>
  getRecentBookSession(input: { bookId: string; conversationId: string }): Promise<BookSessionRecord | null>
  saveBookSession(input: SaveBookSessionInput): Promise<BookSessionRecord>
  deleteBookSession(bookId: string, conversationId?: string): Promise<boolean>
  listSessionTabs(): Promise<SessionTabsState>
  saveSessionTabs(input: SessionTabsState): Promise<SessionTabsState>
  getProviderOverview(): Promise<ProviderOverview>
  createProviderProfile(input: CreateProviderProfileInput): Promise<ProviderOverview>
  updateProviderProfile(input: UpdateProviderProfileInput): Promise<ProviderOverview>
  activateProviderProfile(id: string): Promise<ProviderOverview>
  deleteProviderProfile(id: string): Promise<ProviderOverview>
  testProvider(): Promise<ProviderTestResult>
  testProviderConfiguration(input: ProviderConfigurationInput): Promise<ProviderTestResult>
  listProviderModels(input: ProviderModelListInput): Promise<ProviderModelList>
  listSystemFonts(): Promise<string[]>
  getKnowledgeSettings(): Promise<KnowledgeSettings>
  saveKnowledgeSettings(input: SaveKnowledgeSettingsInput): Promise<KnowledgeSettings>
  testKnowledgeSettings(input: TestKnowledgeSettingsInput): Promise<ProviderTestResult>
  startSemanticIndex(input: StartSemanticIndexInput): Promise<BookAnalysisState>
  cancelSemanticIndex(bookId: string): Promise<void>
  getBookAnalysis(bookId: string): Promise<BookAnalysisState>
  getBookNotesIndex(bookId: string): Promise<BookNotesIndex>
  getBookChapterNotes(input: BookChapterNotesInput): Promise<BookChapterNotesPage>
  prepareBookDocument(input: PrepareBookDocumentInput): Promise<BookAnalysisState>
  cancelBookDocument(bookId: string): Promise<void>
  searchBookDocument(input: { bookId: string; query: string }): Promise<PreparedDocumentSearch>
  previewBookPage(input: BookPagePreviewInput): Promise<BookPagePreview>
  cancelBookPagePreview(requestId: string): Promise<void>
  startBookAnalysis(input: StartBookAnalysisInput): Promise<BookAnalysisState>
  cancelBookAnalysis(bookId: string): Promise<void>
  onBookAnalysisEvent(listener: (state: BookAnalysisState) => void): () => void
  startLlm(request: LlmRequest): Promise<void>
  cancelLlm(requestId: string): Promise<void>
  onLlmEvent(listener: (event: LlmEvent) => void): () => void
  onBeforeClose(listener: () => void | Promise<void>): () => void
  minimizeWindow(): Promise<void>
  toggleMaximizeWindow(): Promise<void>
  closeWindow(): Promise<void>
  isWindowMaximized(): Promise<boolean>
  onWindowMaximizedChange(listener: (maximized: boolean) => void): () => void
}
