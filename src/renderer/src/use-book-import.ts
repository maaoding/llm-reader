import { useCallback, useEffect, useRef, useState } from 'react'
import type { BookImportBatchResult, BookImportEvent, BookRecord } from '@shared/contracts'
import { copy } from '@shared/copy'
import { readableError } from './readable-error'

type BookImportDialogPhase = 'running' | 'stopping' | 'completed'
type DropOverlayState = 'ready' | 'busy' | null

export interface BookImportDialogState {
  phase: BookImportDialogPhase
  total: number
  processed: number
  currentFileName: string
  imported: number
  duplicates: number
  failed: number
  result?: BookImportBatchResult
}

interface BookImportOptions {
  refreshBooks: () => Promise<BookRecord[]>
  openBook: (book: BookRecord) => Promise<void>
  onShowLibrary: () => void
  pushToast: (message: string, tone?: 'success' | 'error' | 'neutral') => void
  dismissToast: () => void
}

export function useBookImport({ refreshBooks, openBook, onShowLibrary, pushToast, dismissToast }: BookImportOptions) {
  const [importing, setImporting] = useState(false)
  const [importDialogState, setImportDialogState] = useState<BookImportDialogState | null>(null)
  const [dropOverlay, setDropOverlay] = useState<DropOverlayState>(null)
  const importingRef = useRef(false)
  const acceptImportEventsRef = useRef(false)
  const importDialogStateRef = useRef<BookImportDialogState | null>(null)
  const importReturnFocusRef = useRef<HTMLButtonElement>(null)
  const dragDepthRef = useRef(0)

  useEffect(() => {
    importDialogStateRef.current = importDialogState
  }, [importDialogState])

  useEffect(() => {
    if (!window.readerApi) return undefined
    return window.readerApi.onBookImportEvent((event: BookImportEvent) => {
      if (!acceptImportEventsRef.current) return
      if (event.type === 'started') {
        setImportDialogState({
          phase: 'running',
          total: event.total,
          processed: 0,
          currentFileName: '',
          imported: 0,
          duplicates: 0,
          failed: 0
        })
        return
      }
      if (event.type === 'itemStarted') {
        setImportDialogState((current) => ({
          phase: current?.phase === 'stopping' ? 'stopping' : 'running',
          total: event.total,
          processed: event.processed,
          currentFileName: event.fileName,
          imported: current?.imported ?? 0,
          duplicates: current?.duplicates ?? 0,
          failed: current?.failed ?? 0
        }))
        return
      }
      if (event.type === 'progress') {
        setImportDialogState((current) => ({
          phase: current?.phase === 'stopping' ? 'stopping' : 'running',
          total: event.total,
          processed: event.processed,
          currentFileName: event.fileName,
          imported: event.imported,
          duplicates: event.duplicates,
          failed: event.failed
        }))
        return
      }
      if (event.type === 'cancelRequested') {
        setImportDialogState((current) => current ? { ...current, phase: 'stopping' } : current)
        return
      }
      // The invoke result owns the final UI transition. IPC event delivery and invoke
      // resolution are separate queues, so rendering completion here could reopen a
      // summary that the user already closed or flash one for a single-file import.
    })
  }, [])

  const runBookImport = useCallback(async (
    start: () => Promise<BookImportBatchResult | null>,
    trigger?: HTMLButtonElement
  ): Promise<void> => {
    if (importingRef.current || importDialogStateRef.current) {
      pushToast(copy('library.importBusy'), 'neutral')
      return
    }
    dismissToast()
    importReturnFocusRef.current = trigger ?? (document.activeElement instanceof HTMLButtonElement ? document.activeElement : null)
    importingRef.current = true
    acceptImportEventsRef.current = true
    setImporting(true)
    try {
      const result = await start()
      acceptImportEventsRef.current = false
      if (!result) {
        importDialogStateRef.current = null
        setImportDialogState(null)
        return
      }
      await refreshBooks()

      if (result.total === 1) {
        importDialogStateRef.current = null
        setImportDialogState(null)
        const item = result.items[0]
        if (item?.status === 'failed') {
          pushToast(item.message, 'error')
          return
        }
        if (item) {
          pushToast(item.status === 'duplicate' ? copy('library.duplicateToast') : copy('library.importedToast'), item.status === 'duplicate' ? 'neutral' : 'success')
          await openBook(item.book)
        }
        return
      }

      const completed: BookImportDialogState = {
        phase: 'completed',
        total: result.total,
        processed: result.processed,
        currentFileName: '',
        imported: result.imported,
        duplicates: result.duplicates,
        failed: result.failed,
        result
      }
      importDialogStateRef.current = completed
      setImportDialogState(completed)
      onShowLibrary()
    } catch (error) {
      acceptImportEventsRef.current = false
      importDialogStateRef.current = null
      setImportDialogState(null)
      pushToast(readableError(error, copy('library.importFailed')), 'error')
    } finally {
      acceptImportEventsRef.current = false
      importingRef.current = false
      setImporting(false)
    }
  }, [dismissToast, openBook, pushToast, refreshBooks, onShowLibrary])

  const importBooks = useCallback((trigger?: HTMLButtonElement): Promise<void> => (
    runBookImport(() => window.readerApi.importBooks(), trigger)
  ), [runBookImport])

  const importDroppedBooks = useCallback((files: File[]): Promise<void> => (
    runBookImport(() => window.readerApi.importDroppedBooks(files))
  ), [runBookImport])

  const cancelBookImport = useCallback(async (): Promise<void> => {
    setImportDialogState((current) => current && current.phase !== 'completed' ? { ...current, phase: 'stopping' } : current)
    try {
      await window.readerApi.cancelBookImport()
    } catch (error) {
      pushToast(readableError(error, copy('library.importFailed')), 'error')
    }
  }, [pushToast])

  const closeBookImportDialog = useCallback((): void => {
    if (importDialogStateRef.current?.phase !== 'completed') return
    importDialogStateRef.current = null
    setImportDialogState(null)
  }, [])

  useEffect(() => {
    const hasFiles = (event: globalThis.DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes('Files')
    const importUiBusy = (): boolean => importingRef.current || importDialogStateRef.current !== null
    const onDragEnter = (event: globalThis.DragEvent): void => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dragDepthRef.current += 1
      setDropOverlay(importUiBusy() ? 'busy' : 'ready')
    }
    const onDragOver = (event: globalThis.DragEvent): void => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = importUiBusy() ? 'none' : 'copy'
      setDropOverlay(importUiBusy() ? 'busy' : 'ready')
    }
    const onDragLeave = (event: globalThis.DragEvent): void => {
      if (dragDepthRef.current === 0) return
      event.preventDefault()
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (dragDepthRef.current === 0) setDropOverlay(null)
    }
    const onDrop = (event: globalThis.DragEvent): void => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dragDepthRef.current = 0
      setDropOverlay(null)
      if (importUiBusy()) {
        pushToast(copy('library.importBusy'), 'neutral')
        return
      }
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length > 0) void importDroppedBooks(files)
    }
    const clearDropOverlay = (): void => {
      dragDepthRef.current = 0
      setDropOverlay(null)
    }

    window.addEventListener('dragenter', onDragEnter, true)
    window.addEventListener('dragover', onDragOver, true)
    window.addEventListener('dragleave', onDragLeave, true)
    window.addEventListener('drop', onDrop, true)
    window.addEventListener('dragend', clearDropOverlay, true)
    window.addEventListener('blur', clearDropOverlay)
    return () => {
      window.removeEventListener('dragenter', onDragEnter, true)
      window.removeEventListener('dragover', onDragOver, true)
      window.removeEventListener('dragleave', onDragLeave, true)
      window.removeEventListener('drop', onDrop, true)
      window.removeEventListener('dragend', clearDropOverlay, true)
      window.removeEventListener('blur', clearDropOverlay)
    }
  }, [importDroppedBooks, pushToast])

  return { importing, importDialogState, dropOverlay, importReturnFocusRef, importBooks, cancelBookImport, closeBookImportDialog }
}
