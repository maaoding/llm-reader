import { BookOpen, FileText } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { BookRecord } from '@shared/contracts'
import { copy } from '@shared/copy'
import { BookCoverCache, observeBookCoverVisibility } from './book-cover-cache'

export function BookCoverView({
  url,
  book,
  size,
  elementRef
}: {
  url: string | null
  book: BookRecord
  size: 'small' | 'large'
  elementRef?: RefObject<HTMLSpanElement | null>
}): ReactNode {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  const failed = Boolean(url && failedUrl === url)
  const showImage = Boolean(url && !failed)
  const iconSize = size === 'large' ? 24 : 17
  const alt = size === 'large' ? copy('bookDetails.coverAlt', { title: book.title }) : ''

  return (
    <span
      ref={elementRef}
      className={'book-cover is-' + book.format + ' is-' + size}
      data-testid="book-cover"
      data-has-cover={showImage ? 'true' : 'false'}
    >
      {showImage && url ? (
        <img src={url} alt={alt} onError={() => setFailedUrl(url)} />
      ) : book.format === 'epub' ? (
        <BookOpen size={iconSize} />
      ) : (
        <FileText size={iconSize} />
      )}
    </span>
  )
}

export function BookCover({ book, cache }: { book: BookRecord; cache: BookCoverCache }): ReactNode {
  const hostRef = useRef<HTMLSpanElement>(null)
  const [nearby, setNearby] = useState(book.format !== 'epub')
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (book.format !== 'epub') return undefined
    const host = hostRef.current
    if (!host) {
      setNearby(true)
      return undefined
    }
    return observeBookCoverVisibility(host, () => setNearby(true))
  }, [book.format, book.id])

  useEffect(() => {
    let alive = true
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    if (!nearby || book.format !== 'epub') return undefined
    const retryDelays = [250, 1_000] as const
    const loadCover = async (attempt: number): Promise<void> => {
      try {
        const coverUrl = await cache.load(book.id)
        if (alive) setUrl(coverUrl)
      } catch {
        if (!alive) return
        const delay = retryDelays[attempt]
        if (delay === undefined) return
        retryTimer = setTimeout(() => void loadCover(attempt + 1), delay)
      }
    }
    void loadCover(0)
    return () => {
      alive = false
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [book.format, book.id, cache, nearby])

  return <BookCoverView url={url} book={book} size="small" elementRef={hostRef} />
}
