import { useEffect, useState } from 'react'
import type { DocumentProcessor, KnowledgeSettings as Settings, SaveKnowledgeSettingsInput } from '@shared/contracts'
import { copy } from '@shared/copy'
import { readableError } from './readable-error'
import { processorCopy } from '@shared/knowledge'

type KnowledgeDraft = SaveKnowledgeSettingsInput & { rerank: NonNullable<SaveKnowledgeSettingsInput['rerank']> }
function draftOf(settings: Settings): KnowledgeDraft {
  const { hasApiKey: embeddingKey, ...embedding } = settings.embedding
  const { hasApiKey: documentKey, ...document } = settings.document
  const { hasApiKey: rerankKey, ...rerank } = settings.rerank
  void embeddingKey; void documentKey; void rerankKey
  return { embedding, rerank, document }
}

export function KnowledgeSettings({ hidden, onDirty }: { hidden: boolean; onDirty: (dirty: boolean) => void }) {
  const [saved, setSaved] = useState<Settings>()
  const [draft, setDraft] = useState<KnowledgeDraft>()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  useEffect(() => {
    let alive = true
    void window.readerApi.getKnowledgeSettings().then((value) => {
      if (alive) { setSaved(value); setDraft(draftOf(value)) }
    }).catch((error: unknown) => { if (alive) setStatus(readableError(error, copy('knowledge.network'))) })
    return () => { alive = false }
  }, [])
  const dirty = Boolean(saved && draft && JSON.stringify(draft) !== JSON.stringify(draftOf(saved)))
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  const update = (value: KnowledgeDraft): void => { setDraft(value); setStatus('') }
  const run = async (target: 'save' | 'embedding' | 'rerank' | 'document'): Promise<void> => {
    if (!draft || busy) return
    setBusy(true); setStatus('')
    try {
      if (target === 'save') {
        const value = await window.readerApi.saveKnowledgeSettings(draft)
        setSaved(value); setDraft(draftOf(value)); setStatus(copy('knowledge.saved'))
      } else {
        const result = await window.readerApi.testKnowledgeSettings({ ...draft, target })
        setStatus(result.message)
      }
    } catch (error) { setStatus(readableError(error, copy('knowledge.network'))) }
    finally { setBusy(false) }
  }
  return <section className="settings-section knowledge-settings" id="settings-panel-knowledge" role="tabpanel" aria-labelledby="settings-tab-knowledge" hidden={hidden}>
    <h3>{copy('knowledge.title')}</h3>
    <p className="field-hint">{copy('knowledge.description')}</p>
    {draft && <form onSubmit={(event) => { event.preventDefault(); void run('save') }}>
      <fieldset disabled={busy}>
        <h4>{copy('knowledge.embeddingTitle')}</h4>
        <label className="knowledge-checkbox"><input data-testid="embedding-enabled" type="checkbox" checked={draft.embedding.enabled}
          onChange={(event) => update({ ...draft, embedding: { ...draft.embedding, enabled: event.target.checked } })} />{copy('knowledge.embeddingEnabled')}</label>
        <p className="field-hint">{copy('knowledge.embeddingHint')}</p>
        <label className="field-label" htmlFor="embedding-url">{copy('knowledge.baseUrl')}</label>
        <input id="embedding-url" data-testid="embedding-url" value={draft.embedding.baseUrl} spellCheck={false} required={draft.embedding.enabled}
          onChange={(event) => update({ ...draft, embedding: { ...draft.embedding, baseUrl: event.target.value, apiKey: undefined } })} />
        <label className="field-label" htmlFor="embedding-model">{copy('knowledge.model')}</label>
        <input id="embedding-model" data-testid="embedding-model" value={draft.embedding.model} spellCheck={false} required={draft.embedding.enabled}
          onChange={(event) => update({ ...draft, embedding: { ...draft.embedding, model: event.target.value } })} />
        <label className="field-label" htmlFor="embedding-key">{copy('knowledge.apiKey')}</label>
        <input id="embedding-key" type="password" autoComplete="off" value={draft.embedding.apiKey ?? ''}
          placeholder={copy(saved?.embedding.hasApiKey && draft.embedding.baseUrl === saved.embedding.baseUrl ? 'knowledge.keySaved' : 'knowledge.keyEmpty')}
          onChange={(event) => update({ ...draft, embedding: { ...draft.embedding, apiKey: event.target.value || undefined } })} />
        <label className="knowledge-checkbox"><input type="checkbox" checked={draft.embedding.apiKey === null}
          onChange={(event) => update({ ...draft, embedding: { ...draft.embedding, apiKey: event.target.checked ? null : undefined } })} />{copy('knowledge.clearKey')}</label>
        <button className="secondary-button" type="button" data-testid="embedding-test" disabled={!draft.embedding.baseUrl || !draft.embedding.model} onClick={() => void run('embedding')}>{copy('knowledge.testEmbedding')}</button>

        <h4>{copy('rerank.title')}</h4>
        <label className="knowledge-checkbox"><input data-testid="rerank-enabled" type="checkbox" checked={draft.rerank.enabled}
          onChange={(event) => update({ ...draft, rerank: { ...draft.rerank, enabled: event.target.checked } })} />{copy('rerank.enabled')}</label>
        <p className="field-hint">{copy('rerank.hint')}</p>
        <label className="field-label" htmlFor="rerank-url">{copy('knowledge.baseUrl')}</label>
        <input id="rerank-url" data-testid="rerank-url" value={draft.rerank.baseUrl} spellCheck={false} required={draft.rerank.enabled}
          onChange={(event) => update({ ...draft, rerank: { ...draft.rerank, baseUrl: event.target.value, apiKey: undefined } })} />
        <label className="field-label" htmlFor="rerank-model">{copy('rerank.model')}</label>
        <input id="rerank-model" data-testid="rerank-model" value={draft.rerank.model} spellCheck={false} required={draft.rerank.enabled}
          onChange={(event) => update({ ...draft, rerank: { ...draft.rerank, model: event.target.value } })} />
        <label className="field-label" htmlFor="rerank-key">{copy('knowledge.apiKey')}</label>
        <input id="rerank-key" type="password" autoComplete="off" value={draft.rerank.apiKey ?? ''}
          placeholder={copy(saved?.rerank.hasApiKey && draft.rerank.baseUrl === saved.rerank.baseUrl ? 'knowledge.keySaved' : 'knowledge.keyEmpty')}
          onChange={(event) => update({ ...draft, rerank: { ...draft.rerank, apiKey: event.target.value || undefined } })} />
        <label className="knowledge-checkbox"><input data-testid="rerank-clear-key" type="checkbox" checked={draft.rerank.apiKey === null}
          onChange={(event) => update({ ...draft, rerank: { ...draft.rerank, apiKey: event.target.checked ? null : undefined } })} />{copy('knowledge.clearKey')}</label>
        <button className="secondary-button" type="button" data-testid="rerank-test" disabled={!draft.rerank.baseUrl || !draft.rerank.model} onClick={() => void run('rerank')}>{copy('rerank.test')}</button>

        <h4>{copy('knowledge.documentTitle')}</h4>
        <label className="field-label" htmlFor="document-processor">{copy('knowledge.processor')}</label>
        <select id="document-processor" data-testid="document-processor" value={draft.document.processor}
          onChange={(event) => {
            const processor = event.target.value as DocumentProcessor
            update({ ...draft, document: { ...draft.document, processor, apiKey: undefined,
              baseUrl: processor === 'mineru-cloud' ? 'https://mineru.net' : '' } })
          }}>
          {(['none', 'mineru-local', 'mineru-cloud', 'docling'] as const).map((value) => <option key={value} value={value}>{copy(processorCopy[value])}</option>)}
        </select>
        <p className="field-hint">{copy('knowledge.documentHint')}</p>
        {draft.document.processor !== 'none' && <>
          <label className="field-label" htmlFor="document-url">{copy('knowledge.baseUrl')}</label>
          <input id="document-url" data-testid="document-url" value={draft.document.baseUrl} spellCheck={false} required
            onChange={(event) => update({ ...draft, document: { ...draft.document, baseUrl: event.target.value, apiKey: undefined } })} />
          <label className="field-label" htmlFor="document-key">{copy('knowledge.apiKey')}</label>
          <input id="document-key" type="password" autoComplete="off" value={draft.document.apiKey ?? ''}
            placeholder={copy(saved?.document.hasApiKey && draft.document.processor === saved.document.processor && draft.document.baseUrl === saved.document.baseUrl ? 'knowledge.keySaved' : 'knowledge.keyEmpty')}
            onChange={(event) => update({ ...draft, document: { ...draft.document, apiKey: event.target.value || undefined } })} />
          <label className="knowledge-checkbox"><input type="checkbox" checked={draft.document.apiKey === null}
            onChange={(event) => update({ ...draft, document: { ...draft.document, apiKey: event.target.checked ? null : undefined } })} />{copy('knowledge.clearKey')}</label>
          <label className="knowledge-checkbox"><input type="checkbox" data-testid="document-ocr" checked={draft.document.ocr}
            onChange={(event) => update({ ...draft, document: { ...draft.document, ocr: event.target.checked } })} />{copy('knowledge.ocr')}</label>
          <label className="field-label" htmlFor="document-language">{copy('knowledge.language')}</label>
          <select id="document-language" value={draft.document.language} onChange={(event) => update({ ...draft, document: { ...draft.document, language: event.target.value as 'ch' | 'en' } })}>
            <option value="ch">{copy('knowledge.ch')}</option><option value="en">{copy('knowledge.en')}</option>
          </select>
          <button className="secondary-button" type="button" data-testid="document-test" disabled={!draft.document.baseUrl} onClick={() => void run('document')}>{copy('knowledge.testDocument')}</button>
        </>}
        <p className="field-hint">{copy('knowledge.endpointHint')} {copy('knowledge.testHint')}</p>
        <button className="primary-button" type="submit" data-testid="knowledge-save" disabled={!dirty}>{copy('knowledge.save')}</button>
      </fieldset>
    </form>}
    {(busy || status) && <p role="status" className="field-hint" data-testid="knowledge-status">{busy ? copy('knowledge.testing') : status}</p>}
  </section>
}
