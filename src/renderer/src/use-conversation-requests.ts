import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { LlmEvent, LlmRequest, PersonaSelection, WebSearchMode } from '@shared/contracts'
import { copy } from '@shared/copy'
import type { ConversationTab, ConversationTurn } from './conversation-session'
import { readableError } from './readable-error'
import { LlmEventBuffer, subscribeToBufferedLlmEvents } from './llm-event-buffer'

const MAX_CONCURRENT_REQUESTS = 2

interface QueuedRequest {
  tabId: string
  bookId: string
  request: LlmRequest
  providerRevision: number
}

interface ConversationRequestOptions {
  conversationTabsRef: RefObject<ConversationTab[]>
  closingRef: RefObject<boolean>
  updateConversationTab: (tabId: string, update: (tab: ConversationTab) => ConversationTab) => void
  persistArchiveHistory: (bookId: string, insightId: string, turns: ConversationTurn[], persona: PersonaSelection | null, webSearch?: WebSearchMode) => Promise<void>
  reportProviderResult: (revision: number, failure: string, pendingWork: number) => void
}

function applyEvent(turn: ConversationTurn, event: LlmEvent): ConversationTurn {
  if (turn.requestId !== event.requestId) return turn
  if (event.type === 'context') return { ...turn, context: event.context, webSearchPhase: undefined }
  if (event.type === 'webSearch') return { ...turn, webSearchPhase: event.phase }
  if (event.type === 'delta') return { ...turn, answer: turn.answer + event.delta }
  if (event.type === 'usage') return { ...turn, usage: event.usage }
  if (event.type === 'completed') return {
    ...turn,
    model: event.model,
    status: 'completed',
    ...(turn.startedAt === undefined ? {} : { durationMs: Math.max(0, Date.now() - turn.startedAt) })
  }
  return { ...turn, status: 'error', error: event.message }
}

/** Owns queue capacity and request lifetimes. Removing a request also removes
 * its authority to update a conversation or the provider's connection status. */
