import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MAX_WORKBENCH_TURNS, type BookRecord, type PersonaSelection, type WorkbenchInput, type WorkbenchRecord, type WorkbenchSummary } from '@shared/contracts'
import { copy } from '@shared/copy'
import { readableError } from './readable-error'
import { LlmEventBuffer, subscribeToBufferedLlmEvents } from './llm-event-buffer'

const ACTIVE_KEY = 'llm-reader-workbench-active'
const input = ({ id, name, bookIds, draft, turns, webSearch, persona }: WorkbenchRecord): WorkbenchInput => ({ id, name, bookIds, draft, turns, webSearch, persona })
export const workbenchBusy = (record: WorkbenchRecord): boolean => record.turns.some((turn) => turn.status === 'queued' || turn.status === 'streaming')

/** Mounted with the application: leaving the workbench view never drops its requests or pending writes. */
export function useWorkbenches(books: BookRecord[], libraryReady: boolean, visible: boolean) {
  const [records, setRecords] = useState<WorkbenchRecord[]>([])
  const recordsRef = useRef(records)
  const [activeId, setActiveId] = useState<string | null>(() => { try { return localStorage.getItem(ACTIVE_KEY) } catch { return null } })
  const activeIdRef = useRef(activeId)
  const [summaries, setSummaries] = useState<WorkbenchSummary[] | null>(null)
  const loadingList = useRef(false)
  const [loadError, setLoadError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [detailAttempt, setDetailAttempt] = useState(0)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState<string[]>([])
  const dirtyIds = useRef(new Set<string>())
  const revisions = useRef(new Map<string, number>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const writes = useRef(new Map<string, { revision: number; promise: Promise<void> }>())
  const requests = useRef(new Map<string, string>())
  const requestStartedAt = useRef(new Map<string, number>())
  const closing = useRef(false)
  const [events] = useState(() => new LlmEventBuffer())
  const publish = useCallback((next: WorkbenchRecord[]) => { recordsRef.current = next; setRecords(next) }, [])

  const activate = useCallback((id: string | null) => {
    activeIdRef.current = id
    setActiveId(id)
    setDetailError('')
    try { if (id) localStorage.setItem(ACTIVE_KEY, id); else localStorage.removeItem(ACTIVE_KEY) } catch { /* State remains usable without localStorage. */ }
  }, [])

  const load = useCallback(async () => {
    if (loadingList.current) return
    loadingList.current = true
    setLoadError('')
    try { setSummaries(await window.readerApi.listWorkbenchSummaries()) }
    catch (error) { setLoadError(readableError(error, copy('workbench.loadFailed'))) }
    finally { loadingList.current = false }
  }, [])
  useEffect(() => { if (visible && !summaries) void load() }, [visible, summaries, load])

  const selectedId = summaries?.some((summary) => summary.id === activeId) ? activeId : null
  const active = records.find((record) => record.id === selectedId)
  useEffect(() => {
    if (!visible || !selectedId || active) return
    let watching = true
    const isCurrent = (): boolean => watching && activeIdRef.current === selectedId
    void window.readerApi.getWorkbench(selectedId).then((record) => {
      if (!isCurrent()) return
      if (record) {
        publish([...recordsRef.current, record])
      } else {
        setSummaries((current) => current?.filter((summary) => summary.id !== selectedId) ?? null)
        activate(null)
      }
    }).catch((error: unknown) => {
      if (isCurrent()) setDetailError(readableError(error, copy('workbench.loadFailed')))
    })
    return () => { watching = false }
  }, [visible, selectedId, active, detailAttempt, activate, publish])

  const retryLoad = (): void => {
    if (!selectedId) { void load(); return }
    setDetailError('')
    setDetailAttempt((attempt) => attempt + 1)
  }

  const flush = useCallback(async (id: string): Promise<void> => {
    clearTimeout(timers.current.get(id)); timers.current.delete(id)
    const running = writes.current.get(id)
    if (!dirtyIds.current.has(id)) return running?.promise
    const record = recordsRef.current.find((item) => item.id === id)
    if (!record) return
    const revision = revisions.current.get(id) ?? 0
    if (running?.revision === revision) return running.promise
    const payload = input(record)
    const promise = (running?.promise ?? Promise.resolve()).catch(() => undefined).then(async () => {
      try {
        await window.readerApi.saveWorkbench(payload)
        if ((revisions.current.get(id) ?? 0) === revision) {
          dirtyIds.current.delete(id)
          setDirty((current) => current.filter((value) => value !== id))
          setErrors((current) => ({ ...current, [id]: '' }))
        }
      } catch (error) {
        if (recordsRef.current.some((item) => item.id === id)) {
          dirtyIds.current.add(id)
          setDirty((current) => current.includes(id) ? current : [...current, id])
          setErrors((current) => ({ ...current, [id]: readableError(error, copy('workbench.saveFailed')) }))
        }
        throw error
      }
    })
    writes.current.set(id, { revision, promise })
    try { await promise } finally { if (writes.current.get(id)?.promise === promise) writes.current.delete(id) }
  }, [])

  const update = useCallback((id: string, change: (record: WorkbenchRecord) => WorkbenchRecord) => {
    if (!recordsRef.current.some((record) => record.id === id)) return
    publish(recordsRef.current.map((record) => record.id === id ? change(record) : record))
    revisions.current.set(id, (revisions.current.get(id) ?? 0) + 1)
    dirtyIds.current.add(id)
    setDirty((current) => current.includes(id) ? current : [...current, id])
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    if (!closing.current) timers.current.set(id, setTimeout(() => { void flush(id).catch(() => undefined) }, 350))
  }, [flush, publish])

  const hasLoadedRecords = records.length > 0
  const available = useMemo(() => libraryReady && hasLoadedRecords ? new Set(books.map((book) => book.id)) : null,
    [books, libraryReady, hasLoadedRecords])
  useEffect(() => {
    if (!available) return
    for (const record of records) if (record.bookIds.some((id) => !available.has(id))) {
      update(record.id, (current) => ({ ...current, bookIds: current.bookIds.filter((id) => available.has(id)) }))
    }
  }, [available, records, update])

  useEffect(() => subscribeToBufferedLlmEvents(events, (id) => requests.current.has(id), (event) => {
    const id = requests.current.get(event.requestId)
    if (!id) return
    update(id, (record) => ({ ...record, turns: record.turns.map((turn) => {
      if (turn.id !== event.requestId) return turn
      if (event.type === 'context') return { ...turn, status: 'streaming', context: event.context }
      if (event.type === 'delta') return { ...turn, status: 'streaming', answer: turn.answer + event.delta }
      if (event.type === 'usage') return { ...turn, usage: event.usage }
      if (event.type === 'completed') {
        const startedAt = requestStartedAt.current.get(event.requestId)
        return { ...turn, status: 'completed', model: event.model,
          durationMs: startedAt === undefined ? undefined : Math.min(86_400_000, Math.max(0, Math.round(performance.now() - startedAt))) }
      }
      if (event.type === 'error') return { ...turn, status: 'error', error: event.message }
      return turn
    }) }))
    if (event.type === 'completed' || event.type === 'error') {
      requests.current.delete(event.requestId)
      requestStartedAt.current.delete(event.requestId)
      void flush(id).catch(() => undefined)
    }
  }), [events, flush, update])

  const cancel = useCallback(async (id: string) => {
    for (const [requestId, workbenchId] of [...requests.current]) {
      if (workbenchId !== id) continue
      events.flush(requestId)
      await window.readerApi.cancelLlm(requestId)
      events.flush(requestId)
      requests.current.delete(requestId)
      requestStartedAt.current.delete(requestId)
      update(id, (record) => ({ ...record, turns: record.turns.map((turn) => turn.id === requestId && (turn.status === 'queued' || turn.status === 'streaming')
        ? { ...turn, status: 'error', error: copy('workbench.cancelled') } : turn) }))
    }
  }, [events, update])

  // A close or explicit retry must acknowledge edits made while an earlier write was pending.
  const flushLatest = useCallback(async (id: string): Promise<void> => {
    while (recordsRef.current.some((record) => record.id === id)) {
      const version = revisions.current.get(id) ?? 0
      try { await flush(id) }
      catch (error) {
        if ((revisions.current.get(id) ?? 0) === version) throw error
      }
      if ((revisions.current.get(id) ?? 0) === version) return
    }
  }, [flush])

  const retrySaves = useCallback(async (): Promise<void> => {
    const results = await Promise.allSettled([...dirtyIds.current].map(flushLatest))
    const failed = results.find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  }, [flushLatest])

  const resumeAfterClose = useCallback((): void => { closing.current = false }, [])

  const beforeClose = useCallback(async (): Promise<boolean> => {
    closing.current = true
    for (const timer of timers.current.values()) clearTimeout(timer)
    timers.current.clear()
    const cancellations = await Promise.allSettled([...new Set(requests.current.values())].map(cancel))
    // An edit may arrive after its own write finishes, while a different workbench is saving.
    while (dirtyIds.current.size || writes.current.size) {
      const ids = [...new Set([...dirtyIds.current, ...writes.current.keys()])]
      const saves = await Promise.allSettled(ids.map(flushLatest))
      if (saves.some((result) => result.status === 'rejected')) return false
    }
    return cancellations.every((result) => result.status === 'fulfilled')
  }, [cancel, flushLatest])

  const create = useCallback(async (name: string, bookIds: string[], persona: PersonaSelection | null) => {
    const record = await window.readerApi.createWorkbench({ name, bookIds })
    revisions.current.set(record.id, 0)
    const summary = { id: record.id, name: record.name, bookIds: record.bookIds, turnCount: record.turns.length }
    setSummaries((current) => [summary, ...(current ?? [])])
    publish([record, ...recordsRef.current]); activate(record.id)
    if (persona) update(record.id, (current) => ({ ...current, persona }))
  }, [activate, publish, update])

  const remove = useCallback(async (id: string) => {
    await cancel(id)
    await flushLatest(id)
    await window.readerApi.deleteWorkbench(id)
    clearTimeout(timers.current.get(id)); timers.current.delete(id)
    dirtyIds.current.delete(id)
    revisions.current.delete(id)
    setDirty((current) => current.filter((value) => value !== id))
    setErrors((current) => { const next = { ...current }; delete next[id]; return next })
    publish(recordsRef.current.filter((record) => record.id !== id))
    setSummaries((current) => current?.filter((summary) => summary.id !== id) ?? null)
    if (activeIdRef.current === id) activate(null)
  }, [activate, cancel, flushLatest, publish])

  const submit = useCallback(async (id: string, model: string, regenerate = false, editedQuestion?: string) => {
    const record = recordsRef.current.find((item) => item.id === id)
    if (!record || workbenchBusy(record) || closing.current) return
    const previous = regenerate ? record.turns.at(-1) : undefined
    const question = editedQuestion?.trim() ?? previous?.question ?? record.draft.trim()
    const bookIds = previous?.bookIds ?? [...record.bookIds]
    if (!question || !bookIds.length || (!regenerate && record.turns.length >= MAX_WORKBENCH_TURNS)) return
    const prior = regenerate ? record.turns.slice(0, -1) : record.turns
    const persona = previous ? previous.persona ?? null : record.persona
    const requestId = crypto.randomUUID()
    requests.current.set(requestId, id)
    requestStartedAt.current.set(requestId, performance.now())
    update(id, (current) => ({ ...current, draft: regenerate && editedQuestion === undefined ? current.draft : '', turns: [...prior, { id: requestId, question, bookIds, answer: '', model, persona, status: 'queued' }] }))
    try {
      await flush(id)
      if (requests.current.get(requestId) !== id || closing.current) return
      const historyTurns = prior.filter((turn) => turn.status === 'completed' && turn.answer && turn.bookIds.every((bookId) => bookIds.includes(bookId))).slice(-15)
      await window.readerApi.startLlm({ requestId, conversationId: id, scope: 'books', bookIds, action: 'ask', question,
        ...(persona ? { persona: persona.prompt } : {}), webSearch: record.webSearch,
        history: historyTurns.flatMap((turn) => [{ role: 'user', content: turn.question }, { role: 'assistant', content: turn.answer.slice(-20_000) }]),
        historyCandidateMessages: Math.min(prior.length * 2, 1_000_000), historyCandidateTruncated: historyTurns.some((turn) => turn.answer.length > 20_000) })
    } catch (error) {
      if (requests.current.get(requestId) !== id) return
      events.flush(requestId)
      requests.current.delete(requestId)
      requestStartedAt.current.delete(requestId)
      update(id, (current) => ({ ...current, turns: current.turns.map((turn) => turn.id === requestId
        ? { ...turn, status: 'error', error: readableError(error, copy('error.requestStartFailed')) } : turn) }))
    }
  }, [events, flush, update])

  return {
    records, summaries: summaries ?? [], selectedId, active, activate, create, remove, update, submit, cancel,
    flush: flushLatest, beforeClose, resumeAfterClose, retrySaves, errors, dirty, retryLoad,
    loading: (!summaries && !loadError) || Boolean(selectedId && !active && !detailError),
    loadError: loadError || (selectedId && !active ? detailError : '')
  }
}
