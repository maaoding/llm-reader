// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReaderApi } from '../../src/shared/contracts'
import { useAppClose } from '../../src/renderer/src/use-app-close'

function setup(canLeaveWorkspace?: () => boolean) {
  let beforeClose!: Parameters<ReaderApi['onBeforeClose']>[0]
  let closeCancelled!: () => void
  Object.defineProperty(window, 'readerApi', { configurable: true, value: {
    onBeforeClose: (listener: typeof beforeClose) => { beforeClose = listener; return () => undefined },
    onCloseCancelled: (listener: typeof closeCancelled) => { closeCancelled = listener; return () => undefined }
  } })
  const options = {
    closingRef: { current: false },
    canLeaveWorkspace,
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

it('does not close or start maintenance while an annotation draft blocks the workspace', async () => {
  const guard = vi.fn(() => false)
  const { result, options, requestClose } = setup(guard)
  const operation = vi.fn(async () => undefined)
  await act(async () => {
    expect(await requestClose()).toBe(false)
    await expect(result.current.runStorageOperation(operation)).rejects.toThrow()
  })
  expect(options.prepareClose).not.toHaveBeenCalled()
  expect(operation).not.toHaveBeenCalled()
  expect(result.current.closeSaveFailed).toBe(false)
  guard.mockReturnValue(true)
  await act(async () => { await result.current.runStorageOperation(operation) })
  expect(operation).toHaveBeenCalledOnce()
})

it('saves both workspaces before maintenance and resumes editing after failure', async () => {
  const { result, options } = setup()
  const operation = vi.fn(async () => {
    expect(options.closingRef.current).toBe(true)
    expect(options.flushSessions).toHaveBeenCalledOnce()
    expect(options.closeWorkbenches).toHaveBeenCalledOnce()
    throw new Error('backup failed')
  })
  await act(async () => { await expect(result.current.runStorageOperation(operation)).rejects.toThrow('backup failed') })
  expect(result.current.closing).toBe(false)
  expect(result.current.storageWorking).toBe(false)
  expect(options.resumeWorkbenches).toHaveBeenCalledOnce()
})

it('never starts maintenance when saving the latest drafts fails', async () => {
  const { result, options } = setup()
  const operation = vi.fn(async () => undefined)
  options.flushSessions.mockResolvedValueOnce(false)
  await act(async () => { await expect(result.current.runStorageOperation(operation)).rejects.toThrow() })
  expect(operation).not.toHaveBeenCalled()
  expect(options.closingRef.current).toBe(false)
  expect(result.current.storageWorking).toBe(false)
})

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
