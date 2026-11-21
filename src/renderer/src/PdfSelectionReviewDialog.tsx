import { useCallback, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { X } from 'lucide-react'
import { copy } from '@shared/copy'
import type { ReaderSelectionDraft, ReaderImageRegionDraft } from './readers'
import { useDialogFocus } from './use-dialog-focus'

export function PdfSelectionReviewDialog({ draft }: { draft: ReaderSelectionDraft }): ReactNode {
  const [value, setValue] = useState(draft.quote)
  const dialogRef = useRef<HTMLElement>(null)
  const returnRef = useRef<HTMLElement>(null)
  const close = useCallback(() => draft.cancel(), [draft])
  useDialogFocus(true, close, dialogRef, returnRef)

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const quote = value.trim()
    if (!quote) return
    draft.confirm(quote)
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section
        ref={dialogRef}
        className="pdf-selection-review-modal"
        data-testid="pdf-selection-review"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-selection-review-title"
      >
        <header className="modal-header">
          <h2 id="pdf-selection-review-title">{copy('reader.pdfRegionReviewTitle')}</h2>
          <button className="icon-button" type="button" onClick={close} aria-label={copy('reader.pdfRegionCancel')}><X size={16} /></button>
        </header>
        <form onSubmit={submit}>
          <div className="pdf-selection-review-body">
            <p>{copy('reader.pdfRegionReviewDetail')}</p>
            <textarea
              data-testid="pdf-selection-review-input"
              aria-label={copy('reader.pdfRegionReviewInputAria')}
              value={value}
              maxLength={20_000}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          <footer className="modal-actions">
            <button ref={returnRef as RefObject<HTMLButtonElement>} className="secondary-button" data-testid="pdf-selection-review-cancel" type="button" onClick={close}>{copy('reader.pdfRegionCancel')}</button>
            <button className="primary-button" data-testid="pdf-selection-review-confirm" type="submit" disabled={!value.trim()}>{copy('reader.pdfRegionConfirm')}</button>
          </footer>
        </form>
      </section>
    </div>
  )
}

export function PdfImageRegionReviewDialog({ draft }: { draft: ReaderImageRegionDraft }): ReactNode {
  const dialogRef = useRef<HTMLElement>(null)
  const returnRef = useRef<HTMLElement>(null)
  const close = useCallback(() => draft.cancel(), [draft])
  useDialogFocus(true, close, dialogRef, returnRef)
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
    <section ref={dialogRef} className="pdf-selection-review-modal" data-testid="pdf-image-region-review" role="dialog" aria-modal="true" aria-labelledby="pdf-image-region-review-title">
      <header className="modal-header"><h2 id="pdf-image-region-review-title">{copy('visual.reviewTitle')}</h2>
        <button className="icon-button" type="button" onClick={close} aria-label={copy('reader.pdfRegionCancel')}><X size={16} /></button></header>
      <div className="pdf-selection-review-body"><p>{copy('visual.reviewHint')}</p>
        <img className="pdf-image-region-preview" src={draft.imageDataUrl} alt={copy('visual.source', { page: draft.source.pageNumber })} /></div>
      <footer className="modal-actions"><button ref={returnRef as RefObject<HTMLButtonElement>} className="secondary-button" type="button" onClick={close}>{copy('reader.pdfRegionCancel')}</button>
        <button className="primary-button" data-testid="pdf-image-region-confirm" type="button" onClick={draft.confirm}>{copy('reader.pdfRegionConfirm')}</button></footer>
    </section>
  </div>
}
