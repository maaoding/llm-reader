import { Select } from './Select'
import { ComposerToolButton } from './ComposerToolButton'
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Bot } from 'lucide-react'
import type { PersonaSelection, PersonaSettings } from '@shared/contracts'
import { copy } from '@shared/copy'
import { MAX_PERSONAS, MAX_PERSONA_NAME_LENGTH, MAX_PERSONA_PROMPT_LENGTH, personaFromPreset } from './assistant-personas'

interface PersonaSettingsPanelProps {
  settings: PersonaSettings
  onChange: (next: PersonaSettings) => boolean
  onError: () => void
  onSaved: () => void
  onDirtyChange: (dirty: boolean) => void
}

export function PersonaSettingsPanel({ settings, onChange, onError, onSaved, onDirtyChange }: PersonaSettingsPanelProps): ReactNode {
  const [selectedId, setSelectedId] = useState<string | null>(settings.defaultId ?? settings.presets[0]?.id ?? null)
  const selected = settings.presets.find((item) => item.id === selectedId)
  const [name, setName] = useState(selected?.name ?? '')
  const [prompt, setPrompt] = useState(selected?.prompt ?? '')
  const dirty = name !== (selected?.name ?? '') || prompt !== (selected?.prompt ?? '')
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  const discard = (): boolean => !dirty || window.confirm(copy('persona.discardChanges'))
  const select = (id: string | null): void => {
    if (!discard()) return
    const item = settings.presets.find((preset) => preset.id === id)
    setSelectedId(item?.id ?? null)
    setName(item?.name ?? '')
    setPrompt(item?.prompt ?? '')
  }
  const save = (event: FormEvent): void => {
    event.preventDefault()
    const cleanName = name.trim(), cleanPrompt = prompt.trim()
    if (!cleanName || !cleanPrompt || cleanName.length > MAX_PERSONA_NAME_LENGTH || cleanPrompt.length > MAX_PERSONA_PROMPT_LENGTH) return
    if (!selected && settings.presets.length >= MAX_PERSONAS) return
    const id = selected?.id ?? crypto.randomUUID()
    const preset = { id, name: cleanName, prompt: cleanPrompt }
    const next = { ...settings, presets: selected ? settings.presets.map((item) => item.id === id ? preset : item) : [...settings.presets, preset] }
    if (!onChange(next)) { onError(); return }
    setSelectedId(id)
    setName(cleanName); setPrompt(cleanPrompt)
    onSaved()
  }
  const remove = (): void => {
    if (!selected || !window.confirm(copy('persona.confirmDelete'))) return
    const next = { presets: settings.presets.filter((item) => item.id !== selected.id), defaultId: settings.defaultId === selected.id ? null : settings.defaultId }
    if (!onChange(next)) { onError(); return }
    const replacement = next.presets[0]
    setSelectedId(replacement?.id ?? null)
    setName(replacement?.name ?? ''); setPrompt(replacement?.prompt ?? '')
  }

  return <div className="persona-settings" data-testid="persona-settings">
    <p className="settings-section-hint">{copy('persona.hint')}</p>
    <div className="persona-default-group">
    <label className="field-label" htmlFor="persona-default">{copy('persona.default')}</label>
    <Select id="persona-default" data-testid="persona-default" value={settings.defaultId ?? ''} onChange={(event) => {
      if (!onChange({ ...settings, defaultId: event.target.value || null })) onError()
    }}>
      <option value="">{copy('persona.none')}</option>
      {settings.presets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </Select>
    <p className="field-hint">{copy('persona.defaultHint')}</p>
    </div>
    <div className="persona-library">
    <h4>{copy('persona.manage')}</h4>
    <p className="field-hint">{copy('persona.manageHint')}</p>
    {dirty && <p className="field-hint" data-testid="persona-dirty-hint">{copy('settings.unsavedHint')}</p>}
    <label className="field-label" htmlFor="persona-preset">{copy('persona.preset')}</label>
    <Select id="persona-preset" data-testid="persona-preset" value={selectedId ?? ''} onChange={(event) => select(event.target.value || null)}>
      {!selectedId && <option value="">{copy('persona.new')}</option>}
      {settings.presets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </Select>
    <div className="persona-actions">
      <button type="button" className="secondary-button" data-testid="persona-new" disabled={settings.presets.length >= MAX_PERSONAS} onClick={() => select(null)}>{copy('persona.new')}</button>
      <button type="button" className="secondary-button" data-testid="persona-duplicate" disabled={!selected || settings.presets.length >= MAX_PERSONAS} onClick={() => {
        if (!discard() || !selected) return
        setSelectedId(null); setName(copy('persona.copyName', { name: selected.name }).slice(0, MAX_PERSONA_NAME_LENGTH)); setPrompt(selected.prompt)
      }}>{copy('persona.duplicate')}</button>
      <button type="button" className="text-button danger-text" data-testid="persona-delete" disabled={!selected} onClick={remove}>{copy('persona.delete')}</button>
    </div>
    {settings.presets.length >= MAX_PERSONAS && <p className="field-hint">{copy('persona.limit')}</p>}
    <form onSubmit={save} className="persona-form">
      <label className="field-label" htmlFor="persona-name">{copy('persona.name')}</label>
      <input id="persona-name" data-testid="persona-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={MAX_PERSONA_NAME_LENGTH} required />
      <label className="field-label" htmlFor="persona-prompt">{copy('persona.prompt')}</label>
      <textarea id="persona-prompt" data-testid="persona-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={MAX_PERSONA_PROMPT_LENGTH} rows={7} required />
      <p className="field-hint">{copy('persona.promptHint')}</p>
      <button type="submit" className="primary-button" data-testid="persona-save" disabled={!dirty && Boolean(selected) || !selected && settings.presets.length >= MAX_PERSONAS}>{copy('persona.save')}</button>
    </form>
    </div>
  </div>
}

interface PersonaSessionControlProps {
  persona: PersonaSelection | null
  settings: PersonaSettings
  onChange: (persona: PersonaSelection | null) => void
  onSaveAs: (persona: PersonaSelection) => void
}

export function PersonaSessionControl({ persona, settings, onChange, onSaveAs }: PersonaSessionControlProps): ReactNode {
  const [isOpen, setIsOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const selectRef = useRef<HTMLSelectElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const panelId = useId()
  const current = settings.presets.find((preset) => preset.id === persona?.presetId && preset.name === persona.name && preset.prompt === persona.prompt)
  const value = persona ? current?.id ?? 'custom' : ''
  const label = copy('persona.trigger', { name: persona?.name ?? copy('persona.builtIn') })
  const beginEdit = (): void => { setName(persona?.name ?? copy('persona.custom')); setPrompt(persona?.prompt ?? ''); setEditing(true) }
  const close = (): void => { panelRef.current?.hidePopover(); triggerRef.current?.focus() }

  useLayoutEffect(() => {
    const trigger = triggerRef.current, panel = panelRef.current
    if (!isOpen || !trigger || !panel) return
    // 原生浮层进入顶层，避免被完整对话页裁切；始终靠近入口并留在窗口内。
    const place = (): void => {
      const rect = (trigger.closest('.assistant-question-box') ?? trigger).getBoundingClientRect()
      panel.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 12))}px`
      panel.style.bottom = `${window.innerHeight - rect.top + 8}px`
      panel.style.maxHeight = `${Math.max(0, rect.top - 20)}px`
    }
    place()
    ;(editing ? nameRef.current : selectRef.current)?.focus({ preventScroll: true })
    const observer = new ResizeObserver(place)
    observer.observe(trigger)
    const composer = trigger.closest('.assistant-composer')
    if (composer) observer.observe(composer)
    window.addEventListener('resize', place)
    return () => { observer.disconnect(); window.removeEventListener('resize', place) }
  }, [isOpen, editing])

  return <div className="persona-session" data-testid="persona-session">
    <ComposerToolButton className="persona-session-trigger" data-testid="session-persona-trigger" ref={triggerRef}
      popoverTarget={panelId} aria-haspopup="dialog" aria-controls={panelId} aria-expanded={isOpen} label={label}>
      <Bot size={16} aria-hidden="true" />
    </ComposerToolButton>
    <div id={panelId} ref={panelRef} popover="auto" className="persona-session-popover" data-testid="session-persona-popover"
      role="dialog" aria-label={copy('persona.select')} onToggle={(event) => {
        const open = event.newState === 'open'
        setIsOpen(open)
        if (!open) setEditing(false)
      }}>
      <label className="field-label" htmlFor={`${panelId}-select`}>{copy('persona.select')}</label>
      <Select id={`${panelId}-select`} ref={selectRef} data-testid="session-persona" value={value} onChange={(event) => {
        if (event.target.value === 'custom') return
        const preset = settings.presets.find((item) => item.id === event.target.value)
        onChange(preset ? personaFromPreset(preset) : null)
        close()
      }}>
        <option value="">{copy('persona.none')}</option>
        {settings.presets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        {persona && !current && <option value="custom">{persona.name} · {copy('persona.custom')}</option>}
      </Select>
      <div className="persona-session-actions">
        <button type="button" className="text-button" data-testid="session-persona-edit" aria-expanded={editing} onClick={() => editing ? setEditing(false) : beginEdit()}>{copy('persona.edit')}</button>
        {persona && <button type="button" className="text-button" data-testid="session-persona-save-as" disabled={settings.presets.length >= MAX_PERSONAS} onClick={() => { onSaveAs(persona); close() }}>{copy('persona.saveAs')}</button>}
      </div>
      {editing && <form className="persona-session-editor" data-testid="session-persona-editor" onSubmit={(event) => {
        event.preventDefault()
        const cleanName = name.trim(), cleanPrompt = prompt.trim()
        if (!cleanName || !cleanPrompt) return
        onChange({ presetId: null, name: cleanName, prompt: cleanPrompt })
        close()
      }}>
        <label htmlFor={`${panelId}-name`}>{copy('persona.name')}</label>
        <input id={`${panelId}-name`} ref={nameRef} value={name} onChange={(event) => setName(event.target.value)} maxLength={MAX_PERSONA_NAME_LENGTH} required />
        <label htmlFor={`${panelId}-prompt`}>{copy('persona.prompt')}</label>
        <textarea id={`${panelId}-prompt`} value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={MAX_PERSONA_PROMPT_LENGTH} rows={3} required />
        <small>{copy('persona.sessionHint')}</small>
        <button type="submit" className="secondary-button" data-testid="session-persona-apply">{copy('persona.save')}</button>
      </form>}
    </div>
  </div>
}
