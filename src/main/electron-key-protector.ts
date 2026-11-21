import { safeStorage } from 'electron'
import type { KeyProtector } from './provider-service'

export class ElectronKeyProtector implements KeyProtector {
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  encrypt(value: string): Uint8Array {
    return safeStorage.encryptString(value)
  }

  decrypt(value: Uint8Array): string {
    return safeStorage.decryptString(Buffer.from(value))
  }
}
