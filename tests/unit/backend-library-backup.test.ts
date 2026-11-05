import { afterEach, expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { AppDatabase } from '../../src/main/database'
import { LibraryService } from '../../src/main/library-service'
import { createBackupPackage, inspectBackup, type BackupManifest } from '../../src/main/library-backup-files'
import { LibraryStorage } from '../../src/main/library-storage'
import { parseLibraryPreferences } from '../../src/shared/library-preferences'

const fault = vi.hoisted(() => ({ activation: false, snapshot: false,
  copy: null as 'backup' | 'restore' | null, writtenBytes: 0 }))
vi.mock('node:fs', async (original) => {
  const real = await original<typeof import('node:fs')>()
  return { ...real, createWriteStream: (...args: Parameters<typeof real.createWriteStream>) => {
    const stream = real.createWriteStream(...args)
    const path = String(args[0]).replaceAll('\\', '/')
    if (path.includes('/library/') && ((fault.copy === 'backup' && path.includes('.partial/')) ||
      (fault.copy === 'restore' && path.includes('/restored-')))) {
      const write = stream._write.bind(stream)
      stream._write = (chunk: Buffer, encoding, done) => {
        // Write a real prefix before injecting the device failure. The pipeline
        // must close both handles and remove this incomplete destination.
        const prefix = chunk.subarray(0, Math.max(1, Math.floor(chunk.length / 2)))
        write(prefix, encoding, (error) => {
          if (!error) fault.writtenBytes += prefix.length
          done(error ?? Object.assign(new Error('Synthetic disk full'), { code: 'ENOSPC' }))
        })
      }
    }
    return stream
  } }
})
vi.mock('node:sqlite', async (original) => {
  const real = await original<typeof import('node:sqlite')>()
  return { ...real, backup: async (...args: Parameters<typeof real.backup>) => {
    const result = await real.backup(...args)
    if (fault.snapshot) throw Object.assign(new Error('Synthetic snapshot failure'), { code: 'ENOSPC' })
    return result
  } }
})
vi.mock('node:fs/promises', async (original) => {
  const real = await original<typeof import('node:fs/promises')>()
  return { ...real, rename: async (from: string, to: string) => {
    if (fault.activation && to.endsWith('library-state.json')) throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' })
    return real.rename(from, to)
  } }
})
const roots: string[] = []
const databases: AppDatabase[] = []
const preferences = { 'llm-reader.theme': 'dark', 'llm-reader.interface-scale': '125',
  'llm-reader.assistant-personas': JSON.stringify({ presets: [{ id: 'reviewer', name: '审稿人', prompt: '指出证据不足之处。' }], defaultId: 'reviewer' }) }

afterEach(async () => {
  fault.activation = false
  fault.snapshot = false
  fault.copy = null
  fault.writtenBytes = 0
  for (const db of databases.splice(0)) db.close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'reader-backup-test-')); roots.push(root)
  const userData = join(root, 'profile'), backups = join(root, 'backups')
  const db = new AppDatabase(join(userData, 'reader.sqlite3')); databases.push(db)
  const library = new LibraryService(db, join(userData, 'library'))
  await mkdir(backups)
  const source = join(root, 'sample.txt')
  await writeFile(source, '第一章 证据\n\n所有结论需要原文支持。\n'.repeat(20))
  const { book } = await library.importFromPath(source)
  db.updateBookProgress(book.id, 'txt:30', 0.4, '2026-11-03T00:00:00Z')
  library.saveHighlight({ bookId: book.id, quote: '原文支持', anchor: 'txt:20:24', chapterTitle: '第一章' })
  library.saveInsight({ bookId: book.id, selection: null, question: '依据是什么？', answer: '原文支持。', model: 'synthetic' })
  db.upsertBookSession({ bookId: book.id, conversationId: randomUUID(), scope: 'book', selection: null,
    draft: '尚未发送的草稿', turns: [], updatedAt: '2026-11-03T00:00:00Z' })
  const workbench = db.createWorkbench('研究工作台', [book.id])
  db.saveWorkbench({ ...workbench, draft: '多书草稿' })
  db.connection.exec(`INSERT INTO provider_profiles(id, name, base_url, model, is_active, created_at, updated_at, request_json, headers_secret)
    VALUES ('profile', 'Synthetic', 'https://test.invalid/?token=CONFIG_SECRET_SENTINEL', 'mock', 1, 'now', 'now', '{"private":"BODY_SECRET_SENTINEL"}', X'414243');
    INSERT INTO knowledge_settings(kind, config_json, secret, revision, headers_secret)
    VALUES ('embedding', '{"key":"KNOWLEDGE_SECRET_SENTINEL"}', X'414243', 'revision', X'444546');`)
  await mkdir(join(userData, 'provider-keys'))
  await writeFile(join(userData, 'provider-keys/profile.bin'), 'FILE_SECRET_SENTINEL')
  const result = await createBackupPackage(db, userData, backups, preferences, '1.3.1')
  return { root, userData, backups, db, book, packagePath: join(backups, result.name), result }
}

