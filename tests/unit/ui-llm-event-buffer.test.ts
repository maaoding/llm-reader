import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { LlmEvent } from '../../src/shared/contracts'
import { LlmEventBuffer } from '../../src/renderer/src/llm-event-buffer'

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

it('shows the first fragment immediately and combines a burst without losing Unicode or order', () => {
  const buffer = new LlmEventBuffer()
  const received: LlmEvent[] = []
  const emit = (event: LlmEvent) => { received.push(event) }
  const chunks = Array.from({ length: 1_000 }, (_, index) => `${index}😀中`)
  for (const delta of chunks) buffer.push({ type: 'delta', requestId: 'a', delta }, emit)
  expect(received).toEqual([{ type: 'delta', requestId: 'a', delta: chunks[0] }])
  vi.advanceTimersByTime(32)
  expect(received).toHaveLength(2)
  expect(received.map((event) => event.type === 'delta' ? event.delta : '').join('')).toBe(chunks.join(''))
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['completed', 'error', 'usage'] as const)('delivers all text before %s without waiting for a timer', (type) => {
  const buffer = new LlmEventBuffer()
  const emit = vi.fn()
  buffer.push({ type: 'delta', requestId: 'a', delta: 'first' }, emit)
  buffer.push({ type: 'delta', requestId: 'a', delta: 'last' }, emit)
  const event: LlmEvent = type === 'completed' ? { type, requestId: 'a', model: 'model' }
    : type === 'usage' ? { type, requestId: 'a', usage: { totalTokens: 2 } }
      : { type, requestId: 'a', code: 'CANCELLED', message: 'Stopped', retryable: false }
  buffer.push(event, emit)
  expect(emit.mock.calls.map(([item]) => item)).toEqual([
    { type: 'delta', requestId: 'a', delta: 'first' },
    { type: 'delta', requestId: 'a', delta: 'last' }, event
  ])
  expect(vi.getTimerCount()).toBe(0)
})

it('flushes one conversation without mixing or discarding another conversation', () => {
  const buffer = new LlmEventBuffer(), first = vi.fn(), second = vi.fn()
  buffer.push({ type: 'delta', requestId: 'a', delta: 'a1' }, first)
  buffer.push({ type: 'delta', requestId: 'b', delta: 'b1' }, second)
  buffer.push({ type: 'delta', requestId: 'a', delta: 'a2' }, first)
  buffer.push({ type: 'delta', requestId: 'b', delta: 'b2' }, second)
  buffer.flush('a')
  expect(first).toHaveBeenLastCalledWith({ type: 'delta', requestId: 'a', delta: 'a2' })
  expect(second).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(32)
  expect(second).toHaveBeenLastCalledWith({ type: 'delta', requestId: 'b', delta: 'b2' })
  expect(first).toHaveBeenCalledTimes(2)
})

it('does not leave timers or fragments behind after disposal', () => {
  const buffer = new LlmEventBuffer(), emit = vi.fn()
  buffer.push({ type: 'delta', requestId: 'a', delta: 'first' }, emit)
  buffer.push({ type: 'delta', requestId: 'a', delta: 'discarded' }, emit)
  buffer.dispose()
  vi.runAllTimers()
  expect(emit).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
