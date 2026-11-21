import { useState } from 'react'
import type { LibraryBackupPreview } from '@shared/contracts'
import { copy } from '@shared/copy'
import { readLibraryPreferences } from './library-backup'
import { readableError } from './readable-error'

export function LibraryBackupSettings({ run, disabled }: {
  run: (operation: () => Promise<void>) => Promise<void>; disabled: boolean
}) {
  const [preview, setPreview] = useState<LibraryBackupPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const perform = async (operation: () => Promise<void>): Promise<void> => {
    if (busy || disabled) return
    setBusy(true); setError(''); setMessage('')
    try { await run(operation) }
    catch (failure) { setError(readableError(failure, copy('backup.failed'))) }
    finally { setBusy(false) }
  }
  return <section className="settings-section" id="settings-panel-backup" role="tabpanel" aria-labelledby="settings-tab-backup">
    <h3>{copy('backup.title')}</h3>
    <p className="settings-section-hint">{copy('backup.hint')}</p>
    <p className="field-hint">{copy('backup.savedOnly')}</p>
    {disabled && <p role="status" className="field-hint">{copy('backup.saveSettings')}</p>}
    <div className="knowledge-service-actions">
      <button className="primary-button" type="button" data-testid="backup-create" disabled={busy || disabled} onClick={() => void perform(async () => {
        const result = await window.readerApi.createLibraryBackup(readLibraryPreferences())
        if (result) setMessage(copy('backup.created', { name: result.name }))
      })}>{copy('backup.create')}</button>
      <button className="secondary-button" type="button" data-testid="backup-select" disabled={busy || disabled} onClick={() => {
        setPreview(null)
        void perform(async () => setPreview(await window.readerApi.previewLibraryBackup()))
      }}>{copy('backup.choose')}</button>
    </div>
    {preview && <div className="settings-section" data-testid="backup-preview">
      <h4>{copy('backup.preview')}</h4>
      <p>{copy('backup.summary', { date: new Date(preview.summary.createdAt).toLocaleString(), books: preview.summary.books,
        highlights: preview.summary.highlights, insights: preview.summary.insights, sessions: preview.summary.sessions, workbenches: preview.summary.workbenches })}</p>
      <p className="field-hint">{copy('backup.restoreHint')}</p>
      <button className="primary-button" type="button" data-testid="backup-restore" disabled={busy || disabled} onClick={() => {
        if (!window.confirm(copy('backup.confirmRestore'))) return
        void perform(async () => {
          await window.readerApi.restoreLibraryBackup({ token: preview.token, preferences: readLibraryPreferences() })
          setMessage(copy('backup.restarting'))
        })
      }}>{copy('backup.restore')}</button>
    </div>}
    {message && <p role="status" data-testid="backup-success">{message}</p>}
    {error && <p role="alert" data-testid="backup-error">{error}</p>}
  </section>
}
