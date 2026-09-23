import { useState } from 'react'
import type { RequestSettingsInput } from '@shared/contracts'
import { customHeadersSchema, extraBodySchema } from '@shared/request-settings'
import { copy } from '@shared/copy'

export function RequestSettingsEditor({ id, value, savedHeaders, onChange, onInvalidChange }: {
  id: string; value: RequestSettingsInput; savedHeaders?: boolean
  onChange: (value: RequestSettingsInput) => void; onInvalidChange: (invalid: boolean) => void
}) {
  const [headers, setHeaders] = useState(value.customHeaders ? JSON.stringify(value.customHeaders, null, 2) : '')
  const [body, setBody] = useState(value.extraBody ? JSON.stringify(value.extraBody, null, 2) : '')
  const [errors, setErrors] = useState({ headers: false, body: false })
  const edit = (field: 'headers' | 'body', raw: string): void => {
    if (field === 'headers') setHeaders(raw); else setBody(raw)
    let invalid = false
    try {
      if (field === 'headers') onChange({ ...value, customHeaders: raw.trim() ? customHeadersSchema.parse(JSON.parse(raw)) : undefined })
      else onChange({ ...value, extraBody: raw.trim() ? extraBodySchema.parse(JSON.parse(raw)) : undefined })
    } catch { invalid = true }
    const next = { ...errors, [field]: invalid }
    setErrors(next); onInvalidChange(next.headers || next.body)
  }
  return <details className="request-settings" data-testid={`${id}-advanced`}>
    <summary>{copy('request.advanced')}</summary>
    <label className="field-label" htmlFor={`${id}-headers`}>{copy('request.headers')}</label>
    <textarea id={`${id}-headers`} data-testid={`${id}-headers`} rows={4} spellCheck={false} autoComplete="off" value={headers}
      aria-invalid={errors.headers} disabled={value.customHeaders === null}
      placeholder={savedHeaders ? copy('request.headersSaved') : copy('request.headersExample', { example: JSON.stringify({ 'X-Project': 'reader' }) })}
      onChange={(event) => edit('headers', event.target.value)} />
    {errors.headers && <p role="alert" className="field-hint is-error-text">{copy('request.headersInvalid')}</p>}
    <p className="field-hint">{copy('request.headersHint')}</p>
    <label className="knowledge-checkbox"><input data-testid={`${id}-clear-headers`} type="checkbox" checked={value.customHeaders === null}
      onChange={(event) => {
        setHeaders(''); setErrors({ ...errors, headers: false }); onInvalidChange(errors.body)
        onChange({ ...value, customHeaders: event.target.checked ? null : undefined })
      }} />{copy('request.clearHeaders')}</label>
    <label className="field-label" htmlFor={`${id}-body`}>{copy('request.body')}</label>
    <textarea id={`${id}-body`} data-testid={`${id}-body`} rows={4} spellCheck={false} value={body} aria-invalid={errors.body}
      placeholder={copy('request.bodyExample', { example: JSON.stringify({ max_tokens: 4096 }) })} onChange={(event) => edit('body', event.target.value)} />
    {errors.body && <p role="alert" className="field-hint is-error-text">{copy('request.bodyInvalid')}</p>}
    <p className="field-hint">{copy('request.bodyHint')}</p>
    <label className="field-label" htmlFor={`${id}-timeout`}>{copy('request.timeout')}</label>
    <input id={`${id}-timeout`} data-testid={`${id}-timeout`} type="number" min={1} max={600} step={1}
      placeholder={copy('request.timeoutDefault')} value={value.timeoutMs === undefined ? '' : value.timeoutMs / 1_000}
      onChange={(event) => onChange({ ...value, timeoutMs: event.target.value ? Number(event.target.value) * 1_000 : undefined })} />
  </details>
}
