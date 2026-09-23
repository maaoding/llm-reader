import { useState } from 'react'
import type { BookSessionSummary } from '@shared/contracts'
import { copy } from '@shared/copy'

export function RecentConversations({ currentId, disabled, onList, onRestore }: {
  currentId: string
  disabled: boolean
  onList: () => Promise<BookSessionSummary[]>
  onRestore: (id: string) => Promise<void>
}) {
  const [items, setItems] = useState<BookSessionSummary[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const open = async () => {
    if (items) { setItems(null); return }
    setBusy(true); setError(false)
    try { setItems(await onList()) } catch { setError(true) }
    finally { setBusy(false) }
  }
  const restore = async (id: string) => {
    setBusy(true); setError(false)
    try { await onRestore(id); setItems(null) } catch { setError(true) }
    finally { setBusy(false) }
  }
  return <div className="recent-conversations">
    <button type="button" className="secondary-button" data-testid="recent-conversations" disabled={disabled || busy}
      aria-expanded={items !== null} onClick={() => void open()}>{copy('assistant.recentSessions')}</button>
    {error && <p role="status">{copy('assistant.sessionRestoreFailed')}</p>}
    {items && <div className="recent-conversations-list">
      <small>{copy('assistant.recentSessionsHint')}</small>
      {items.filter((item) => item.conversationId !== currentId).length === 0 && <p>{copy('assistant.recentSessionsEmpty')}</p>}
      {items.filter((item) => item.conversationId !== currentId).map((item) => <button type="button" data-testid="recent-conversation"
        key={item.conversationId} disabled={disabled || busy} onClick={() => void restore(item.conversationId)}>
        <span>{item.title || copy(item.scope === 'book' ? 'analysis.book' : 'analysis.selection')}</span>
        <small>{copy(item.scope === 'book' ? 'analysis.book' : 'analysis.selection')} · {new Date(item.updatedAt).toLocaleString('zh-CN')} · {copy('assistant.recentSessionTurns', { count: item.turnCount })}</small>
      </button>)}
    </div>}
  </div>
}
