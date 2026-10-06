import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SecretStore, type Cipher } from '../../src/main/store/secrets'

const xorCipher = (available = true): Cipher => ({
  isAvailable: () => available,
  encrypt: (plain) => Buffer.from(Buffer.from(plain, 'utf8').map((b) => b ^ 0x5a)),
  decrypt: (blob) => Buffer.from(blob.map((b) => b ^ 0x5a)).toString('utf8'),
})

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'arc-secrets-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('SecretStore', () => {
  it('has no key at first', async () => {
    const s = new SecretStore(dir, xorCipher())
    expect(await s.hasApiKey()).toBe(false)
    expect(await s.getApiKey()).toBeNull()
  })

  it('stores the key trimmed and round-trips it', async () => {
    const s = new SecretStore(dir, xorCipher())
    await s.setApiKey('  AIzaSyExampleKey123  ')
    expect(await s.hasApiKey()).toBe(true)
    expect(await s.getApiKey()).toBe('AIzaSyExampleKey123')
    expect(await new SecretStore(dir, xorCipher()).getApiKey()).toBe('AIzaSyExampleKey123')
  })

  it('never writes the plaintext key to disk', async () => {
    const s = new SecretStore(dir, xorCipher())
    await s.setApiKey('AIzaSyExampleKey123')
    for (const f of await readdir(dir)) {
      expect((await readFile(join(dir, f))).toString('latin1')).not.toContain('AIzaSyExampleKey123')
    }
  })

  it('writes the file readable by the owner only', async () => {
    await new SecretStore(dir, xorCipher()).setApiKey('abcdefgh12345')
    const [file] = await readdir(dir)
    expect((await stat(join(dir, file))).mode & 0o777).toBe(0o600)
  })

  it('clear removes the key', async () => {
    const s = new SecretStore(dir, xorCipher())
    await s.setApiKey('abcdefgh12345')
    await s.clear()
    expect(await s.hasApiKey()).toBe(false)
  })

  it('rejects an empty or whitespace-only key', async () => {
    const s = new SecretStore(dir, xorCipher())
    await expect(s.setApiKey('')).rejects.toThrow()
    await expect(s.setApiKey('   ')).rejects.toThrow()
    expect(await s.hasApiKey()).toBe(false)
  })

  it('refuses to store anything when secure storage is unavailable', async () => {
    const s = new SecretStore(dir, xorCipher(false))
    await expect(s.setApiKey('abcdefgh12345')).rejects.toThrow(/secure storage/i)
    expect(await readdir(dir)).toEqual([])
  })

  it('treats an undecryptable blob as no key', async () => {
    const s = new SecretStore(dir, xorCipher())
    await s.setApiKey('abcdefgh12345')
    const broken: Cipher = { ...xorCipher(), decrypt: () => { throw new Error('bad blob') } }
    expect(await new SecretStore(dir, broken).hasApiKey()).toBe(false)
  })
})
