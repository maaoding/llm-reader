import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
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
