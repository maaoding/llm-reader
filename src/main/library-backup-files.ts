import { createHash, randomUUID } from 'node:crypto'
import { constants, createWriteStream } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { backup, DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import type { LibraryBackupSummary, LibraryPreferences } from '@shared/contracts'
import { parseLibraryPreferences } from '@shared/library-preferences'
import { copy } from '@shared/copy'
import { AppDatabase, migrations } from './database'
import { AppError } from './errors'

const fileSchema = z.object({ path: z.string().regex(/^(reader\.sqlite3|preferences\.json|library\/[a-f0-9]{64}\.(epub|txt|pdf))$/u),
  bytes: z.number().int().nonnegative().max(64 * 1024 ** 3), sha256: z.string().regex(/^[a-f0-9]{64}$/u) }).strict()
const count = z.number().int().nonnegative().max(100_000_000)
const summarySchema = z.object({ createdAt: z.iso.datetime(), appVersion: z.string().min(1).max(64),
  books: count, highlights: count, insights: count, sessions: count, workbenches: count,
  bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict()
const manifestSchema = z.object({ format: z.literal('llm-reader-library'), version: z.literal(1),
  schemaVersion: z.literal(migrations.length), credentialsIncluded: z.literal(false),
  summary: summarySchema, files: z.array(fileSchema).min(2).max(100_002) }).strict()
export type BackupManifest = z.infer<typeof manifestSchema>

export function invalidBackup(): AppError { return new AppError('BACKUP_INVALID', copy('backup.invalid')) }
export function busyBackup(): AppError { return new AppError('BACKUP_BUSY', copy('backup.busy')) }

export async function regularDirectory(path: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw invalidBackup()
}

export async function syncFile(path: string): Promise<void> {
  const handle = await open(path, 'r+')
  try { await handle.sync() } finally { await handle.close() }
}

export async function syncDirectory(path: string): Promise<void> {
  // Windows does not expose directory fsync through Node; all files are flushed before rename.
  if (process.platform === 'win32') return
  const handle = await open(path, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

export async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    await syncFile(temporary)
    await rename(temporary, path)
    await syncDirectory(resolve(path, '..'))
  } finally { await rm(temporary, { force: true }) }
}

/** Hash while streaming; input links and changes during the read are rejected. */
async function readOrCopy(source: string, destination?: string): Promise<{ bytes: number; sha256: string }> {
  const info = await lstat(source)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 ** 3) throw invalidBackup()
  const input = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  const hash = createHash('sha256')
  let bytes = 0
  const digest = new Transform({ transform(chunk: Buffer, _encoding, done) {
    bytes += chunk.length; hash.update(chunk); done(null, chunk)
  } })
  try {
    const before = await input.stat()
    if (!before.isFile() || before.ino !== info.ino || before.size !== info.size) throw invalidBackup()
    if (destination) {
      await pipeline(input.createReadStream({ autoClose: false }), digest, createWriteStream(destination, { flags: 'wx', mode: 0o600 }))
      await syncFile(destination)
    } else {
      for await (const chunk of input.createReadStream({ autoClose: false })) { hash.update(chunk); bytes += chunk.length }
    }
    const after = await input.stat()
    if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw invalidBackup()
    return { bytes, sha256: hash.digest('hex') }
  } finally { await input.close() }
}

async function boundedJson(path: string, limit: number): Promise<{ value: unknown; sha256: string }> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw invalidBackup()
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await handle.stat()
    if (stat.size > limit || !stat.isFile()) throw invalidBackup()
    const bytes = await handle.readFile()
    if (bytes.length > limit) throw invalidBackup()
    return { value: JSON.parse(bytes.toString('utf8')), sha256: createHash('sha256').update(bytes).digest('hex') }
  } finally { await handle.close() }
}

