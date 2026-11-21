import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, open, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { AppDatabase } from '../src/main/database'
import { LibraryStorage } from '../src/main/library-storage'

const MiB = 1024 ** 2
const profiles = {
  quick: { books: 4, bytesPerBook: 8 * 1024, draftBytes: 1024 },
  'many-files': { books: 1024, bytesPerBook: 256 * 1024, draftBytes: 16 * 1024 },
  'large-files': { books: 16, bytesPerBook: 32 * MiB, draftBytes: 64 * 1024 }
} as const
export type BackupStressProfile = keyof typeof profiles
interface Measurement { phase: string; elapsedMs: number; rssAtStart: number; sampledPeakRss: number }
const preferences = { 'llm-reader.theme': 'dark', 'llm-reader.interface-scale': '125' }
const draft = (index: number, bytes: number) => `Synthetic draft ${index}: `.padEnd(bytes, 'D')

async function directoryBytes(directory: string): Promise<number> {
  let bytes = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    bytes += entry.isDirectory() ? await directoryBytes(path) : (await stat(path)).size
  }
  return bytes
}

async function measure<T>(measurements: Measurement[], phase: string, operation: () => Promise<T>): Promise<T> {
  const rssAtStart = process.memoryUsage().rss
  let sampledPeakRss = rssAtStart
  const sample = () => { sampledPeakRss = Math.max(sampledPeakRss, process.memoryUsage().rss) }
  const interval = setInterval(sample, 20)
  const started = performance.now()
  try { return await operation() }
  finally {
    sample(); clearInterval(interval)
    measurements.push({ phase, elapsedMs: Math.round((performance.now() - started) * 10) / 10, rssAtStart, sampledPeakRss })
  }
}

async function seed(root: string, db: AppDatabase, profile: typeof profiles[BackupStressProfile]) {
  await mkdir(join(root, 'library'))
  const ids: string[] = []
  // Build bounded chunks directly in a disposable library: import parsing and
  // rendering are deliberately excluded from this storage benchmark.
  for (let index = 0; index < profile.books; index++) {
    const id = randomUUID(), temporary = join(root, 'library', `.seed-${id}`)
    const chunk = Buffer.alloc(Math.min(64 * 1024, profile.bytesPerBook), 0x20)
    chunk.write(`Chapter 1\nSynthetic backup stress fixture v1, book ${index}.\n`)
    const hash = createHash('sha256'), file = await open(temporary, 'wx', 0o600)
    try {
      for (let remaining = profile.bytesPerBook; remaining > 0; remaining -= chunk.length) {
        const part = chunk.subarray(0, Math.min(remaining, chunk.length))
        await file.writeFile(part); hash.update(part)
      }
    } finally { await file.close() }
    const sha256 = hash.digest('hex'), storedName = `${sha256}.txt`
    await rename(temporary, join(root, 'library', storedName))
    db.insertBook({ id, sha256, storedName, title: `Synthetic book ${index}`, author: null,
      format: 'txt', sourceFormat: 'txt', originalName: `book-${index}.txt`,
      importedAt: '2026-11-04T00:00:00Z', lastOpenedAt: null, lastLocator: 'txt:20', progress: 0.25 })
    db.upsertBookSession({ bookId: id, conversationId: randomUUID(), scope: 'book', selection: null,
      draft: draft(index, profile.draftBytes), turns: [], updatedAt: '2026-11-04T00:00:00Z' })
    ids.push(id)
  }
  db.connection.exec(`INSERT INTO provider_profiles(id, name, base_url, model, is_active, created_at, updated_at)
    VALUES ('stress-profile', 'Synthetic', 'https://test.invalid/?token=synthetic-secret', 'mock', 1, 'now', 'now')`)
  return ids
}

