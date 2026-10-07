import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryKeyStore, SecretStore, type Cipher } from '../../src/main/store/secrets'

const xor = (available = true): Cipher => ({
  isAvailable: () => available,
  encrypt: (plain) => Buffer.from(Buffer.from(plain, 'utf8').map((b) => b ^ 0x5a)),
  decrypt: (blob) => Buffer.from(blob.map((b) => b ^ 0x5a)).toString('utf8'),
})

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'arc-vault-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('SecretStore named secrets (cloud)', () => {
  it('keeps the cloud token and the GitHub token apart from the Vertex key', async () => {
    const s = new SecretStore(dir, xor())
    await s.setApiKey('vertex-key-1')
    await s.setSecret('cloud-token', '  worker-token  ')
    await s.setSecret('github-token', 'ghp_example')
    expect(await s.getSecret('cloud-token')).toBe('worker-token')
    expect(await s.getSecret('github-token')).toBe('ghp_example')
    expect(await s.getApiKey()).toBe('vertex-key-1')
    expect(await s.hasSecret('cloud-token')).toBe(true)
  })

  it('clearing one secret leaves the others, and clear() only removes the Vertex key', async () => {
    const s = new SecretStore(dir, xor())
    await s.setApiKey('vertex-key-1')
    await s.setSecret('cloud-token', 'a')
    await s.setSecret('github-token', 'b')
    await s.clearSecret('cloud-token')
    expect(await s.hasSecret('cloud-token')).toBe(false)
    expect(await s.hasSecret('github-token')).toBe(true)
    await s.clear()
    expect(await s.hasApiKey()).toBe(false)
    expect(await s.hasSecret('github-token')).toBe(true)
  })

  it('never writes a secret to disk in plain text, and survives a reload', async () => {
    await new SecretStore(dir, xor()).setSecret('github-token', 'ghp_PlainTextCheck')
    for (const f of await readdir(dir)) expect((await readFile(join(dir, f))).toString('latin1')).not.toContain('ghp_PlainTextCheck')
    expect(await new SecretStore(dir, xor()).getSecret('github-token')).toBe('ghp_PlainTextCheck')
  })

  it('refuses empty values and unknown names, and refuses to save without secure storage', async () => {
    const s = new SecretStore(dir, xor())
    await expect(s.setSecret('cloud-token', '   ')).rejects.toThrow(/empty/i)
    await expect(s.setSecret('../api-key' as never, 'x')).rejects.toThrow(/unknown/i)
    await expect(new SecretStore(dir, xor(false)).setSecret('cloud-token', 'x')).rejects.toThrow(/secure storage/i)
    expect(await s.hasSecret('cloud-token')).toBe(false)
  })
})

describe('MemoryKeyStore', () => {
  it('holds the key and named secrets in memory only', async () => {
    const m = new MemoryKeyStore()
    expect(await m.hasApiKey()).toBe(false)
    await m.setApiKey(' k ')
    await m.setSecret('github-token', ' t ')
    expect(await m.getApiKey()).toBe('k')
    expect(await m.getSecret('github-token')).toBe('t')
    await m.clear()
    expect(await m.hasApiKey()).toBe(false)
    expect(await m.hasSecret('github-token')).toBe(true)
    await m.clearSecret('github-token')
    expect(await m.getSecret('github-token')).toBeNull()
  })
})
