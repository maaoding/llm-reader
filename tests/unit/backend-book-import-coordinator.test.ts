import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { BookImportEvent, BookRecord, ImportedBookResult } from '../../src/shared/contracts'
import { AppError } from '../../src/main/errors'
import { BookImportCoordinator, MAX_BOOK_IMPORT_BATCH } from '../../src/main/book-import-coordinator'

function record(id: string, originalName: string): BookRecord {
  return {
    id,
    title: originalName.replace(/\.[^.]+$/u, ''),
    author: null,
    format: 'epub',
    sourceFormat: 'epub',
    originalName,
    importedAt: '2026-08-30T00:00:00.000Z',
    lastOpenedAt: null,
    lastLocator: null,
    progress: 0
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolveValue) => {
    resolvePromise = resolveValue
  })
  return { promise, resolve: resolvePromise }
}

describe('BookImportCoordinator', () => {
  it('keeps selection order and continues after duplicate and failed items', async () => {
    const paths = ['first.epub', 'copy.epub', 'broken.epub'].map((name) => resolve(name))
    const first = record('11111111-1111-4111-8111-111111111111', 'first.epub')
    const copy = record('22222222-2222-4222-8222-222222222222', 'copy.epub')
    const importer = {
      importFromPath: vi.fn(async (path: string): Promise<ImportedBookResult> => {
        if (path === paths[0]) return { book: first, duplicate: false }
        if (path === paths[1]) return { book: copy, duplicate: true }
        throw new AppError('EPUB_INVALID', 'EPUB 文件无效。')
      })
    }
    const events: BookImportEvent[] = []
    const coordinator = new BookImportCoordinator(importer, (event) => events.push(event))

    const result = await coordinator.importPaths(paths)

    expect(result).toMatchObject({
      total: 3,
      processed: 3,
      imported: 1,
      duplicates: 1,
      failed: 1,
      skipped: 0,
      canceled: false
    })
    expect(result.items.map((item) => [item.status, item.fileName])).toEqual([
      ['imported', 'first.epub'],
      ['duplicate', 'copy.epub'],
      ['failed', 'broken.epub']
    ])
    expect(importer.importFromPath).toHaveBeenCalledTimes(3)
    expect(events.at(0)).toEqual({ type: 'started', total: 3 })
    expect(events.at(-1)).toEqual({ type: 'completed', result })
  })

  it('finishes the active item and skips only the remaining items after cancellation', async () => {
    const active = deferred<ImportedBookResult>()
    const first = record('11111111-1111-4111-8111-111111111111', 'first.epub')
    const importer = { importFromPath: vi.fn(() => active.promise) }
    const events: BookImportEvent[] = []
    const coordinator = new BookImportCoordinator(importer, (event) => events.push(event))
    const running = coordinator.importPaths(['first.epub', 'second.epub', 'third.epub'].map((name) => resolve(name)))

    await vi.waitFor(() => expect(importer.importFromPath).toHaveBeenCalledOnce())
    coordinator.cancel()
    active.resolve({ book: first, duplicate: false })
    const result = await running

    expect(result).toMatchObject({ processed: 1, imported: 1, skipped: 2, canceled: true })
    expect(result.items).toHaveLength(1)
    expect(events.some((event) => event.type === 'cancelRequested')).toBe(true)
    expect(importer.importFromPath).toHaveBeenCalledOnce()
  })

  it('rejects a concurrent batch without disturbing the active batch', async () => {
    const active = deferred<ImportedBookResult>()
    const book = record('11111111-1111-4111-8111-111111111111', 'first.epub')
    const importer = { importFromPath: vi.fn(() => active.promise) }
    const coordinator = new BookImportCoordinator(importer, () => undefined)
    const running = coordinator.importPaths([resolve('first.epub')])

    await vi.waitFor(() => expect(importer.importFromPath).toHaveBeenCalledOnce())
    await expect(coordinator.importPaths([resolve('second.epub')])).rejects.toMatchObject({ code: 'IMPORT_BUSY' })
    active.resolve({ book, duplicate: false })
    await expect(running).resolves.toMatchObject({ imported: 1 })
  })

  it('accepts 300 files and rejects a larger batch before importing anything', async () => {
    const book = record('11111111-1111-4111-8111-111111111111', 'book.epub')
    const importer = { importFromPath: vi.fn(async () => ({ book, duplicate: true })) }
    const coordinator = new BookImportCoordinator(importer, () => undefined)
    const allowed = Array.from({ length: MAX_BOOK_IMPORT_BATCH }, (_, index) => resolve(`book-${index}.epub`))

    await expect(coordinator.importPaths(allowed)).resolves.toMatchObject({ total: 300, processed: 300 })
    expect(importer.importFromPath).toHaveBeenCalledTimes(300)
    await expect(coordinator.importPaths([...allowed, resolve('overflow.epub')])).rejects.toMatchObject({ code: 'IMPORT_BATCH_TOO_LARGE' })
    expect(importer.importFromPath).toHaveBeenCalledTimes(300)
  })

  it('never exposes full paths from internal failures or progress events', async () => {
    const secretPath = resolve('private-folder', 'secret-title.epub')
    const importer = { importFromPath: vi.fn(async () => { throw new Error(`cannot read ${secretPath}`) }) }
    const events: BookImportEvent[] = []
    const coordinator = new BookImportCoordinator(importer, (event) => events.push(event))

    const result = await coordinator.importPaths([secretPath])
    const serialized = JSON.stringify({ result, events })

    expect(serialized).not.toContain(secretPath)
    expect(serialized).not.toContain('private-folder')
    expect(result.items[0]).toMatchObject({ status: 'failed', fileName: 'secret-title.epub', code: 'INTERNAL_ERROR' })
  })

  it('rejects relative paths as item failures without calling the importer', async () => {
    const importer = { importFromPath: vi.fn() }
    const coordinator = new BookImportCoordinator(importer, () => undefined)

    const result = await coordinator.importPaths(['relative.epub'])

    expect(result).toMatchObject({ total: 1, processed: 1, imported: 0, failed: 1 })
    expect(result.items[0]).toMatchObject({ status: 'failed', fileName: 'relative.epub', code: 'INVALID_PATH' })
    expect(importer.importFromPath).not.toHaveBeenCalled()
  })
})
