// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookCoverPayload, BookRecord } from '../../src/shared/contracts'
import { BookCover } from '../../src/renderer/src/App'
import { BookCoverCache } from '../../src/renderer/src/book-cover-cache'

interface ObserverHarness {
  callback: IntersectionObserverCallback
  options?: IntersectionObserverInit
  disconnect: ReturnType<typeof vi.fn>
}

const observers: ObserverHarness[] = []

class MockIntersectionObserver {
  readonly root: Element | Document | null
  readonly rootMargin: string
  readonly thresholds = [0]
  readonly disconnect = vi.fn()
  readonly observe = vi.fn()
  readonly unobserve = vi.fn()

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.root = options?.root ?? null
    this.rootMargin = options?.rootMargin ?? '0px'
    observers.push({ callback, options, disconnect: this.disconnect })
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

function book(index: number): BookRecord {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    title: `Book ${index}`,
    author: null,
    format: 'epub',
    sourceFormat: 'epub',
    originalName: `book-${index}.epub`,
    importedAt: '2026-08-30T00:00:00.000Z',
    lastOpenedAt: null,
    lastLocator: null,
    progress: 0
  }
}

describe('lazy library covers', () => {
  beforeEach(() => {
    observers.length = 0
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('does not request all covers for a 300-book list and uses a 200px prefetch margin', async () => {
    const loader = vi.fn(async () => null)
    const cache = new BookCoverCache(loader, vi.fn(() => 'blob:unused'), vi.fn())
    const books = Array.from({ length: 300 }, (_, index) => book(index))

    const view = render(
      <div className="library-list">
        {books.map((item) => <BookCover key={item.id} book={item} cache={cache} />)}
      </div>
    )

    expect(view.getAllByTestId('book-cover')).toHaveLength(300)
    expect(observers).toHaveLength(1)
    expect(observers[0].options?.rootMargin).toBe('200px 0px')
    expect(loader).not.toHaveBeenCalled()

    act(() => {
      observers[0].callback(
        view.getAllByTestId('book-cover').slice(0, 4).map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry),
        {} as IntersectionObserver
      )
    })

    await waitFor(() => expect(loader).toHaveBeenCalledTimes(4))
    expect(observers[0].disconnect).not.toHaveBeenCalled()
    cache.dispose()
  })

  it('retries a visible cover twice after transient failures and then renders it', async () => {
    vi.useFakeTimers()
    try {
      const cover: BookCoverPayload = {
        mimeType: 'image/png',
        bytes: new Uint8Array([1, 2, 3])
      }
      const loader = vi.fn()
        .mockRejectedValueOnce(new Error('first transient failure'))
        .mockRejectedValueOnce(new Error('second transient failure'))
        .mockResolvedValueOnce(cover)
      const cache = new BookCoverCache(loader, vi.fn(() => 'blob:recovered'), vi.fn())
      const view = render(
        <div className="library-list">
          <BookCover book={book(1)} cache={cache} />
        </div>
      )

      act(() => {
        observers[0].callback(
          [{ target: view.getByTestId('book-cover'), isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver
        )
      })
      await act(async () => { await Promise.resolve() })
      expect(loader).toHaveBeenCalledTimes(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(250)
      })
      expect(loader).toHaveBeenCalledTimes(2)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000)
      })
      expect(loader).toHaveBeenCalledTimes(3)
      expect(view.getByTestId('book-cover').getAttribute('data-has-cover')).toBe('true')
      cache.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not retry an explicit missing-cover result', async () => {
    vi.useFakeTimers()
    try {
      const loader = vi.fn(async () => null)
      const cache = new BookCoverCache(loader, vi.fn(() => 'blob:unused'), vi.fn())
      const view = render(
        <div className="library-list">
          <BookCover book={book(1)} cache={cache} />
        </div>
      )

      act(() => {
        observers[0].callback(
          [{ target: view.getByTestId('book-cover'), isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver
        )
      })
      await act(async () => {
        await Promise.resolve()
        await vi.advanceTimersByTimeAsync(2_000)
      })

      expect(loader).toHaveBeenCalledOnce()
      expect(view.getByTestId('book-cover').getAttribute('data-has-cover')).toBe('false')
      cache.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})
