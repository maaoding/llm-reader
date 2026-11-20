// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useWorkbenches } from '../../src/renderer/src/use-workbenches'
import type { ReaderApi, WorkbenchRecord } from '../../src/shared/contracts'
import { deferred } from './support/deferred'

const record = (id: string): WorkbenchRecord => ({
  id, name: id, bookIds: ['book'], draft: 'Original draft', turns: [], webSearch: 'off', persona: null,
  createdAt: '2026-10-21', updatedAt: '2026-10-21'
})

async function setup(records = [record('first')], { visible = true, restore = true } = {}) {
  const api = {
    listWorkbenchSummaries: vi.fn<ReaderApi['listWorkbenchSummaries']>(async () => records.map(({ id, name, bookIds, turns }) => ({ id, name, bookIds, turnCount: turns.length }))),
    getWorkbench: vi.fn<ReaderApi['getWorkbench']>(async (id) => records.find((entry) => entry.id === id) ?? null),
    saveWorkbench: vi.fn<ReaderApi['saveWorkbench']>(async (payload) => ({ ...payload, createdAt: '', updatedAt: '' })),
    onLlmEvent: vi.fn<ReaderApi['onLlmEvent']>(() => () => undefined),
    cancelLlm: vi.fn(async () => undefined),
    startLlm: vi.fn<ReaderApi['startLlm']>(async () => undefined)
  }
  if (restore && records[0]) localStorage.setItem('llm-reader-workbench-active', records[0].id)
  Object.defineProperty(window, 'readerApi', { configurable: true, value: api })
  const hook = renderHook(({ visible }) => useWorkbenches([], false, visible), { initialProps: { visible } })
  await act(async () => undefined)
  return { ...hook, api }
}

beforeEach(() => { vi.useFakeTimers(); localStorage.clear() })
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })

it('loads summaries on first visit, reads only an opened record, and closes without saving clean records', async () => {
  const { result, api, rerender } = await setup([record('first'), record('second')], { visible: false, restore: false })
  expect(api.listWorkbenchSummaries).not.toHaveBeenCalled()
  await act(async () => { rerender({ visible: true }) })
  expect(result.current.summaries.map(({ id }) => id)).toEqual(['first', 'second'])
  expect(api.getWorkbench).not.toHaveBeenCalled()
  await act(async () => { result.current.activate('first') })
  expect(api.getWorkbench.mock.calls).toEqual([['first']])
  expect(result.current.active?.draft).toBe('Original draft')
  await act(async () => { expect(await result.current.beforeClose()).toBe(true) })
  expect(api.saveWorkbench).not.toHaveBeenCalled()
})

it('ignores a late workbench read after the user goes back and opens another history', async () => {
  const { result, api } = await setup([record('first'), record('second')], { restore: false })
  const pending = deferred<WorkbenchRecord>()
  api.getWorkbench.mockReturnValueOnce(pending.promise)
  await act(async () => { result.current.activate('first') })
  expect(result.current.loading).toBe(true)
  await act(async () => { result.current.activate(null) })
  await act(async () => { result.current.activate('second') })
  await act(async () => { pending.resolve(record('first')) })
  expect(result.current.active?.id).toBe('second')
  expect(result.current.records.map(({ id }) => id)).toEqual(['second'])
})

it('rejects closing when one workbench fails, still saves the others, and retries the latest draft', async () => {
  const { result, api } = await setup([record('first'), record('second')])
  await act(async () => { result.current.activate('second') })
  act(() => {
    result.current.update('first', (current) => ({ ...current, draft: 'First edit' }))
    result.current.update('second', (current) => ({ ...current, draft: 'Second edit' }))
  })
  api.saveWorkbench.mockImplementation(async (payload) => {
    if (payload.id === 'first') throw new Error('Synthetic disk failure')
    return { ...payload, createdAt: '', updatedAt: '' }
  })
  let approved = true
  await act(async () => { approved = await result.current.beforeClose() })
  expect(approved).toBe(false)
  expect(api.saveWorkbench.mock.calls.map(([payload]) => payload.id)).toEqual(['first', 'second'])
  expect(result.current.dirty).toEqual(['first'])
  expect(result.current.errors.first).toContain('Synthetic disk failure')

  act(() => {
    result.current.resumeAfterClose()
    result.current.update('first', (current) => ({ ...current, draft: 'Latest retained draft' }))
  })
  api.saveWorkbench.mockImplementation(async (payload) => ({ ...payload, createdAt: '', updatedAt: '' }))
  await act(async () => { await result.current.retrySaves() })
  expect(api.saveWorkbench).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'first', draft: 'Latest retained draft' }))
  expect(result.current.records[0].draft).toBe('Latest retained draft')
  expect(result.current.dirty).toEqual([])
  expect(result.current.errors.first).toBe('')
  const completedWrites = api.saveWorkbench.mock.calls.length
  await act(async () => { await result.current.retrySaves() })
  expect(api.saveWorkbench).toHaveBeenCalledTimes(completedWrites)
})

