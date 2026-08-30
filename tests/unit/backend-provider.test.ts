import { readFile, rm } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { AppError } from '../../src/main/errors'
import { ProviderService, type KeyProtector } from '../../src/main/provider-service'
import { FileSecretStore, ProfileSecretStore } from '../../src/main/secret-store'

const temporaryDirectories: string[] = []

class XorKeyProtector implements KeyProtector {
  isAvailable(): boolean {
    return true
  }

  encrypt(value: string): Uint8Array {
    return Uint8Array.from(Buffer.from(value, 'utf8'), (byte) => byte ^ 0xa5)
  }

  decrypt(value: Uint8Array): string {
    return Buffer.from(Uint8Array.from(value, (byte) => byte ^ 0xa5)).toString('utf8')
  }
}

function makeTemporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'llm-reader-provider-'))
  temporaryDirectories.push(path)
  return path
}

function makeProvider(root: string, fetchImplementation: typeof fetch = fetch): {
  database: AppDatabase
  provider: ProviderService
} {
  const database = new AppDatabase(join(root, 'reader.sqlite3'))
  const provider = new ProviderService(
    database,
    new XorKeyProtector(),
    new ProfileSecretStore(join(root, 'provider-keys'), join(root, 'api-key.bin')),
    fetchImplementation
  )
  return { database, provider }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('ProviderService profiles and secret storage', () => {
  it('isolates profile keys outside SQLite and switches only after activation', async () => {
    const root = makeTemporaryDirectory()
    const { database, provider } = makeProvider(root)
    const firstKey = 'sk-first-secret'
    const secondKey = 'sk-second-secret'

    let overview = provider.createProfile({
      name: '日常',
      baseUrl: 'https://first.example.test/v1',
      model: 'first-model',
      apiKey: firstKey
    })
    const first = overview.profiles[0]
    expect(overview.activeProfileId).toBeNull()
    expect(() => provider.getCredentials()).toThrow(AppError)

    overview = provider.createProfile({
      name: '研究',
      baseUrl: 'https://second.example.test/v1',
      model: 'second-model',
      apiKey: secondKey
    })
    const second = overview.profiles[1]
    provider.activateProfile(first.id)
    expect(provider.getCredentials()).toEqual({
      baseUrl: 'https://first.example.test/v1',
      model: 'first-model',
      apiKey: firstKey
    })
    provider.activateProfile(second.id)
    expect(provider.getCredentials().apiKey).toBe(secondKey)

    const columns = database.connection.prepare('PRAGMA table_info(provider_profiles)').all()
    expect(columns.map((column) => column.name)).toEqual([
      'id', 'name', 'base_url', 'model', 'is_active', 'created_at', 'updated_at'
    ])
    database.close()

    const databaseBytes = await readFile(join(root, 'reader.sqlite3'))
    const firstSecretBytes = await readFile(join(root, 'provider-keys', `${first.id}.bin`))
    const secondSecretBytes = await readFile(join(root, 'provider-keys', `${second.id}.bin`))
    for (const value of [firstKey, secondKey]) {
      expect(databaseBytes.includes(Buffer.from(value))).toBe(false)
      expect(firstSecretBytes.includes(Buffer.from(value))).toBe(false)
      expect(secondSecretBytes.includes(Buffer.from(value))).toBe(false)
    }
  })

  it('updates, deletes the active profile to an empty state, and removes its key', async () => {
    const root = makeTemporaryDirectory()
    const { database, provider } = makeProvider(root)
    let overview = provider.createProfile({
      name: '默认', baseUrl: 'https://models.example.test', model: 'reader', apiKey: 'secret'
    })
    const id = overview.profiles[0].id
    provider.activateProfile(id)
    overview = provider.updateProfile({
      id, name: '已改名', baseUrl: 'https://models.example.test/v1', model: 'reader-2', apiKey: 'rotated'
    })
    expect(overview.profiles[0]).toMatchObject({ name: '已改名', model: 'reader-2', isActive: true })
    expect(provider.getCredentials().apiKey).toBe('rotated')

    overview = provider.deleteProfile(id)
    expect(overview).toEqual({ profiles: [], activeProfileId: null })
    expect(() => provider.getCredentials()).toThrow(AppError)
    await expect(readFile(join(root, 'provider-keys', `${id}.bin`))).rejects.toMatchObject({ code: 'ENOENT' })
    database.close()
  })

  it('enforces safe URLs, unique names, the ten-profile limit, and key-required activation', () => {
    const root = makeTemporaryDirectory()
    const { database, provider } = makeProvider(root)
    expect(() => provider.createProfile({
      name: '不安全', baseUrl: 'http://models.example.test', model: 'reader', apiKey: 'key'
    })).toThrow(AppError)
    expect(() => provider.createProfile({
      name: '本机', baseUrl: 'http://127.0.0.1:11434', model: 'reader'
    })).not.toThrow()
    const local = provider.getOverview().profiles[0]
    expect(() => provider.activateProfile(local.id)).toThrow(AppError)
    expect(() => provider.createProfile({
      name: '本机', baseUrl: 'https://models.example.test', model: 'reader', apiKey: 'key'
    })).toThrow(AppError)
    for (let index = 2; index <= 10; index += 1) {
      provider.createProfile({
        name: `配置 ${index}`,
        baseUrl: 'https://models.example.test',
        model: `reader-${index}`,
        apiKey: 'key'
      })
    }
    expect(() => provider.createProfile({
      name: '第十一套', baseUrl: 'https://models.example.test', model: 'reader-11', apiKey: 'key'
    })).toThrow(AppError)
    database.close()
  })

  it('migrates the legacy encrypted key after the database migration', async () => {
    const root = makeTemporaryDirectory()
    const database = new AppDatabase(join(root, 'reader.sqlite3'))
    database.connection.prepare(
      `INSERT INTO provider_profiles(id, name, base_url, model, is_active, created_at, updated_at)
       VALUES ('legacy', '现有配置', 'https://legacy.example.test', 'legacy-model', 1, ?, ?)`
    ).run('2026-01-01', '2026-01-01')
    database.close()
    const encrypted = new XorKeyProtector().encrypt('legacy-key')
    new FileSecretStore(join(root, 'api-key.bin')).write(encrypted)

    const opened = makeProvider(root)
    expect(opened.provider.getCredentials().apiKey).toBe('legacy-key')
    await expect(readFile(join(root, 'api-key.bin'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(root, 'provider-keys', 'legacy.bin'))).resolves.toBeInstanceOf(Buffer)
    opened.database.close()
  })
})

describe('ProviderService model discovery', () => {
  it('uses a draft key, filters model ids, deduplicates, and sorts', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: 'z-model' },
        { id: 'a-model' },
        { id: 'a-model' },
        { id: '' },
        { nope: true }
      ]
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const root = makeTemporaryDirectory()
    const { database, provider } = makeProvider(root, fetchMock)

    await expect(provider.listModels({
      baseUrl: 'https://models.example.test/v1/chat/completions', apiKey: 'draft-key'
    })).resolves.toEqual({ models: ['a-model', 'z-model'], truncated: false })
    expect(fetchMock).toHaveBeenCalledWith('https://models.example.test/v1/models', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer draft-key' })
    }))
    database.close()
  })

  it('uses the selected profile key and rejects invalid or empty model lists', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'saved-model' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
    const root = makeTemporaryDirectory()
    const { database, provider } = makeProvider(root, fetchMock)
    const profile = provider.createProfile({
      name: '已保存', baseUrl: 'https://models.example.test', model: 'saved-model', apiKey: 'saved-key'
    }).profiles[0]

    await expect(provider.listModels({ profileId: profile.id, baseUrl: profile.baseUrl }))
      .resolves.toEqual({ models: ['saved-model'], truncated: false })
    await expect(provider.listModels({ profileId: profile.id, baseUrl: profile.baseUrl }))
      .rejects.toMatchObject({ code: 'PROVIDER_MODELS_INVALID' })
    await expect(provider.listModels({ profileId: profile.id, baseUrl: profile.baseUrl }))
      .rejects.toMatchObject({ code: 'PROVIDER_MODELS_EMPTY' })
    database.close()
  })

  it('bounds, truncates, and safely reports interrupted model lists', async () => {
    const manyModels = Array.from({ length: 2_001 }, (_, index) => ({ id: `model-${String(index).padStart(4, '0')}` }))
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: manyModels }), { status: 200 }))
      .mockResolvedValueOnce(new Response('x'.repeat(2 * 1024 * 1024 + 1), { status: 200 }))
      .mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    const root = makeTemporaryDirectory()
    const { database, provider } = makeProvider(root, fetchMock)
    const input = { baseUrl: 'https://models.example.test', apiKey: 'draft-key' }

    const listed = await provider.listModels(input)
    expect(listed.models).toHaveLength(2_000)
    expect(listed.truncated).toBe(true)
    await expect(provider.listModels(input)).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
    await expect(provider.listModels(input)).rejects.toMatchObject({ code: 'PROVIDER_MODELS_TIMEOUT' })
    database.close()
  })
})
