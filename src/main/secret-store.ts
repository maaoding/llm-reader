import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { copy } from '@shared/copy'
import { AppError } from './errors'

const MAGIC = Buffer.from('LLMRKEY1', 'ascii')
const MAX_SECRET_BYTES = 64 * 1024

export interface SecretStore {
  has(): boolean
  read(): Uint8Array | null
  write(ciphertext: Uint8Array): void
}

export class FileSecretStore implements SecretStore {
  constructor(private readonly path: string) {
    if (!isAbsolute(path)) throw new Error('Secret path must be absolute')
  }

  has(): boolean {
    return existsSync(this.path)
  }

  read(): Uint8Array | null {
    if (!this.has()) return null
    let value: Buffer
    try {
      value = readFileSync(this.path)
    } catch (error) {
      throw new AppError('KEY_READ_FAILED', copy('error.keyReadFailed'), false, { cause: error })
    }
    if (
      value.length <= MAGIC.length ||
      value.length > MAX_SECRET_BYTES ||
      !value.subarray(0, MAGIC.length).equals(MAGIC)
    ) {
      throw new AppError('KEY_READ_FAILED', copy('error.keyCipherInvalid'))
    }
    return Uint8Array.from(value.subarray(MAGIC.length))
  }

  write(ciphertext: Uint8Array): void {
    if (ciphertext.byteLength === 0 || ciphertext.byteLength > MAX_SECRET_BYTES - MAGIC.length) {
      throw new AppError('KEY_WRITE_FAILED', copy('error.keyCipherSize'))
    }
    mkdirSync(dirname(this.path), { recursive: true })
    const temporaryPath = `${this.path}.${process.pid}.${Date.now()}.tmp`
    try {
      writeFileSync(temporaryPath, Buffer.concat([MAGIC, Buffer.from(ciphertext)]), {
        flag: 'wx',
        mode: 0o600
      })
      renameSync(temporaryPath, this.path)
    } catch (error) {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
      throw new AppError('KEY_WRITE_FAILED', copy('error.keyWriteFailed'), false, { cause: error })
    }
  }
}

const PROFILE_ID_PATTERN = /^[\w-]{1,128}$/u
const PENDING_SUFFIX = '.pending-delete'

export class ProfileSecretStore {
  constructor(
    private readonly directory: string,
    private readonly legacyPath: string
  ) {
    if (!isAbsolute(directory) || !isAbsolute(legacyPath)) {
      throw new Error('Profile secret paths must be absolute')
    }
  }

  private profilePath(profileId: string): string {
    if (!PROFILE_ID_PATTERN.test(profileId)) throw new Error('Invalid provider profile id')
    return join(this.directory, `${profileId}.bin`)
  }

  private pendingPath(profileId: string): string {
    return `${this.profilePath(profileId)}${PENDING_SUFFIX}`
  }

  private store(profileId: string): FileSecretStore {
    return new FileSecretStore(this.profilePath(profileId))
  }

  reconcile(validProfileIds: ReadonlySet<string>): void {
    mkdirSync(this.directory, { recursive: true })
    for (const entry of readdirSync(this.directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(PENDING_SUFFIX)) continue
      const profileId = entry.name.slice(0, -`${'.bin'}${PENDING_SUFFIX}`.length)
      if (!PROFILE_ID_PATTERN.test(profileId)) continue
      const pendingPath = this.pendingPath(profileId)
      const profilePath = this.profilePath(profileId)
      if (validProfileIds.has(profileId) && !existsSync(profilePath)) {
        renameSync(pendingPath, profilePath)
      } else {
        unlinkSync(pendingPath)
      }
    }
    if (validProfileIds.has('legacy')) this.migrateLegacy('legacy')
  }

  private migrateLegacy(profileId: string): void {
    if (profileId !== 'legacy' || !existsSync(this.legacyPath)) return
    const target = this.store(profileId)
    if (!target.has()) {
      const ciphertext = new FileSecretStore(this.legacyPath).read()
      if (!ciphertext) return
      target.write(ciphertext)
      const verified = target.read()
      if (!verified || !Buffer.from(verified).equals(Buffer.from(ciphertext))) {
        throw new AppError('KEY_WRITE_FAILED', copy('error.keyWriteFailed'))
      }
    }
    unlinkSync(this.legacyPath)
  }

  has(profileId: string): boolean {
    return this.store(profileId).has() || (profileId === 'legacy' && existsSync(this.legacyPath))
  }

  read(profileId: string): Uint8Array | null {
    const target = this.store(profileId)
    if (target.has()) return target.read()
    if (profileId === 'legacy' && existsSync(this.legacyPath)) {
      return new FileSecretStore(this.legacyPath).read()
    }
    return null
  }

  write(profileId: string, ciphertext: Uint8Array): void {
    this.store(profileId).write(ciphertext)
    if (profileId === 'legacy' && existsSync(this.legacyPath)) unlinkSync(this.legacyPath)
  }

  prepareDelete(profileId: string): boolean {
    const targetPath = this.profilePath(profileId)
    const sourcePath = existsSync(targetPath)
      ? targetPath
      : profileId === 'legacy' && existsSync(this.legacyPath)
        ? this.legacyPath
        : null
    if (!sourcePath) return false
    const pendingPath = this.pendingPath(profileId)
    if (existsSync(pendingPath)) unlinkSync(pendingPath)
    mkdirSync(this.directory, { recursive: true })
    renameSync(sourcePath, pendingPath)
    return true
  }

  commitDelete(profileId: string): void {
    const pendingPath = this.pendingPath(profileId)
    if (existsSync(pendingPath)) unlinkSync(pendingPath)
  }

  rollbackDelete(profileId: string): void {
    const pendingPath = this.pendingPath(profileId)
    if (!existsSync(pendingPath)) return
    const targetPath = this.profilePath(profileId)
    if (existsSync(targetPath)) {
      unlinkSync(pendingPath)
    } else {
      renameSync(pendingPath, targetPath)
    }
  }
}
