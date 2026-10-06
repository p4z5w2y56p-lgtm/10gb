import { safeStorage } from 'electron'
import type { Cipher } from './secrets'

/** Cipher backed by the OS keychain through Electron's safeStorage. Electron-only; not unit tested. */
export function electronCipher(): Cipher {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (blob) => safeStorage.decryptString(blob),
  }
}