it('keeps dirty data and rejects an unsuccessful explicit retry', async () => {
  const { result, api } = await setup()
  act(() => { result.current.update('first', (current) => ({ ...current, draft: 'Unsaved draft' })) })
  api.saveWorkbench.mockRejectedValue(new Error('Still unavailable'))
  await act(async () => { await expect(result.current.retrySaves()).rejects.toThrow('Still unavailable') })
  expect(result.current.records[0].draft).toBe('Unsaved draft')
  expect(result.current.dirty).toEqual(['first'])
  expect(result.current.errors.first).toContain('Still unavailable')
})

it('waits for edits made during a slow closing save and clears their errors only after the latest write succeeds', async () => {
  const { result, api } = await setup()
  const first = deferred<void>(), latest = deferred<void>()
  api.saveWorkbench.mockImplementationOnce(async (payload) => {
    await first.promise
    return { ...payload, createdAt: '', updatedAt: '' }
  }).mockImplementationOnce(async (payload) => {
    await latest.promise
    return { ...payload, createdAt: '', updatedAt: '' }
  })
  let close!: Promise<boolean>
  let approved: boolean | undefined
  act(() => { result.current.update('first', (current) => ({ ...current, draft: 'Before close' })) })
  await act(async () => { close = result.current.beforeClose(); void close.then((value) => { approved = value }) })
  act(() => { result.current.update('first', (current) => ({ ...current, draft: 'Written while saving' })) })
  await act(async () => { first.resolve(); await Promise.resolve() })
  expect(api.saveWorkbench).toHaveBeenCalledTimes(2)
  expect(api.saveWorkbench).toHaveBeenLastCalledWith(expect.objectContaining({ draft: 'Written while saving' }))
  expect(result.current.dirty).toEqual(['first'])
  expect(approved).toBeUndefined()
  await act(async () => { latest.resolve(); await close })
  expect(approved).toBe(true)
  expect(result.current.dirty).toEqual([])
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  expect(api.saveWorkbench).toHaveBeenCalledTimes(2)
})

it('permits new questions after a rejected close is resumed', async () => {
  const { result, api } = await setup()
  act(() => { result.current.update('first', (current) => ({ ...current, draft: 'Draft for retry' })) })
  api.saveWorkbench.mockRejectedValueOnce(new Error('Synthetic write failure'))
  await act(async () => { expect(await result.current.beforeClose()).toBe(false) })
  await act(async () => { await result.current.submit('first', 'model') })
  expect(api.startLlm).not.toHaveBeenCalled()
  act(() => { result.current.resumeAfterClose() })
  await act(async () => { await result.current.submit('first', 'model') })
  expect(api.startLlm).toHaveBeenCalledOnce()
  expect(api.startLlm).toHaveBeenCalledWith(expect.objectContaining({ question: 'Draft for retry', scope: 'books' }))
})

it('saves a newer revision after an older in-flight write fails, without leaving a stale error', async () => {
  const { result, api } = await setup()
  const old = deferred<void>()
  api.saveWorkbench.mockImplementationOnce(async (payload) => {
    await old.promise
    return { ...payload, createdAt: '', updatedAt: '' }
  })
  let close!: Promise<boolean>
  act(() => { result.current.update('first', (current) => ({ ...current, draft: 'Earlier draft' })) })
  await act(async () => { close = result.current.beforeClose() })
  act(() => { result.current.update('first', (current) => ({ ...current, draft: 'Newer draft' })) })
  await act(async () => { old.reject(new Error('Old write failed')); expect(await close).toBe(true) })
  expect(api.saveWorkbench).toHaveBeenCalledTimes(2)
  expect(api.saveWorkbench).toHaveBeenLastCalledWith(expect.objectContaining({ draft: 'Newer draft' }))
  expect(result.current.dirty).toEqual([])
  expect(result.current.errors.first).toBe('')
})