async function changeManifest(path: string, change: (manifest: BackupManifest) => void) {
  const manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8')) as BackupManifest
  change(manifest)
  await writeFile(join(path, 'manifest.json'), JSON.stringify(manifest))
}

it('round-trips committed WAL data, book bytes, sessions, archives and preferences without service secrets', async () => {
  const { userData, db, book, packagePath, result } = await fixture()
  expect(result.summary).toMatchObject({ books: 1, highlights: 1, insights: 1, sessions: 1, workbenches: 1 })
  const databaseBytes = await readFile(join(packagePath, 'reader.sqlite3'))
  for (const marker of ['CONFIG_SECRET_SENTINEL', 'BODY_SECRET_SENTINEL', 'KNOWLEDGE_SECRET_SENTINEL', 'FILE_SECRET_SENTINEL']) {
    expect(databaseBytes.includes(Buffer.from(marker))).toBe(false)
  }
  expect((await readdir(packagePath)).sort()).toEqual(['library', 'manifest.json', 'preferences.json', 'reader.sqlite3'])
  expect(await readdir(packagePath)).not.toContain('provider-keys')
  expect(db.listProviderProfiles()).toHaveLength(1)
  const originalBytes = await readFile(join(userData, 'library', db.getStoredBook(book.id)!.storedName))
  const storage = await LibraryStorage.open(userData)
  const preview = await storage.inspect(packagePath)
  await storage.restore(preview.token, { 'llm-reader.theme': 'light' })
  const restarted = await LibraryStorage.open(userData)
  expect(restarted.directory).not.toBe(userData)
  expect(restarted.pendingPreferences?.values).toEqual(preferences)
  const restored = new AppDatabase(join(restarted.directory, 'reader.sqlite3')); databases.push(restored)
  expect(restored.listBooks()[0]).toMatchObject({ id: book.id, progress: 0.4, lastLocator: 'txt:30' })
  expect(restored.getBookSession(book.id)?.draft).toBe('尚未发送的草稿')
  expect(restored.listHighlights(book.id)).toHaveLength(1)
  expect(restored.listInsights(book.id)).toHaveLength(1)
  expect(restored.listWorkbenches()[0]).toMatchObject({ draft: '多书草稿', bookIds: [book.id] })
  expect(restored.listProviderProfiles()).toEqual([])
  expect(restored.connection.prepare('SELECT * FROM knowledge_settings').all()).toEqual([])
  expect(await readFile(join(restarted.directory, 'library', restored.getStoredBook(book.id)!.storedName))).toEqual(originalBytes)
  await expect(restarted.acknowledgePreferences(randomUUID())).rejects.toMatchObject({ code: 'BACKUP_INVALID' })
  await restarted.acknowledgePreferences(restarted.pendingPreferences!.token)
  expect((await LibraryStorage.open(userData)).pendingPreferences).toBeNull()
  const second = await restarted.create(restored, join(userData, '..', 'backups'), preferences, '1.3.1')
  const secondPreview = await restarted.inspect(join(userData, '..', 'backups', second.name))
  const previousDirectory = restarted.directory
  await restarted.restore(secondPreview.token, preferences)
  expect(restarted.directory).not.toBe(previousDirectory)
  const reopened = await LibraryStorage.open(userData)
  expect(reopened.directory).toBe(restarted.directory)
  // Original credentials and library still exist; restoring never mutates them.
  expect(db.getBookSession(book.id)?.draft).toBe('尚未发送的草稿')
  expect(await readFile(join(userData, 'provider-keys/profile.bin'), 'utf8')).toBe('FILE_SECRET_SENTINEL')
})

