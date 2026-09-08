/* global process */
import { copyFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export function readEvaluationProfile(sourceDirectory, profileId) {
  const database = new DatabaseSync(join(sourceDirectory, 'reader.sqlite3'), { readOnly: true })
  try {
    const current = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'provider_profiles'").get()
    const compatibilityColumn = current && database.prepare('PRAGMA table_info(provider_profiles)').all().some((column) => column.name === 'compatibility')
      ? 'compatibility' : "'auto' AS compatibility"
    const profile = current
      ? (profileId
          ? database.prepare(`SELECT id, name, base_url, model, created_at, updated_at, ${compatibilityColumn} FROM provider_profiles WHERE id = ?`).get(profileId)
          : database.prepare(`SELECT id, name, base_url, model, created_at, updated_at, ${compatibilityColumn} FROM provider_profiles WHERE is_active = 1`).get())
      : database.prepare("SELECT 'legacy' AS id, '现有配置' AS name, base_url, model, '1' AS created_at, '1' AS updated_at, 'auto' AS compatibility FROM provider_settings WHERE singleton = 1").get()
    if (!profile || !/^[\w-]{1,128}$/u.test(profile.id) || !profile.model || !profile.base_url || (profileId && profile.id !== profileId)) {
      throw new Error('未找到指定的完整模型配置。')
    }
    const keyPath = join(sourceDirectory, 'provider-keys', `${profile.id}.bin`)
    const legacyPath = join(sourceDirectory, 'api-key.bin')
    const encryptedKeyPath = existsSync(keyPath) ? keyPath : profile.id === 'legacy' && existsSync(legacyPath) ? legacyPath : null
    if (!encryptedKeyPath || !existsSync(join(sourceDirectory, 'Local State'))) throw new Error('模型配置缺少加密凭据或 safeStorage 上下文。')
    return { profile, encryptedKeyPath }
  } finally {
    database.close()
  }
}

/** Copy one saved profile into a newly initialized temporary profile. No plaintext key leaves Electron. */
export async function copyEvaluationProfile(sourceDirectory, targetDirectory, profileId) {
  if (resolve(sourceDirectory).toLocaleLowerCase() === resolve(targetDirectory).toLocaleLowerCase()) throw new Error('评测必须使用独立用户数据目录。')
  const { profile, encryptedKeyPath } = readEvaluationProfile(sourceDirectory, profileId)
  const target = new DatabaseSync(join(targetDirectory, 'reader.sqlite3'))
  try {
    if (Number(target.prepare('SELECT count(*) AS n FROM provider_profiles').get().n) !== 0) throw new Error('评测目标目录已有模型配置，拒绝覆盖。')
    await mkdir(join(targetDirectory, 'provider-keys'), { recursive: true })
    await copyFile(encryptedKeyPath, join(targetDirectory, 'provider-keys', `${profile.id}.bin`))
    await copyFile(join(sourceDirectory, 'Local State'), join(targetDirectory, 'Local State'))
    target.prepare('INSERT INTO provider_profiles(id, name, base_url, model, is_active, created_at, updated_at, compatibility) VALUES (?, ?, ?, ?, 1, ?, ?, ?)')
      .run(profile.id, profile.name, profile.base_url, profile.model, profile.created_at, profile.updated_at, profile.compatibility)
    return { id: profile.id, name: profile.name, model: profile.model }
  } finally {
    target.close()
  }
}

export function evaluationSourceDirectory() {
  if (process.env.LLM_READER_REAL_API_SOURCE_USER_DATA) return resolve(process.env.LLM_READER_REAL_API_SOURCE_USER_DATA)
  if (!process.env.APPDATA) throw new Error('请指定 LLM_READER_REAL_API_SOURCE_USER_DATA。')
  return join(process.env.APPDATA, 'llm-reader')
}
