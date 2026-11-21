import { useMemo, useRef, useState } from 'react'
import { HIGHLIGHT_EXPORT_MAX_COUNT, type HighlightRecord } from '@shared/contracts'
import { copy } from '@shared/copy'
import { highlightTagKey } from '@shared/highlight-tags'
import { readableError } from './readable-error'

export function useHighlightOrganizer(bookId: string | undefined, records: readonly HighlightRecord[]) {
  const [query, setQuery] = useState('')
  const [tagKey, setTagKey] = useState('')
  const [selection, setSelection] = useState<Set<string> | null>(null)
  const [previousRecords, setPreviousRecords] = useState(records)
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null)
  const [exporting, setExporting] = useState(false)
  const pending = useRef(false)

  const tags = useMemo(() => {
    const options = new Map<string, string>()
    for (const record of records) {
      for (const tag of record.tags) {
        const key = highlightTagKey(tag)
        if (key && !options.has(key)) options.set(key, tag)
      }
    }
    return options
  }, [records])
  const activeTag = tags.has(tagKey) ? tagKey : ''
  const needle = highlightTagKey(query)
  const visible = useMemo(() => {
    if (!needle && !activeTag) return records
    return records.filter((record) =>
      (!activeTag || record.tags.some((tag) => highlightTagKey(tag) === activeTag)) &&
      (!needle || [record.quote, record.chapterTitle, record.note, ...record.tags]
        .some((value) => highlightTagKey(value).includes(needle)))
    )
  }, [records, activeTag, needle])
  const selectedIds = visible.filter((record) => selection?.has(record.id)).map((record) => record.id)

  // A record hidden by an edit or removed from the library must stay deselected.
  if (previousRecords !== records) {
    setPreviousRecords(records)
    if (tagKey !== activeTag) {
      setTagKey(activeTag)
      if (selection) setSelection(new Set())
      setFeedback(null)
    } else if (selection && selectedIds.length !== selection.size) {
      setSelection(new Set(selectedIds))
      setFeedback(null)
    }
  }

  const clearSelection = (): void => {
    setSelection((current) => current === null ? null : new Set())
    setFeedback(null)
  }
  const changeQuery = (value: string): void => { setQuery(value); clearSelection() }
  const changeTag = (value: string): void => { setTagKey(value); clearSelection() }
  const toggleMode = (): void => {
    setSelection((current) => current === null ? new Set() : null)
    setFeedback(null)
  }
  const toggleOne = (id: string): void => {
    setSelection((current) => {
      if (current === null) return null
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setFeedback(null)
  }
  const selectAll = (checked: boolean): void => {
    setSelection(new Set(checked ? visible.map((record) => record.id) : []))
    setFeedback(null)
  }
  const exportSelected = async (): Promise<void> => {
    if (!bookId || !selectedIds.length || pending.current) return
    if (selectedIds.length > HIGHLIGHT_EXPORT_MAX_COUNT) {
      setFeedback({ error: true, message: copy('highlights.exportTooLarge') })
      return
    }
    pending.current = true
    setExporting(true)
    setFeedback(null)
    try {
      const result = await window.readerApi.exportHighlights({ bookId, highlightIds: selectedIds })
      if (!result.canceled) setFeedback({ error: false, message: copy('highlights.exported', { count: selectedIds.length, fileName: result.fileName }) })
    } catch (error) {
      setFeedback({ error: true, message: readableError(error, copy('highlights.exportFailed')) })
    } finally {
      pending.current = false
      setExporting(false)
    }
  }

  return {
    query, activeTag, tags, visible, filtering: Boolean(needle || activeTag), selection,
    selectedCount: selectedIds.length, feedback, exporting,
    changeQuery, changeTag, toggleMode, toggleOne, selectAll, exportSelected
  }
}
