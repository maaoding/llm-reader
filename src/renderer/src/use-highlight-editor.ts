import { useCallback, useRef, useState } from 'react'
import type { HighlightRecord } from '@shared/contracts'
import { copy } from '@shared/copy'
import { normalizeHighlightTags, validHighlightNote, validHighlightTags } from '@shared/highlight-tags'
import { readableError } from './readable-error'

interface HighlightDraft {
  original: HighlightRecord
  note: string
  tagsText: string
}

function isDirty(draft: HighlightDraft): boolean {
  return draft.note !== draft.original.note || draft.tagsText !== draft.original.tags.join('，')
}

export function useHighlightEditor(onSaved: (record: HighlightRecord) => void) {
  const [draft, setDraft] = useState<HighlightDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const current = useRef<HighlightDraft | null>(null)
  const pending = useRef(false)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const showDraft = (next: HighlightDraft | null): void => {
    current.current = next
    setDraft(next)
    setError('')
  }
  const open = (record: HighlightRecord, trigger: HTMLElement): void => {
    if (current.current) return
    returnFocusRef.current = trigger
    showDraft({ original: record, note: record.note, tagsText: record.tags.join('，') })
  }
  const change = (field: 'note' | 'tagsText', value: string): void => {
    if (!current.current || pending.current) return
    showDraft({ ...current.current, [field]: value })
  }
  const close = (): void => {
    const target = current.current
    if (!target || pending.current) return
    if (isDirty(target) && !window.confirm(copy('settings.discardChanges'))) return
    showDraft(null)
  }
  const save = async (): Promise<void> => {
    const target = current.current
    if (!target || !isDirty(target) || pending.current) return
    if (!validHighlightNote(target.note)) {
      setError(copy('highlights.noteInvalid'))
      return
    }
    const tags = normalizeHighlightTags(target.tagsText.split(/[,，]/u))
    if (!validHighlightTags(tags)) {
      setError(copy('highlights.tagsInvalid'))
      return
    }

    pending.current = true
    setSaving(true)
    setError('')
    const { bookId, id: highlightId } = target.original
    let updated: HighlightRecord
    try {
      updated = await window.readerApi.updateHighlight({ bookId, highlightId, note: target.note, tags })
    } catch (cause) {
      setError(readableError(cause, copy('highlights.noteSaveFailed')))
      return
    } finally {
      pending.current = false
      setSaving(false)
    }
    showDraft(null)
    onSaved(updated)
  }

  const isOpen = useCallback(() => current.current !== null, [])
  const canLeaveWorkspace = useCallback(() => {
    if (pending.current) return false
    const target = current.current
    if (!target || !isDirty(target)) return true
    setError(copy('highlights.draftPending'))
    return false
  }, [])

  return { draft, dirty: draft !== null && isDirty(draft), saving, error, returnFocusRef, isOpen, open, change, close, save, canLeaveWorkspace }
}

export type HighlightEditor = ReturnType<typeof useHighlightEditor>
