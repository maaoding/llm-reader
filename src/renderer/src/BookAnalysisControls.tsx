import { isPageProcessor, providerIsConfigured } from '@shared/request-settings'
import { useState } from 'react'
import type { BookAnalysisState, BookRecord, ProviderOverview } from '@shared/contracts'
import { copy } from '@shared/copy'
import { SemanticIndexControls } from './SemanticIndexControls'
import { BookOcrPreview } from './BookOcrPreview'
import { processorCopy } from '@shared/knowledge'

export function BookAnalysisControls({ book, state, error, profiles, suspended = false, onStart, onCancel, onPrepare, onCancelPreparation, onConfigure }: {
  book: BookRecord; state?: BookAnalysisState; error?: { load?: string; document?: string; notes?: string }; profiles: ProviderOverview
  suspended?: boolean
  onStart: (profileId: string, rebuild: boolean) => Promise<void>
  onCancel: () => void; onPrepare: (rebuild: boolean) => Promise<void>; onCancelPreparation: () => void
  onConfigure: (section: 'model' | 'knowledge', trigger: HTMLButtonElement, service?: 'document' | 'embedding') => void
}) {
  const [chosenProfile, setChosenProfile] = useState('')
  const [starting, setStarting] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const profileId = chosenProfile || state?.profileId || profiles.activeProfileId || ''
  const preparing = state?.document?.status === 'preparing'
  const documentReady = state?.document?.status === 'ready'
  const busy = preparing || state?.status === 'analyzing' || previewing
  const supported = book.format !== 'pdf' || Boolean(state?.documentProcessor && state.documentProcessor !== 'none')
  const pageOcr = book.format === 'pdf' && isPageProcessor(state?.documentProcessor ?? 'none')
  const vision = book.format === 'pdf' && state?.documentProcessor === 'vision'
  const canStart = !starting && profiles.profiles.some((profile) => profile.id === profileId && providerIsConfigured(profile))
  const start = async (rebuild: boolean) => {
    if (rebuild && !window.confirm(copy('preparation.notesRebuildConfirm'))) return
    setStarting(true)
    try { await onStart(profileId, rebuild) } finally { setStarting(false) }
  }
  const prepare = async (rebuild: boolean) => {
    if (rebuild && !window.confirm(copy('preparation.rebuildConfirm'))) return
    setStarting(true)
    try { await onPrepare(rebuild) } finally { setStarting(false) }
  }
  const diagnosticKeys = { 'missing-body': 'preparation.missingBody', 'unknown-structure': 'preparation.unknownStructure', 'unlinked-note': 'preparation.unlinkedNote', 'table-degraded': 'preparation.tableDegraded', 'suspected-duplicate': 'preparation.duplicate' } as const
  return <div className="book-analysis-controls preparation-content" data-testid="book-analysis-controls">
    <p className="preparation-intro">{copy('preparation.intro')}</p>
    {error?.load && <p className="analysis-error" role="status">{error.load}</p>}
    <section className="preparation-card" data-testid="analysis-details">
      <header><h3>{copy('preparation.original')}</h3><span className="status-tag">{copy('preparation.basic')}</span></header>
      <p data-testid="document-status" role="status">{copy(`preparation.document.${state?.document?.status ?? 'empty'}`)}</p>
      {book.format === 'pdf' && <p className="field-hint">{copy('preparation.pdfGuide')}</p>}
      <p className="field-hint">{copy(vision ? 'vision.preparation' : pageOcr ? 'preparation.pageOcr' : book.format === 'pdf' ? 'preparation.pdf' : 'preparation.local')}</p>
      {book.format === 'pdf' && supported && <small>{copy(processorCopy[state?.documentProcessor ?? 'none'])}</small>}
      {pageOcr && state?.document?.ocrProgress && <p data-testid="ocr-progress" role="status">{copy('vision.progress', state.document.ocrProgress)}</p>}
      {state?.document && state.document.total > 0 && <p>{copy('preparation.documentProgress', { completed: state.document.completed, total: state.document.total })}</p>}
      {error?.document && <p className="analysis-error" role="status">{error.document}</p>}
      {state?.document?.message && <p className="analysis-error" role="status">{state.document.message}</p>}
      <div className="analysis-actions">
        {!supported ? <button className="primary-button" type="button" onClick={(event) => onConfigure('knowledge', event.currentTarget, 'document')}>{copy('preparation.configureDocument')}</button>
          : preparing ? <button className="secondary-button" data-testid="document-cancel" onClick={onCancelPreparation}>{copy('preparation.pause')}</button>
          : <>{!documentReady && <button className="primary-button" data-testid="document-prepare" disabled={busy || starting} onClick={() => void prepare(false)}>{copy(state?.document?.status === 'paused' ? 'preparation.resume' : state?.document?.status === 'error' ? 'preparation.retry' : 'preparation.prepare')}</button>}
            {state?.document && state.document.status !== 'empty' && <button className="secondary-button" data-testid="document-rebuild" disabled={busy || starting} onClick={() => void prepare(true)}>{copy('preparation.rebuild')}</button>}</>}
      </div>
      {book.format === 'pdf' && <p className="field-hint">{copy(vision ? 'vision.disclosure' : pageOcr ? 'preparation.pageOcrDisclosure' : 'knowledge.pdfDisclosure')}</p>}
      {pageOcr && <BookOcrPreview key={`${book.id}:${state?.documentProcessor}:${suspended}`} bookId={book.id} documentReady={documentReady} suspended={suspended} disabled={preparing || state?.status === 'analyzing' || starting} onBusyChange={setPreviewing} />}
      {!!state?.document?.diagnostics.length && <details data-testid="document-check" className="analysis-failures">
        <summary>{copy('preparation.check', { count: state.document.diagnostics.length })}</summary><p>{copy('preparation.checkHint')}</p>
        <ol>{state.document.diagnostics.slice(0, 100).map((item, index) => <li key={index}>{item.page ? copy('preparation.pageDiagnostic', { page: item.page, message: copy(diagnosticKeys[item.code]) }) : copy(diagnosticKeys[item.code])}</li>)}</ol>
        {state.document.diagnostics.length > 100 && <p>{copy('preparation.checkLimit', { count: state.document.diagnostics.length })}</p>}
      </details>}
    </section>
    <section className="preparation-card">
      <header><h3>{copy('workspace.notes')}</h3><span className="status-tag">{copy('workspace.optional')}</span></header>
      <p className="field-hint">{copy('preparation.notesHint')}</p>
      <p data-testid="notes-status">{copy(`analysis.status.${state?.status ?? 'empty'}`)}{state?.sections ? ` · ${copy('workspace.noteCount', { completed: state.completedSections, total: state.sections })}` : ''}</p>
      {error?.notes && <p className="analysis-error" role="status">{error.notes}</p>}
      {state?.message && <p className="analysis-error" role="status">{state.message}</p>}
      {state?.progress && state.progress.total > 0 && <p data-testid="analysis-stage-progress" role="status">{copy('analysis.stageProgress', { stage: copy(`analysis.stage.${state.progress.stage}`), completed: state.progress.completed, total: state.progress.total })}</p>}
      {state?.progress?.retryAttempt && <p data-testid="analysis-retrying">{copy('analysis.retrying', { attempt: state.progress.retryAttempt })}</p>}
      <label>{copy('analysis.profile')}<select data-testid="analysis-profile" value={profileId} disabled={busy || starting} onChange={(event) => setChosenProfile(event.target.value)}>
        <option value="" disabled>{copy('analysis.profile')}</option>{profiles.profiles.map((profile) => <option key={profile.id} value={profile.id} disabled={!providerIsConfigured(profile)}>{profile.name} · {profile.model}</option>)}
      </select></label>
      <p className="field-hint">{copy('analysis.disclosure')}</p>
      <div className="analysis-actions">
        {state?.status === 'analyzing' ? <button className="secondary-button" data-testid="analysis-cancel" onClick={onCancel}>{copy('analysis.cancel')}</button>
          : <>{!canStart && <button className="secondary-button" onClick={(event) => onConfigure('model', event.currentTarget)}>{copy('preparation.configureModel')}</button>}
            {state?.status !== 'ready' && state?.status !== 'stale' && <button className="primary-button" data-testid="analysis-start" disabled={!canStart || !documentReady || busy} onClick={() => void start(false)}>{copy(state && !['empty', 'unsupported'].includes(state.status) ? 'analysis.resume' : 'analysis.prepare')}</button>}
            {state && state.status !== 'empty' && <button className="secondary-button" data-testid="analysis-rebuild" disabled={!canStart || !documentReady || busy} onClick={() => void start(true)}>{copy('analysis.rebuild')}</button>}</>}
      </div>
      {!documentReady && <p className="field-hint">{copy('analysis.needed')}</p>}
      <details className="preparation-details"><summary>{copy('preparation.details')}</summary><p>{copy('analysis.disclosureRetry')}</p>{state?.usage?.totalTokens !== undefined && <p>{copy('assistant.tokenUsage', { count: state.usage.totalTokens })}</p>}</details>
      {!!state?.failures?.length && <details className="analysis-failures" data-testid="analysis-failures"><summary>{copy('analysis.recentFailures')}</summary><ol>{state.failures.map((failure, index) => <li key={index}><small>{new Date(failure.occurredAt).toLocaleString('zh-CN')} · {copy(`analysis.stage.${failure.stage}`)}</small><p>{failure.message}</p></li>)}</ol></details>}
    </section>
    <section className="preparation-card"><header><h3>{copy('knowledge.indexTitle')}</h3><span className="status-tag">{copy('workspace.optional')}</span></header>
      <p className="field-hint">{copy('preparation.semanticHint')}</p>
      {documentReady && state?.semantic ? <SemanticIndexControls key={book.id} bookId={book.id} state={state.semantic} /> : <p>{copy('analysis.needed')}</p>}
      {(!state?.semantic || state.semantic.status === 'disabled') && <button className="secondary-button" onClick={(event) => onConfigure('knowledge', event.currentTarget, 'embedding')}>{copy('preparation.configureSemantic')}</button>}
    </section>
  </div>
}
