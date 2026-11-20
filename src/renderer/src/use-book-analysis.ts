import { useCallback, useEffect, useRef, useState } from 'react'
import type { BookAnalysisState } from '@shared/contracts'
import { copy } from '@shared/copy'
import { readableError } from './readable-error'

export function useBookAnalysis() {
  const [states, setStates] = useState<Record<string, BookAnalysisState>>({})
  const [errors, setErrors] = useState<Record<string, { load?: string; notes?: string; document?: string }>>({})
  const revisions = useRef(new Map<string, number>())
  const settingsRevision = useRef(0)
  const [settingsVersion, setSettingsVersion] = useState(0)
  const trackRequest = useCallback((bookId: string) => {
    const revision = (revisions.current.get(bookId) ?? 0) + 1
    const settings = settingsRevision.current
    revisions.current.set(bookId, revision)
    return () => settingsRevision.current === settings && revisions.current.get(bookId) === revision
  }, [])

  const refresh = useCallback(async (bookId: string) => {
    const isCurrent = trackRequest(bookId)
    try {
      const state = await window.readerApi.getBookAnalysis(bookId)
      if (isCurrent()) {
        setStates((current) => ({ ...current, [bookId]: state }))
        setErrors((current) => ({ ...current, [bookId]: { ...current[bookId], load: '' } }))
      }
    } catch (error) {
      if (isCurrent()) setErrors((current) => ({ ...current, [bookId]: { ...current[bookId], load: readableError(error, copy('analysis.failed')) } }))
    }
  }, [trackRequest])
  useEffect(() => {
    const unsubscribeProgress = window.readerApi.onBookAnalysisEvent((state) => {
      revisions.current.set(state.bookId, (revisions.current.get(state.bookId) ?? 0) + 1)
      setStates((current) => ({ ...current, [state.bookId]: state }))
    })
    const unsubscribeSettings = window.readerApi.onBookAnalysisSettingsChanged(() => {
      setSettingsVersion(++settingsRevision.current)
    })
    return () => { unsubscribeProgress(); unsubscribeSettings() }
  }, [])
  const start = useCallback(async (bookId: string, profileId: string, rebuild: boolean) => {
    const isCurrent = trackRequest(bookId)
    setErrors((current) => ({ ...current, [bookId]: { ...current[bookId], notes: '' } }))
    try {
      const state = await window.readerApi.startBookAnalysis({ bookId, profileId, rebuild })
      if (isCurrent()) setStates((current) => ({ ...current, [bookId]: state }))
    } catch (error) {
      setErrors((current) => ({ ...current, [bookId]: { ...current[bookId], notes: readableError(error, copy('analysis.failed')) } }))
    }
  }, [trackRequest])
  const cancel = useCallback(async (bookId: string) => {
    try { await window.readerApi.cancelBookAnalysis(bookId) }
    catch (error) { setErrors((current) => ({ ...current, [bookId]: { ...current[bookId], notes: readableError(error, copy('analysis.failed')) } })) }
  }, [])
  const prepare = useCallback(async (bookId: string, rebuild: boolean) => {
    const isCurrent = trackRequest(bookId)
    setErrors((current) => ({ ...current, [bookId]: { ...current[bookId], document: '' } }))
    try {
      const state = await window.readerApi.prepareBookDocument({ bookId, rebuild })
      if (isCurrent()) setStates((current) => ({ ...current, [bookId]: state }))
    } catch (error) { setErrors((current) => ({ ...current, [bookId]: { ...current[bookId], document: readableError(error, copy('preparation.document.error')) } })) }
  }, [trackRequest])
  const cancelPreparation = useCallback(async (bookId: string) => {
    try { await window.readerApi.cancelBookDocument(bookId) }
    catch (error) { setErrors((current) => ({ ...current, [bookId]: { ...current[bookId], document: readableError(error, copy('preparation.stopFailed')) } })) }
  }, [])
  return { states, errors, settingsVersion, refresh, start, cancel, prepare, cancelPreparation }
}
