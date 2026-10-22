// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReaderApi } from '../../src/shared/contracts'
import { useAppClose } from '../../src/renderer/src/use-app-close'

function setup() {
  let beforeClose!: Parameters<ReaderApi['onBeforeClose']>[0]
  let closeCancelled!: () => void
  Object.defineProperty(window, 'readerApi', { configurable: true, value: {
    onBeforeClose: (listener: typeof beforeClose) => { beforeClose = listener; return () => undefined },
    onCloseCancelled: (listener: typeof closeCancelled) => { closeCancelled = listener; return () => undefined }
  } })
  const options = {
    closingRef: { current: false },
    isBusy: vi.fn(() => false),
    prepareClose: vi.fn(async () => undefined),
    flushSessions: vi.fn(async () => true),
    closeWorkbenches: vi.fn(async () => true),
    resumeWorkbenches: vi.fn(),
    retryWorkbenchSaves: vi.fn(async () => undefined),
    retryTabRestoration: vi.fn()
  }
  const hook = renderHook(() => useAppClose(options))
  return { ...hook, options, requestClose: () => beforeClose(), cancelInstallation: () => closeCancelled() }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('keeps the window editable after a failed save and retries without authorizing exit', async () => {
  const { result, options, requestClose } = setup()
  options.flushSessions.mockResolvedValueOnce(false)
  await act(async () => { expect(await requestClose()).toBe(false) })
  expect(result.current.closing).toBe(false)
  expect(options.closingRef.current).toBe(false)
  expect(result.current.closeSaveFailed).toBe(true)
  expect(options.closeWorkbenches).toHaveBeenCalledOnce()
  expect(options.resumeWorkbenches).toHaveBeenCalledOnce()

  await act(async () => { await result.current.retrySessionSaves() })
  expect(options.retryWorkbenchSaves).toHaveBeenCalledOnce()
  expect(result.current.closeSaveFailed).toBe(false)
  expect(result.current.closing).toBe(false)
  expect(options.prepareClose).toHaveBeenCalledOnce()
  await act(async () => { expect(await requestClose()).toBe(true) })
  expect(result.current.closing).toBe(true)
})

it('waits for both kinds of sessions and rejects duplicate close requests while saving', async () => {
  const { result, options, requestClose } = setup()
  let finishSessions!: (saved: boolean) => void
  let finishWorkbenches!: (saved: boolean) => void
  options.flushSessions.mockReturnValueOnce(new Promise((resolve) => { finishSessions = resolve }))
  options.closeWorkbenches.mockReturnValueOnce(new Promise((resolve) => { finishWorkbenches = resolve }))
  let closing!: boolean | Promise<boolean>
  let approved: boolean | undefined
  await act(async () => { closing = requestClose(); void Promise.resolve(closing).then((value) => { approved = value }) })
  expect(result.current.closing).toBe(true)
  await act(async () => { expect(await requestClose()).toBe(false); finishSessions(true) })
  expect(approved).toBeUndefined()
  await act(async () => { finishWorkbenches(false); expect(await closing).toBe(false) })
  expect(result.current.closing).toBe(false)
  expect(result.current.closeSaveFailed).toBe(true)
})

it('restores editing and restoration retries when preparing to close throws', async () => {
  const { result, options, requestClose } = setup()
  options.prepareClose.mockRejectedValueOnce(new Error('Progress write failed'))
  await act(async () => { await expect(requestClose()).rejects.toThrow('Progress write failed') })
  expect(options.closingRef.current).toBe(false)
  expect(result.current.closing).toBe(false)
  expect(result.current.closeSaveFailed).toBe(true)
  expect(options.retryTabRestoration).toHaveBeenCalledOnce()
  expect(options.resumeWorkbenches).toHaveBeenCalledOnce()
})

it('defers closing during a session operation and restores the guard after installation is cancelled', async () => {
  const { result, options, requestClose, cancelInstallation } = setup()
  options.isBusy.mockReturnValueOnce(true)
  await act(async () => { expect(await requestClose()).toBe(false) })
  expect(options.prepareClose).not.toHaveBeenCalled()
  await act(async () => { expect(await requestClose()).toBe(true) })
  act(() => cancelInstallation())
  expect(result.current.closing).toBe(false)
  expect(options.closingRef.current).toBe(false)
  expect(options.resumeWorkbenches).toHaveBeenCalledOnce()
  await act(async () => { expect(await requestClose()).toBe(true) })
  expect(options.prepareClose).toHaveBeenCalledTimes(2)
})