function schemaIdentity(db: DatabaseSync): string {
  return JSON.stringify(db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all())
}
let expectedSchema: string | undefined
function validateDatabase(db: DatabaseSync): void {
  if (!expectedSchema) {
    const reference = new AppDatabase(':memory:')
    try { expectedSchema = schemaIdentity(reference.connection) } finally { reference.close() }
  }
  // Reject altered schemas/triggers before executing queries or opening through migrations.
  if (schemaIdentity(db) !== expectedSchema) throw invalidBackup()
  const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version)
  if (JSON.stringify(versions) !== JSON.stringify(migrations.map((_, i) => i + 1))) throw invalidBackup()
  if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw invalidBackup()
}

function inventory(db: DatabaseSync) {
  const books = db.prepare('SELECT stored_name, sha256, format, source_format FROM books ORDER BY stored_name').all()
  const files = books.map((book) => {
    const name = String(book.stored_name)
    if (!/^[a-f0-9]{64}\.(epub|txt|pdf)$/u.test(name) || name !== `${book.sha256}.${book.format}`) throw invalidBackup()
    return `library/${name}`
  })
  const total = (table: string): number => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n)
  return { files, counts: { books: books.length, highlights: total('highlights'), insights: total('insights'),
    sessions: total('book_session_history'), workbenches: total('workbenches') } }
}

function verifyCounts(manifest: BackupManifest, actual: ReturnType<typeof inventory>): void {
  const expected = ['reader.sqlite3', 'preferences.json', ...actual.files].sort()
  const paths = manifest.files.map((file) => file.path).sort()
  if (JSON.stringify(paths) !== JSON.stringify(expected)) throw invalidBackup()
  if (manifest.summary.bytes !== manifest.files.reduce((sum, file) => sum + file.bytes, 0)) throw invalidBackup()
  for (const key of Object.keys(actual.counts) as Array<keyof typeof actual.counts>) {
    if (manifest.summary[key] !== actual.counts[key]) throw invalidBackup()
  }
}

export async function inspectBackup(directory: string): Promise<{ manifest: BackupManifest; fingerprint: string; preferences: LibraryPreferences }> {
  try {
    await regularDirectory(directory)
    await regularDirectory(join(directory, 'library'))
    // Sidecars would change SQLite's logical contents without changing the manifest's database hash.
    for (const suffix of ['-wal', '-shm', '-journal']) {
      let exists = false
      try { await lstat(join(directory, `reader.sqlite3${suffix}`)); exists = true }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      if (exists) throw invalidBackup()
    }
    const input = await boundedJson(join(directory, 'manifest.json'), 32 * 1024 ** 2)
    const manifest = manifestSchema.parse(input.value)
    const paths = new Set(manifest.files.map((file) => file.path))
    if (paths.size !== manifest.files.length || !paths.has('reader.sqlite3') || !paths.has('preferences.json')) throw invalidBackup()
    for (const file of manifest.files) {
      const actual = await readOrCopy(join(directory, file.path))
      if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) throw invalidBackup()
    }
    const db = new DatabaseSync(join(directory, 'reader.sqlite3'), { readOnly: true, allowExtension: false })
    try {
      validateDatabase(db)
      if (db.prepare('SELECT count(*) AS n FROM provider_profiles').get()!.n !== 0 || db.prepare('SELECT count(*) AS n FROM knowledge_settings').get()!.n !== 0) throw invalidBackup()
      verifyCounts(manifest, inventory(db))
    } finally { db.close() }
    const preferences = parseLibraryPreferences((await boundedJson(join(directory, 'preferences.json'), 2_000_000)).value)
    return { manifest, fingerprint: input.sha256, preferences }
  } catch (error) {
    if (error instanceof AppError) throw error
    throw invalidBackup()
  }
}