it.each(['missing', 'corrupt', 'duplicate', 'traversal', 'future-version', 'bad-count', 'symlink', 'sidecar'] as const)(
  'rejects a %s backup without activating or deleting the original store', async (kind) => {
    const { userData, db, book, packagePath } = await fixture()
    const file = join(packagePath, 'library', db.getStoredBook(book.id)!.storedName)
    if (kind === 'missing') await rm(file)
    if (kind === 'corrupt') await writeFile(file, 'changed')
    if (kind === 'sidecar') await writeFile(join(packagePath, 'reader.sqlite3-wal'), 'unhashed changes')
    if (kind === 'duplicate') await changeManifest(packagePath, (m) => m.files.push(m.files[0]))
    if (kind === 'traversal') await changeManifest(packagePath, (m) => { m.files[0].path = '../reader.sqlite3' })
    if (kind === 'future-version') await changeManifest(packagePath, (m) => { m.schemaVersion += 1 })
    if (kind === 'bad-count') await changeManifest(packagePath, (m) => { m.summary.books = 99 })
    if (kind === 'symlink') { await rm(file); await symlink(join(userData, 'library', db.getStoredBook(book.id)!.storedName), file) }
    const storage = await LibraryStorage.open(userData)
    await expect(storage.inspect(packagePath)).rejects.toMatchObject({ code: 'BACKUP_INVALID' })
    expect(storage.directory).toBe(userData)
    expect(db.listBooks()).toHaveLength(1)
    expect((await readdir(userData)).filter((name) => name.startsWith('restored-'))).toEqual([])
  }
)

it('rejects a forged database schema even when the file digest is recomputed', async () => {
  const { packagePath } = await fixture()
  const path = join(packagePath, 'reader.sqlite3')
  const db = new DatabaseSync(path)
  db.exec('CREATE TRIGGER malicious AFTER INSERT ON books BEGIN DELETE FROM insights; END;'); db.close()
  const bytes = await readFile(path)
  await changeManifest(packagePath, (manifest) => {
    const entry = manifest.files.find((file) => file.path === 'reader.sqlite3')!
    entry.bytes = bytes.length; entry.sha256 = createHash('sha256').update(bytes).digest('hex')
    manifest.summary.bytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0)
  })
  await expect(inspectBackup(packagePath)).rejects.toMatchObject({ code: 'BACKUP_INVALID' })
})

it('rechecks previewed files and refuses stale preview tokens', async () => {
  const { userData, packagePath } = await fixture()
  const storage = await LibraryStorage.open(userData)
  const first = await storage.inspect(packagePath)
  const second = await storage.inspect(packagePath)
  await expect(storage.restore(first.token, {})).rejects.toMatchObject({ code: 'BACKUP_INVALID' })
  await changeManifest(packagePath, (m) => { m.summary.appVersion = 'changed' })
  await expect(storage.restore(second.token, {})).rejects.toMatchObject({ code: 'BACKUP_INVALID' })
  expect(storage.directory).toBe(userData)
})

it('leaves the original active and removes staging when activation cannot be written', async () => {
  const { userData, packagePath } = await fixture()
  const storage = await LibraryStorage.open(userData)
  const preview = await storage.inspect(packagePath)
  fault.activation = true
  await expect(storage.restore(preview.token, {})).rejects.toMatchObject({ code: 'BACKUP_WRITE' })
  expect(storage.directory).toBe(userData)
  expect((await readdir(userData)).filter((name) => name.startsWith('restored-'))).toEqual([])
  expect((await LibraryStorage.open(userData)).directory).toBe(userData)
})

it.each(['snapshot', 'copy'] as const)('cleans a failed backup during %s and can retry without changing the live library', async (phase) => {
  const { userData, backups, db, book, packagePath } = await fixture()
  const existingBackups = await readdir(backups)
  const storage = await LibraryStorage.open(userData)
  fault.snapshot = phase === 'snapshot'
  fault.copy = phase === 'copy' ? 'backup' : null
  await expect(storage.exclusive(() => false, () => storage.create(db, backups, preferences, '1.3.1')))
    .rejects.toMatchObject({ code: 'BACKUP_WRITE' })
  if (phase === 'copy') expect(fault.writtenBytes).toBeGreaterThan(0)
  expect(storage.locked).toBe(false)
  expect(await readdir(backups)).toEqual(existingBackups)
  expect((await readdir(userData)).filter((name) => name.startsWith('.backup-snapshot-'))).toEqual([])
  expect(db.getBookSession(book.id)?.draft).toBe('尚未发送的草稿')
  expect(db.listProviderProfiles()).toHaveLength(1)
  await expect(inspectBackup(packagePath)).resolves.toHaveProperty('preferences', preferences)
  fault.snapshot = false; fault.copy = null
  const retried = await storage.exclusive(() => false, () => storage.create(db, backups, preferences, '1.3.1'))
  await expect(inspectBackup(join(backups, retried.name))).resolves.toHaveProperty('preferences', preferences)
})