export function useConversationRequests({
  conversationTabsRef, closingRef, updateConversationTab, persistArchiveHistory, reportProviderResult
}: ConversationRequestOptions) {
  const activeRef = useRef(new Map<string, QueuedRequest>())
  const pendingRef = useRef<QueuedRequest[]>([])
  const [events] = useState(() => new LlmEventBuffer())

  const pumpRequestQueue = useCallback(function pump(): void {
    if (closingRef.current) return
    while (activeRef.current.size < MAX_CONCURRENT_REQUESTS && pendingRef.current.length > 0) {
      const next = pendingRef.current.shift()!
      const requestId = next.request.requestId
      const tab = conversationTabsRef.current.find((candidate) => candidate.id === next.tabId)
      if (!tab?.turns.some((turn) => turn.requestId === requestId && turn.status === 'queued')) continue
      activeRef.current.set(requestId, next)
      updateConversationTab(next.tabId, (current) => ({
        ...current,
        turns: current.turns.map((turn) => turn.requestId === requestId ? { ...turn, status: 'streaming', startedAt: Date.now() } : turn)
      }))
      void window.readerApi.startLlm(next.request).catch((error: unknown) => {
        // Cancellation or a terminal event may have already retired this request.
        if (activeRef.current.get(requestId) !== next) return
        events.flush(requestId)
        activeRef.current.delete(requestId)
        const message = readableError(error, copy('error.requestStartFailed'))
        updateConversationTab(next.tabId, (current) => ({
          ...current,
          turns: current.turns.map((turn) => turn.requestId === requestId ? { ...turn, status: 'error', error: message } : turn)
        }))
        pump()
        reportProviderResult(next.providerRevision, message, activeRef.current.size + pendingRef.current.length)
      })
    }
  }, [closingRef, conversationTabsRef, events, reportProviderResult, updateConversationTab])

  const hasConversationRequest = useCallback((tabId: string): boolean => (
    [...activeRef.current.values(), ...pendingRef.current].some((request) => request.tabId === tabId)
  ), [])

  const enqueueConversationRequest = useCallback((tabId: string, request: LlmRequest, providerRevision: number): void => {
    const tab = conversationTabsRef.current.find((candidate) => candidate.id === tabId)
    if (!tab || closingRef.current || hasConversationRequest(tabId)) return
    pendingRef.current.push({ tabId, bookId: tab.bookId, request, providerRevision })
    pumpRequestQueue()
  }, [closingRef, conversationTabsRef, hasConversationRequest, pumpRequestQueue])

  const cancelMatching = useCallback(async (matches: (request: QueuedRequest) => boolean): Promise<void> => {
    const queued = pendingRef.current.filter(matches)
    pendingRef.current = pendingRef.current.filter((request) => !matches(request))
    const active = [...activeRef.current.values()].filter(matches)
    for (const request of active) events.flush(request.request.requestId)
    // Retire the whole group before freeing slots or awaiting IPC. Late deltas,
    // cancellation events and start failures can no longer resurrect these turns.
    for (const request of active) activeRef.current.delete(request.request.requestId)
    for (const request of [...queued, ...active]) {
      updateConversationTab(request.tabId, (tab) => ({
        ...tab,
        turns: tab.turns.map((turn) => turn.requestId === request.request.requestId
          ? { ...turn, status: 'error', error: turn.answer ? copy('assistant.cancelledPartial') : copy('assistant.cancelledEmpty') }
          : turn)
      }))
    }
    const cancellations = active.map(({ request }) => window.readerApi.cancelLlm(request.requestId))
    pumpRequestQueue()
    await Promise.allSettled(cancellations)
  }, [events, pumpRequestQueue, updateConversationTab])

  const cancelRequest = useCallback(async (requestId: string | null): Promise<void> => {
    if (requestId) await cancelMatching(({ request }) => request.requestId === requestId)
  }, [cancelMatching])
  const cancelBookRequests = useCallback((bookId: string): Promise<void> => (
    cancelMatching((request) => request.bookId === bookId)
  ), [cancelMatching])
  const cancelTabRequests = useCallback((tabId: string): Promise<void> => (
    cancelMatching((request) => request.tabId === tabId)
  ), [cancelMatching])
  const cancelAllRequests = useCallback((): Promise<void> => cancelMatching(() => true), [cancelMatching])

  useEffect(() => {
    if (!window.readerApi) return undefined
    return subscribeToBufferedLlmEvents(events, (id) => activeRef.current.has(id), (event) => {
      const request = activeRef.current.get(event.requestId)
      if (!request) return
      const tab = conversationTabsRef.current.find((candidate) => candidate.id === request.tabId)
      if (tab) {
        const turns = tab.turns.map((turn) => applyEvent(turn, event))
        updateConversationTab(tab.id, (current) => ({ ...current, turns }))
        if (event.type === 'completed' && tab.kind === 'archive' && tab.insightId) {
          void persistArchiveHistory(tab.bookId, tab.insightId, turns, tab.persona, tab.webSearch).catch(() => undefined)
        }
      }
      if (event.type === 'completed' || event.type === 'error') {
        activeRef.current.delete(event.requestId)
        pumpRequestQueue()
        const failure = event.type === 'error' && event.code !== 'CANCELLED' ? event.message : ''
        reportProviderResult(request.providerRevision, failure, activeRef.current.size + pendingRef.current.length)
      }
    })
  }, [conversationTabsRef, events, persistArchiveHistory, pumpRequestQueue, reportProviderResult, updateConversationTab])

  useEffect(() => {
    const active = activeRef.current
    return () => {
      const requestIds = [...active.keys()]
      active.clear()
      pendingRef.current = []
      for (const id of requestIds) void window.readerApi.cancelLlm(id).catch(() => undefined)
    }
  }, [])

  return { hasConversationRequest, enqueueConversationRequest, cancelRequest, cancelBookRequests, cancelTabRequests, cancelAllRequests }
}
