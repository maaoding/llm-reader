import { useEffect, useId, useRef, useState } from 'react'
import { History } from 'lucide-react'
import type { BookSessionSummary } from '@shared/contracts'
import { copy } from '@shared/copy'

export function RecentConversations({ currentId, disabled, onList, onRestore }: {
  currentId: string
  disabled: boolean
  onList: () => Promise<BookSessionSummary[]>
  onRestore: (id: string) => Promise<void>
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [items, setItems] = useState<BookSessionSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelId = useId()

  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setIsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setIsOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  const toggle = async () => {
    if (isOpen) { setIsOpen(false); return }
    setIsOpen(true)
    setBusy(true); setError(false)
    setItems([])
    try { setItems(await onList()) } catch { setError(true) }
    finally { setBusy(false) }
  }
  const restore = async (id: string) => {
    setBusy(true); setError(false)
    try { await onRestore(id); setIsOpen(false) } catch { setError(true) }
    finally { setBusy(false) }
  }
  const otherItems = items.filter((item) => item.conversationId !== currentId)
  return <div className="recent-conversations" ref={rootRef}>
    <button type="button" ref={triggerRef} className="icon-button" data-testid="recent-conversations" disabled={disabled || busy}
      aria-label={copy('assistant.recentSessions')} title={copy('assistant.recentSessions')}
      aria-controls={panelId} aria-expanded={isOpen} onClick={() => void toggle()}><History size={17} /></button>
    {isOpen && <div id={panelId} className="recent-conversations-popover" role="dialog" aria-label={copy('assistant.recentSessions')}>
      <strong>{copy('assistant.recentSessions')}</strong>
      <small>{copy('assistant.recentSessionsHint')}</small>
      {busy && <p role="status">{copy('assistant.recentSessionsLoading')}</p>}
      {error && <p role="status">{copy('assistant.sessionRestoreFailed')}</p>}
      {!busy && !error && otherItems.length === 0 && <p>{copy('assistant.recentSessionsEmpty')}</p>}
      {!busy && !error && otherItems.length > 0 && <div className="recent-conversations-list">
      {otherItems.map((item) => <button type="button" data-testid="recent-conversation"
        key={item.conversationId} disabled={disabled || busy} onClick={() => void restore(item.conversationId)}>
        <span>{item.title || copy(item.scope === 'book' ? 'analysis.book' : 'analysis.selection')}</span>
        <small>{copy(item.scope === 'book' ? 'analysis.book' : 'analysis.selection')} · {new Date(item.updatedAt).toLocaleString('zh-CN')} · {copy('assistant.recentSessionTurns', { count: item.turnCount })}</small>
      </button>)}
      </div>}
    </div>}
  </div>
}