export async function createBackupPackage(database: AppDatabase, libraryRoot: string, parent: string,
  preferences: LibraryPreferences, appVersion: string, protectedRoot = libraryRoot): Promise<{ name: string; summary: LibraryBackupSummary }> {
  const values = parseLibraryPreferences(preferences)
  await regularDirectory(parent)
  const destinationRoot = await realpath(parent)
  const sourceRoot = await realpath(protectedRoot)
  const relation = relative(sourceRoot, destinationRoot)
  if (relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation))) {
    throw new AppError('BACKUP_DESTINATION', copy('backup.destination'))
  }
  const name = `LLM-Reader-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`
  const temporary = join(destinationRoot, `.${name}.partial`)
  await mkdir(temporary, { mode: 0o700 })
  let scratch: string | undefined
  try {
    await mkdir(join(temporary, 'library'), { mode: 0o700 })
    // The unsanitized snapshot stays beside the live database, never in the user's
    // export destination (which may be shared). Only sanitized pages leave userData.
    scratch = await mkdtemp(join(libraryRoot, '.backup-snapshot-'))
    const snapshot = join(scratch, 'snapshot.sqlite3')
    await backup(database.connection, snapshot)
    const db = new DatabaseSync(snapshot, { allowExtension: false })
    let contents: ReturnType<typeof inventory>
    try {
      validateDatabase(db)
      // Exclude entire service configurations: URLs and custom bodies may also contain credentials.
      db.exec('PRAGMA secure_delete = ON; DELETE FROM provider_profiles; DELETE FROM knowledge_settings;')
      contents = inventory(db)
      db.prepare('VACUUM INTO ?').run(join(temporary, 'reader.sqlite3'))
    } finally { db.close() }
    await rm(scratch, { recursive: true, force: true })
    scratch = undefined
    await writeFile(join(temporary, 'preferences.json'), JSON.stringify(values), { flag: 'wx', mode: 0o600 })
    const files: BackupManifest['files'] = []
    for (const path of ['reader.sqlite3', 'preferences.json']) {
      await syncFile(join(temporary, path))
      files.push({ path, ...await readOrCopy(join(temporary, path)) })
    }
    if (contents.files.length) await regularDirectory(join(libraryRoot, 'library'))
    for (const path of contents.files) files.push({ path, ...await readOrCopy(join(libraryRoot, path), join(temporary, path)) })
    const summary = { appVersion, createdAt: new Date().toISOString(), ...contents.counts, bytes: files.reduce((n, f) => n + f.bytes, 0) }
    await atomicJson(join(temporary, 'manifest.json'), { format: 'llm-reader-library', version: 1,
      schemaVersion: migrations.length, credentialsIncluded: false, summary, files } satisfies BackupManifest)
    await syncDirectory(join(temporary, 'library'))
    await syncDirectory(temporary)
    await rename(temporary, join(destinationRoot, name))
    await syncDirectory(destinationRoot)
    return { name, summary }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    throw error
  } finally { if (scratch) await rm(scratch, { recursive: true, force: true }) }
}

/** Materialize and revalidate a complete independent store; never replace live files. */
export async function stageBackup(directory: string, destination: string, fingerprint: string): Promise<LibraryPreferences> {
  const input = await inspectBackup(directory)
  if (input.fingerprint !== fingerprint) throw invalidBackup()
  await mkdir(destination, { mode: 0o700 })
  try {
    await mkdir(join(destination, 'library'), { mode: 0o700 })
    for (const file of input.manifest.files) {
      const actual = await readOrCopy(join(directory, file.path), join(destination, file.path))
      if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) throw invalidBackup()
    }
    await atomicJson(join(destination, 'manifest.json'), input.manifest)
    // Check the copies, not just the previously previewed source.
    const staged = await inspectBackup(destination)
    await syncDirectory(join(destination, 'library'))
    await syncDirectory(destination)
    return staged.preferences
  } catch (error) { await rm(destination, { recursive: true, force: true }); throw error }
}

export async function validateStoredDatabase(path: string): Promise<void> {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw invalidBackup()
  const db = new DatabaseSync(path, { readOnly: true, allowExtension: false })
  try { validateDatabase(db) } finally { db.close() }
}
