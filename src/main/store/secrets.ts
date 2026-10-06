import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWrite } from './fsutil'

/** Encrypts the API key at rest. Production uses Electron's safeStorage (macOS Keychain). */
export interface Cipher {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(blob: Buffer): string
}

/** Where the API key lives. The app uses the encrypted SecretStore; the terminal harness keeps it in memory. */
export interface KeyStore {
  setApiKey(key: string): Promise<void>
  getApiKey(): Promise<string | null>
  hasApiKey(): Promise<boolean>
  clear(): Promise<void>
}

export class SecretStore implements KeyStore {
  private readonly file: string

  constructor(
    dir: string,
    private readonly cipher: Cipher,
  ) {
    this.file = join(dir, 'api-key.bin')
  }

  async setApiKey(key: string): Promise<void> {
    const trimmed = key.trim()
    if (!trimmed) throw new Error('The API key is empty')
    if (!this.cipher.isAvailable()) {
      throw new Error('Secure storage is not available on this machine, so the key was not saved')
    }
    await atomicWrite(this.file, this.cipher.encrypt(trimmed), 0o600)
  }

  async getApiKey(): Promise<string | null> {
    try {
      const blob = await readFile(this.file)
      const key = this.cipher.decrypt(blob).trim()
      return key || null
    } catch {
      return null
    }
  }

  async hasApiKey(): Promise<boolean> {
    return (await this.getApiKey()) !== null
  }

  async clear(): Promise<void> {
    await rm(this.file, { force: true })
  }
}
