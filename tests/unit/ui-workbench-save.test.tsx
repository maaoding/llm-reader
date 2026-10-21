// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useWorkbenches } from '../../src/renderer/src/use-workbenches'
import type { ReaderApi, WorkbenchRecord } from '../../src/shared/contracts'

const record = (id: string): WorkbenchRecord => ({
  id, name: id, bookIds: ['book'], draft: 'Original draft', turns: [], webSearch: 'off', persona: null,
  createdAt: '2026-10-21', updatedAt: '2026-10-21'
})

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

async function setup(records = [record('first')]) {
  const api = {
    listWorkbenches: vi.fn(async () => records),
    saveWorkbench: vi.fn<ReaderApi['saveWorkbench']>(async (payload) => ({ ...payload, createdAt: '', updatedAt: '' })),
    onLlmEvent: vi.fn(() => () => undefined),
    cancelLlm: vi.fn(async () => undefined),
    startLlm: vi.fn(async () => undefined)
  }
  Object.defineProperty(window, 'readerApi', { configurable: true, value: api })
  const hook = renderHook(() => useWorkbenches([], false))
  await act(async () => undefined)
  return { ...hook, api }
}

beforeEach(() => { vi.useFakeTimers(); localStorage.clear() })
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })

it('rejects closing when one workbench fails, still saves the others, and retries the latest draft', async () => {
  const { result, api } = await setup([record('first'), record('second')])
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
  const first = deferred(), latest = deferred()
  api.saveWorkbench.mockImplementationOnce(async (payload) => {
    await first.promise
    return { ...payload, createdAt: '', updatedAt: '' }
  }).mockImplementationOnce(async (payload) => {
    await latest.promise
    return { ...payload, createdAt: '', updatedAt: '' }
  })
  let close!: Promise<boolean>
  let approved: boolean | undefined
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
  api.saveWorkbench.mockRejectedValueOnce(new Error('Synthetic write failure'))
  await act(async () => { expect(await result.current.beforeClose()).toBe(false) })
  await act(async () => { await result.current.submit('first', 'model') })
  expect(api.startLlm).not.toHaveBeenCalled()
  act(() => { result.current.resumeAfterClose() })
  await act(async () => { await result.current.submit('first', 'model') })
  expect(api.startLlm).toHaveBeenCalledOnce()
  expect(api.startLlm).toHaveBeenCalledWith(expect.objectContaining({ question: 'Original draft', scope: 'books' }))
})

it('saves a newer revision after an older in-flight write fails, without leaving a stale error', async () => {
  const { result, api } = await setup()
  const old = deferred()
  api.saveWorkbench.mockImplementationOnce(async (payload) => {
    await old.promise
    return { ...payload, createdAt: '', updatedAt: '' }
  })
  let close!: Promise<boolean>
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
  const second = deferred()
  api.saveWorkbench.mockImplementation(async (payload) => {
    if (payload.id === 'second') await second.promise
    return { ...payload, createdAt: '', updatedAt: '' }
  })
  let close!: Promise<boolean>
  await act(async () => { close = result.current.beforeClose() })
  expect(api.saveWorkbench).toHaveBeenCalledTimes(2)
  act(() => { result.current.update('first', (current) => ({ ...current, draft: 'Edit after first saved' })) })
  await act(async () => { second.resolve(); expect(await close).toBe(true) })
  expect(api.saveWorkbench).toHaveBeenCalledTimes(3)
  expect(api.saveWorkbench).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'first', draft: 'Edit after first saved' }))
  expect(result.current.dirty).toEqual([])
})
