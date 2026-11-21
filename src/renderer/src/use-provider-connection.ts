import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProviderOverview, ProviderSettings, ProviderTestResult } from '@shared/contracts'
import { copy } from '@shared/copy'
import { providerIsConfigured, publicRequestSettings } from '@shared/request-settings'
import { readableError } from './readable-error'

type ProviderConnectionStatus = 'not-configured' | 'checking' | 'connected' | 'disconnected'
interface ProviderConnectionState {
  status: ProviderConnectionStatus
  message: string
}

const EMPTY_PROVIDER: ProviderSettings = {
  compatibility: 'auto',
  baseUrl: 'https://api.openai.com',
  model: '',
  hasApiKey: false
}
const EMPTY_PROVIDER_OVERVIEW: ProviderOverview = { profiles: [], activeProfileId: null }

function activeProviderSettings(overview: ProviderOverview): ProviderSettings {
  const active = overview.profiles.find((profile) => profile.id === overview.activeProfileId)
  return active
    ? { ...publicRequestSettings(active), protocol: active.protocol, hasCustomHeaders: active.hasCustomHeaders, baseUrl: active.baseUrl, model: active.model, compatibility: active.compatibility, hasApiKey: active.hasApiKey }
    : EMPTY_PROVIDER
}

export function providerStatusLabel(status: ProviderConnectionStatus): string {
  if (status === 'checking') return copy('provider.statusChecking')
  if (status === 'connected') return copy('provider.statusConnected')
  if (status === 'disconnected') return copy('provider.statusDisconnected')
  return copy('provider.statusNotConfigured')
}

/** Owns provider restoration and connection checks; request results carry the
 * revision they started with so an older provider cannot change the new status. */
export function useProviderConnection(pushToast: (message: string, tone: 'error') => void) {
  const [providerOverview, setProviderOverview] = useState<ProviderOverview>(EMPTY_PROVIDER_OVERVIEW)
  const [provider, setProvider] = useState<ProviderSettings>(EMPTY_PROVIDER)
  const [providerConnection, setProviderConnection] = useState<ProviderConnectionState>({
    status: 'not-configured', message: providerStatusLabel('not-configured')
  })
  const providerRef = useRef(EMPTY_PROVIDER)
  const revisionRef = useRef(0)
  const checkSequenceRef = useRef(0)

  const commitProviderSettings = useCallback((settings: ProviderSettings): number => {
    const revision = ++revisionRef.current
    checkSequenceRef.current += 1
    providerRef.current = settings
    setProvider(settings)
    const status = providerIsConfigured(settings) ? 'checking' : 'not-configured'
    setProviderConnection({ status, message: providerStatusLabel(status) })
    return revision
  }, [])

  const runProviderCheck = useCallback(async (revision: number): Promise<ProviderTestResult & { current: boolean }> => {
    const sequence = ++checkSequenceRef.current
    if (revision === revisionRef.current) {
      setProviderConnection({ status: 'checking', message: providerStatusLabel('checking') })
    }
    let result: ProviderTestResult
    try {
      result = await window.readerApi.testProvider()
    } catch (error) {
      result = { ok: false, message: readableError(error, copy('provider.backgroundTestFailed')) }
    }
    const current = revision === revisionRef.current && sequence === checkSequenceRef.current
    if (current) {
      const status = result.ok ? 'connected' : 'disconnected'
      setProviderConnection({ status, message: result.message || providerStatusLabel(status) })
    }
    return { ...result, current }
  }, [])

  const handleProviderOverviewChange = useCallback((overview: ProviderOverview, checkActive: boolean): void => {
    setProviderOverview(overview)
    const settings = activeProviderSettings(overview)
    const previous = providerRef.current
    const changed = settings.baseUrl !== previous.baseUrl || settings.model !== previous.model || settings.hasApiKey !== previous.hasApiKey || settings.compatibility !== previous.compatibility || settings.protocol !== previous.protocol || JSON.stringify(publicRequestSettings(settings)) !== JSON.stringify(publicRequestSettings(previous)) || settings.hasCustomHeaders !== previous.hasCustomHeaders
    if (!checkActive && !changed) return
    const revision = commitProviderSettings(settings)
    if (!checkActive || !providerIsConfigured(settings)) return
    const check = runProviderCheck(revision)
    const sequence = checkSequenceRef.current
    void check.then((result) => {
      if (!result.ok && revision === revisionRef.current && sequence === checkSequenceRef.current) {
        pushToast(result.message || copy('provider.backgroundTestFailed'), 'error')
      }
    })
  }, [commitProviderSettings, pushToast, runProviderCheck])

  useEffect(() => {
    if (!window.readerApi) return undefined
    let alive = true
    void window.readerApi.getProviderOverview().catch(() => EMPTY_PROVIDER_OVERVIEW).then((overview) => {
      if (!alive || revisionRef.current !== 0) return
      setProviderOverview(overview)
      const settings = activeProviderSettings(overview)
      const revision = commitProviderSettings(settings)
      if (providerIsConfigured(settings)) void runProviderCheck(revision)
    })
    return () => {
      alive = false
      checkSequenceRef.current += 1
    }
  }, [commitProviderSettings, runProviderCheck])

  const getProviderRevision = useCallback((): number => revisionRef.current, [])
  const reportProviderResult = useCallback((revision: number, failure: string, pendingWork: number): void => {
    if (revision !== revisionRef.current || (failure && pendingWork > 0)) return
    checkSequenceRef.current += 1
    setProviderConnection(failure
      ? { status: 'disconnected', message: failure }
      : { status: 'connected', message: providerStatusLabel('connected') })
  }, [])

  return { providerOverview, provider, providerConnection, handleProviderOverviewChange, getProviderRevision, reportProviderResult }
}
