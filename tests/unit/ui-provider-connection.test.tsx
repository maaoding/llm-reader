// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ProviderOverview, ProviderTestResult, ReaderApi } from '../../src/shared/contracts'
import { useProviderConnection } from '../../src/renderer/src/use-provider-connection'
import { deferred } from './support/deferred'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function overview(id: string): ProviderOverview {
  return { activeProfileId: id, profiles: [{
    id, name: id, isActive: true, createdAt: '', updatedAt: '',
    baseUrl: `https://${id}.example.test`, model: id, hasApiKey: true, compatibility: 'auto'
  }] }
}

function setup() {
  const restored = deferred<ProviderOverview>()
  const testProvider = vi.fn<ReaderApi['testProvider']>().mockResolvedValue({ ok: true, message: 'Connected' })
  Object.defineProperty(window, 'readerApi', { configurable: true, value: {
    getProviderOverview: () => restored.promise, testProvider
  } })
  const pushToast = vi.fn()
  return { ...renderHook(() => useProviderConnection(pushToast)), restored, testProvider, pushToast }
}

it('does not restore an old provider over a configuration chosen during startup', async () => {
  const view = setup()
  await act(async () => view.result.current.handleProviderOverviewChange(overview('new'), true))
  const revision = view.result.current.getProviderRevision()
  await act(async () => view.restored.resolve(overview('old')))
  expect(view.result.current.provider.model).toBe('new')
  expect(view.result.current.providerOverview.activeProfileId).toBe('new')
  expect(view.result.current.getProviderRevision()).toBe(revision)
  expect(view.testProvider).toHaveBeenCalledOnce()
})

it('ignores failures from checks and requests belonging to a previous provider', async () => {
  const view = setup()
  const oldCheck = deferred<ProviderTestResult>()
  view.testProvider.mockReturnValueOnce(oldCheck.promise)
  await act(async () => view.restored.resolve(overview('old')))
  const revision = view.result.current.getProviderRevision()
  await act(async () => view.result.current.handleProviderOverviewChange(overview('new'), true))
  await act(async () => oldCheck.resolve({ ok: false, message: 'Old provider failed' }))
  act(() => view.result.current.reportProviderResult(revision, 'Old request failed', 0))
  expect(view.result.current.providerConnection).toEqual({ status: 'connected', message: 'Connected' })
  expect(view.pushToast).not.toHaveBeenCalled()
})

it('keeps a concurrent failure from overriding a healthy connection and gives requests precedence over an older check', async () => {
  const view = setup()
  const check = deferred<ProviderTestResult>()
  view.testProvider.mockReturnValueOnce(check.promise)
  await act(async () => view.restored.resolve(overview('active')))
  const revision = view.result.current.getProviderRevision()
  act(() => view.result.current.reportProviderResult(revision, '', 1))
  act(() => view.result.current.reportProviderResult(revision, 'Concurrent failure', 1))
  await act(async () => check.resolve({ ok: false, message: 'Obsolete check' }))
  expect(view.result.current.providerConnection.status).toBe('connected')
  act(() => view.result.current.reportProviderResult(revision, 'Last request failed', 0))
  expect(view.result.current.providerConnection).toEqual({ status: 'disconnected', message: 'Last request failed' })
})

it('keeps the revision for inactive profile edits but rechecks an explicitly changed active profile', async () => {
  const view = setup()
  const initial = overview('active')
  await act(async () => view.restored.resolve(initial))
  const revision = view.result.current.getProviderRevision()
  const edited = { ...initial, profiles: [...initial.profiles, { ...overview('inactive').profiles[0], isActive: false }] }
  act(() => view.result.current.handleProviderOverviewChange(edited, false))
  expect(view.result.current.getProviderRevision()).toBe(revision)
  expect(view.result.current.providerOverview.profiles).toHaveLength(2)
  view.testProvider.mockResolvedValueOnce({ ok: false, message: 'New credentials failed' })
  await act(async () => view.result.current.handleProviderOverviewChange(edited, true))
  expect(view.result.current.getProviderRevision()).toBeGreaterThan(revision)
  expect(view.pushToast).toHaveBeenCalledExactlyOnceWith('New credentials failed', 'error')
})

it('discards background check notifications after unmount', async () => {
  const view = setup()
  const check = deferred<ProviderTestResult>()
  view.testProvider.mockReturnValueOnce(check.promise)
  act(() => view.result.current.handleProviderOverviewChange(overview('active'), true))
  view.unmount()
  await act(async () => check.resolve({ ok: false, message: 'Late failure' }))
  expect(view.pushToast).not.toHaveBeenCalled()
})
