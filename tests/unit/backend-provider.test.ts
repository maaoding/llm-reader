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
const databases: AppDatabase[] = []

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
  databases.push(database)
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
  vi.useRealTimers()
  for (const database of databases.splice(0)) if (database.connection.isOpen) database.close()
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('provider capability probes', () => {
  const configuration = { baseUrl: 'https://fixture.example/v1', model: 'fixture', apiKey: 'fixture-only' }
  it.each(['<html>Sign in</html>', '{}', '{"error":{"message":"private upstream error"}}', '{"choices":[{"message":{"content":"   "}}]}'])('rejects a successful HTTP response without usable text: %s', async (body) => {
    const { provider } = makeProvider(makeTemporaryDirectory(), vi.fn<typeof fetch>(async () => new Response(body)))
    const result = await provider.testConfiguration(configuration)
    expect(result.ok).toBe(false)
    expect(result.message).not.toContain('private upstream error')
    expect(result.message).not.toContain('<html>')
  })

  it('checks actual text and requires a complete SSE response for the stream probe', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ choices: [{ message: { content: 'OK' } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: 'OK' } }] }))
      .mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\n', { headers: { 'content-type': 'text/event-stream' } }))
      .mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }))
    const { provider } = makeProvider(makeTemporaryDirectory(), fetcher)
    expect(await provider.testConfiguration(configuration)).toMatchObject({ ok: true, message: expect.stringContaining('文本测试通过') })
    expect(await provider.testConfiguration({ ...configuration, testMode: 'stream' })).toMatchObject({ ok: false, message: expect.stringContaining('未收到流式回复') })
    expect(await provider.testConfiguration({ ...configuration, testMode: 'stream' })).toMatchObject({ ok: false })
    expect(await provider.testConfiguration({ ...configuration, testMode: 'stream' })).toMatchObject({ ok: true, message: expect.stringContaining('流式测试通过') })
    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).stream)).toEqual([false, true, true, true])
  })

  it('times out and cancels a stalled body even when the transport ignores abort', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'application/json' } }))
    const { provider } = makeProvider(makeTemporaryDirectory(), fetcher)
    const pending = provider.testConfiguration({ ...configuration, timeoutMs: 1_000 })
    await vi.advanceTimersByTimeAsync(1_001)
    expect(await pending).toMatchObject({ ok: false, message: expect.stringContaining('超时') })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('does not accept a stream containing an error after text, even with a done marker', async () => {
    const stream = 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: {"error":{"message":"private upstream detail"}}\n\ndata: [DONE]\n\n'
    const { provider } = makeProvider(makeTemporaryDirectory(), vi.fn<typeof fetch>(async () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } })))
    const result = await provider.testConfiguration({ ...configuration, testMode: 'stream' })
    expect(result.ok).toBe(false)
    expect(result.message).not.toContain('private upstream detail')
  })
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
      protocol: 'openai', customHeaders: {},
      compatibility: 'auto',
      baseUrl: 'https://first.example.test/v1',
      model: 'first-model',
      apiKey: firstKey
    })
    provider.activateProfile(second.id)
    expect(provider.getCredentials().apiKey).toBe(secondKey)

    const columns = database.connection.prepare('PRAGMA table_info(provider_profiles)').all()
    expect(columns.map((column) => column.name)).toEqual([
      'id', 'name', 'base_url', 'model', 'is_active', 'created_at', 'updated_at', 'compatibility', 'protocol', 'request_json', 'headers_secret'
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
