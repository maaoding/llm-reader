/* global URL */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const sha256 = (value) => createHash('sha256').update(value).digest('hex')

function validEndpoint(value) {
  try {
    const url = new URL(value)
    return !url.username && !url.password && !url.hash && (url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  } catch { return false }
}

/** Inspect only selected configuration; never return credentials in a public report. */
export function inspectConfiguration(sourceDirectory, profileId) {
  if (!sourceDirectory) return { ready: false, reasons: ['MODEL_CONFIGURATION_DIRECTORY_MISSING'] }
  const root = resolve(sourceDirectory)
  if (!existsSync(join(root, 'reader.sqlite3'))) return { ready: false, reasons: ['MODEL_CONFIGURATION_DATABASE_MISSING'] }
  const database = new DatabaseSync(join(root, 'reader.sqlite3'), { readOnly: true })
  try {
    const table = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='provider_profiles'").get()
    if (!table) return { ready: false, reasons: ['SAVED_MODEL_PROFILE_MISSING'] }
    const selected = profileId
      ? database.prepare('SELECT id, model, base_url, protocol, headers_secret FROM provider_profiles WHERE id = ?').get(profileId)
      : database.prepare('SELECT id, model, base_url, protocol, headers_secret FROM provider_profiles WHERE is_active = 1').get()
    const reasons = []
    if (!selected || !/^[\w-]{1,128}$/u.test(selected.id) || !selected.model || !validEndpoint(selected.base_url)) reasons.push('SAVED_MODEL_PROFILE_MISSING')
    if (selected && !selected.headers_secret && !existsSync(join(root, 'provider-keys', `${selected.id}.bin`)) &&
      !(selected.id === 'legacy' && existsSync(join(root, 'api-key.bin')))) reasons.push('ENCRYPTED_MODEL_AUTHENTICATION_MISSING')
    if (!existsSync(join(root, 'Local State'))) reasons.push('MODEL_ENCRYPTION_CONTEXT_MISSING')
    const row = database.prepare("SELECT config_json FROM knowledge_settings WHERE kind = 'document'").get()
    const document = row ? JSON.parse(row.config_json) : null
    if (!document || document.processor === 'none' || document.enabled === false || !validEndpoint(document.baseUrl)) reasons.push('PDF_PROCESSOR_CONFIGURATION_MISSING')
    return { ready: reasons.length === 0, reasons,
      ...(selected ? { model: selected.model, profileId: selected.id, protocol: selected.protocol ?? 'openai' } : {}),
      documentProcessor: document?.processor ?? 'none' }
  } catch {
    return { ready: false, reasons: ['SAVED_CONFIGURATION_SCHEMA_UNSUPPORTED'] }
  } finally { database.close() }
}

/** Copy ciphertext and routing settings into an empty disposable profile only. */
export async function copyConfiguration(sourceDirectory, targetDirectory, profileId) {
  if (resolve(sourceDirectory) === resolve(targetDirectory)) throw new Error('Evaluation profile must be isolated')
  const inspection = inspectConfiguration(sourceDirectory, profileId)
  if (!inspection.ready) throw new Error(inspection.reasons.join(', '))
  const source = new DatabaseSync(join(sourceDirectory, 'reader.sqlite3'), { readOnly: true })
  const target = new DatabaseSync(join(targetDirectory, 'reader.sqlite3'))
  try {
    if (Number(target.prepare('SELECT count(*) AS n FROM books').get().n) ||
      Number(target.prepare('SELECT count(*) AS n FROM provider_profiles').get().n)) throw new Error('Evaluation target is not empty')
    const profile = source.prepare('SELECT id, name, base_url, model, created_at, updated_at, compatibility, protocol, request_json, headers_secret FROM provider_profiles WHERE id = ?').get(inspection.profileId)
    const document = source.prepare("SELECT config_json, secret, headers_secret, revision FROM knowledge_settings WHERE kind = 'document'").get()
    await mkdir(join(targetDirectory, 'provider-keys'), { recursive: true })
    const keyPath = join(sourceDirectory, 'provider-keys', `${profile.id}.bin`)
    const legacyPath = join(sourceDirectory, 'api-key.bin')
    if (existsSync(keyPath) || (profile.id === 'legacy' && existsSync(legacyPath))) {
      await copyFile(existsSync(keyPath) ? keyPath : legacyPath, join(targetDirectory, 'provider-keys', `${profile.id}.bin`))
    }
    await copyFile(join(sourceDirectory, 'Local State'), join(targetDirectory, 'Local State'))
    target.prepare('INSERT INTO provider_profiles(id,name,base_url,model,is_active,created_at,updated_at,compatibility,protocol,request_json,headers_secret) VALUES (?,?,?,?,1,?,?,?,?,?,?)')
      .run(profile.id, profile.name, profile.base_url, profile.model, profile.created_at, profile.updated_at, profile.compatibility, profile.protocol, profile.request_json, profile.headers_secret)
    target.prepare('INSERT OR REPLACE INTO knowledge_settings(kind,config_json,secret,headers_secret,revision) VALUES (?,?,?,?,?)')
      .run('document', document.config_json, document.secret, document.headers_secret, document.revision)
    // Fresh defaults keep optional embedding, rerank and web search disabled.
    return inspection
  } finally { source.close(); target.close() }
}

export async function verifyFixtureFiles(manifest, fixtureDirectory) {
  const errors = []
  for (const file of manifest.files) {
    const path = resolve(fixtureDirectory, file.path)
    const within = relative(resolve(fixtureDirectory), path)
    if (isAbsolute(within) || within === '..' || within.startsWith('..' + sep)) { errors.push(`${file.key}:INVALID_PATH`); continue }
    try {
      if (sha256(await readFile(path)) !== file.sha256) errors.push(`${file.key}:HASH_MISMATCH`)
    } catch { errors.push(`${file.key}:FILE_MISSING`) }
  }
  return errors
}

const normalized = (value) => value.normalize('NFKC').replace(/\s+/gu, '').toLowerCase()

/** Exact evidence matching is a diagnostic; semantic correctness always requires review. */
export function measureIndependentAnswer(result, item, evidence, bookIds) {
  const passages = result.context?.passages ?? []
  const citations = [...new Set([...result.answer.matchAll(/\[((?:P|W)\d+)\]/gu)].map((match) => match[1]))]
  const known = new Map(passages.map((passage) => [passage.id, passage]))
  const cited = citations.flatMap((id) => known.has(id) ? [known.get(id)] : [])
  const requestedBookIds = new Set(item.bookKeys.map((key) => bookIds[key]).filter(Boolean))
  const matches = (id, candidates) => {
    const expected = evidence.find((entry) => entry.id === id)
    return expected && candidates.some((passage) =>
      (passage.bookId ?? result.context?.bookId) === bookIds[expected.bookKey] &&
      normalized(passage.text).includes(normalized(expected.quote)))
  }
  return {
    expectedEvidence: item.expectedEvidence,
    retrievedEvidence: item.expectedEvidence.filter((id) => matches(id, passages)),
    citedEvidence: item.expectedEvidence.filter((id) => matches(id, cited)),
    validCitations: citations.filter((id) => known.has(id)),
    unknownCitations: citations.filter((id) => !known.has(id)),
    unexpectedBookPassages: passages.filter((passage) => !requestedBookIds.has(passage.bookId ?? result.context?.bookId)).map((passage) => passage.id),
    expectedFactMarkers: item.expectedFacts.map((fact) => ({ fact, present: normalized(result.answer).includes(normalized(fact)) })),
    manualReviewRequired: true,
    review: { conclusionSupported: null, conditionsAndExceptions: null, refusalAppropriate: null, sourceAttribution: null }
  }
}
