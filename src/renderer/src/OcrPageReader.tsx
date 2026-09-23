import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { PreparedOcrPage, SelectionContext } from '@shared/contracts'
import { copy } from '@shared/copy'
import { OCR_MAX_PAGES } from '@shared/vision-ocr'
import { readableError } from './readable-error'
import { ocrSelection } from './readers/ocr-selection'

export function OcrPageReader({ bookId, pageNumber, onSelection, onNavigate, onClose, onPrepare }: {
  bookId: string; pageNumber: number; onSelection: (selection: SelectionContext | null) => void
  onNavigate: (page: number) => Promise<void>; onClose: () => void; onPrepare: () => void
}) {
  const [page, setPage] = useState<PreparedOcrPage | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [retry, setRetry] = useState(0)
  const [input, setInput] = useState(String(pageNumber))
  const [navigating, setNavigating] = useState(false)
  const [copying, setCopying] = useState(false)
  const textRef = useRef<HTMLPreElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    closeRef.current?.focus({ preventScroll: true })
    return () => { alive.current = false }
  }, [])
  useEffect(() => {
    let current = true
    void window.readerApi.getBookOcrPage({ bookId, pageNumber }).then((result) => {
      if (current) setPage(result)
    }).catch((failure) => { if (current) setError(readableError(failure, copy('ocrReading.loadFailed'))) })
    return () => { current = false }
  }, [bookId, pageNumber, retry])
  useEffect(() => {
    const element = textRef.current
    if (!element || page?.status !== 'ready') return
    let selectedAnchor = ''
    const changed = () => {
      const selection = window.getSelection()
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null
      if (!range || selection?.isCollapsed || !element.contains(range.startContainer) || !element.contains(range.endContainer)) {
        if (selectedAnchor) { selectedAnchor = ''; onSelection(null) }
        return
      }
      const prefix = range.cloneRange()
      prefix.selectNodeContents(element); prefix.setEnd(range.startContainer, range.startOffset)
      const start = Array.from(prefix.toString()).length
      prefix.setEnd(range.endContainer, range.endOffset)
      try {
        const context = ocrSelection(bookId, page, start, Array.from(prefix.toString()).length)
        if ((context?.anchor ?? '') !== selectedAnchor) { selectedAnchor = context?.anchor ?? ''; onSelection(context) }
        setMessage('')
      } catch (failure) { selectedAnchor = ''; onSelection(null); setMessage(readableError(failure, copy('ocrReading.selectionTooLong'))) }
    }
    document.addEventListener('selectionchange', changed)
    return () => {
      document.removeEventListener('selectionchange', changed)
      const selection = window.getSelection()
      if (selection?.anchorNode && element.contains(selection.anchorNode)) selection.removeAllRanges()
      if (selectedAnchor) onSelection(null)
    }
  }, [bookId, page, onSelection])
  const navigate = async (target: number) => {
    const total = page?.status === 'ready' ? page.pageCount : OCR_MAX_PAGES
    if (!Number.isInteger(target) || target < 1 || target > total) { setMessage(copy('vision.previewPageRange', { count: total })); return }
    if (navigating || target === pageNumber) return
    setNavigating(true); setMessage(''); onSelection(null)
    try { await onNavigate(target) }
    catch (failure) { if (alive.current) setMessage(readableError(failure, copy('reader.navigateSourceFailed'))) }
    finally { if (alive.current) setNavigating(false) }
  }
  const submit = (event: FormEvent) => { event.preventDefault(); void navigate(Number(input)) }
  const copyText = async () => {
    if (page?.status !== 'ready' || !page.text || copying) return
    setCopying(true); setMessage('')
    try { await window.readerApi.copyText(page.text); if (alive.current) setMessage(copy('vision.previewCopied')) }
    catch { if (alive.current) setMessage(copy('vision.previewCopyFailed')) }
    finally { if (alive.current) setCopying(false) }
  }
  return <section className="ocr-page-reader" data-testid="ocr-page-reader" aria-label={copy('ocrReading.title')}>
    <header className="ocr-reading-header"><h2>{copy('ocrReading.title')}</h2><button ref={closeRef} type="button" className="secondary-button" data-testid="ocr-reading-close" onClick={onClose}>{copy('ocrReading.viewPdf')}</button></header>
    <p className="ocr-reading-hint">{copy('ocrReading.hint')}</p>
    {!page && !error && <p role="status">{copy('ocrReading.loading')}</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" className="secondary-button" onClick={() => { setError(''); setPage(null); setRetry((value) => value + 1) }}>{copy('common.retry')}</button></div>}
    {page && page.status !== 'ready' && <div className="ocr-reading-empty"><p role="status">{copy(page.status === 'unprepared' ? 'ocrReading.unprepared' : 'ocrReading.unsupported')}</p>
      <button type="button" className="secondary-button" data-testid="ocr-reading-prepare" onClick={onPrepare}>{copy('ocrReading.prepare')}</button></div>}
    {page?.status === 'ready' && <>
      <form className="ocr-reading-actions" onSubmit={submit}>
        <button type="button" className="secondary-button" data-testid="ocr-reading-previous" disabled={navigating || pageNumber <= 1} onClick={() => void navigate(pageNumber - 1)}>{copy('ocrReading.previous')}</button>
        <label htmlFor="ocr-reading-page">{copy('vision.previewPage')}</label>
        <input id="ocr-reading-page" data-testid="ocr-reading-page" type="number" min="1" max={page.pageCount} value={input} disabled={navigating} onChange={(event) => setInput(event.target.value)} />
        <span>/ {page.pageCount}</span><button type="submit" className="secondary-button" disabled={navigating}>{copy('ocrReading.go')}</button>
        <button type="button" className="secondary-button" data-testid="ocr-reading-next" disabled={navigating || pageNumber >= page.pageCount} onClick={() => void navigate(pageNumber + 1)}>{copy('ocrReading.next')}</button>
        <button type="button" className="secondary-button" data-testid="ocr-reading-copy" disabled={!page.text || copying} onClick={() => void copyText()}>{copy('ocrReading.copy')}</button>
      </form>
      {message && <p className="ocr-reading-message" role="status">{message}</p>}
      {page.text ? <pre ref={textRef} className="ocr-reading-text" data-testid="ocr-reading-text" tabIndex={0} aria-label={copy('knowledge.pdfPage', { page: pageNumber })}>{page.text}</pre>
        : <p role="status">{copy('ocrReading.blank')}</p>}
    </>}
  </section>
}
