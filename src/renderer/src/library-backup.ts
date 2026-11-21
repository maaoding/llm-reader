import type { LibraryPreferences } from '@shared/contracts'
import { isLibraryPreferenceKey, parseLibraryPreferences } from '@shared/library-preferences'

function rawLibraryPreferences(): LibraryPreferences {
  const values: LibraryPreferences = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!
    if (isLibraryPreferenceKey(key)) values[key] = localStorage.getItem(key)!
  }
  return values
}

export function readLibraryPreferences(): LibraryPreferences { return parseLibraryPreferences(rawLibraryPreferences()) }

function replaceLibraryPreferences(values: LibraryPreferences): void {
  const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!)
  for (const key of keys) if (isLibraryPreferenceKey(key)) localStorage.removeItem(key)
  for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value)
}

/** Runs before mounting React, so preference hooks never overwrite the restored values. */
export async function applyRestoredPreferences(): Promise<void> {
  const pending = await window.readerApi.getRestoredPreferences()
  if (!pending) return
  const values = parseLibraryPreferences(pending.values)
  const previous = rawLibraryPreferences()
  try {
    replaceLibraryPreferences(values)
    await window.readerApi.acknowledgeRestoredPreferences(pending.token)
  } catch (error) {
    replaceLibraryPreferences(previous)
    throw error
  }
}
