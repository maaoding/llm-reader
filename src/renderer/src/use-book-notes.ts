import { useEffect, useState } from 'react'
import type { BookAnalysisState, BookNotesIndex } from '@shared/contracts'
import { copy } from '@shared/copy'
import { readableError } from './readable-error'

export function useBookNotesIndex(bookId: string, state?: BookAnalysisState) {
  const [index, setIndex] = useState<BookNotesIndex>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    void window.readerApi.getBookNotesIndex(bookId).then((value) => {
      if (active) { setIndex(value); setError('') }
    }).catch((reason: unknown) => { if (active) setError(readableError(reason, copy('notes.failed'))) })
    return () => { active = false }
  }, [bookId, state?.jobId, state?.document?.jobId, state?.completedSections, state?.status, retry])
  return { index: index?.bookId === bookId ? index : undefined, error, retry: () => setRetry((value) => value + 1) }
}
