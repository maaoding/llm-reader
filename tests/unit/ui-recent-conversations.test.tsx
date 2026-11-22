// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { BookSessionSearchResult } from '../../src/shared/contracts'
import { RecentConversations } from '../../src/renderer/src/RecentConversations'
import { deferred } from './support/deferred'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

function result(title: string): BookSessionSearchResult {
  return { hasMore: false, matches: [{
    bookId: 'book', bookTitle: '样本书', conversationId: title, scope: 'book', title,
    matchField: 'question', excerpt: title, updatedAt: '2026-10-01T00:00:00Z', turnCount: 1
  }] }
}

it('ignores late local search results after a query change or reopen', async () => {
  vi.useFakeTimers()
  const first = deferred<BookSessionSearchResult>()
  const second = deferred<BookSessionSearchResult>()
  const third = deferred<BookSessionSearchResult>()
  const searchRecentBookSessions = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise)
  vi.stubGlobal('readerApi', { searchRecentBookSessions })
  render(<RecentConversations disabled={false} onRestore={vi.fn()} />)
  const trigger = screen.getByTestId('library-recent-conversations')
  fireEvent.click(trigger)
  const query = screen.getByTestId('recent-conversation-query')
  expect(document.activeElement).toBe(query)
  fireEvent.change(query, { target: { value: '旧查询' } })
  act(() => { vi.advanceTimersByTime(200) })
  fireEvent.change(query, { target: { value: '新查询' } })
  act(() => { vi.advanceTimersByTime(200) })
  await act(async () => { second.resolve(result('新查询')) })
  await act(async () => { first.resolve(result('旧查询')) })
  expect(screen.getByTestId('recent-conversation-result').textContent).toContain('新查询')
  expect(screen.queryByText('旧查询')).toBeNull()

  fireEvent.change(query, { target: { value: '关闭时仍在读取' } })
  act(() => { vi.advanceTimersByTime(200) })
  fireEvent.keyDown(query, { key: 'Escape' })
  expect(document.activeElement).toBe(trigger)
  fireEvent.click(trigger)
  await act(async () => { third.resolve(result('关闭时仍在读取')) })
  expect(screen.queryByTestId('recent-conversation-result')).toBeNull()
  expect((screen.getByTestId('recent-conversation-query') as HTMLInputElement).value).toBe('')
})

it('removes a stale search result when its saved conversation no longer exists', async () => {
  vi.useFakeTimers()
  const searchRecentBookSessions = vi.fn().mockResolvedValue(result('已经删除的记录'))
  const onRestore = vi.fn().mockResolvedValue('missing')
  vi.stubGlobal('readerApi', { searchRecentBookSessions })
  render(<RecentConversations disabled={false} onRestore={onRestore} />)
  fireEvent.click(screen.getByTestId('library-recent-conversations'))
  fireEvent.change(screen.getByTestId('recent-conversation-query'), { target: { value: '已经删除' } })
  await act(async () => { vi.advanceTimersByTime(200) })
  await act(async () => { fireEvent.click(screen.getByTestId('recent-conversation-result')) })
  expect(onRestore).toHaveBeenCalledExactlyOnceWith('book', '已经删除的记录', expect.any(AbortSignal))
  expect(screen.queryByTestId('recent-conversation-result')).toBeNull()
  expect(screen.getByRole('alert').textContent).toContain('不在最近保留的记录中')
})
