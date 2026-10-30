import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import type { BookRecord } from '@shared/contracts'
import { copy } from '@shared/copy'
import { READER_SEARCH_QUERY_MAX_LENGTH, type ReaderSearchResult } from '@shared/reader-search'
import type { ReaderAdapter } from './readers'
import { readableError } from './readable-error'

interface ReaderSearchOptions {
  adapterRef: RefObject<ReaderAdapter | null>
  activeBookRef: RefObject<BookRecord | null>
  visible: boolean
}

export function useReaderSearch({ adapterRef, activeBookRef, visible }: ReaderSearchOptions) {
  const [searchQuery, setSearchQuery] = useState('')
  const [executedSearchQuery, setExecutedSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ReadonlyArray<ReaderSearchResult>>([])
  const [searchState, setSearchState] = useState<'idle' | 'searching' | 'ready' | 'error'>('idle')
  const [searchError, setSearchError] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const sequenceRef = useRef(0)

  const invalidateSearch = useCallback((): void => { sequenceRef.current += 1 }, [])
  const resetSearch = useCallback((keepQuery = false): void => {
    invalidateSearch()
    if (!keepQuery) setSearchQuery('')
    setSearchResults([])
    setExecutedSearchQuery('')
    setSearchState('idle')
    setSearchError('')
  }, [invalidateSearch])

  useEffect(() => invalidateSearch, [invalidateSearch])
  useEffect(() => {
    if (!visible) return undefined
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [visible])

  const runSearch = useCallback(async (value: string): Promise<void> => {
    const query = value.trim()
    const queryLength = Array.from(query).length
    if (queryLength < 1 || queryLength > READER_SEARCH_QUERY_MAX_LENGTH) {
      invalidateSearch()
      setSearchResults([])
      setExecutedSearchQuery('')
      setSearchState('error')
      setSearchError(copy('reader.searchInvalid'))
      return
    }
    const adapter = adapterRef.current
    const bookId = activeBookRef.current?.id
    if (!adapter || !bookId) return
    const sequence = ++sequenceRef.current
    const isCurrent = (): boolean => sequence === sequenceRef.current && adapterRef.current === adapter && activeBookRef.current?.id === bookId
    setSearchState('searching')
    setSearchError('')
    try {
      const prepared = adapter.format === 'pdf' ? await window.readerApi.searchBookDocument({ bookId, query }) : null
      if (!isCurrent()) return
      const results = prepared?.available ? prepared.results : await adapter.search(query)
      if (!isCurrent()) return
      setSearchResults(results)
      setExecutedSearchQuery(query)
      setSearchState('ready')
    } catch (error) {
      if (!isCurrent()) return
      setSearchResults([])
      setExecutedSearchQuery('')
      setSearchState('error')
      setSearchError(readableError(error, copy('reader.searchFailed')))
    }
  }, [activeBookRef, adapterRef, invalidateSearch])

  const submitSearch = useCallback((event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void runSearch(searchQuery)
  }, [runSearch, searchQuery])

  return { searchQuery, setSearchQuery, executedSearchQuery, searchResults, searchState, searchError, searchInputRef, runSearch, submitSearch, resetSearch, invalidateSearch }
}
