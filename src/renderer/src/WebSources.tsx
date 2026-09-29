import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ContextSnapshot, WebSearchSource } from '@shared/contracts'
import { copy } from '@shared/copy'
import { webSearchStatus } from '@shared/web-search'
import { useDialogFocus } from './use-dialog-focus'

function SourceContent({ source, bookId }: { source: WebSearchSource; bookId: string }) {
  const [error, setError] = useState('')
  const open = async (): Promise<void> => {
    try { await window.readerApi.openWebSource({ bookId, url: source.url }); setError('') }
    catch { setError(copy('webSearch.openFailed')) }
  }
  return <div className="web-source-content">
    <strong>{source.title}</strong><small className="web-source-url">{source.url}</small>
    <p>{source.excerpt}</p>
    <button className="text-button" data-testid="web-source-open" type="button" onClick={(event) => { event.stopPropagation(); void open() }}>{copy('webSearch.openInBrowser')}</button>
    {error && <p role="status" className="field-hint is-error-text">{error}</p>}
  </div>
}

function SourceDialog({ source, bookId, onClose }: { source: WebSearchSource; bookId: string; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null)
  const returnRef = useRef<HTMLElement>(null)
  useDialogFocus(true, onClose, ref, returnRef)
  return createPortal(<div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={ref} role="dialog" aria-modal="true" aria-label={copy('webSearch.sourcesTitle')} className="web-source-dialog" data-testid="web-source-dialog" onClick={(event) => event.stopPropagation()}>
      <header><h3>{copy('webSearch.sourcesTitle')}</h3><button type="button" className="text-button" onClick={onClose}>{copy('webSearch.close')}</button></header>
      <SourceContent source={source} bookId={bookId} />
    </section>
  </div>, document.body)
}

export function WebCitation({ source, bookId }: { source: WebSearchSource; bookId: string }) {
  const [expanded, setExpanded] = useState(false)
  return <><button type="button" className="citation citation-valid" data-testid="citation-web" title={source.title} onClick={(event) => { event.stopPropagation(); setExpanded(true) }}>{source.title}</button>
    {expanded && <SourceDialog source={source} bookId={bookId} onClose={() => setExpanded(false)} />}</>
}

export function WebSources({ context }: { context: ContextSnapshot }) {
  const record = context.webSearch
  if (!record) return null
  return <div className="web-sources" data-testid="web-search-result">
    <p className="field-hint" role="status">{webSearchStatus(record)}</p>
    {(record.query || record.sources.length > 0) && <details className="answer-sources" data-testid="web-sources"><summary>{copy('webSearch.sourcesTitle')}</summary>
      {record.query && <p className="field-hint">{copy('webSearch.queryLabel', { query: record.query })}</p>}
      {record.searchedAt && <p className="field-hint">{copy('webSearch.searchedAt', { time: record.searchedAt })}</p>}
      {record.sources.map((source) => <SourceContent key={source.id} source={source} bookId={context.bookId} />)}
    </details>}
  </div>
}
