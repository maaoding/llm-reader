import type { AssistantPersona, PersonaSelection, PersonaSettings } from '@shared/contracts'

export const ASSISTANT_PERSONAS_STORAGE_KEY = 'llm-reader.assistant-personas'
export const MAX_PERSONAS = 20
export const MAX_PERSONA_NAME_LENGTH = 60
export const MAX_PERSONA_PROMPT_LENGTH = 3_000

export function emptyPersonaSettings(): PersonaSettings {
  return { presets: [], defaultId: null }
}

export function personaFromPreset(preset: AssistantPersona): PersonaSelection {
  return { presetId: preset.id, name: preset.name, prompt: preset.prompt }
}

export function defaultPersona(settings: PersonaSettings): PersonaSelection | null {
  const preset = settings.presets.find((item) => item.id === settings.defaultId)
  return preset ? personaFromPreset(preset) : null
}

export function normalizePersonaSettings(value: unknown): PersonaSettings {
  if (!value || typeof value !== 'object') return emptyPersonaSettings()
  const data = value as Record<string, unknown>
  const presets: AssistantPersona[] = []
  if (Array.isArray(data.presets)) {
    for (const item of data.presets.slice(0, MAX_PERSONAS)) {
      if (!item || typeof item !== 'object') continue
      const preset = item as Record<string, unknown>
      if (typeof preset.id !== 'string' || !/^[\w-]{1,128}$/u.test(preset.id) || presets.some((other) => other.id === preset.id)) continue
      if (typeof preset.name !== 'string' || typeof preset.prompt !== 'string') continue
      const name = preset.name.trim(), prompt = preset.prompt.trim()
      if (!name || !prompt || name.length > MAX_PERSONA_NAME_LENGTH || prompt.length > MAX_PERSONA_PROMPT_LENGTH) continue
      presets.push({ id: preset.id, name, prompt })
    }
  }
  return { presets, defaultId: presets.some((item) => item.id === data.defaultId) ? data.defaultId as string : null }
}

export function readPersonaSettings(): PersonaSettings {
  if (typeof window === 'undefined') return emptyPersonaSettings()
  try { return normalizePersonaSettings(JSON.parse(window.localStorage.getItem(ASSISTANT_PERSONAS_STORAGE_KEY) ?? 'null') as unknown) }
  catch { return emptyPersonaSettings() }
}

export function persistPersonaSettings(settings: PersonaSettings): boolean {
  if (typeof window === 'undefined') return false
  try { window.localStorage.setItem(ASSISTANT_PERSONAS_STORAGE_KEY, JSON.stringify(settings)); return true }
  catch { return false }
}
