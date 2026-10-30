import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { AlertCircle, LoaderCircle, RefreshCw, Trash2, X } from 'lucide-react'
import type { BookCoverPayload, BookDetails, BookRecord } from '@shared/contracts'
import { copy } from '@shared/copy'
import { BookCoverView } from './BookCover'
import { readableError } from './readable-error'
import { useDialogFocus } from './use-dialog-focus'

function useCoverPayloadUrl(cover: BookCoverPayload | null | undefined): string | null {
  const [loaded, setLoaded] = useState<{ cover: BookCoverPayload; url: string } | null>(null)

  useEffect(() => {
    let alive = true
    let objectUrl: string | null = null
    if (!cover) return undefined

    void Promise.resolve().then(() => {
      if (!alive) return
      try {
        const blob = new Blob([cover.bytes as BlobPart], { type: cover.mimeType })
        objectUrl = URL.createObjectURL(blob)
        setLoaded({ cover, url: objectUrl })
      } catch {
        // The details modal falls back to the placeholder below.
      }
    })

    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [cover])

  return loaded !== null && loaded.cover === cover ? loaded.url : null
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB'] as const
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const text = unit === 0 ? String(value) : value >= 100 ? String(Math.round(value)) : value.toFixed(1)
  return text + ' ' + units[unit]
}

function sourceFormatLabel(book: BookRecord): string {
  if (book.sourceFormat === 'mobi') return copy('bookDetails.formatMobi')
  if (book.sourceFormat === 'azw3') return copy('bookDetails.formatAzw3')
  if (book.sourceFormat === 'pdf') return copy('bookDetails.formatPdf')
  return book.sourceFormat === 'epub' ? copy('bookDetails.formatEpub') : copy('bookDetails.formatTxt')
}

function formatFullDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function BookDetailRow({
  label,
  value,
  wide = false
}: {
  label: string
  value: string
  wide?: boolean
}): ReactNode {
  return (
    <div className={wide ? 'book-details-row is-wide' : 'book-details-row'}>
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
  )
}

function BookProgressRow({ progress }: { progress: number }): ReactNode {
  const percent = Math.round(Math.max(0, Math.min(1, progress || 0)) * 100)
  return (
    <div className="book-details-row is-progress">
      <dt>{copy('bookDetails.progressLabel')}</dt>
      <dd>
        <span className="book-details-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={copy('reader.progressAria', { percent })}>
          <i style={{ width: percent + '%' }} />
        </span>
        <strong>{percent}%</strong>
      </dd>
    </div>
  )
}

export function BookDetailsModal({
  book,
  returnFocusRef,
  deleting,
  onClose,
  onDelete
}: {
  book: BookRecord
  returnFocusRef: RefObject<HTMLButtonElement | null>
  deleting: boolean
  onClose: () => void
  onDelete: (book: BookRecord) => void
}): ReactNode {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [details, setDetails] = useState<BookDetails | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)
  const coverUrl = useCoverPayloadUrl(details?.cover ?? null)

  useDialogFocus(true, onClose, dialogRef, returnFocusRef)

  useEffect(() => {
    let alive = true

    void window.readerApi
      .getBookDetails(book.id)
      .then((result) => {
        if (alive) {
          setDetails(result)
          setState('ready')
        }
      })
      .catch((cause) => {
        if (alive) {
          setError(readableError(cause, copy('bookDetails.readFailed')))
          setState('error')
        }
      })

    return () => {
      alive = false
    }
  }, [attempt, book.id])

  const retry = (): void => {
    setState('loading')
    setError('')
    setDetails(null)
    setAttempt((current) => current + 1)
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="book-details-modal" data-testid="book-details-modal" role="dialog" aria-modal="true" aria-labelledby="book-details-title">
        <header className="modal-header">
          <div><h2 id="book-details-title">{copy('bookDetails.title')}</h2></div>
          <button className="icon-button" data-testid="book-details-close" type="button" onClick={onClose} aria-label={copy('bookDetails.closeAria')}><X size={18} /></button>
        </header>

        {state === 'loading' && (
          <div className="book-details-state"><LoaderCircle className="spin" size={22} />{copy('bookDetails.loading')}</div>
        )}

        {state === 'error' && (
          <div className="book-details-state is-error">
            <AlertCircle size={20} />
            <span>{error}</span>
            <button className="text-button" type="button" onClick={retry}><RefreshCw size={14} />{copy('common.retry')}</button>
          </div>
        )}

        {state === 'ready' && details && (
          <div className="book-details-body">
            <div className="book-details-cover" data-testid="book-details-cover">
              <BookCoverView url={coverUrl} book={details.book} size="large" />
              {!coverUrl && <small>{copy('bookDetails.coverMissing')}</small>}
            </div>
            <div className="book-details-panel">
              <div className="book-details-heading">
                <h3>{details.book.title}</h3>
                <p>{details.book.author || copy('common.unknownAuthor')}</p>
              </div>
              <dl className="book-details-list">
                <BookDetailRow label={copy('bookDetails.titleLabel')} value={details.book.title} />
                <BookDetailRow label={copy('bookDetails.authorLabel')} value={details.book.author || copy('common.unknownAuthor')} />
                <BookDetailRow label={copy('bookDetails.formatLabel')} value={sourceFormatLabel(details.book)} />
                <BookDetailRow label={copy('bookDetails.originalNameLabel')} value={details.book.originalName} />
                <BookDetailRow label={copy('bookDetails.fileSizeLabel')} value={formatFileSize(details.fileSizeBytes)} />
                <BookDetailRow label={copy('bookDetails.languageLabel')} value={details.metadata.language || copy('bookDetails.notProvided')} />
                <BookDetailRow label={copy('bookDetails.publisherLabel')} value={details.metadata.publisher || copy('bookDetails.notProvided')} />
                <BookDetailRow label={copy('bookDetails.publishedAtLabel')} value={details.metadata.publishedAt || copy('bookDetails.notProvided')} />
                <BookDetailRow label={copy('bookDetails.identifierLabel')} value={details.metadata.identifier || copy('bookDetails.notProvided')} />
                <BookDetailRow label={copy('bookDetails.importedAtLabel')} value={formatFullDate(details.book.importedAt)} />
                <BookDetailRow label={copy('bookDetails.lastOpenedAtLabel')} value={details.book.lastOpenedAt ? formatFullDate(details.book.lastOpenedAt) : copy('bookDetails.neverOpened')} />
                <BookProgressRow progress={details.book.progress} />
                <BookDetailRow label={copy('bookDetails.descriptionLabel')} value={details.metadata.description || copy('bookDetails.notProvided')} wide />
              </dl>
            </div>
          </div>
        )}

        <footer className="book-details-footer">
          {confirmDelete ? (
            <div
              className="book-details-delete-confirmation"
              data-testid="book-details-delete-confirmation"
              role="group"
              aria-label={copy('library.deleteQuestion', { title: book.title })}
            >
              <div>
                <strong>{copy('library.deleteQuestion', { title: book.title })}</strong>
                <p>{copy('library.deleteDetail')}</p>
                <p>{copy('workbench.deleteBookHint')}</p>
              </div>
              <div className="book-details-delete-actions">
                <button
                  data-testid="book-details-delete-confirm"
                  type="button"
                  disabled={deleting}
                  onClick={() => onDelete(book)}
                >
                  {deleting && <LoaderCircle className="spin" size={14} />}
                  {copy('common.confirm')}
                </button>
                <button
                  data-testid="book-details-delete-cancel"
                  type="button"
                  disabled={deleting}
                  onClick={() => setConfirmDelete(false)}
                >
                  {copy('common.back')}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="book-details-delete"
              data-testid="book-details-delete"
              type="button"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={14} />
              {copy('library.deleteBook')}
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}
