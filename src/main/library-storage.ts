import { randomUUID } from 'node:crypto'
import { lstat, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { LibraryBackupPreview, LibraryPreferences, RestoredPreferences } from '@shared/contracts'
import { parseLibraryPreferences } from '@shared/library-preferences'
import { copy } from '@shared/copy'
import type { AppDatabase } from './database'
import { AppError } from './errors'
import { atomicJson, busyBackup, createBackupPackage, inspectBackup, invalidBackup,
  regularDirectory, stageBackup, syncDirectory, validateStoredDatabase } from './library-backup-files'

const storeId = z.string().regex(/^restored-[a-f0-9-]{36}$/u).nullable()
const preferences = z.record(z.string(), z.string())
const stateSchema = z.object({ version: z.literal(1), current: storeId,
  pending: z.object({ token: z.uuid(), values: preferences }).optional(),
  previous: z.object({ current: storeId, preferences }).optional() }).strict()
type StorageState = z.infer<typeof stateSchema>

/** A single atomically replaced pointer activates a fully copied library. Old stores remain intact. */
export class LibraryStorage {
  private state: StorageState = { version: 1, current: null }
  private preview?: { token: string; directory: string; fingerprint: string }
  locked = false
  rolledBack = false
  private constructor(readonly userData: string) {}

  static async open(userData: string): Promise<LibraryStorage> {
    const storage = new LibraryStorage(userData)
    const path = join(userData, 'library-state.json')
    try {
      const stat = await lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8_000_000) throw invalidBackup()
      storage.state = stateSchema.parse(JSON.parse(await readFile(path, 'utf8')))
      if (storage.state.pending) storage.state.pending.values = parseLibraryPreferences(storage.state.pending.values)
      if (storage.state.previous) storage.state.previous.preferences = parseLibraryPreferences(storage.state.previous.preferences)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return storage
      throw invalidBackup()
    }
    if (storage.state.current) {
      try {
        await regularDirectory(storage.directory)
        // A restore has not been used yet: validate before allowing application migrations/writes.
        if (storage.state.pending && storage.state.previous) await inspectBackup(storage.directory)
        else {
          const database = await lstat(join(storage.directory, 'reader.sqlite3'))
          if (!database.isFile() || database.isSymbolicLink()) throw invalidBackup()
        }
      } catch (error) {
        if (!storage.state.pending || !storage.state.previous) throw error
        const previous = storage.state.previous
        const previousDirectory = previous.current ? join(userData, previous.current) : userData
        await regularDirectory(previousDirectory)
        await validateStoredDatabase(join(previousDirectory, 'reader.sqlite3'))
        await storage.commit({ version: 1, current: previous.current,
          pending: { token: randomUUID(), values: previous.preferences } })
        storage.rolledBack = true
      }
    }
    return storage
  }

  get directory(): string { return this.state.current ? join(this.userData, this.state.current) : this.userData }
  get pendingPreferences(): RestoredPreferences | null { return this.state.pending ?? null }

  async acknowledgePreferences(token: string): Promise<void> {
    if (!this.state.pending || token !== this.state.pending.token) throw invalidBackup()
    const next = { ...this.state }
    delete next.pending
    await this.commit(next)
  }

  private async commit(next: StorageState): Promise<void> {
    const path = join(this.userData, 'library-state.json')
    try { await atomicJson(path, next) }
    catch (error) {
      // A directory flush can fail after rename. Never delete a store referenced by
      // an already-published pointer; an interrupted rename leaves either whole state.
      let published = false
      try { published = JSON.stringify(JSON.parse(await readFile(path, 'utf8'))) === JSON.stringify(next) } catch { /* Keep the original error. */ }
      if (!published) throw error
    }
    this.state = next
  }

  async exclusive<T>(isBusy: () => boolean, operation: () => Promise<T>): Promise<T> {
    if (this.locked || isBusy()) throw busyBackup()
    this.locked = true
    try { return await operation() } finally { this.locked = false }
  }

  async create(database: AppDatabase, parent: string, values: LibraryPreferences, version: string) {
    try { return await createBackupPackage(database, this.directory, parent, values, version, this.userData) }
    catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('BACKUP_WRITE', copy('backup.writeFailed'))
    }
  }

  async inspect(directory: string): Promise<LibraryBackupPreview> {
    this.preview = undefined
    const { manifest, fingerprint } = await inspectBackup(directory)
    const token = randomUUID()
    this.preview = { directory, fingerprint, token }
    return { token, summary: manifest.summary }
  }

  async restore(token: string, previousPreferences: LibraryPreferences): Promise<void> {
    const preview = this.preview
    if (!preview || preview.token !== token) throw invalidBackup()
    const previous = { current: this.state.current, preferences: parseLibraryPreferences(previousPreferences) }
    const current = `restored-${randomUUID()}`
    const destination = join(this.userData, current)
    let committed = false
    try {
      const values = await stageBackup(preview.directory, destination, preview.fingerprint)
      await syncDirectory(this.userData)
      await this.commit({ version: 1, current, pending: { token: randomUUID(), values }, previous })
      committed = true
      this.preview = undefined
    } catch (error) {
      // The active pointer never changes until every restored file has been validated.
      if (!committed) await rm(destination, { recursive: true, force: true })
      if (error instanceof AppError) throw error
      throw new AppError('BACKUP_WRITE', copy('backup.writeFailed'))
    }
  }
}
