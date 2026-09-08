import { useState } from 'react'
import type { BookAnalysisState, BookRecord, ProviderOverview } from '@shared/contracts'
import { copy } from '@shared/copy'
import { SemanticIndexControls } from './SemanticIndexControls'
import { processorCopy } from '@shared/knowledge'

export function BookAnalysisControls({ book, state, error, profiles, scope, disabled, onScope, onStart, onCancel, onPrepare, onCancelPreparation }: {
  book: BookRecord
  state?: BookAnalysisState
  error?: string
  profiles: ProviderOverview
  scope: 'selection' | 'book'
  disabled: boolean
  onScope: (scope: 'selection' | 'book') => void
  onStart: (profileId: string, rebuild: boolean) => Promise<void>
  onCancel: () => void
  onPrepare: (rebuild: boolean) => Promise<void>
  onCancelPreparation: () => void
}) {
  const [chosenProfile, setChosenProfile] = useState('')
  const [starting, setStarting] = useState(false)
  const profileId = chosenProfile || state?.profileId || profiles.activeProfileId || ''
  const preparing = state?.document?.status === 'preparing'
  const documentReady = state?.document?.status === 'ready'
  const busy = preparing || state?.status === 'analyzing'
  const supported = book.format !== 'pdf' || documentReady || Boolean(state?.documentProcessor && state.documentProcessor !== 'none')
  const ready = state?.status === 'ready'
  const progress = state?.progress
  const stageLabel = progress ? copy(`analysis.stage.${progress.stage}`) : ''
  const canStart = !starting && profiles.profiles.some((profile) => profile.id === profileId && profile.hasApiKey)
  const start = async (rebuild: boolean): Promise<void> => {
    setStarting(true)
    try { await onStart(profileId, rebuild) } finally { setStarting(false) }
  }
  const prepare = async (rebuild: boolean): Promise<void> => {
    setStarting(true)
    try { await onPrepare(rebuild) } finally { setStarting(false) }
  }
  const documentLabel = ({ empty: '原文未准备', preparing: '正在准备原文', paused: '原文准备已暂停', ready: '原文可检索', error: '原文准备失败' } as const)[state?.document?.status ?? 'empty']
  const diagnosticLabels = { 'missing-body': '本页缺少正文', 'unknown-structure': '存在未知结构，已保留文字', 'unlinked-note': '脚注缺少明确关联',
    'table-degraded': '表格结构异常，已降为文本', 'suspected-duplicate': '疑似重复内容，已保留原文' }
  return (
    <div className="book-analysis-controls" data-testid="book-analysis-controls">
      <div className="analysis-scope" role="group" aria-label={copy('analysis.scopeLabel')}>
        <button type="button" aria-pressed={scope === 'selection'} onClick={() => onScope('selection')} disabled={disabled}>{copy('analysis.selection')}</button>
        <button type="button" data-testid="scope-book" aria-pressed={scope === 'book'} onClick={() => onScope('book')} disabled={disabled || !supported}>{copy('analysis.book')}</button>
        <small data-testid="document-status">{documentLabel}</small>
      </div>
      {(error || state?.document?.message || state?.message) && <p className="analysis-error" role="status">{!error && state?.message && stageLabel ? `${stageLabel}：` : ''}{error || state?.document?.message || state?.message}</p>}
      {busy && progress?.retryAttempt && <p className="analysis-hint" role="status" data-testid="analysis-retrying">{copy('analysis.retrying', { attempt: progress.retryAttempt })}</p>}
      {supported && <details className="analysis-details" data-testid="analysis-details">
        <summary>原文与章节笔记{state && state.sections > 0 ? ` · ${state.completedSections}/${state.sections}` : ''}</summary>
        <p>{book.format === 'pdf' ? '准备原文会将整份 PDF 发送到所选文档服务，用于提取结构和文字。' : '准备原文在本机提取文字、建立章节结构与全文索引，无需分析模型。'}完成后即可书内问答。</p>
        {book.format === 'pdf' && <p className="analysis-hint">{copy('knowledge.pdfDisclosure')} · {copy(processorCopy[state?.documentProcessor ?? 'none'])}</p>}
        <p>{documentLabel}{state?.document && state.document.total > 0 ? ` · ${state.document.completed}/${state.document.total}` : ''}</p>
        <div className="analysis-actions">
          {preparing ? <button type="button" data-testid="document-cancel" onClick={onCancelPreparation}>暂停准备</button> : <>
            {!documentReady && <button type="button" data-testid="document-prepare" disabled={busy || starting} onClick={() => void prepare(false)}>{state?.document && ['paused', 'error'].includes(state.document.status) ? '继续准备原文' : '准备原文'}</button>}
            {state?.document && state.document.status !== 'empty' && <button type="button" data-testid="document-rebuild" disabled={busy || starting} onClick={() => void prepare(true)}>重新准备原文</button>}
          </>}
        </div>
        {state?.document && state.document.status !== 'empty' && <p className="analysis-hint">重新准备原文会重建结构，相关章节笔记和语义索引需重新建立。已有归档保留。</p>}
        {!!state?.document?.diagnostics.length && <details data-testid="document-check" className="analysis-failures">
          <summary>文档检查 · {state.document.diagnostics.length}</summary>
          <p>这些提示表示可能存在解析问题，请对照原文检查；不代表 OCR 准确率。</p>
          <ol>{state.document.diagnostics.slice(0, 100).map((diagnostic, index) => <li key={index}>{diagnostic.page ? `第 ${diagnostic.page} 页：` : ''}{diagnosticLabels[diagnostic.code]}</li>)}</ol>
          {state.document.diagnostics.length > 100 && <p>共 {state.document.diagnostics.length} 条，当前显示前 100 条。</p>}
        </details>}
        <p data-testid="notes-status">章节笔记进度 · {state?.completedSections ?? 0}/{state?.sections ?? 0} · {copy(`analysis.status.${state?.status ?? 'empty'}`)}</p>
        <p>{copy('analysis.disclosure')} {copy('analysis.disclosureRetry')}</p>
        <label>{copy('analysis.profile')}
          <select data-testid="analysis-profile" value={profileId} disabled={busy || starting} onChange={(event) => setChosenProfile(event.target.value)}>
            <option value="" disabled>{copy('analysis.profile')}</option>
            {profiles.profiles.map((profile) => <option key={profile.id} value={profile.id} disabled={!profile.hasApiKey}>{profile.name} · {profile.model}</option>)}
          </select>
        </label>
        {state && state.sections > 0 && <p>{copy('analysis.progress')} {state.completedSections}/{state.sections} · {state.model}<br />
          {progress && progress.stage !== 'sections' && <><span data-testid="analysis-stage-progress">{copy('analysis.stageProgress', { stage: stageLabel, completed: progress.completed, total: progress.total })}{progress.round ? ` · ${copy('analysis.summaryRound', { round: progress.round })}` : ''}</span><br /></>}
          {state.usage?.totalTokens !== undefined ? copy('assistant.tokenUsage', { count: state.usage.totalTokens }) : copy('analysis.usageUnknown')}</p>}
        <div className="analysis-actions">
          {state?.status === 'analyzing' ? <button type="button" data-testid="analysis-cancel" onClick={onCancel}>{copy('analysis.cancel')}</button> : <>
            {!ready && state?.status !== 'stale' && <button type="button" data-testid="analysis-start" disabled={!canStart || !documentReady || busy} onClick={() => void start(false)}>{state && !['empty', 'unsupported'].includes(state.status) ? copy('analysis.resume') : copy('analysis.prepare')}</button>}
            {state && state.status !== 'empty' && <button type="button" data-testid="analysis-rebuild" disabled={!canStart || !documentReady || busy} onClick={() => void start(true)}>{copy('analysis.rebuild')}</button>}
          </>}
        </div>
        {!!state?.failures?.length && <details className="analysis-failures" data-testid="analysis-failures">
          <summary>{copy('analysis.recentFailures')}</summary>
          <ol>{state.failures.map((failure, index) => <li key={`${failure.occurredAt}-${index}`}>
            <small>{new Date(failure.occurredAt).toLocaleString('zh-CN')} · {copy(`analysis.stage.${failure.stage}`)}</small><br />{failure.message}
          </li>)}</ol>
        </details>}
      </details>}
      {!supported && <p className="analysis-hint">{copy('knowledge.pdfRequired')}</p>}
      {documentReady && state?.semantic && <SemanticIndexControls key={book.id} bookId={book.id} state={state.semantic} />}
      {scope === 'book' && !documentReady && <p className="analysis-hint">{copy('analysis.needed')}</p>}
    </div>
  )
}
