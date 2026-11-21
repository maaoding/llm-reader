// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { LlmEvent, LlmRequest, ReaderApi } from '../../src/shared/contracts'
import type { ConversationTab, ConversationTurn } from '../../src/renderer/src/conversation-session'
import { useConversationRequests } from '../../src/renderer/src/use-conversation-requests'
import { deferred } from './support/deferred'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

function setup() {
  let listener: ((event: LlmEvent) => void) | undefined
  const startLlm = vi.fn<ReaderApi['startLlm']>().mockResolvedValue(undefined)
  const cancelLlm = vi.fn<ReaderApi['cancelLlm']>().mockResolvedValue(undefined)
  Object.defineProperty(window, 'readerApi', { configurable: true, value: {
    startLlm, cancelLlm,
    onLlmEvent: (next: typeof listener) => { listener = next; return () => { listener = undefined } }
  } })
  const conversationTabsRef = { current: [] as ConversationTab[] }
  const closingRef = { current: false }
  const updateConversationTab = vi.fn((tabId: string, update: (tab: ConversationTab) => ConversationTab) => {
    conversationTabsRef.current = conversationTabsRef.current.map((tab) => tab.id === tabId ? update(tab) : tab)
  })
  const persistArchiveHistory = vi.fn().mockResolvedValue(undefined)
  const reportProviderResult = vi.fn()
  const hook = renderHook(() => useConversationRequests({ conversationTabsRef, closingRef, updateConversationTab, persistArchiveHistory, reportProviderResult }))
  const enqueue = (id: string, options: { bookId?: string; archive?: boolean; revision?: number } = {}) => {
    const bookId = options.bookId ?? id
    const turn: ConversationTurn = { id, requestId: id, selection: null, action: 'ask', actionLabel: 'Ask', question: id, answer: '', model: '', status: 'queued' }
    conversationTabsRef.current.push({ id, bookId, kind: options.archive ? 'archive' : 'live', conversationId: id, title: id, selection: null, scope: 'book', turns: [turn], draft: '', persona: null, webSearch: 'off', ...(options.archive ? { insightId: `insight-${id}` } : {}) })
    const request: LlmRequest = { requestId: id, conversationId: id, action: 'ask', question: id, history: [], scope: 'book', bookId }
    act(() => hook.result.current.enqueueConversationRequest(id, request, options.revision ?? 1))
  }
  return {
    ...hook, enqueue, startLlm, cancelLlm, conversationTabsRef, closingRef, updateConversationTab, persistArchiveHistory, reportProviderResult,
    emit: (event: LlmEvent) => act(() => listener?.(event)),
    turn: (id: string) => conversationTabsRef.current.find((tab) => tab.id === id)!.turns[0],
    started: () => startLlm.mock.calls.map(([request]) => request.requestId)
  }
}

it('limits concurrency to two and advances in order after completion or a failed start', async () => {
  const view = setup()
  const failedStart = deferred<void>()
  view.startLlm.mockReturnValueOnce(failedStart.promise)
  for (const id of ['a', 'b', 'c', 'd']) view.enqueue(id)
  expect(view.started()).toEqual(['a', 'b'])
  expect(view.turn('c').status).toBe('queued')
  await act(async () => failedStart.reject(new Error('Start failed')))
  expect(view.started()).toEqual(['a', 'b', 'c'])
  expect(view.turn('a')).toMatchObject({ status: 'error', error: 'Start failed' })
  expect(view.reportProviderResult).toHaveBeenLastCalledWith(1, 'Start failed', 3)
  view.emit({ requestId: 'b', type: 'completed', model: 'test-model' })
  expect(view.started()).toEqual(['a', 'b', 'c', 'd'])
  expect(view.turn('b')).toMatchObject({ status: 'completed', model: 'test-model', durationMs: expect.any(Number) })
})

it('removes every queued and running request for a deleted book before filling its slots', async () => {
  const view = setup()
  view.enqueue('a', { bookId: 'deleted' })
  view.enqueue('b')
  view.enqueue('c', { bookId: 'deleted', archive: true })
  view.enqueue('d')
  view.emit({ requestId: 'a', type: 'delta', delta: 'Partial answer' })
  view.emit({ requestId: 'a', type: 'delta', delta: ' including buffered text' })
  await act(async () => view.result.current.cancelBookRequests('deleted'))
  expect(view.started()).toEqual(['a', 'b', 'd'])
  expect(view.cancelLlm).toHaveBeenCalledExactlyOnceWith('a')
  expect(view.turn('a')).toMatchObject({ answer: 'Partial answer including buffered text', status: 'error' })
  expect(view.turn('c').status).toBe('error')
  expect(view.result.current.hasConversationRequest('a')).toBe(false)
  expect(view.result.current.hasConversationRequest('c')).toBe(false)
  view.emit({ requestId: 'a', type: 'delta', delta: ' stale' })
  view.emit({ requestId: 'a', type: 'completed', model: 'old-model' })
  view.emit({ requestId: 'b', type: 'completed', model: 'test-model' })
  expect(view.started()).toEqual(['a', 'b', 'd'])
  expect(view.turn('a')).toMatchObject({ answer: 'Partial answer including buffered text', status: 'error' })
})

