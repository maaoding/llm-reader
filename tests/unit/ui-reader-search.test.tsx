// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { BookRecord, PreparedDocumentSearch, ReaderApi } from '../../src/shared/contracts'
import type { ReaderAdapter, ReaderSearchResult } from '../../src/renderer/src/readers'
import { useReaderSearch } from '../../src/renderer/src/use-reader-search'
import { deferred } from './support/deferred'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function hit(excerpt: string): ReaderSearchResult {
  return { excerpt, anchor: `txtpos:${excerpt}`, chapterTitle: 'Chapter' }
}

function setup(format: 'txt' | 'pdf' = 'txt') {
  const search = vi.fn<ReaderAdapter['search']>().mockResolvedValue([])
  const searchBookDocument = vi.fn<ReaderApi['searchBookDocument']>().mockResolvedValue({ available: false, results: [] })
  Object.defineProperty(window, 'readerApi', { configurable: true, value: { searchBookDocument } })
  const adapterRef = { current: { format, search } as unknown as ReaderAdapter }
  const activeBookRef = { current: { id: 'book' } as BookRecord }
  return { ...renderHook(() => useReaderSearch({ adapterRef, activeBookRef, visible: false })), search, searchBookDocument, adapterRef, activeBookRef }
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
  view.searchBookDocument.mockResolvedValueOnce({ available: true, results: [hit('prepared')] })
  await act(async () => view.result.current.runSearch('prepared'))
  expect(view.result.current.searchResults).toEqual([hit('prepared')])
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
