import { useEffect, useRef, useState } from 'react'
import { CONVERSATION_COPY_MAX_LENGTH } from '@shared/contracts'
import { copy } from '@shared/copy'
import { buildConversationMarkdown, ConversationMarkdownError, type ConversationMarkdownSnapshot, type MarkdownBook } from './conversation-markdown'
import type { ConversationTurn } from './conversation-session'

interface Failure { message: string; snapshot?: ConversationMarkdownSnapshot }

export function useConversationMarkdown(book: MarkdownBook | undefined, turns: readonly ConversationTurn[], activeRequestId: string | null) {
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [failure, setFailure] = useState<Failure | null>(null)
  const returnRef = useRef<HTMLElement | null>(null)
  const running = useRef(false)
  const alive = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const ongoing = Boolean(activeRequestId) || turns.some((turn) => turn.status === 'queued' || turn.status === 'streaming')

  const perform = async (operation: 'copy' | 'export', snapshot: ConversationMarkdownSnapshot, trigger?: HTMLElement): Promise<void> => {
    if (running.current || !alive.current) return
    if (trigger) returnRef.current = trigger
    setFeedback('')
    if (operation === 'copy' && snapshot.markdown.length > CONVERSATION_COPY_MAX_LENGTH) {
      setFailure({ message: copy('conversationMarkdown.copyTooLarge'), snapshot })
      return
    }
    running.current = true
    setBusy(true)
    try {
      if (operation === 'copy') {
        await window.readerApi.copyConversationMarkdown(snapshot.markdown)
        if (!alive.current) return
        setFeedback(copy(snapshot.single ? 'conversationMarkdown.copiedTurn' : 'conversationMarkdown.copiedSession'))
      } else {
        const result = await window.readerApi.exportConversationMarkdown({ markdown: snapshot.markdown, title: snapshot.title })
        if (!alive.current || result.canceled) return
        setFeedback(copy('conversationMarkdown.saved', { fileName: result.fileName }))
      }
      setFailure(null)
    } catch {
      if (alive.current) setFailure({ message: copy(operation === 'copy' ? 'conversationMarkdown.copyFailed' : 'conversationMarkdown.saveFailed'), snapshot })
    } finally {
      running.current = false
      if (alive.current) setBusy(false)
    }
  }

  const start = (operation: 'copy' | 'export', trigger: HTMLElement, turnId?: string): void => {
    if (!book || running.current) return
    returnRef.current = trigger
    setFeedback('')
    try {
      const snapshot = buildConversationMarkdown(book, turns, turnId)
      void perform(operation, snapshot, trigger)
    } catch (error) {
      const reason = error instanceof ConversationMarkdownError ? error.reason : 'tooLarge'
      setFailure({ message: copy(reason === 'busy' ? 'conversationMarkdown.busyHint' : reason === 'empty' ? 'conversationMarkdown.empty' : 'conversationMarkdown.tooLarge') })
    }
  }

  return {
    busy, feedback, failure, returnRef,
    canCopyConversation: Boolean(book) && turns.length > 0 && !ongoing && !busy,
    canCopyTurn: (turn: ConversationTurn) => Boolean(book) && !busy && (turn.status === 'completed' || turn.status === 'error'),
    disabledHint: ongoing ? copy('conversationMarkdown.busyHint') : copy('conversationMarkdown.empty'),
    copyTurn: (turnId: string, trigger: HTMLElement) => start('copy', trigger, turnId),
    copyConversation: (trigger: HTMLElement) => start('copy', trigger),
    exportConversation: (trigger: HTMLElement) => start('export', trigger),
    retryCopy: () => { if (failure?.snapshot) void perform('copy', failure.snapshot) },
    savePrepared: () => { if (failure?.snapshot) void perform('export', failure.snapshot) },
    closeFailure: () => { if (!running.current) setFailure(null) }
  }
}

export type ConversationMarkdownController = ReturnType<typeof useConversationMarkdown>
