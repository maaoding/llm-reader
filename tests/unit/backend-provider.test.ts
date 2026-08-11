import { readFile, rm } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { AppError } from '../../src/main/errors'
import { ProviderService, type KeyProtector } from '../../src/main/provider-service'
import { FileSecretStore } from '../../src/main/secret-store'

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

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe('ProviderService secret storage', () => {
  it('keeps the API key out of SQLite and decrypts the separate ciphertext file', async () => {
    const root = makeTemporaryDirectory()
    const databasePath = join(root, 'reader.sqlite3')
    const secretPath = join(root, 'api-key.bin')
    const database = new AppDatabase(databasePath)
    const provider = new ProviderService(
      database,
      new XorKeyProtector(),
      new FileSecretStore(secretPath)
    )
    const apiKey = 'sk-super-secret-value'

    expect(
      provider.saveSettings({ baseUrl: 'https://models.example.test/v1', model: 'reader-model', apiKey })
    ).toEqual({
      baseUrl: 'https://models.example.test/v1',
      model: 'reader-model',
      hasApiKey: true
    })
    expect(provider.getCredentials()).toEqual({
      baseUrl: 'https://models.example.test/v1',
      model: 'reader-model',
      apiKey
    })
    provider.saveSettings({
      baseUrl: 'https://models.example.test/v1',
      model: 'reader-model',
      apiKey: 'sk-rotated-secret'
    })
    expect(provider.getCredentials().apiKey).toBe('sk-rotated-secret')
    const columns = database.connection.prepare('PRAGMA table_info(provider_settings)').all()
    expect(columns.map((column) => column.name)).toEqual(['singleton', 'base_url', 'model'])
    database.close()

    const databaseBytes = await readFile(databasePath)
    const secretBytes = await readFile(secretPath)
    expect(databaseBytes.includes(Buffer.from(apiKey))).toBe(false)
    expect(databaseBytes.includes(Buffer.from('sk-rotated-secret'))).toBe(false)
    expect(secretBytes.includes(Buffer.from(apiKey))).toBe(false)
    expect(secretBytes.includes(Buffer.from('sk-rotated-secret'))).toBe(false)
  })

  it('rejects plaintext HTTP for non-loopback providers', () => {
    const root = makeTemporaryDirectory()
    const database = new AppDatabase(join(root, 'reader.sqlite3'))
    const provider = new ProviderService(
      database,
      new XorKeyProtector(),
      new FileSecretStore(join(root, 'api-key.bin'))
    )

    expect(() =>
      provider.saveSettings({ baseUrl: 'http://models.example.test', model: 'reader-model', apiKey: 'key' })
    ).toThrow(AppError)
    expect(() =>
      provider.saveSettings({ baseUrl: 'http://127.0.0.1:11434', model: 'reader-model', apiKey: 'key' })
    ).not.toThrow()
    database.close()
  })
})
