import { useCallback, useEffect, useRef, useState } from 'react'
import type { BookPagePreview } from '@shared/contracts'
import { copy } from '@shared/copy'
import { processorCopy } from '@shared/knowledge'
import { OCR_MAX_PAGES } from '@shared/vision-ocr'
import { readableError } from './readable-error'

export function BookOcrPreview({ bookId, suspended, disabled, documentReady, onBusyChange }: {
  bookId: string; suspended: boolean; disabled: boolean; documentReady: boolean; onBusyChange: (busy: boolean) => void
}) {
  const [page, setPage] = useState('1')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<'render' | 'recognize'>('render')
  const [error, setError] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')
  const [result, setResult] = useState<(BookPagePreview & { imageDataUrl: string }) | null>(null)
  const copyRequest = useRef(0)
  const retryForce = useRef(false)
  const pending = useRef<{ requestId: string; controller: AbortController } | null>(null)
  const stop = useCallback(() => {
    const job = pending.current
    if (!job) return
    pending.current = null
    job.controller.abort()
    setBusy(false)
    void window.readerApi.cancelBookPagePreview(job.requestId).catch(() => undefined)
    onBusyChange(false)
  }, [onBusyChange])
  useEffect(() => {
    if (suspended || disabled) stop()
    return stop
  }, [bookId, suspended, disabled, stop])
  useEffect(() => () => { copyRequest.current++ }, [])

  const preview = async (force = false) => {
    if (pending.current || suspended || disabled) return
    const pageNumber = Number(page)
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > OCR_MAX_PAGES) {
      setError(copy('vision.previewPageRange', { count: OCR_MAX_PAGES })); return
    }
    const job = { requestId: crypto.randomUUID(), controller: new AbortController() }
    pending.current = job
    retryForce.current = force
    copyRequest.current++
    setBusy(true); onBusyChange(true); setStage('render'); setError(''); setCopyState('idle')
    try {
      const { imageDataUrl, pageCount } = result ?? await (await import('./readers/pdf-preview')).loadPdfPreview(bookId, pageNumber, job.controller.signal)
      job.controller.signal.throwIfAborted()
      if (pending.current !== job) return
      setStage('recognize')
      const value = await window.readerApi.previewBookPage({ bookId, requestId: job.requestId, pageNumber, pageCount, imageDataUrl, force })
      job.controller.signal.throwIfAborted()
      if (pending.current === job) setResult({ ...value, imageDataUrl })
    } catch (failure) {
      if (pending.current === job && !job.controller.signal.aborted) setError(readableError(failure, copy('vision.previewFailed')))
    } finally {
      if (pending.current === job) { pending.current = null; setBusy(false); onBusyChange(false) }
    }
  }
  const copyText = async () => {
    if (!result?.text) return
    const request = ++copyRequest.current
    setCopyState('copying')
    try {
      await window.readerApi.copyText(result.text)
      if (copyRequest.current === request) setCopyState('copied')
    } catch { if (copyRequest.current === request) setCopyState('failed') }
  }
  const cancel = () => { stop(); setBusy(false); setError(copy('vision.previewCancelled')) }
  const active = busy
  return <section className="ocr-preview" data-testid="ocr-preview">
    <h4>{copy('vision.previewTitle')}</h4>
    <p className="field-hint">{copy('vision.previewHint')}</p>
    <div className="ocr-preview-actions">
      <label htmlFor="ocr-preview-page">{copy('vision.previewPage')}</label>
      <input id="ocr-preview-page" data-testid="ocr-preview-page" type="number" min="1" max={OCR_MAX_PAGES} value={page} disabled={active || disabled || suspended}
        onChange={(event) => { copyRequest.current++; setPage(event.target.value); setResult(null); setError(''); setCopyState('idle'); retryForce.current = false }} />
      {active ? <button type="button" className="secondary-button" data-testid="ocr-preview-cancel" onClick={cancel}>{copy('vision.previewCancel')}</button>
        : <button type="button" className="secondary-button" data-testid="ocr-preview-start" disabled={disabled || suspended} onClick={() => void preview(error ? retryForce.current : false)}>{copy(error ? 'vision.previewRetry' : 'vision.previewStart')}</button>}
      {result && <button type="button" className="secondary-button" data-testid="ocr-preview-refresh" disabled={active || disabled || suspended}
        title={copy('vision.previewRefreshHint')} onClick={() => void preview(true)}>{copy('vision.previewRefresh')}</button>}
    </div>
    {active && <p role="status">{copy(stage === 'render' ? 'vision.previewRendering' : 'vision.previewRecognizing')}</p>}
    {error && <p className="analysis-error" role="status" data-testid="ocr-preview-error">{error}</p>}
    {result && <div data-testid="ocr-preview-result">
      <p>{copy('knowledge.pdfPage', { page: result.pageNumber })} / {result.pageCount} · {copy(processorCopy[result.processor])}{result.model ? ` · ${result.model}` : ''}</p>
      <p className="field-hint" data-testid="ocr-preview-source">{copy(result.cached ? 'vision.previewCached' : 'vision.previewSaved')}</p>
      <p className="field-hint">{copy('vision.previewRefreshHint')}{documentReady ? ` ${copy('vision.previewPreparedHint')}` : ''}</p>
      <div className="ocr-preview-comparison">
        <figure><figcaption>{copy('vision.previewImage')}</figcaption><img src={result.imageDataUrl} alt={copy('knowledge.pdfPage', { page: result.pageNumber })} /></figure>
        <div><div className="ocr-preview-text-heading"><span>{copy('vision.previewText')}</span>
          <button type="button" className="secondary-button" data-testid="ocr-preview-copy" disabled={!result.text || active || disabled || suspended || copyState === 'copying'}
            onClick={() => void copyText()}>{copy(copyState === 'copied' ? 'vision.previewCopied' : 'vision.previewCopy')}</button></div>
          {copyState === 'failed' && <p className="analysis-error" role="status">{copy('vision.previewCopyFailed')}</p>}
          <pre data-testid="ocr-preview-text">{result.text || copy('vision.previewBlank')}</pre></div>
      </div>
    </div>}
  </section>
}