it('ignores late start failures and events after cancelling a request', async () => {
  const view = setup()
  const start = deferred<void>()
  const cancel = deferred<void>()
  view.startLlm.mockReturnValueOnce(start.promise)
  view.cancelLlm.mockReturnValueOnce(cancel.promise)
  view.enqueue('a')
  let cancellation!: Promise<void>
  act(() => { cancellation = view.result.current.cancelRequest('a') })
  const cancelledTurn = view.turn('a')
  view.emit({ requestId: 'a', type: 'delta', delta: 'Late answer' })
  await act(async () => start.reject(new Error('Late failure')))
  expect(view.turn('a')).toEqual(cancelledTurn)
  expect(view.reportProviderResult).not.toHaveBeenCalled()
  await act(async () => { cancel.resolve(); await cancellation })
})

it('cancels queued sessions without calling the provider and leaves other work running', async () => {
  const view = setup()
  for (const id of ['a', 'b', 'c']) view.enqueue(id)
  await act(async () => view.result.current.cancelTabRequests('c'))
  view.emit({ requestId: 'a', type: 'completed', model: 'test-model' })
  expect(view.started()).toEqual(['a', 'b'])
  expect(view.cancelLlm).not.toHaveBeenCalled()
  expect(view.turn('c').status).toBe('error')
  expect(view.result.current.hasConversationRequest('b')).toBe(true)
})

it('waits for cancellation on close without starting queued work and can resume after a failed close', async () => {
  const view = setup()
  for (const id of ['a', 'b', 'c']) view.enqueue(id)
  const cancel = deferred<void>()
  view.cancelLlm.mockReturnValueOnce(cancel.promise)
  view.closingRef.current = true
  let completed = false
  let closing!: Promise<void>
  await act(async () => { closing = view.result.current.cancelAllRequests().then(() => { completed = true }) })
  expect(completed).toBe(false)
  expect(view.started()).toEqual(['a', 'b'])
  expect(['a', 'b', 'c'].map((id) => view.turn(id).status)).toEqual(['error', 'error', 'error'])
  await act(async () => { cancel.resolve(); await closing })
  view.closingRef.current = false
  view.enqueue('d')
  expect(view.started()).toEqual(['a', 'b', 'd'])
})

it('preserves streamed usage and archive history and ignores duplicate terminal events', () => {
  const view = setup()
  view.enqueue('archive', { archive: true, revision: 7 })
  view.emit({ requestId: 'archive', type: 'delta', delta: 'Answer' })
  view.emit({ requestId: 'archive', type: 'usage', usage: { totalTokens: 42 } })
  view.emit({ requestId: 'archive', type: 'completed', model: 'test-model' })
  view.emit({ requestId: 'archive', type: 'error', code: 'LATE', message: 'Late error', retryable: false })
  expect(view.turn('archive')).toMatchObject({ answer: 'Answer', usage: { totalTokens: 42 }, status: 'completed' })
  expect(view.persistArchiveHistory).toHaveBeenCalledExactlyOnceWith('archive', 'insight-archive', [view.turn('archive')], null, 'off')
  expect(view.reportProviderResult).toHaveBeenCalledExactlyOnceWith(7, '', 0)
})

it('cancels active work on unmount and discards pending work and late failures', async () => {
  const view = setup()
  const start = deferred<void>()
  view.startLlm.mockReturnValueOnce(start.promise)
  for (const id of ['a', 'b', 'c']) view.enqueue(id)
  view.unmount()
  view.updateConversationTab.mockClear()
  await act(async () => start.reject(new Error('Late failure')))
  view.emit({ requestId: 'b', type: 'completed', model: 'test-model' })
  expect(view.cancelLlm.mock.calls).toEqual([['a'], ['b']])
  expect(view.started()).toEqual(['a', 'b'])
  expect(view.updateConversationTab).not.toHaveBeenCalled()
  expect(view.reportProviderResult).not.toHaveBeenCalled()
})

it('batches a thousand stream fragments into two state updates and archives the complete answer', () => {
  vi.useFakeTimers()
  const view = setup()
  view.enqueue('archive', { archive: true })
  view.updateConversationTab.mockClear()
  for (let i = 0; i < 1_000; i++) view.emit({ requestId: 'archive', type: 'delta', delta: '文😀' })
  expect(view.turn('archive').answer).toBe('文😀')
  expect(view.updateConversationTab).toHaveBeenCalledOnce()
  act(() => vi.advanceTimersByTime(32))
  expect(view.turn('archive').answer).toBe('文😀'.repeat(1_000))
  expect(view.updateConversationTab).toHaveBeenCalledTimes(2)
  view.emit({ requestId: 'archive', type: 'delta', delta: ' final' })
  view.emit({ requestId: 'archive', type: 'delta', delta: ' tail' })
  view.emit({ requestId: 'archive', type: 'completed', model: 'model' })
  expect(view.persistArchiveHistory).toHaveBeenCalledWith('archive', 'insight-archive', [expect.objectContaining({
    answer: '文😀'.repeat(1_000) + ' final tail', status: 'completed'
  })], null, 'off')
})

it('retains buffered text when starting fails after streaming has begun', async () => {
  const view = setup(), start = deferred<void>()
  view.startLlm.mockReturnValueOnce(start.promise)
  view.enqueue('a')
  view.emit({ requestId: 'a', type: 'delta', delta: 'first' })
  view.emit({ requestId: 'a', type: 'delta', delta: 'last' })
  await act(async () => start.reject(new Error('Interrupted')))
  expect(view.turn('a')).toMatchObject({ answer: 'firstlast', status: 'error', error: 'Interrupted' })
})