export async function runBackupStress(profileName: BackupStressProfile) {
  assert.ok(Object.hasOwn(profiles, profileName), 'Unknown backup stress profile')
  const profile = profiles[profileName], available = await statfs(tmpdir())
  // Original + export + restored store, duplicated session rows and headroom.
  // This is a harness guard, not a prediction of an arbitrary user's library.
  const required = profile.books * (profile.bytesPerBook + profile.draftBytes * 3) * 3 + 512 * MiB
  assert.ok(available.bavail * available.bsize >= required, `Insufficient temporary disk space; need at least ${Math.ceil(required / MiB)} MiB`)
  const root = await mkdtemp(join(tmpdir(), 'llm-reader-backup-stress-'))
  const userData = join(root, '资料 profile'), backups = join(root, '备份 backups')
  const databases: AppDatabase[] = [], measurements: Measurement[] = []
  try {
    const db = new AppDatabase(join(userData, 'reader.sqlite3')); databases.push(db)
    const ids = await seed(userData, db, profile)
    await mkdir(backups)
    const storage = await LibraryStorage.open(userData)
    const originalBytes = await directoryBytes(userData)
    const created = await measure(measurements, 'backup', () => storage.exclusive(() => false,
      () => storage.create(db, backups, preferences, 'stress-fixture-v1')))
    assert.equal(created.summary.books, profile.books)
    assert.equal(created.summary.sessions, profile.books)
    const packagePath = join(backups, created.name)
    const backupBytes = await directoryBytes(packagePath)
    const preview = await measure(measurements, 'preview', () => storage.inspect(packagePath))
    // Restore must recover the snapshot while retaining the newer original data.
    db.updateBookProgress(ids[0], 'txt:40', 0.75, '2026-11-04T01:00:00Z')
    await measure(measurements, 'restore', () => storage.exclusive(() => false,
      () => storage.restore(preview.token, { 'llm-reader.theme': 'light' })))
    const reopened = await measure(measurements, 'startup-validation', () => LibraryStorage.open(userData))
    assert.notEqual(reopened.directory, userData)
    assert.deepEqual(reopened.pendingPreferences?.values, preferences)
    const target = new AppDatabase(join(reopened.directory, 'reader.sqlite3')); databases.push(target)
    assert.equal(target.listBooks().length, profile.books)
    for (const [index, id] of ids.entries()) assert.equal(target.getBookSession(id)?.draft, draft(index, profile.draftBytes))
    assert.equal(target.getStoredBook(ids[0])?.lastLocator, 'txt:20')
    assert.equal(db.getStoredBook(ids[0])?.lastLocator, 'txt:40')
    assert.equal(db.listProviderProfiles().length, 1)
    assert.equal(target.listProviderProfiles().length, 0)
    await reopened.acknowledgePreferences(reopened.pendingPreferences!.token)
    assert.equal((await LibraryStorage.open(userData)).pendingPreferences, null)
    const afterRestoreBytes = await directoryBytes(root)
    // Invalidate a previously accepted package: rejecting it must not switch the
    // active library or leave a partial restore, including at the larger sizes.
    const tamperPreview = await reopened.inspect(packagePath)
    await writeFile(join(packagePath, 'library', db.getStoredBook(ids[0])!.storedName), 'corrupted')
    const active = reopened.directory
    await assert.rejects(() => reopened.restore(tamperPreview.token, preferences), { code: 'BACKUP_INVALID' })
    assert.equal(reopened.directory, active)
    assert.equal((await LibraryStorage.open(userData)).directory, active)
    assert.equal((await readdir(userData)).filter(name => name.startsWith('restored-')).length, 1)
    assert.equal((await readdir(userData)).filter(name => name.startsWith('.backup-snapshot-')).length, 0)
    return { profile: profileName, ...profile, filePayloadBytes: profile.books * profile.bytesPerBook,
      measurements, disk: { originalBytes, backupBytes, afterRestoreBytes },
      checks: { allDraftsRestored: true, fileHashesValidated: true, credentialsExcluded: true,
        originalRetained: true, preferencesApplied: true, tamperedPreviewRejected: true },
      passed: true, disposableDataRemoved: true }
  } finally {
    try { for (const db of databases.reverse()) db.close() }
    finally { await rm(root, { recursive: true, force: true }) }
  }
}
