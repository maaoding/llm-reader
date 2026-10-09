import { useCallback, useEffect, useRef, useState } from 'react'
import type { BookRecord, LlmEvent, PersonaSelection, WorkbenchInput, WorkbenchRecord } from '@shared/contracts'
import { copy } from '@shared/copy'
import { readableError } from './readable-error'

const ACTIVE_KEY = 'llm-reader-workbench-active'
const input = ({ id, name, bookIds, draft, turns, webSearch, persona }: WorkbenchRecord): WorkbenchInput => ({ id, name, bookIds, draft, turns, webSearch, persona })
export const workbenchBusy = (record: WorkbenchRecord): boolean => record.turns.some((turn) => turn.status === 'queued' || turn.status === 'streaming')

/** Mounted with the application: leaving the workbench view never drops its requests or pending writes. */
export function useWorkbenches(books: BookRecord[], libraryReady: boolean) {
  const [records, setRecords] = useState<WorkbenchRecord[]>([])
  const recordsRef = useRef(records)
  const [activeId, setActiveId] = useState<string | null>(() => { try { return localStorage.getItem(ACTIVE_KEY) } catch { return null } })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState<string[]>([])
  const revisions = useRef(new Map<string, number>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const writes = useRef(new Map<string, Promise<void>>())
  const requests = useRef(new Map<string, string>())
  const closing = useRef(false)
  const publish = useCallback((next: WorkbenchRecord[]) => { recordsRef.current = next; setRecords(next) }, [])

  const activate = useCallback((id: string | null) => {
    setActiveId(id)
    try { if (id) localStorage.setItem(ACTIVE_KEY, id); else localStorage.removeItem(ACTIVE_KEY) } catch { /* State remains usable without localStorage. */ }
  }, [])

  const load = useCallback(async () => {
    if (!window.readerApi.listWorkbenches) { setLoading(false); return }
    setLoading(true); setLoadError('')
    try { publish(await window.readerApi.listWorkbenches()) }
    catch (error) { setLoadError(readableError(error, copy('workbench.loadFailed'))) }
    finally { setLoading(false) }
  }, [publish])
  useEffect(() => { void load() }, [load])

  const flush = useCallback(async (id: string): Promise<void> => {
    clearTimeout(timers.current.get(id)); timers.current.delete(id)
    const record = recordsRef.current.find((item) => item.id === id)
    if (!record) return
    const version = revisions.current.get(id) ?? 0
    const payload = input(record)
    const pending = (writes.current.get(id) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      try {
        await window.readerApi.saveWorkbench(payload)
        if ((revisions.current.get(id) ?? 0) === version) {
          setDirty((current) => current.filter((value) => value !== id))
          setErrors((current) => ({ ...current, [id]: '' }))
        }
      } catch (error) {
        setErrors((current) => ({ ...current, [id]: readableError(error, copy('workbench.saveFailed')) }))
        throw error
      }
    })
    writes.current.set(id, pending)
    try { await pending } finally { if (writes.current.get(id) === pending) writes.current.delete(id) }
  }, [])

  const update = useCallback((id: string, change: (record: WorkbenchRecord) => WorkbenchRecord) => {
    if (!recordsRef.current.some((record) => record.id === id)) return
    publish(recordsRef.current.map((record) => record.id === id ? change(record) : record))
    revisions.current.set(id, (revisions.current.get(id) ?? 0) + 1)
    setDirty((current) => current.includes(id) ? current : [...current, id])
    clearTimeout(timers.current.get(id))
    timers.current.set(id, setTimeout(() => { void flush(id).catch(() => undefined) }, 350))
  }, [flush, publish])

  useEffect(() => {
    if (!libraryReady || loading) return
    const available = new Set(books.map((book) => book.id))
    for (const record of recordsRef.current) if (record.bookIds.some((id) => !available.has(id))) {
      update(record.id, (current) => ({ ...current, bookIds: current.bookIds.filter((id) => available.has(id)) }))
    }
  }, [books, libraryReady, loading, update])

  useEffect(() => window.readerApi.onLlmEvent((event: LlmEvent) => {
    const id = requests.current.get(event.requestId)
    if (!id) return
    update(id, (record) => ({ ...record, turns: record.turns.map((turn) => {
      if (turn.id !== event.requestId) return turn
      if (event.type === 'context') return { ...turn, status: 'streaming', context: event.context }
      if (event.type === 'delta') return { ...turn, status: 'streaming', answer: turn.answer + event.delta }
      if (event.type === 'usage') return { ...turn, usage: event.usage }
      if (event.type === 'completed') return { ...turn, status: 'completed', model: event.model }
      if (event.type === 'error') return { ...turn, status: 'error', error: event.message }
      return turn
    }) }))
    if (event.type === 'completed' || event.type === 'error') {
      requests.current.delete(event.requestId)
      void flush(id).catch(() => undefined)
    }
  }), [flush, update])

  const cancel = useCallback(async (id: string) => {
    for (const [requestId, workbenchId] of [...requests.current]) {
      if (workbenchId !== id) continue
      await window.readerApi.cancelLlm(requestId)
      requests.current.delete(requestId)
      update(id, (record) => ({ ...record, turns: record.turns.map((turn) => turn.id === requestId && (turn.status === 'queued' || turn.status === 'streaming')
        ? { ...turn, status: 'error', error: copy('workbench.cancelled') } : turn) }))
    }
  }, [update])

  const beforeClose = useCallback(async () => {
    closing.current = true
    for (const id of new Set(requests.current.values())) await cancel(id).catch(() => undefined)
    for (const record of recordsRef.current) await flush(record.id).catch(() => undefined)
  }, [cancel, flush])

  const create = useCallback(async (name: string, bookIds: string[], persona: PersonaSelection | null) => {
    const record = await window.readerApi.createWorkbench({ name, bookIds })
    revisions.current.set(record.id, 0)
    publish([record, ...recordsRef.current]); activate(record.id)
    if (persona) update(record.id, (current) => ({ ...current, persona }))
  }, [activate, publish, update])

  const remove = useCallback(async (id: string) => {
    await cancel(id)
    await flush(id)
    await window.readerApi.deleteWorkbench(id)
    clearTimeout(timers.current.get(id)); timers.current.delete(id)
    publish(recordsRef.current.filter((record) => record.id !== id))
    activate(null)
  }, [activate, cancel, flush, publish])

  const submit = useCallback(async (id: string, model: string, regenerate = false, editedQuestion?: string) => {
    const record = recordsRef.current.find((item) => item.id === id)
    if (!record || workbenchBusy(record) || closing.current) return
    const previous = regenerate ? record.turns.at(-1) : undefined
    const question = editedQuestion?.trim() ?? previous?.question ?? record.draft.trim()
    const bookIds = previous?.bookIds ?? [...record.bookIds]
    if (!question || !bookIds.length || (!regenerate && record.turns.length >= 200)) return
    const prior = regenerate ? record.turns.slice(0, -1) : record.turns
    const persona = previous ? previous.persona ?? null : record.persona
    const requestId = crypto.randomUUID()
    requests.current.set(requestId, id)
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
      requests.current.delete(requestId)
      update(id, (current) => ({ ...current, turns: current.turns.map((turn) => turn.id === requestId
        ? { ...turn, status: 'error', error: readableError(error, copy('error.requestStartFailed')) } : turn) }))
    }
  }, [flush, update])

  return { records, activeId, active: records.find((record) => record.id === activeId), activate, create, remove, update, submit, cancel, flush, beforeClose, loading, loadError, load, errors, dirty }
}
