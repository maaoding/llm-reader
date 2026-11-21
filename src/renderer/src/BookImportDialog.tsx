import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { Check, CircleStop, LoaderCircle, X } from 'lucide-react'
import { copy } from '@shared/copy'
import { FOCUSABLE, useDialogFocus } from './use-dialog-focus'
import type { BookImportDialogState } from './use-book-import'

export function BookImportDialog({
  state,
  returnFocusRef,
  onCancel,
  onClose
}: {
  state: BookImportDialogState
  returnFocusRef: RefObject<HTMLButtonElement | null>
  onCancel: () => void
  onClose: () => void
}): ReactNode {
  const dialogRef = useRef<HTMLElement>(null)
  const completed = state.phase === 'completed'
  const completedRef = useRef(completed)
  const closeIfCompleted = useCallback(() => {
    if (completedRef.current) onClose()
  }, [onClose])
  const result = state.result
  const failures = result?.items.filter((item) => item.status === 'failed') ?? []
  const percent = state.total > 0 ? Math.round((state.processed / state.total) * 100) : 0

  useEffect(() => {
    completedRef.current = completed
  }, [completed])
  useDialogFocus(true, closeIfCompleted, dialogRef, returnFocusRef)

  useEffect(() => {
    if (!completed) return undefined
    const frame = window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [completed])

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && closeIfCompleted()}
    >
      <section
        ref={dialogRef}
        className="book-import-modal"
        data-testid="book-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-import-title"
      >
        <header className="modal-header">
          <div>
            <h2 id="book-import-title">
              {copy(completed ? 'library.importSummaryTitle' : 'library.importProgressTitle')}
            </h2>
          </div>
          {completed && (
            <button className="icon-button" type="button" onClick={onClose} aria-label={copy('library.importClose')}>
              <X size={18} />
            </button>
          )}
        </header>

        <div className="book-import-body">
          {!completed && (
            <>
              <div className="book-import-current" data-testid="book-import-current" role="status">
                {state.phase === 'stopping' ? <CircleStop size={18} /> : <LoaderCircle className="spin" size={18} />}
                <div>
                  <strong>{state.phase === 'stopping' ? copy('library.importStopping') : copy('library.importCurrent', { fileName: state.currentFileName || copy('library.unknownFile') })}</strong>
                  <span>{copy('library.importProgress', { processed: state.processed, total: state.total })}</span>
                </div>
              </div>
              <div
                className="book-import-progress"
                data-testid="book-import-progress"
                role="progressbar"
                aria-label={copy('library.importProgressAria')}
                aria-valuemin={0}
                aria-valuemax={state.total}
                aria-valuenow={state.processed}
                aria-valuetext={copy('library.importProgress', { processed: state.processed, total: state.total })}
              >
                <i style={{ width: percent + '%' }} />
              </div>
              <p className="book-import-counts">
                {copy('library.importSummary', {
                  imported: state.imported,
                  duplicates: state.duplicates,
                  failed: state.failed,
                  skipped: 0
                })}
              </p>
            </>
          )}

          {completed && result && (
            <>
              <div className="book-import-summary" data-testid="book-import-summary" role="status">
                <Check size={20} />
                <div>
                  <strong>{copy('library.importSummary', {
                    imported: result.imported,
                    duplicates: result.duplicates,
                    failed: result.failed,
                    skipped: result.skipped
                  })}</strong>
                  {result.canceled && <span>{copy('library.importCanceled')}</span>}
                </div>
              </div>
              {failures.length > 0 && (
                <section className="book-import-failures" aria-labelledby="book-import-failures-title">
                  <h3 id="book-import-failures-title">{copy('library.importFailuresTitle')}</h3>
                  <ul>
                    {failures.map((failure, index) => (
                      <li data-testid="book-import-failure" key={`${failure.fileName}-${index}`}>
                        <strong>{failure.fileName}</strong>
                        <span>{failure.message}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        <footer className="book-import-actions">
          {completed ? (
            <button className="primary-button" data-testid="book-import-close" type="button" onClick={onClose}>
              {copy('library.importClose')}
            </button>
          ) : (
            <button
              className="secondary-button"
              data-testid="book-import-cancel"
              type="button"
              disabled={state.phase === 'stopping'}
              onClick={onCancel}
            >
              {state.phase === 'stopping' ? <LoaderCircle className="spin" size={15} /> : <CircleStop size={15} />}
              {state.phase === 'stopping' ? copy('library.importStopping') : copy('library.importCancel')}
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}
