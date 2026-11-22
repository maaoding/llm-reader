import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import type { BookRecord, SemanticIndexState, SemanticSearchFallbackReason } from '@shared/contracts'
import { copy } from '@shared/copy'
import { pdfPageFromLocator } from '@shared/ocr-reading'
import { normalizeReaderSearchQuery } from '@shared/reader-search'
import { passagePage } from './passage-locations'
import type { ReaderAdapter, ReaderSearchResult } from './readers'
import { readableError } from './readable-error'

interface ReaderSearchOptions {
  adapterRef: RefObject<ReaderAdapter | null>
  activeBookRef: RefObject<BookRecord | null>
  visible: boolean
  settingsVersion?: number
  documentJobId?: string
  indexStatus?: SemanticIndexState['status']
}

export type ReaderSearchMode = 'text' | 'semantic'

async function fullTextSearch(adapter: ReaderAdapter, bookId: string, query: string, isCurrent: () => boolean): Promise<ReadonlyArray<ReaderSearchResult>> {
  const prepared = adapter.format === 'pdf' ? await window.readerApi.searchBookDocument({ bookId, query }) : null
  if (!isCurrent()) return []
  return prepared?.available
    ? prepared.results.map((result): ReaderSearchResult => ({
      ...result, chapterTitleCopy: { key: 'knowledge.pdfPage', page: pdfPageFromLocator(result.anchor) }
    }))
    : adapter.search(query)
}

export function useReaderSearch({
  adapterRef, activeBookRef, visible, settingsVersion = 0, documentJobId, indexStatus
}: ReaderSearchOptions) {
  const [searchQuery, updateQuery] = useState('')
  const [searchMode, updateMode] = useState<ReaderSearchMode>('text')
  const [resultMode, setResultMode] = useState<ReaderSearchMode | null>(null)
  const [executedSearchQuery, setExecutedSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ReadonlyArray<ReaderSearchResult>>([])
  const [searchState, setSearchState] = useState<'idle' | 'searching' | 'ready' | 'error'>('idle')
  const [searchError, setSearchError] = useState('')
  const [fallbackReason, setFallbackReason] = useState<SemanticSearchFallbackReason | null>(null)
  const [searchNotice, setSearchNotice] = useState<'canceled' | 'changed' | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const sequenceRef = useRef(0)
  const semanticRequest = useRef<string | null>(null)
  const revision = useRef({ settingsVersion, documentJobId, indexStatus })
  const wasVisible = useRef(visible)

  const invalidateSearch = useCallback((): void => {
    sequenceRef.current += 1
    const requestId = semanticRequest.current
    semanticRequest.current = null
    if (requestId) void window.readerApi.cancelSemanticSearch(requestId).catch(() => undefined)
  }, [])
  const resetSearch = useCallback((keepQuery = false): void => {
    invalidateSearch()
    if (!keepQuery) updateQuery('')
    setSearchResults([])
    setExecutedSearchQuery('')
    setSearchState('idle')
    setSearchError('')
    setResultMode(null)
    setFallbackReason(null)
    setSearchNotice(null)
  }, [invalidateSearch])

  useEffect(() => invalidateSearch, [invalidateSearch])
  useLayoutEffect(() => {
    const previous = revision.current
    revision.current = { settingsVersion, documentJobId, indexStatus }
    const changed = previous.settingsVersion !== settingsVersion ||
      Boolean(previous.documentJobId && previous.documentJobId !== documentJobId) ||
      previous.indexStatus === 'ready' && indexStatus !== 'ready'
    if (searchMode === 'semantic' && changed) {
      resetSearch(true)
      setSearchNotice('changed')
    }
  }, [documentJobId, indexStatus, resetSearch, searchMode, settingsVersion])
  useLayoutEffect(() => {
    if (wasVisible.current && !visible && searchMode === 'semantic' && searchState === 'searching') resetSearch(true)
    wasVisible.current = visible
  }, [resetSearch, searchMode, searchState, visible])
  useEffect(() => {
    if (!visible) return undefined
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [visible])

  const runSearch = useCallback(async (value: string): Promise<void> => {
    resetSearch(true)
    const query = normalizeReaderSearchQuery(value)
    if (!query || query.includes('\0')) {
      setSearchState('error')
      setSearchError(copy('reader.searchInvalid'))
      return
    }
    const adapter = adapterRef.current
    const bookId = activeBookRef.current?.id
    if (!adapter || !bookId) return
    const sequence = sequenceRef.current
    const isCurrent = (): boolean => sequence === sequenceRef.current && adapterRef.current === adapter && activeBookRef.current?.id === bookId
    setSearchState('searching')
    setResultMode(searchMode)
    try {
      if (searchMode === 'semantic') {
        const requestId = crypto.randomUUID()
        semanticRequest.current = requestId
        const response = await window.readerApi.searchBookSemantically({ bookId, query, requestId }).finally(() => {
          if (semanticRequest.current === requestId) semanticRequest.current = null
        })
        if (!isCurrent()) return
        if (response.status === 'canceled') {
          resetSearch(true)
          setSearchNotice('canceled')
          return
        }
        if (response.status === 'ready') {
          setSearchResults(response.results.map((result): ReaderSearchResult => {
            const page = adapter.format === 'pdf' ? passagePage(result.anchor) ?? result.page : undefined
            return { ...result, ...(page ? { chapterTitleCopy: { key: 'knowledge.pdfPage', page } } : {}) }
          }))
          setSearchState('ready')
          return
        }
        setFallbackReason(response.reason)
        setResultMode('text')
      }
      const results = await fullTextSearch(adapter, bookId, query, isCurrent)
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
  }, [activeBookRef, adapterRef, resetSearch, searchMode])

  const setSearchQuery = (value: string): void => {
    if (value !== searchQuery) {
      resetSearch(true)
      updateQuery(value)
    }
  }
  const setSearchMode = (mode: ReaderSearchMode): void => {
    if (mode !== searchMode) {
      resetSearch(true)
      updateMode(mode)
    }
  }
  const cancelSearch = (): void => {
    resetSearch(true)
    setSearchNotice('canceled')
  }

  const submitSearch = useCallback((event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void runSearch(searchQuery)
  }, [runSearch, searchQuery])

  return {
    searchQuery, setSearchQuery, searchMode, setSearchMode, resultMode, fallbackReason, searchNotice,
    executedSearchQuery, searchResults, searchState, searchError, searchInputRef, runSearch, submitSearch, resetSearch, invalidateSearch, cancelSearch
  }
}

export type ReaderSearchController = ReturnType<typeof useReaderSearch>
