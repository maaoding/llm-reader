import { useState } from 'react'
import type { SemanticIndexState } from '@shared/contracts'
import { copy } from '@shared/copy'
import { readableError } from './readable-error'

export function SemanticIndexControls({ bookId, state }: { bookId: string; state: SemanticIndexState }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (operation: 'start' | 'rebuild' | 'cancel'): Promise<void> => {
    setBusy(true); setError('')
    try {
      if (operation === 'cancel') await window.readerApi.cancelSemanticIndex(bookId)
      else await window.readerApi.startSemanticIndex({ bookId, rebuild: operation === 'rebuild' })
    } catch (error) { setError(readableError(error, copy('knowledge.network'))) }
    finally { setBusy(false) }
  }
  return <details className="analysis-details semantic-details" data-testid="semantic-details">
    <summary>{copy('knowledge.indexTitle')} · {copy(`knowledge.status.${state.status}`)}</summary>
    {state.status === 'disabled' ? <p className="analysis-hint">{copy('knowledge.embeddingRequired')}</p> : <>
      <p>{copy('knowledge.indexDisclosure')}</p>
      <p>{copy('knowledge.indexProgress', { completed: state.completed, total: state.total })} · {state.model}</p>
      <div className="analysis-actions">
        {state.status === 'indexing' ? <button type="button" disabled={busy} data-testid="semantic-cancel" onClick={() => void run('cancel')}>{copy('knowledge.indexCancel')}</button> : <>
          {state.status !== 'ready' && state.status !== 'stale' && <button type="button" data-testid="semantic-start" disabled={busy} onClick={() => void run('start')}>{copy(state.completed ? 'knowledge.indexResume' : 'knowledge.indexStart')}</button>}
          {state.status !== 'empty' && <button type="button" disabled={busy} data-testid="semantic-rebuild" onClick={() => void run('rebuild')}>{copy('knowledge.indexRebuild')}</button>}
        </>}
      </div>
    </>}
    {(error || state.message) && <p role="status" className="analysis-error">{error || state.message}</p>}
  </details>
}
