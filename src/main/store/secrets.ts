import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { CLOUD_SECRET_NAMES, type CloudSecretName } from '../../shared/cloud'
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

/** Named secrets for the cloud (worker token, GitHub token). Kept apart from the Vertex key. */
export interface SecretVault {
  setSecret(name: CloudSecretName, value: string): Promise<void>
  getSecret(name: CloudSecretName): Promise<string | null>
  hasSecret(name: CloudSecretName): Promise<boolean>
  clearSecret(name: CloudSecretName): Promise<void>
}

function checkName(name: string): asserts name is CloudSecretName {
  if (!(CLOUD_SECRET_NAMES as readonly string[]).includes(name)) throw new Error(`Unknown secret: ${String(name)}`)
}

/** Holds everything in memory and writes nothing: the terminal harness and the cloud worker. */
export class MemoryKeyStore implements KeyStore, SecretVault {
  private key: string | null = null
  private readonly named = new Map<CloudSecretName, string>()

  async setApiKey(key: string): Promise<void> {
    const trimmed = key.trim()
    if (!trimmed) throw new Error('The API key is empty')
    this.key = trimmed
  }
  async getApiKey(): Promise<string | null> {
    return this.key
  }
  async hasApiKey(): Promise<boolean> {
    return this.key !== null
  }
  async clear(): Promise<void> {
    this.key = null
  }
  async setSecret(name: CloudSecretName, value: string): Promise<void> {
    checkName(name)
    const trimmed = value.trim()
    if (!trimmed) throw new Error('The value is empty')
    this.named.set(name, trimmed)
  }
  async getSecret(name: CloudSecretName): Promise<string | null> {
    checkName(name)
    return this.named.get(name) ?? null
  }
  async hasSecret(name: CloudSecretName): Promise<boolean> {
    return (await this.getSecret(name)) !== null
  }
  async clearSecret(name: CloudSecretName): Promise<void> {
    checkName(name)
    this.named.delete(name)
  }
}

export class SecretStore implements KeyStore, SecretVault {
  private readonly dir: string
  private readonly file: string

  constructor(
    dir: string,
    private readonly cipher: Cipher,
  ) {
    this.dir = dir
    this.file = join(dir, 'api-key.bin')
  }

  private secretFile(name: CloudSecretName): string {
    checkName(name)
    return join(this.dir, `secret-${name}.bin`)
  }

  async setSecret(name: CloudSecretName, value: string): Promise<void> {
    const file = this.secretFile(name)
    const trimmed = value.trim()
    if (!trimmed) throw new Error('The value is empty')
    if (!this.cipher.isAvailable()) {
      throw new Error('Secure storage is not available on this machine, so the secret was not saved')
    }
    await atomicWrite(file, this.cipher.encrypt(trimmed), 0o600)
  }

  async getSecret(name: CloudSecretName): Promise<string | null> {
    const file = this.secretFile(name)
    try {
      const value = this.cipher.decrypt(await readFile(file)).trim()
      return value || null
    } catch {
      return null
    }
  }

  async hasSecret(name: CloudSecretName): Promise<boolean> {
    return (await this.getSecret(name)) !== null
  }

  async clearSecret(name: CloudSecretName): Promise<void> {
    await rm(this.secretFile(name), { force: true })
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
