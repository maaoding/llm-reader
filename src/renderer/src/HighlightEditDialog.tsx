import { useId, useRef, type RefObject } from 'react'
import { X } from 'lucide-react'
import { copy } from '@shared/copy'
import { HIGHLIGHT_NOTE_MAX_LENGTH } from '@shared/highlight-tags'
import type { HighlightEditor } from './use-highlight-editor'
import { useDialogFocus } from './use-dialog-focus'

export function HighlightEditDialog({ editor, fallbackFocusRef }: {
  editor: HighlightEditor
  fallbackFocusRef: RefObject<HTMLElement | null>
}) {
  const id = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const { draft, dirty, saving, error, returnFocusRef, change, close, save } = editor
  useDialogFocus(Boolean(draft), close, dialogRef, returnFocusRef, fallbackFocusRef)
  if (!draft) return null

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <section ref={dialogRef} className="highlight-edit-dialog" role="dialog" aria-modal="true"
      aria-labelledby={id + '-title'} aria-busy={saving} data-testid="highlight-edit-dialog">
      <header className="modal-header">
        <h2 id={id + '-title'}>{copy('highlights.edit')}</h2>
        <button type="button" className="icon-button" disabled={saving} aria-label={copy('window.closeAria')} onClick={close}><X size={18} /></button>
      </header>
      <p className="highlight-quote">{draft.original.quote}</p>
      <form onSubmit={(event) => { event.preventDefault(); void save() }}>
        <label className="field-label" htmlFor={id + '-note'}>{copy('highlights.note')}</label>
        <textarea id={id + '-note'} data-testid="highlight-note" rows={5} maxLength={HIGHLIGHT_NOTE_MAX_LENGTH}
          value={draft.note} disabled={saving} onChange={(event) => change('note', event.target.value)} />
        <label className="field-label" htmlFor={id + '-tags'}>{copy('highlights.tags')}</label>
        <input id={id + '-tags'} data-testid="highlight-tags" aria-describedby={id + '-tags-hint'} value={draft.tagsText}
          disabled={saving} onChange={(event) => change('tagsText', event.target.value)} />
        <p id={id + '-tags-hint'} className="field-hint">{copy('highlights.tagsHint')}</p>
        {saving && <p role="status" className="field-hint">{copy('highlights.noteSaving')}</p>}
        {error && <p role="alert" className="highlight-edit-error">{error}</p>}
        <footer className="modal-actions">
          <button type="button" className="secondary-button" disabled={saving} onClick={close}>{copy('common.back')}</button>
          <button type="submit" className="primary-button" disabled={saving || !dirty} data-testid="highlight-note-save">{copy('highlights.saveNote')}</button>
        </footer>
      </form>
    </section>
  </div>
}
