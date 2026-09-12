// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { bookTabPage, readWorkspaceState, saveWorkspaceState } from '../../src/renderer/src/workspace-state'

const KEY = 'llm-reader.workspace'

function write(value: unknown): void {
  window.localStorage.setItem(KEY, JSON.stringify(value))
}

describe('workspace state', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('falls back to the library when nothing is stored', () => {
    expect(readWorkspaceState()).toEqual({ bookId: null, page: 'library', tabs: [] })
  })

  it('migrates a record without tabs into a single book tab', () => {
    write({ bookId: 'book-1', page: 'reading' })
    expect(readWorkspaceState()).toEqual({
      bookId: 'book-1',
      page: 'reading',
      tabs: [{ bookId: 'book-1', page: 'reading' }]
    })
  })

  it('keeps a non-book page as an overview tab when migrating', () => {
    write({ bookId: 'book-1', page: 'library' })
    expect(readWorkspaceState().tabs).toEqual([{ bookId: 'book-1', page: 'overview' }])
  })

  it('keeps an explicitly empty tab list instead of restoring the active book', () => {
    write({ bookId: null, page: 'library', tabs: [] })
    expect(readWorkspaceState()).toEqual({ bookId: null, page: 'library', tabs: [] })
  })

  it('drops malformed, duplicated and page-less tabs', () => {
    write({
      bookId: 'book-1',
      page: 'reading',
      tabs: [
        { bookId: 'book-1', page: 'reading' },
        { bookId: 'book-1', page: 'notes' },
        { bookId: 'book-2', page: 'conversation' },
        { bookId: '', page: 'notes' },
        { page: 'notes' },
        null,
        'book-3'
      ]
    })
    expect(readWorkspaceState().tabs).toEqual([{ bookId: 'book-1', page: 'reading' }])
  })

  it('ignores unknown pages and malformed records', () => {
    write({ bookId: 'book-1', page: 'settings' })
    expect(readWorkspaceState()).toEqual({ bookId: null, page: 'library', tabs: [] })
    window.localStorage.setItem(KEY, 'not-json')
    expect(readWorkspaceState()).toEqual({ bookId: null, page: 'library', tabs: [] })
  })

  it('round-trips the tab list through storage', () => {
    const state = {
      bookId: 'book-2',
      page: 'notes' as const,
      tabs: [
        { bookId: 'book-1', page: 'reading' as const },
        { bookId: 'book-2', page: 'notes' as const }
      ]
    }
    saveWorkspaceState(state)
    expect(readWorkspaceState()).toEqual(state)
  })

  it('maps only book pages to tab pages', () => {
    expect(bookTabPage('reading')).toBe('reading')
    expect(bookTabPage('library')).toBeNull()
    expect(bookTabPage('archives')).toBeNull()
    expect(bookTabPage('conversation')).toBeNull()
  })
})
