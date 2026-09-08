import { useCallback, useEffect, useRef, useState } from 'react'
import type { BookAnalysisState } from '@shared/contracts'
import { copy } from '@shared/copy'
import { readableError } from './readable-error'

export function useBookAnalysis() {
  const [states, setStates] = useState<Record<string, BookAnalysisState>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const revisions = useRef(new Map<string, number>())
  const refresh = useCallback(async (bookId: string) => {
    const revision = revisions.current.get(bookId) ?? 0
    try {
      const state = await window.readerApi.getBookAnalysis(bookId)
      if ((revisions.current.get(bookId) ?? 0) === revision) setStates((current) => ({ ...current, [bookId]: state }))
    } catch (error) { setErrors((current) => ({ ...current, [bookId]: readableError(error, copy('analysis.failed')) })) }
  }, [])
  useEffect(() => {
    const unsubscribe = window.readerApi.onBookAnalysisEvent((state) => {
      revisions.current.set(state.bookId, (revisions.current.get(state.bookId) ?? 0) + 1)
      setStates((current) => ({ ...current, [state.bookId]: state }))
    })
    return unsubscribe
  }, [])
  const start = useCallback(async (bookId: string, profileId: string, rebuild: boolean) => {
    setErrors((current) => ({ ...current, [bookId]: '' }))
    try {
      const state = await window.readerApi.startBookAnalysis({ bookId, profileId, rebuild })
      setStates((current) => ({ ...current, [bookId]: state }))
    } catch (error) {
      setErrors((current) => ({ ...current, [bookId]: readableError(error, copy('analysis.failed')) }))
    }
  }, [])
  const cancel = useCallback(async (bookId: string) => {
    try { await window.readerApi.cancelBookAnalysis(bookId) }
    catch (error) { setErrors((current) => ({ ...current, [bookId]: readableError(error, copy('analysis.failed')) })) }
  }, [])
  const prepare = useCallback(async (bookId: string, rebuild: boolean) => {
    setErrors((current) => ({ ...current, [bookId]: '' }))
    try {
      const state = await window.readerApi.prepareBookDocument({ bookId, rebuild })
      setStates((current) => ({ ...current, [bookId]: state }))
    } catch (error) { setErrors((current) => ({ ...current, [bookId]: readableError(error, '原文准备失败。') })) }
  }, [])
  const cancelPreparation = useCallback(async (bookId: string) => {
    try { await window.readerApi.cancelBookDocument(bookId) }
    catch (error) { setErrors((current) => ({ ...current, [bookId]: readableError(error, '无法停止原文准备。') })) }
  }, [])
  return { states, errors, refresh, start, cancel, prepare, cancelPreparation }
}
