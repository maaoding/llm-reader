// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { BookRecord, PreparedDocumentSearch, ReaderApi, SemanticSearchResult } from '../../src/shared/contracts'
import { readerTitle, type ReaderAdapter, type ReaderSearchResult } from '../../src/renderer/src/readers'
import { useReaderSearch } from '../../src/renderer/src/use-reader-search'
import { deferred } from './support/deferred'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function hit(excerpt: string): ReaderSearchResult {
  return { excerpt, anchor: `txtpos:${excerpt}`, chapterTitle: 'Chapter' }
}

function setup(format: 'txt' | 'pdf' = 'txt') {
  const search = vi.fn<ReaderAdapter['search']>().mockResolvedValue([])
  const searchBookDocument = vi.fn<ReaderApi['searchBookDocument']>().mockResolvedValue({ available: false, results: [] })
  const searchBookSemantically = vi.fn<ReaderApi['searchBookSemantically']>()
  const cancelSemanticSearch = vi.fn<ReaderApi['cancelSemanticSearch']>().mockResolvedValue(undefined)
  Object.defineProperty(window, 'readerApi', { configurable: true, value: { searchBookDocument, searchBookSemantically, cancelSemanticSearch } })
  const adapterRef = { current: { format, search } as unknown as ReaderAdapter }
  const activeBookRef = { current: { id: 'book' } as BookRecord }
  return { ...renderHook(({ settingsVersion }) => useReaderSearch({ adapterRef, activeBookRef, visible: false, settingsVersion }),
    { initialProps: { settingsVersion: 0 } }), search, searchBookDocument, searchBookSemantically, cancelSemanticSearch, adapterRef, activeBookRef }
}

it('keeps the newest query when an earlier search finishes later', async () => {
  const view = setup()
  const old = deferred<ReadonlyArray<ReaderSearchResult>>()
  view.search.mockReturnValueOnce(old.promise).mockResolvedValueOnce([hit('new')])
  let previous!: Promise<void>
  act(() => { previous = view.result.current.runSearch('old') })
  await act(async () => view.result.current.runSearch(' new '))
  await act(async () => { old.resolve([hit('old')]); await previous })
  expect(view.result.current.searchResults).toEqual([hit('new')])
  expect(view.result.current.executedSearchQuery).toBe('new')
})

it('invalidates in-flight results when the reading mode changes while preserving the query', async () => {
  const view = setup()
  const pending = deferred<ReadonlyArray<ReaderSearchResult>>()
  view.search.mockReturnValueOnce(pending.promise)
  let search!: Promise<void>
  act(() => { view.result.current.setSearchQuery('query'); search = view.result.current.runSearch('query') })
  act(() => view.result.current.resetSearch(true))
  await act(async () => { pending.resolve([hit('obsolete anchor')]); await search })
  expect(view.result.current.searchQuery).toBe('query')
  expect(view.result.current.searchState).toBe('idle')
  expect(view.result.current.executedSearchQuery).toBe('')
  expect(view.result.current.searchResults).toEqual([])
})

it('does not search a replaced PDF adapter when an unavailable prepared index arrives late', async () => {
  const view = setup('pdf')
  const prepared = deferred<PreparedDocumentSearch>()
  view.searchBookDocument.mockReturnValueOnce(prepared.promise)
  let search!: Promise<void>
  act(() => { search = view.result.current.runSearch('query') })
  act(() => {
    view.result.current.resetSearch()
    view.activeBookRef.current = { id: 'other' } as BookRecord
    view.adapterRef.current = { format: 'txt', search: vi.fn() } as unknown as ReaderAdapter
  })
  await act(async () => { prepared.resolve({ available: false, results: [] }); await search })
  expect(view.search).not.toHaveBeenCalled()
  expect(view.result.current.searchState).toBe('idle')
})

it('uses prepared PDF results and falls back to adapter search only when unavailable', async () => {
  const view = setup('pdf')
  const prepared = { excerpt: 'prepared', anchor: 'pdfpos:7:0', chapterTitle: '第 7 页' }
  view.searchBookDocument.mockResolvedValueOnce({ available: true, results: [prepared] })
  await act(async () => view.result.current.runSearch('prepared'))
  const [result] = view.result.current.searchResults
  expect(result).toMatchObject(prepared)
  expect(readerTitle(result.chapterTitleCopy ?? result.chapterTitle, 'en')).toBe('Page 7')
  expect(view.search).not.toHaveBeenCalled()
  view.search.mockResolvedValueOnce([hit('native')])
  await act(async () => view.result.current.runSearch('native'))
  expect(view.search).toHaveBeenCalledExactlyOnceWith('native')
  expect(view.result.current.searchResults).toEqual([hit('native')])
})

it('keeps validation errors when a previous search rejects and accepts Unicode within the character limit', async () => {
  const view = setup()
  const previous = deferred<ReadonlyArray<ReaderSearchResult>>()
  view.search.mockReturnValueOnce(previous.promise)
  let search!: Promise<void>
  act(() => { search = view.result.current.runSearch('old') })
  await act(async () => view.result.current.runSearch('😀'.repeat(101)))
  const error = view.result.current.searchError
  await act(async () => { previous.reject(new Error('Late failure')); await search })
  expect(view.result.current.searchState).toBe('error')
  expect(view.result.current.searchError).toBe(error)
  await act(async () => view.result.current.runSearch('😀'.repeat(100)))
  expect(view.search).toHaveBeenCalledTimes(2)
  expect(view.result.current.searchState).toBe('ready')
})

it('sends semantic queries on submission and preserves the fallback reason with an empty full-text result', async () => {
  const view = setup()
  act(() => { view.result.current.setSearchMode('semantic'); view.result.current.setSearchQuery('同义问题') })
  expect(view.searchBookSemantically).not.toHaveBeenCalled()
  view.searchBookSemantically.mockResolvedValueOnce({ status: 'fallback', reason: 'timeout' })
  await act(async () => view.result.current.runSearch(view.result.current.searchQuery))
  expect(view.searchBookSemantically).toHaveBeenCalledExactlyOnceWith({ bookId: 'book', query: '同义问题', requestId: expect.any(String) })
  expect(view.search).toHaveBeenCalledExactlyOnceWith('同义问题')
  expect(view.result.current).toMatchObject({ resultMode: 'text', fallbackReason: 'timeout', searchResults: [], searchState: 'ready' })
})

it.each(['edit', 'settings', 'cancel', 'switch'] as const)('cancels semantic lookup on %s and ignores late results', async (action) => {
  const view = setup()
  const pending = deferred<SemanticSearchResult>()
  view.searchBookSemantically.mockReturnValueOnce(pending.promise)
  act(() => view.result.current.setSearchMode('semantic'))
  let task!: Promise<void>
  act(() => { task = view.result.current.runSearch('上一条') })
  const [{ requestId }] = view.searchBookSemantically.mock.calls[0]
  if (action === 'settings') view.rerender({ settingsVersion: 1 })
  else act(() => {
    if (action === 'edit') view.result.current.setSearchQuery('下一条')
    if (action === 'cancel') view.result.current.cancelSearch()
    if (action === 'switch') {
      view.activeBookRef.current = { id: 'another' } as BookRecord
      view.result.current.resetSearch()
    }
  })
  await act(async () => { pending.resolve({ status: 'fallback', reason: 'timeout' }); await task })
  expect(view.cancelSemanticSearch).toHaveBeenCalledExactlyOnceWith(requestId)
  expect(view.search).not.toHaveBeenCalled()
  expect(view.result.current).toMatchObject({ searchResults: [], searchState: 'idle', fallbackReason: null })
})
