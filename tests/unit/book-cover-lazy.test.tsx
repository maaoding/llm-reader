// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookRecord } from '../../src/shared/contracts'
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
})
