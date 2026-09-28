import { useEffect, useRef, useState } from 'react'
import type { DocumentProcessor, KnowledgeSettings as Settings, SaveKnowledgeSettingsInput, TestKnowledgeSettingsInput } from '@shared/contracts'
import { copy } from '@shared/copy'
import { readableError } from './readable-error'
import { processorCopy } from '@shared/knowledge'
import { isPageProcessor } from '@shared/request-settings'
import { RequestSettingsEditor } from './RequestSettingsEditor'

type KnowledgeDraft = SaveKnowledgeSettingsInput & { rerank: NonNullable<SaveKnowledgeSettingsInput['rerank']> }
type Kind = 'embedding' | 'rerank' | 'document'
const kinds: Kind[] = ['embedding', 'rerank', 'document']
function draftOf(settings: Settings): KnowledgeDraft {
  const { hasApiKey: embeddingKey, ...embedding } = settings.embedding
  const { hasApiKey: documentKey, ...document } = settings.document
  const { hasApiKey: rerankKey, ...rerank } = settings.rerank
  void embeddingKey; void documentKey; void rerankKey
  return { embedding, rerank, document }
}

export function KnowledgeSettings({ hidden, onDirty, initialService }: { hidden: boolean; onDirty: (dirty: boolean) => void; initialService?: 'document' | 'embedding' }) {
  const sectionRef = useRef<HTMLElement>(null)
  const [saved, setSaved] = useState<Settings>()
  const [draft, setDraft] = useState<KnowledgeDraft>()
  const [busy, setBusy] = useState<string | null>(null)
  const [testStatus, setTestStatus] = useState<Partial<Record<Kind, string>>>({})
  const [status, setStatus] = useState<Partial<Record<Kind, string>>>({})
  const [loadError, setLoadError] = useState('')
  const [invalidSettings, setInvalidSettings] = useState<Partial<Record<Kind, boolean>>>({})
  const [editorRevision, setEditorRevision] = useState<Record<Kind, number>>({ embedding: 0, rerank: 0, document: 0 })
  const loaded = Boolean(draft)
  useEffect(() => {
    if (!hidden && loaded && initialService) {
      const card = sectionRef.current?.querySelector<HTMLDetailsElement>(`[data-service="${initialService}"]`)
      if (card) { card.open = true; card.scrollIntoView({ block: 'start' }); card.querySelector<HTMLElement>('select, input')?.focus({ preventScroll: true }) }
    }
  }, [hidden, loaded, initialService])
  useEffect(() => {
    let alive = true
    void window.readerApi.getKnowledgeSettings().then((value) => {
      if (alive) { setSaved(value); setDraft(draftOf(value)) }
    }).catch((error: unknown) => { if (alive) setLoadError(readableError(error, copy('knowledge.network'))) })
    return () => { alive = false }
  }, [])
  const changed = (kind: Kind): boolean => Boolean(saved && draft && JSON.stringify(draft[kind]) !== JSON.stringify(draftOf(saved)[kind]))
  const configured = (kind: Kind): boolean => Boolean(saved && (kind === 'document'
    ? saved.document.processor !== 'none' && saved.document.baseUrl && (!['vision', 'mistral-ocr'].includes(saved.document.processor) || saved.document.model)
    : saved[kind].baseUrl && saved[kind].model))
  const dirty = Object.values(invalidSettings).some(Boolean) || kinds.some(changed)
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  const update = (value: KnowledgeDraft): void => {
    for (const kind of kinds) {
      if (JSON.stringify(draft?.[kind]) === JSON.stringify(value[kind])) continue
      setTestStatus((current) => current[kind] ? { ...current, [kind]: copy('knowledge.testOutdated') } : current)
      setStatus((current) => ({ ...current, [kind]: undefined }))
      const endpointChanged = draft?.[kind].baseUrl !== value[kind].baseUrl ||
        kind === 'document' && (draft?.document.processor !== value.document.processor || draft?.document.protocol !== value.document.protocol)
      if (endpointChanged) setInvalidSettings((current) => ({ ...current, [kind]: false }))
    }
    setDraft(value)
  }
  const validateFields = (target: Kind): boolean => {
    const container = sectionRef.current?.querySelector(`[data-service="${target}"]`)
    const invalid = Array.from(container?.querySelectorAll<HTMLInputElement>('input') ?? []).find((field) => field.willValidate && !field.validity.valid)
    if (invalid) {
      const card = invalid.closest('details')
      if (card) card.open = true
      invalid.scrollIntoView({ block: 'center' })
      invalid.focus(); invalid.reportValidity()
      return false
    }
    return true
  }
  const save = async (target: Kind, activate = false): Promise<void> => {
    if (!draft || !saved || busy || invalidSettings[target] || !validateFields(target)) return
    setBusy(`save-${target}`); setStatus((current) => ({ ...current, [target]: undefined }))
    try {
      const input = { ...draftOf(saved), [target]: { ...draft[target], enabled: activate || draft[target].enabled }, target }
      const value = await window.readerApi.saveKnowledgeSettings(input)
      setSaved(value)
      setDraft((current) => current ? { ...current, [target]: draftOf(value)[target] } : current)
      setEditorRevision((current) => ({ ...current, [target]: current[target] + 1 }))
      setInvalidSettings((current) => ({ ...current, [target]: false }))
      setStatus((current) => ({ ...current, [target]: copy(activate ? 'knowledge.savedAndEnabled' : 'knowledge.saved') }))
    } catch (error) {
      setStatus((current) => ({ ...current, [target]: readableError(error, copy('knowledge.network')) }))
    }
    finally { setBusy(null) }
  }
  const toggle = async (target: Kind, enabled: boolean): Promise<void> => {
    if (!saved || !draft || busy) return
    setBusy(`toggle-${target}`); setStatus((current) => ({ ...current, [target]: undefined }))
    try {
      const previous = draftOf(saved)
      const value = await window.readerApi.saveKnowledgeSettings({ ...previous, [target]: { ...previous[target], enabled }, target })
      setSaved(value)
      setDraft((current) => current ? { ...current, [target]: { ...current[target], enabled } } : current)
      setStatus((current) => ({ ...current, [target]: copy(enabled ? 'knowledge.enabledNow' : 'knowledge.disabledNow') }))
    } catch (error) {
      setStatus((current) => ({ ...current, [target]: readableError(error, copy('knowledge.network')) }))
    }
    finally { setBusy(null) }
  }
  const test = async (target: Kind): Promise<void> => {
    if (!draft || busy || invalidSettings[target] || !validateFields(target)) return
    setBusy(`test-${target}`); setTestStatus((current) => ({ ...current, [target]: undefined }))
    try {
      const input: TestKnowledgeSettingsInput = target === 'embedding' ? { target, embedding: draft.embedding } :
        target === 'rerank' ? { target, rerank: draft.rerank } : { target, document: draft.document }
      const result = await window.readerApi.testKnowledgeSettings(input)
      setTestStatus((current) => ({ ...current, [target]: result.message }))
    } catch (error) {
      setTestStatus((current) => ({ ...current, [target]: readableError(error, copy('knowledge.network')) }))
    }
    finally { setBusy(null) }
  }
  const feedback = (target: Kind) => (busy === `test-${target}` || busy === `save-${target}` || testStatus[target] || status[target]) &&
    <p role="status" className="field-hint knowledge-status" data-testid={`knowledge-${target}-status`}>
      {busy === `test-${target}` || busy === `save-${target}` ? copy('knowledge.testing') : status[target] || testStatus[target]}
    </p>
  const heading = (target: Kind, title: string) => <summary className="knowledge-service-summary"><span>{title}</span>
    <small>{copy(!configured(target) ? 'knowledge.unconfigured' :
      saved?.[target].enabled ? 'knowledge.active' : 'knowledge.inactive')}</small>
    {changed(target) && <small>{copy('knowledge.pending')}</small>}
    <small className="knowledge-details-label">{copy('knowledge.details')}</small>
  </summary>
  const saveButton = (target: Kind) => {
    const firstSetup = !configured(target)
    return <button className="primary-button" type="button" data-testid={`${target}-save`}
      disabled={!changed(target) || Boolean(invalidSettings[target]) || target === 'document' && draft?.document.processor === 'none'}
      onClick={() => void save(target, Boolean(firstSetup))}>
      {copy(firstSetup ? 'knowledge.saveAndEnable' : 'knowledge.saveService')}
    </button>
  }
  return <section ref={sectionRef} className="settings-section knowledge-settings" id="settings-panel-knowledge" role="tabpanel" aria-labelledby="settings-tab-knowledge" hidden={hidden}>
    <h3>{copy('knowledge.title')}</h3>
    <p className="field-hint">{copy('knowledge.description')}</p>
    {draft && saved && <div>
      <fieldset disabled={Boolean(busy)}>
        <details open className="knowledge-service-card" data-service="embedding">{heading('embedding', copy('knowledge.embeddingTitle'))}
        <label className="knowledge-checkbox"><input data-testid="embedding-enabled" type="checkbox" role="switch" checked={saved.embedding.enabled}
          disabled={!saved.embedding.enabled && !configured('embedding')}
          onChange={(event) => void toggle('embedding', event.target.checked)} />{copy('knowledge.embeddingEnabled')}</label>
        {!configured('embedding') && <p className="field-hint">{copy('knowledge.configureBeforeEnable')}</p>}
        <p className="field-hint">{copy('knowledge.embeddingHint')}</p>
        <label className="field-label" htmlFor="embedding-url">{copy('knowledge.baseUrl')}</label>
        <input id="embedding-url" type="url" pattern="https?://[^?#]+" data-testid="embedding-url" value={draft.embedding.baseUrl} spellCheck={false} required
          onChange={(event) => update({ ...draft, embedding: { ...draft.embedding, baseUrl: event.target.value, apiKey: undefined, customHeaders: undefined } })} />
        <label className="field-label" htmlFor="embedding-model">{copy('knowledge.model')}</label>
        <input id="embedding-model" data-testid="embedding-model" value={draft.embedding.model} spellCheck={false} required
          onChange={(event) => update({ ...draft, embedding: { ...draft.embedding, model: event.target.value } })} />
        <label className="field-label" htmlFor="embedding-key">{copy('knowledge.apiKey')}</label>
        <input id="embedding-key" type="password" autoComplete="off" value={draft.embedding.apiKey ?? ''}
          placeholder={copy(saved?.embedding.hasApiKey && draft.embedding.baseUrl === saved.embedding.baseUrl ? 'knowledge.keySaved' : 'knowledge.keyEmpty')}
          onChange={(event) => update({ ...draft, embedding: { ...draft.embedding, apiKey: event.target.value || undefined } })} />
        {(saved.embedding.hasApiKey && saved.embedding.baseUrl === draft.embedding.baseUrl || draft.embedding.apiKey === null) && <button className="text-button" type="button" data-testid="embedding-clear-key"
          onClick={() => update({ ...draft, embedding: { ...draft.embedding, apiKey: draft.embedding.apiKey === null ? undefined : null } })}>
          {copy(draft.embedding.apiKey === null ? 'knowledge.undoClear' : 'knowledge.clearKey')}
        </button>}
        {draft.embedding.apiKey === null && <p className="field-hint">{copy('knowledge.clearPending')}</p>}
        <RequestSettingsEditor key={editorRevision.embedding + '-embedding-' + draft.embedding.baseUrl} id="embedding" value={draft.embedding}
          savedHeaders={saved?.embedding.hasCustomHeaders && draft.embedding.baseUrl === saved.embedding.baseUrl}
          onInvalidChange={(invalid) => { setInvalidSettings((current) => ({ ...current, embedding: invalid })); if (invalid) setTestStatus((current) => current.embedding ? { ...current, embedding: copy('knowledge.testOutdated') } : current) }}
          onChange={(settings) => update({ ...draft, embedding: { ...draft.embedding, ...settings } })} />
        <div className="knowledge-service-actions">
          <button className="secondary-button" type="button" data-testid="embedding-test" disabled={invalidSettings.embedding || !draft.embedding.baseUrl || !draft.embedding.model} onClick={() => void test('embedding')}>{copy('knowledge.testEmbedding')}</button>
          {saveButton('embedding')}
        </div>
        {feedback('embedding')}</details>
        <details open className="knowledge-service-card" data-service="rerank">{heading('rerank', copy('rerank.title'))}
        <label className="knowledge-checkbox"><input data-testid="rerank-enabled" type="checkbox" role="switch" checked={saved.rerank.enabled}
          disabled={!saved.rerank.enabled && !configured('rerank')}
          onChange={(event) => void toggle('rerank', event.target.checked)} />{copy('rerank.enabled')}</label>
        {!configured('rerank') && <p className="field-hint">{copy('knowledge.configureBeforeEnable')}</p>}
        <p className="field-hint">{copy('rerank.hint')}</p>
        <label className="field-label" htmlFor="rerank-url">{copy('knowledge.baseUrl')}</label>
        <input id="rerank-url" type="url" pattern="https?://[^?#]+" data-testid="rerank-url" value={draft.rerank.baseUrl} spellCheck={false} required
          onChange={(event) => update({ ...draft, rerank: { ...draft.rerank, baseUrl: event.target.value, apiKey: undefined, customHeaders: undefined } })} />
        <label className="field-label" htmlFor="rerank-model">{copy('rerank.model')}</label>
        <input id="rerank-model" data-testid="rerank-model" value={draft.rerank.model} spellCheck={false} required
          onChange={(event) => update({ ...draft, rerank: { ...draft.rerank, model: event.target.value } })} />
        <label className="field-label" htmlFor="rerank-key">{copy('knowledge.apiKey')}</label>
        <input id="rerank-key" type="password" autoComplete="off" value={draft.rerank.apiKey ?? ''}
          placeholder={copy(saved?.rerank.hasApiKey && draft.rerank.baseUrl === saved.rerank.baseUrl ? 'knowledge.keySaved' : 'knowledge.keyEmpty')}
          onChange={(event) => update({ ...draft, rerank: { ...draft.rerank, apiKey: event.target.value || undefined } })} />
        {(saved.rerank.hasApiKey && saved.rerank.baseUrl === draft.rerank.baseUrl || draft.rerank.apiKey === null) && <button className="text-button" type="button" data-testid="rerank-clear-key"
          onClick={() => update({ ...draft, rerank: { ...draft.rerank, apiKey: draft.rerank.apiKey === null ? undefined : null } })}>
          {copy(draft.rerank.apiKey === null ? 'knowledge.undoClear' : 'knowledge.clearKey')}
        </button>}
        {draft.rerank.apiKey === null && <p className="field-hint">{copy('knowledge.clearPending')}</p>}
        <RequestSettingsEditor key={editorRevision.rerank + '-rerank-' + draft.rerank.baseUrl} id="rerank" value={draft.rerank}
          savedHeaders={saved?.rerank.hasCustomHeaders && draft.rerank.baseUrl === saved.rerank.baseUrl}
          onInvalidChange={(invalid) => { setInvalidSettings((current) => ({ ...current, rerank: invalid })); if (invalid) setTestStatus((current) => current.rerank ? { ...current, rerank: copy('knowledge.testOutdated') } : current) }}
          onChange={(settings) => update({ ...draft, rerank: { ...draft.rerank, ...settings } })} />
        <div className="knowledge-service-actions">
          <button className="secondary-button" type="button" data-testid="rerank-test" disabled={invalidSettings.rerank || !draft.rerank.baseUrl || !draft.rerank.model} onClick={() => void test('rerank')}>{copy('rerank.test')}</button>
          {saveButton('rerank')}
        </div>
        {feedback('rerank')}</details>
        <details open className="knowledge-service-card" data-service="document">{heading('document', copy('knowledge.documentTitle'))}
        <label className="knowledge-checkbox"><input data-testid="document-enabled" type="checkbox" role="switch" checked={saved.document.enabled}
          disabled={!saved.document.enabled && !configured('document')}
          onChange={(event) => void toggle('document', event.target.checked)} />{copy('knowledge.documentEnabled')}</label>
        {!configured('document') && <p className="field-hint">{copy('knowledge.configureBeforeEnable')}</p>}
        <p className="field-hint">{copy('knowledge.documentStartHint')}</p>
        <label className="field-label" htmlFor="document-processor">{copy('knowledge.processor')}</label>
        <select id="document-processor" data-testid="document-processor" value={draft.document.processor}
          onChange={(event) => {
            const processor = event.target.value as DocumentProcessor
            update({ ...draft, document: { ...draft.document, processor, apiKey: undefined, customHeaders: undefined, extraBody: undefined, protocol: undefined,
              model: processor === 'mistral-ocr' ? 'mistral-ocr-latest' : '',
              baseUrl: processor === 'mineru-cloud' ? 'https://mineru.net' : processor === 'mistral-ocr' ? 'https://api.mistral.ai/v1' : processor === 'docling' ? 'http://127.0.0.1:5001' : processor === 'mineru-local' ? 'http://127.0.0.1:8000' : '' } })
          }}>
          <option value="none" disabled>{copy('knowledge.none')}</option>
          {(['mineru-local', 'mineru-cloud', 'docling', 'vision', 'mistral-ocr', 'unstructured'] as const).map((value) => <option key={value} value={value}>{copy(processorCopy[value])}</option>)}
        </select>
        <p className="field-hint">{copy('knowledge.processorGuide')}</p>
        <p className="field-hint">{copy(draft.document.processor === 'vision' ? 'vision.hint' : isPageProcessor(draft.document.processor) ? 'request.pageHint' : 'knowledge.documentHint')}</p>
        {draft.document.processor === 'unstructured' && <p className="field-hint">{copy('request.partitionHint')}</p>}
        {draft.document.processor !== 'none' && <>
          <label className="field-label" htmlFor="document-url">{copy('knowledge.baseUrl')}</label>
          <input id="document-url" type="url" pattern="https?://[^?#]+" data-testid="document-url" value={draft.document.baseUrl} spellCheck={false} required
            onChange={(event) => update({ ...draft, document: { ...draft.document, baseUrl: event.target.value, apiKey: undefined, customHeaders: undefined } })} />
          {['vision', 'mistral-ocr'].includes(draft.document.processor) && <>
            <label className="field-label" htmlFor="document-model">{copy(draft.document.processor === 'vision' ? 'vision.model' : 'request.ocrModel')}</label>
            <input id="document-model" data-testid="document-model" value={draft.document.model ?? ''} maxLength={256} spellCheck={false} required
              onChange={(event) => update({ ...draft, document: { ...draft.document, model: event.target.value } })} />
          </>}
          {draft.document.processor === 'vision' && <>
            <label className="field-label" htmlFor="document-protocol">{copy('request.protocol')}</label>
            <select id="document-protocol" data-testid="document-protocol" value={draft.document.protocol ?? 'openai'} onChange={(event) => update({ ...draft, document: { ...draft.document, protocol: event.target.value as 'openai' | 'anthropic', apiKey: undefined, customHeaders: undefined } })}>
              <option value="openai">{copy('request.openai')}</option><option value="anthropic">{copy('request.anthropic')}</option>
            </select>
            <label className="field-label" htmlFor="document-compatibility">{copy('settings.compatibilityLabel')}</label>
            <select id="document-compatibility" value={draft.document.compatibility ?? 'auto'} onChange={(event) => update({ ...draft, document: { ...draft.document, compatibility: event.target.value as 'auto' | 'opencode-go' } })}>
              <option value="auto">{copy('settings.compatibilityAuto')}</option><option value="opencode-go">{copy('settings.compatibilityGo')}</option>
            </select>
            <p className="field-hint">{copy('settings.compatibilityHint')}</p>
          </>}
          <label className="field-label" htmlFor="document-key">{copy('knowledge.apiKey')}</label>
          <input id="document-key" type="password" autoComplete="off" value={draft.document.apiKey ?? ''}
            placeholder={copy(saved?.document.hasApiKey && draft.document.processor === saved.document.processor && draft.document.baseUrl === saved.document.baseUrl ? 'knowledge.keySaved' : 'knowledge.keyEmpty')}
            onChange={(event) => update({ ...draft, document: { ...draft.document, apiKey: event.target.value || undefined } })} />
          {(saved.document.hasApiKey && saved.document.baseUrl === draft.document.baseUrl && saved.document.processor === draft.document.processor || draft.document.apiKey === null) &&
            <button className="text-button" type="button" data-testid="document-clear-key"
              onClick={() => update({ ...draft, document: { ...draft.document, apiKey: draft.document.apiKey === null ? undefined : null } })}>
              {copy(draft.document.apiKey === null ? 'knowledge.undoClear' : 'knowledge.clearKey')}
            </button>}
          {draft.document.apiKey === null && <p className="field-hint">{copy('knowledge.clearPending')}</p>}
          {!isPageProcessor(draft.document.processor) ? <>
            <label className="field-label" htmlFor="document-ocr">{copy('knowledge.extractionMethod')}</label>
            <select id="document-ocr" data-testid="document-ocr" value={draft.document.ocr ? 'ocr' : 'text'}
              onChange={(event) => update({ ...draft, document: { ...draft.document, ocr: event.target.value === 'ocr' } })}>
              <option value="text">{copy('knowledge.extractText')}</option>
              <option value="ocr">{copy(draft.document.processor === 'docling' ? 'knowledge.doclingOcr' : 'knowledge.extractOcr')}</option>
            </select>
            <p className="field-hint">{copy('knowledge.extractionHint')}</p>
          </> : <p className="field-hint">{copy('knowledge.pageOcrOnly')}</p>}
          <label className="field-label" htmlFor="document-language">{copy('knowledge.language')}</label>
          <select id="document-language" value={draft.document.language} onChange={(event) => update({ ...draft, document: { ...draft.document, language: event.target.value as 'ch' | 'en' } })}>
            <option value="ch">{copy('knowledge.ch')}</option><option value="en">{copy('knowledge.en')}</option>
          </select>
        </>}
        {draft.document.processor !== 'none' && <RequestSettingsEditor key={editorRevision.document + '-document-' + draft.document.baseUrl + draft.document.processor + draft.document.protocol} id="document" value={draft.document}
          savedHeaders={saved?.document.hasCustomHeaders && draft.document.baseUrl === saved.document.baseUrl && draft.document.processor === saved.document.processor && draft.document.protocol === saved.document.protocol}
          onInvalidChange={(invalid) => { setInvalidSettings((current) => ({ ...current, document: invalid })); if (invalid) setTestStatus((current) => current.document ? { ...current, document: copy('knowledge.testOutdated') } : current) }}
          onChange={(settings) => update({ ...draft, document: { ...draft.document, ...settings } })} />}
        <div className="knowledge-service-actions">
          {draft.document.processor !== 'none' && <button className="secondary-button" type="button" data-testid="document-test" disabled={invalidSettings.document || !draft.document.baseUrl || (['vision', 'mistral-ocr'].includes(draft.document.processor) && !draft.document.model?.trim())} onClick={() => void test('document')}>{copy(draft.document.processor === 'vision' ? 'vision.test' : isPageProcessor(draft.document.processor) ? 'request.testOcr' : 'knowledge.testDocument')}</button>}
          {saveButton('document')}
        </div>
        {feedback('document')}</details>
        <p className="field-hint">{copy('knowledge.endpointHint')} {copy('knowledge.testHint')}</p>
      </fieldset>
    </div>}
    {loadError && <p role="status" className="field-hint" data-testid="knowledge-status">{loadError}</p>}
  </section>
}
