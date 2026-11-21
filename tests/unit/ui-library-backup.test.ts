// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { applyRestoredPreferences, readLibraryPreferences } from '../../src/renderer/src/library-backup'

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

it('restores only allowlisted preferences before acknowledging and preserves unrelated storage', async () => {
  localStorage.setItem('llm-reader.theme', 'light')
  localStorage.setItem('llm-reader.text-reading-mode.old-book', 'plain')
  localStorage.setItem('unrelated-secret', 'never export')
  expect(readLibraryPreferences()).not.toHaveProperty('unrelated-secret')
  // Corrupt old display state must not prevent valid restored preferences from replacing it.
  localStorage.setItem('llm-reader.workspace', 'broken old JSON')
  const acknowledge = vi.fn(async () => {
    expect(localStorage.getItem('llm-reader.theme')).toBe('dark')
    expect(localStorage.getItem('llm-reader.text-reading-mode.old-book')).toBeNull()
  })
  Object.defineProperty(window, 'readerApi', { configurable: true, value: {
    getRestoredPreferences: async () => ({ token: 'token', values: { 'llm-reader.theme': 'dark' } }),
    acknowledgeRestoredPreferences: acknowledge
  } })
  await applyRestoredPreferences()
  expect(acknowledge).toHaveBeenCalledWith('token')
  expect(localStorage.getItem('unrelated-secret')).toBe('never export')
})

it('keeps prior preferences when restore acknowledgement fails so startup can retry', async () => {
  localStorage.setItem('llm-reader.theme', 'light')
  Object.defineProperty(window, 'readerApi', { configurable: true, value: {
    getRestoredPreferences: async () => ({ token: 'token', values: { 'llm-reader.theme': 'dark' } }),
    acknowledgeRestoredPreferences: async () => { throw new Error('disk full') }
  } })
  await expect(applyRestoredPreferences()).rejects.toThrow('disk full')
  expect(localStorage.getItem('llm-reader.theme')).toBe('light')
})