it('removes a partially copied restore, keeps the active store usable and can retry the same preview', async () => {
  const { userData, db, book, packagePath } = await fixture()
  const storage = await LibraryStorage.open(userData)
  const preview = await storage.inspect(packagePath)
  fault.copy = 'restore'
  await expect(storage.exclusive(() => false, () => storage.restore(preview.token, {})))
    .rejects.toMatchObject({ code: 'BACKUP_WRITE' })
  expect(fault.writtenBytes).toBeGreaterThan(0)
  expect(storage.locked).toBe(false)
  expect((await readdir(userData)).filter((name) => name.startsWith('restored-'))).toEqual([])
  expect((await LibraryStorage.open(userData)).directory).toBe(userData)
  db.updateBookProgress(book.id, 'txt:40', 0.5, '2026-11-04T00:00:00Z')
  expect(db.getStoredBook(book.id)?.lastLocator).toBe('txt:40')
  fault.copy = null
  await storage.exclusive(() => false, () => storage.restore(preview.token, {}))
  const reopened = await LibraryStorage.open(userData)
  expect(reopened.directory).not.toBe(userData)
  const restored = new AppDatabase(join(reopened.directory, 'reader.sqlite3')); databases.push(restored)
  expect(restored.getBookSession(book.id)?.draft).toBe('尚未发送的草稿')
  expect(restored.getStoredBook(book.id)?.lastLocator).toBe('txt:30')
  expect(db.getStoredBook(book.id)?.lastLocator).toBe('txt:40')
})

it.each(['database', 'book'] as const)('rolls back a pending restore with a damaged %s before opening it or applying preferences', async (kind) => {
  const { userData, packagePath } = await fixture()
  const storage = await LibraryStorage.open(userData)
  const preview = await storage.inspect(packagePath)
  await storage.restore(preview.token, { 'llm-reader.theme': 'light' })
  if (kind === 'database') await writeFile(join(storage.directory, 'reader.sqlite3'), 'interrupted/damaged')
  else await rm(join(storage.directory, 'library', (await readdir(join(storage.directory, 'library')))[0]))
  const restarted = await LibraryStorage.open(userData)
  expect(restarted.rolledBack).toBe(true)
  expect(restarted.directory).toBe(userData)
  expect(restarted.pendingPreferences?.values).toEqual({ 'llm-reader.theme': 'light' })
})

it('rejects destinations inside the live store and preserves existing reports', async () => {
  const { db, userData, packagePath } = await fixture()
  await expect(createBackupPackage(db, userData, userData, {}, '1.3.1')).rejects.toMatchObject({ code: 'BACKUP_DESTINATION' })
  await expect(inspectBackup(packagePath)).resolves.toHaveProperty('preferences', preferences)
})

it('serializes maintenance, rejects active background work and releases its lock after failures', async () => {
  const { userData } = await fixture()
  const storage = await LibraryStorage.open(userData)
  const work = vi.fn(async () => undefined)
  await expect(storage.exclusive(() => true, work)).rejects.toMatchObject({ code: 'BACKUP_BUSY' })
  expect(work).not.toHaveBeenCalled()
  let finish!: () => void
  const running = storage.exclusive(() => false, () => new Promise<void>((resolve) => { finish = resolve }))
  await expect(storage.exclusive(() => false, work)).rejects.toMatchObject({ code: 'BACKUP_BUSY' })
  finish(); await running
  await expect(storage.exclusive(() => false, async () => { throw new Error('disk error') })).rejects.toThrow('disk error')
  expect(storage.locked).toBe(false)
})

it('allowlists preference fields and rejects unknown storage or oversized payloads', () => {
  expect(() => parseLibraryPreferences({ 'api-key': 'secret' })).toThrow()
  expect(() => parseLibraryPreferences({ 'llm-reader.theme': 'unknown' })).toThrow()
  expect(() => parseLibraryPreferences({ 'llm-reader-workbench-active': 'x'.repeat(256_001) })).toThrow()
  const sanitized = parseLibraryPreferences({ 'llm-reader.assistant-personas': JSON.stringify({ presets: [], defaultId: null, apiKey: 'secret' }) })
  expect(sanitized['llm-reader.assistant-personas']).toBe('{"presets":[],"defaultId":null}')
})
