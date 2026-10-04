import { useState } from 'react'
import type { KnowledgeSettings, SaveKnowledgeSettingsInput, WebSearchProvider } from '@shared/contracts'
import { copy } from '@shared/copy'
import { parseSearchDomains, WEB_SEARCH_BASE_URLS } from '@shared/web-search-settings'
import { Select } from './Select'
import { RequestSettingsEditor } from './RequestSettingsEditor'

type SearchDraft = NonNullable<SaveKnowledgeSettingsInput['webSearch']>
export function WebSearchSettingsFields({ value, saved, onChange, onInvalidChange }: {
  value: SearchDraft; saved: KnowledgeSettings['webSearch']
  onChange: (value: SearchDraft) => void; onInvalidChange: (invalid: boolean) => void
}) {
  const [domains, setDomains] = useState({ includeDomains: (value.includeDomains ?? []).join('\n'), excludeDomains: (value.excludeDomains ?? []).join('\n') })
  const [invalid, setInvalid] = useState({ includeDomains: false, excludeDomains: false, headers: false })
  const provider = value.provider ?? 'tavily'
  const endpointMatches = saved.baseUrl === value.baseUrl && (saved.provider ?? 'tavily') === provider
  const report = (next: typeof invalid): void => { setInvalid(next); onInvalidChange(Object.values(next).some(Boolean)) }
  const changeEndpoint = (next: SearchDraft): void => {
    onChange({ ...next, apiKey: undefined, customHeaders: undefined, extraBody: undefined })
    report({ ...invalid, headers: false })
  }
  const editDomains = (field: 'includeDomains' | 'excludeDomains', text: string): void => {
    setDomains({ ...domains, [field]: text })
    const parsed = parseSearchDomains(text)
    if (parsed.success) onChange({ ...value, [field]: parsed.data })
    report({ ...invalid, [field]: !parsed.success })
  }
  return <>
    <p className="field-hint">{copy('webSearch.hint')}</p>
    <label className="field-label" htmlFor="webSearch-provider">{copy('webSearch.provider')}</label>
    <Select id="webSearch-provider" data-testid="webSearch-provider" value={provider}
      onChange={(event) => {
        const selected = event.target.value as WebSearchProvider
        changeEndpoint({ ...value, provider: selected, baseUrl: WEB_SEARCH_BASE_URLS[selected] })
      }}>
      <option value="tavily">Tavily</option><option value="brave">Brave Search</option><option value="exa">Exa</option>
    </Select>
    <label className="field-label" htmlFor="webSearch-url">{copy('knowledge.baseUrl')}</label>
    <input id="webSearch-url" type="url" pattern="https?://[^?#]+" data-testid="webSearch-url" value={value.baseUrl} spellCheck={false} required
      onChange={(event) => changeEndpoint({ ...value, baseUrl: event.target.value })} />
    <p className="field-hint">{copy('webSearch.endpointHint')}</p>
    <label className="field-label" htmlFor="webSearch-key">{copy('knowledge.apiKey')}</label>
    <input id="webSearch-key" data-testid="webSearch-key" type="password" autoComplete="off" value={value.apiKey ?? ''}
      placeholder={copy(saved.hasApiKey && endpointMatches ? 'knowledge.keySaved' : 'knowledge.keyEmpty')}
      onChange={(event) => onChange({ ...value, apiKey: event.target.value || undefined })} />
    {(saved.hasApiKey && endpointMatches || value.apiKey === null) && <button className="text-button" type="button" data-testid="webSearch-clear-key"
      onClick={() => onChange({ ...value, apiKey: value.apiKey === null ? undefined : null })}>
      {copy(value.apiKey === null ? 'knowledge.undoClear' : 'knowledge.clearKey')}</button>}
    {value.apiKey === null && <p className="field-hint">{copy('knowledge.clearPending')}</p>}
    <label className="field-label" htmlFor="webSearch-timeout">{copy('request.timeout')}</label>
    <input id="webSearch-timeout" data-testid="webSearch-timeout" type="number" min={1} max={600} step={1} placeholder="10"
      value={value.timeoutMs === undefined ? '' : value.timeoutMs / 1_000}
      onChange={(event) => onChange({ ...value, timeoutMs: event.target.value ? Number(event.target.value) * 1_000 : undefined })} />
    <label className="field-label" htmlFor="webSearch-maxResults">{copy('webSearch.maxResults')}</label>
    <input id="webSearch-maxResults" data-testid="webSearch-maxResults" type="number" min={1} max={5} step={1} placeholder="5"
      value={value.maxResults ?? ''}
      onChange={(event) => onChange({ ...value, maxResults: event.target.value ? Number(event.target.value) : undefined })} />
    {(['includeDomains', 'excludeDomains'] as const).map((field) => <div key={field}>
      <label className="field-label" htmlFor={`webSearch-${field}`}>{copy(field === 'includeDomains' ? 'webSearch.includeDomains' : 'webSearch.excludeDomains')}</label>
      <textarea className="web-search-domains" id={`webSearch-${field}`} data-testid={`webSearch-${field}`} rows={2} spellCheck={false}
        value={domains[field]} aria-invalid={invalid[field]} aria-describedby={`webSearch-${field}-hint`}
        onChange={(event) => editDomains(field, event.target.value)} />
      <p id={`webSearch-${field}-hint`} className={`field-hint${invalid[field] ? ' is-error-text' : ''}`} role={invalid[field] ? 'alert' : undefined}>
        {copy(invalid[field] ? 'webSearch.domainsInvalid' : 'webSearch.domainsHint')}</p>
    </div>)}
    <RequestSettingsEditor key={`${provider}-${value.baseUrl}`} id="webSearch" value={value} headersOnly
      savedHeaders={saved.hasCustomHeaders && endpointMatches}
      onInvalidChange={(headers) => report({ ...invalid, headers })}
      onChange={(settings) => onChange({ ...value, ...settings })} />
  </>
}
