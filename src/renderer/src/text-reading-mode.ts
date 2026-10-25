import type { TextReadingMode } from '@shared/contracts'

const key = (bookId: string) => `llm-reader.text-reading-mode.${bookId}`
export const isTextReadingMode = (value: unknown): value is TextReadingMode => value === 'auto' || value === 'plain' || value === 'markdown'

export function readTextReadingMode(bookId: string): TextReadingMode {
  try {
    const value = window.localStorage.getItem(key(bookId))
    return isTextReadingMode(value) ? value : 'auto'
  } catch { return 'auto' }
}

export function saveTextReadingMode(bookId: string, mode: TextReadingMode): boolean {
  if (!isTextReadingMode(mode)) return false
  try { window.localStorage.setItem(key(bookId), mode); return true }
  catch { return false }
}
