import { Info } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { BookRecord } from '@shared/contracts'
import { copy } from '@shared/copy'
import { BookCover } from './BookCover'
import type { BookCoverCache } from './book-cover-cache'

const GRID_GAP = 16
const OVERSCAN_ROWS = 3

interface RowWindow {
  start: number
  end: number
  pitch: number
}

interface LibraryBookGridProps {
  books: readonly BookRecord[]
  columns: number
  activeBookId?: string
  coverCache: BookCoverCache
  onOpen: (book: BookRecord) => Promise<void>
  onDetails: (book: BookRecord, trigger: HTMLButtonElement) => void
}

export function LibraryBookGrid({
  books, columns, activeBookId, coverCache, onOpen, onDetails
}: LibraryBookGridProps): ReactNode {
  const gridRef = useRef<HTMLDivElement>(null)
  const firstCardRef = useRef<HTMLDivElement>(null)
  const [rowWindow, setRowWindow] = useState<RowWindow>({ start: 0, end: 8, pitch: 110 + GRID_GAP })
  const [focusedBookId, setFocusedBookId] = useState<string | null>(null)
  const rowCount = Math.ceil(books.length / columns)
  const firstBookId = books[0]?.id
  const focusedIndex = useMemo(
    () => focusedBookId === null ? -1 : books.findIndex((book) => book.id === focusedBookId),
    [books, focusedBookId]
  )

  useLayoutEffect(() => {
    const grid = gridRef.current
    const firstCard = firstCardRef.current
    const list = grid?.parentElement
    if (!grid || !firstCard || !list) return

    let pitch = 110 + GRID_GAP
    const updateRange = (): void => {
      if (list.clientHeight === 0) return
      const offset = list.scrollTop - grid.offsetTop
      const start = Math.max(0, Math.min(rowCount - 1, Math.floor(offset / pitch) - OVERSCAN_ROWS))
      const end = Math.min(rowCount, Math.max(start + 1, Math.ceil((offset + list.clientHeight) / pitch) + OVERSCAN_ROWS))
      const next = { start, end, pitch }
      setRowWindow((current) => (
        current.start === next.start && current.end === next.end && current.pitch === next.pitch
          ? current
          : next
      ))
    }
    const measure = (): void => {
      const height = firstCard.getBoundingClientRect().height
      if (height > 0) pitch = height + GRID_GAP
      updateRange()
    }

    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(list)
    observer?.observe(firstCard)
    list.addEventListener('scroll', updateRange, { passive: true })
    return () => {
      observer?.disconnect()
      list.removeEventListener('scroll', updateRange)
    }
  }, [columns, firstBookId, rowCount])

  if (rowCount === 0) return null

  // Keep the ends of the tab order and the rows adjacent to the last focused book mounted.
  // The focused book also remains available for focus restoration from its details dialog.
  const rows = new Set([0, rowCount - 1])
  for (let row = rowWindow.start; row < Math.min(rowCount, rowWindow.end); row += 1) {
    rows.add(row)
  }
  if (focusedIndex >= 0) {
    const focusedRow = Math.floor(focusedIndex / columns)
    for (let row = Math.max(0, focusedRow - 1); row <= Math.min(rowCount - 1, focusedRow + 1); row += 1) {
      rows.add(row)
    }
  }

  return (
    <div
      className="library-book-grid"
      ref={gridRef}
      role="list"
      style={{
        height: rowCount * rowWindow.pitch - GRID_GAP,
        '--library-grid-gap': `${GRID_GAP}px`,
        '--library-columns': columns
      } as CSSProperties}
      onFocusCapture={(event) => {
        const bookId = (event.target as HTMLElement).dataset.bookId
        if (bookId) setFocusedBookId(bookId)
      }}
    >
      {Array.from(rows).sort((first, second) => first - second).flatMap((row) => (
        books.slice(row * columns, (row + 1) * columns).map((book, column) => {
          const index = row * columns + column
          const author = book.author || copy('common.unknownAuthor')
          const progress = copy('workspace.readingProgress', { percent: Math.round(book.progress * 100) })
          const detailsLabel = copy('bookDetails.openAria', { title: book.title })
          return (
            <div
              className={'book-item ' + (activeBookId === book.id ? 'is-active' : '')}
              key={book.id}
              ref={index === 0 ? firstCardRef : undefined}
              role="listitem"
              aria-posinset={index + 1}
              aria-setsize={books.length}
              style={{ top: row * rowWindow.pitch, '--library-column': column } as CSSProperties}
            >
              <button
                className="book-item-open"
                data-testid="book-item"
                data-book-id={book.id}
                data-source-format={book.sourceFormat}
                type="button"
                onClick={() => void onOpen(book)}
              >
                <BookCover book={book} cache={coverCache} />
                <span className="book-meta">
                  <strong title={book.title}>{book.title}</strong>
                  <small title={author}>{author}</small>
                  <span className="book-meta-foot">
                    <span className="format-chip" data-testid="book-format" data-format={book.sourceFormat}>{book.sourceFormat.toUpperCase()}</span>
                    <span className="book-progress-text" title={progress}>{progress}</span>
                  </span>
                </span>
              </button>
              <button
                className="book-item-info"
                data-testid="book-info"
                data-book-id={book.id}
                type="button"
                aria-label={detailsLabel}
                title={detailsLabel}
                onClick={(event) => {
                  setFocusedBookId(book.id)
                  onDetails(book, event.currentTarget)
                }}
              >
                <Info size={14} />
              </button>
            </div>
          )
        })
      ))}
    </div>
  )
}