it('revisits a workbench edited while another workbench is still saving on close', async () => {
  const { result, api } = await setup([record('first'), record('second')])
  await act(async () => { result.current.activate('second') })
  const second = deferred<void>()
  api.saveWorkbench.mockImplementation(async (payload) => {
    if (payload.id === 'second') await second.promise
    return { ...payload, createdAt: '', updatedAt: '' }
  })
  let close!: Promise<boolean>
  act(() => {
    result.current.update('first', (current) => ({ ...current, draft: 'First edit' }))
    result.current.update('second', (current) => ({ ...current, draft: 'Second edit' }))
  })
  await act(async () => { close = result.current.beforeClose() })
  expect(api.saveWorkbench).toHaveBeenCalledTimes(2)
  act(() => { result.current.update('first', (current) => ({ ...current, draft: 'Edit after first saved' })) })
  await act(async () => { second.resolve(); expect(await close).toBe(true) })
  expect(api.saveWorkbench).toHaveBeenCalledTimes(3)
  expect(api.saveWorkbench).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'first', draft: 'Edit after first saved' }))
  expect(result.current.dirty).toEqual([])
})

it('saves all buffered text when closing a streaming workbench', async () => {
  const { result, api } = await setup()
  await act(async () => { await result.current.submit('first', 'model') })
  const requestId = api.startLlm.mock.calls[0][0].requestId
  const emit = api.onLlmEvent.mock.calls.at(-1)![0]
  act(() => {
    emit({ type: 'delta', requestId, delta: 'first' })
    emit({ type: 'delta', requestId, delta: 'last' })
  })
  expect(result.current.records[0].turns[0].answer).toBe('first')
  await act(async () => { expect(await result.current.beforeClose()).toBe(true) })
  expect(api.saveWorkbench).toHaveBeenLastCalledWith(expect.objectContaining({ turns: [expect.objectContaining({ answer: 'firstlast', status: 'error' })] }))
  const saved = api.saveWorkbench.mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
  expect(api.saveWorkbench).toHaveBeenCalledTimes(saved)
})

it('flushes the final fragment before saving a completed workbench', async () => {
  const { result, api } = await setup()
  await act(async () => { await result.current.submit('first', 'model') })
  const requestId = api.startLlm.mock.calls[0][0].requestId
  const emit = api.onLlmEvent.mock.calls.at(-1)![0]
  await act(async () => {
    emit({ type: 'delta', requestId, delta: 'first' })
    emit({ type: 'delta', requestId, delta: 'last' })
    emit({ type: 'completed', requestId, model: 'test-model' })
  })
  expect(api.saveWorkbench).toHaveBeenLastCalledWith(expect.objectContaining({ turns: [expect.objectContaining({ answer: 'firstlast', status: 'completed', model: 'test-model' })] }))
  act(() => emit({ type: 'delta', requestId, delta: 'stale' }))
  expect(result.current.records[0].turns[0].answer).toBe('firstlast')
})

it('preserves cancellation and its buffered text when starting fails late', async () => {
  const { result, api } = await setup(), start = deferred<void>()
  api.startLlm.mockReturnValueOnce(start.promise)
  let submit!: Promise<void>
  await act(async () => { submit = result.current.submit('first', 'model') })
  const requestId = api.startLlm.mock.calls[0][0].requestId
  const emit = api.onLlmEvent.mock.calls.at(-1)![0]
  act(() => {
    emit({ type: 'delta', requestId, delta: 'first' })
    emit({ type: 'delta', requestId, delta: 'last' })
  })
  await act(async () => { await result.current.cancel('first') })
  const cancelled = result.current.records[0].turns[0]
  expect(cancelled).toMatchObject({ answer: 'firstlast', status: 'error' })
  await act(async () => { start.reject(new Error('Late failure')); await submit })
  expect(result.current.records[0].turns[0]).toEqual(cancelled)
})
