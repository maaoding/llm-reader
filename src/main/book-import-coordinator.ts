import { basename, isAbsolute } from 'node:path'
import type {
  BookImportBatchResult,
  BookImportEvent,
  BookImportItemResult,
  ImportedBookResult
} from '@shared/contracts'
import { copy } from '@shared/copy'
import { AppError, toPublicError } from './errors'

export const MAX_BOOK_IMPORT_BATCH = 300

interface BookImporter {
  importFromPath(path: string): Promise<ImportedBookResult>
}

interface ActiveBatch {
  total: number
  processed: number
  cancelRequested: boolean
}

function safeFileName(path: string): string {
  const name = basename(path).replace(/[\r\n\t]/gu, ' ').trim()
  return Array.from(name).slice(0, 255).join('') || copy('library.unknownFile')
}

export class BookImportCoordinator {
  private active: ActiveBatch | null = null

  constructor(
    private readonly importer: BookImporter,
    private readonly emit: (event: BookImportEvent) => void,
    private readonly beforeItem?: () => Promise<void>
  ) {}

  isBusy(): boolean {
    return this.active !== null
  }

  async importPaths(paths: ReadonlyArray<string>): Promise<BookImportBatchResult> {
    if (this.active) throw new AppError('IMPORT_BUSY', copy('error.importBusy'))
    if (paths.length === 0) throw new AppError('INVALID_INPUT', copy('error.invalidInput'))
    if (paths.length > MAX_BOOK_IMPORT_BATCH) {
      throw new AppError('IMPORT_BATCH_TOO_LARGE', copy('error.importBatchTooLarge'))
    }

    const active: ActiveBatch = { total: paths.length, processed: 0, cancelRequested: false }
    const items: BookImportItemResult[] = []
    let imported = 0
    let duplicates = 0
    let failed = 0
    this.active = active
    this.safeEmit({ type: 'started', total: active.total })

    try {
      for (const path of paths) {
        if (active.cancelRequested) break
        const fileName = safeFileName(path)
        this.safeEmit({
          type: 'itemStarted',
          total: active.total,
          processed: active.processed,
          fileName
        })
        await this.beforeItem?.()

        let item: BookImportItemResult
        try {
          if (!isAbsolute(path)) throw new AppError('INVALID_PATH', copy('error.importAbsolutePath'))
          const result = await this.importer.importFromPath(path)
          if (result.duplicate) {
            duplicates += 1
            item = { status: 'duplicate', fileName, book: result.book }
          } else {
            imported += 1
            item = { status: 'imported', fileName, book: result.book }
          }
        } catch (error) {
          failed += 1
          const safe = toPublicError(error)
          item = { status: 'failed', fileName, code: safe.code, message: safe.message }
        }

        items.push(item)
        active.processed = items.length
        this.safeEmit({
          type: 'progress',
          total: active.total,
          processed: active.processed,
          fileName,
          imported,
          duplicates,
          failed
        })
      }

      const skipped = active.total - active.processed
      const result: BookImportBatchResult = {
        total: active.total,
        processed: active.processed,
        imported,
        duplicates,
        failed,
        skipped,
        canceled: active.cancelRequested,
        items
      }
      this.safeEmit({ type: 'completed', result })
      return result
    } finally {
      if (this.active === active) this.active = null
    }
  }

  cancel(): void {
    if (!this.active || this.active.cancelRequested) return
    this.active.cancelRequested = true
    this.safeEmit({
      type: 'cancelRequested',
      total: this.active.total,
      processed: this.active.processed
    })
  }

  dispose(): void {
    if (this.active) this.active.cancelRequested = true
  }

  private safeEmit(event: BookImportEvent): void {
    try {
      this.emit(event)
    } catch {
      // Importing remains independent from a renderer that is closing or unavailable.
    }
  }
}
