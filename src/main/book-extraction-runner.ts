import { join } from 'node:path'
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS, type BookAnalysisState, type BookExtractionInput, type PdfOcrPageRequest } from '@shared/contracts'
import { copy } from '@shared/copy'
import { BookAnalysisService } from './book-analysis'
import { LibraryService } from './library-service'
import { bookExtractionBatchSchema, bookExtractionSchema, pdfExtractionSchema, pdfOcrPageSchema } from './schemas'
import { safeIpcError } from './ipc'
import { AppError, toPublicError } from './errors'

const channels = [IPC_CHANNELS.analysisRead, IPC_CHANNELS.analysisPdf, IPC_CHANNELS.analysisPdfPageResult, IPC_CHANNELS.analysisAppend, IPC_CHANNELS.analysisFinish, IPC_CHANNELS.analysisFail]

/** Only this job's main frame may exchange extraction batches; it has no general reader API. */
export class BookExtractionRunner {
  private active: { input: BookExtractionInput; window: BrowserWindow; url: string; timeout: ReturnType<typeof setTimeout> } | undefined
  private pdf?: { input: BookExtractionInput; controller: AbortController }
  private page?: { input: PdfOcrPageRequest; resolve: (image: string) => void; reject: (error: Error) => void }

  constructor(private readonly library: LibraryService, private readonly analysis: BookAnalysisService) {
    for (const channel of channels) {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (event, value: unknown) => {
        const active = this.active
        if (!active || !this.trusted(event, active)) throw new Error(`[UNTRUSTED_SENDER] ${copy('error.untrustedSender')}`)
        try {
          if (channel === IPC_CHANNELS.analysisRead) return { input: active.input, payload: await this.library.readBook(active.input.bookId) }
          const input = bookExtractionSchema.parse(value)
          if (input.bookId !== active.input.bookId || input.jobId !== active.input.jobId) throw new Error('Invalid extraction job')
          if (channel === IPC_CHANNELS.analysisPdf) {
            const pdf = pdfExtractionSchema.parse(value)
            if (this.pdf) throw new Error('PDF job already running')
            if (this.analysis.documents?.usesVision()) {
              // OCR keeps this sandbox alive for one bounded page render at a time.
              clearTimeout(active.timeout)
              await this.startPdf(input, pdf.pageCount)
            } else {
              void this.startPdf(input, pdf.pageCount)
              setTimeout(() => { if (this.active === active) this.stop() }, 0)
            }
          }
          else if (channel === IPC_CHANNELS.analysisPdfPageResult) {
            const page = pdfOcrPageSchema.parse(value), pending = this.page
            if (!pending || pending.input.bookId !== page.bookId || pending.input.jobId !== page.jobId || pending.input.pageNumber !== page.pageNumber) throw new Error('Invalid PDF page response')
            if (page.imageDataUrl) pending.resolve(page.imageDataUrl)
            else pending.reject(new AppError('OCR_IMAGE', copy('vision.renderFailed')))
          }
          else if (channel === IPC_CHANNELS.analysisAppend) this.analysis.append(bookExtractionBatchSchema.parse(value))
          else if (channel === IPC_CHANNELS.analysisFinish) this.analysis.finish(input)
          else this.analysis.fail(input)
          return undefined
        } catch (error) {
          throw safeIpcError(error)
        }
      })
    }
  }

  private trusted(event: IpcMainInvokeEvent, active: NonNullable<BookExtractionRunner['active']>): boolean {
    return !active.window.isDestroyed() && event.sender.id === active.window.webContents.id &&
      event.senderFrame === event.sender.mainFrame && event.senderFrame?.url === active.url
  }

  start(state: BookAnalysisState): void {
    if (!this.analysis.needsExtraction(state.bookId)) return
    this.stop()
    const input = { bookId: state.bookId, jobId: state.document!.jobId }
    try {
      const window = new BrowserWindow({
        show: false, skipTaskbar: true,
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'), additionalArguments: ['--llm-reader-extraction'], sandbox: true, contextIsolation: true,
          nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false,
          navigateOnDragDrop: false, backgroundThrottling: false, spellcheck: false
        }
      })
      const developmentUrl = process.env.ELECTRON_RENDERER_URL
      const url = developmentUrl ? new URL('extraction.html', developmentUrl).toString() : 'llm-reader://app/extraction.html'
      const failed = (): void => {
        if (this.active?.input.jobId === input.jobId) { this.analysis.fail(input); this.stop() }
      }
      this.active = { input, window, url, timeout: setTimeout(failed, 120_000) }
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', (event) => event.preventDefault())
      window.webContents.on('will-redirect', (event) => event.preventDefault())
      window.webContents.on('will-attach-webview', (event) => event.preventDefault())
      window.webContents.on('render-process-gone', failed)
      window.on('closed', failed)
      void window.loadURL(url).catch(failed)
    } catch (error) {
      this.analysis.fail(input)
      this.stop()
      throw error
    }
  }

  observe(state: BookAnalysisState): void {
    if (this.pdf?.input.bookId === state.bookId && (state.document?.status !== 'preparing' || state.document.jobId !== this.pdf.input.jobId)) {
      this.pdf.controller.abort()
      this.pdf = undefined
    }
    const active = this.active
    if (active?.input.bookId === state.bookId && (state.document?.status !== 'preparing' || state.document.jobId !== active.input.jobId)) {
      // Let the finish invocation return before closing its renderer.
      setTimeout(() => { if (this.active === active) this.stop() }, 0)
    }
  }

  private stop(): void {
    const active = this.active
    this.active = undefined
    if (!active) return
    clearTimeout(active.timeout)
    if (!active.window.isDestroyed()) active.window.destroy()
  }

  private async renderPage(input: BookExtractionInput, pageNumber: number, signal: AbortSignal): Promise<string> {
    const active = this.active
    signal.throwIfAborted()
    if (!active || active.input.jobId !== input.jobId || this.page) throw new AppError('OCR_IMAGE', copy('vision.renderFailed'))
    const request = { ...input, pageNumber }
    let timeout: ReturnType<typeof setTimeout> | undefined
    const abort = (): void => pending.reject(new AppError('OCR_IMAGE', copy('vision.renderFailed')))
    let pending: NonNullable<BookExtractionRunner['page']>
    const result = new Promise<string>((resolve, reject) => { pending = { input: request, resolve, reject }; this.page = pending })
    try {
      timeout = setTimeout(abort, 45_000)
      signal.addEventListener('abort', abort, { once: true })
      active.window.webContents.send(IPC_CHANNELS.analysisPdfPageRequest, request)
      return await result
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      if (this.page === pending!) this.page = undefined
    }
  }

  private async startPdf(input: BookExtractionInput, pageCount: number): Promise<void> {
    if (this.pdf) throw new Error('PDF job already running')
    const active = { input, controller: new AbortController() }
    this.pdf = active
    await (async () => {
      const payload = await this.library.readBook(input.bookId)
      if (payload.book.format !== 'pdf' || !this.analysis.documents) throw new Error('Invalid PDF job')
      active.controller.signal.throwIfAborted()
      const sections = await this.analysis.documents.extract(input.bookId, payload.bytes, pageCount, active.controller.signal,
        (page, signal) => this.renderPage(input, page, signal), () => this.analysis.emit(input.bookId))
      const document = this.analysis.documents.structure(input.bookId)
      for (let offset = 0; offset < sections.length; offset += 8) {
        active.controller.signal.throwIfAborted()
        this.analysis.append(bookExtractionBatchSchema.parse({ ...input, sections: sections.slice(offset, offset + 8), ...(offset === 0 && document ? { document } : {}) }))
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      this.analysis.finish(input)
    })().catch((error: unknown) => {
      if (!active.controller.signal.aborted) this.analysis.fail(input, toPublicError(error).message)
    }).finally(() => { if (this.pdf === active) this.pdf = undefined })
  }
  dispose(): void { this.cancel(); for (const channel of channels) ipcMain.removeHandler(channel) }
  cancel(): void { this.pdf?.controller.abort(); this.pdf = undefined; this.stop() }
}
