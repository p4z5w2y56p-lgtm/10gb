import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuditLog } from '../../src/main/store/audit'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'arc-audit-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const entry = { tool: 'Bash', args: { command: 'ls' }, verdict: 'allow' as const, reason: 'read-only', approvedBy: 'readonly' as const }

describe('AuditLog', () => {
  it('appends one JSON line per record and reads them back in order', async () => {
    const log = new AuditLog(dir, 's1')
    await log.record({ ...entry, tool: 'Read' })
    await log.record({ ...entry, tool: 'Bash' })
    const lines = (await readFile(join(dir, 's1.jsonl'), 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    const read = await log.read()
    expect(read.map((e) => e.tool)).toEqual(['Read', 'Bash'])
    expect(new Date(read[0].ts).toString()).not.toBe('Invalid Date')
  })

  it('stores secrets redacted', async () => {
    const key = 'AIzaSy' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'
    const log = new AuditLog(dir, 's1', () => ['custom-secret-value'])
    await log.record({ ...entry, args: { command: `curl -H "x-key: ${key}" custom-secret-value` }, reason: `saw ${key}` })
    const raw = await readFile(join(dir, 's1.jsonl'), 'utf8')
    expect(raw).not.toContain(key)
    expect(raw).not.toContain('custom-secret-value')
    expect(raw).toContain('[REDACTED]')
  })

  it('truncates serialized args to 500 characters', async () => {
    const log = new AuditLog(dir, 's1')
    await log.record({ ...entry, args: { command: 'x'.repeat(5000) } })
    const [e] = await log.read()
    expect(typeof e.args).toBe('string')
    expect((e.args as string).length).toBeLessThanOrEqual(520)
    expect(e.args as string).toContain('…')
  })

  it('keeps order under concurrent records', async () => {
    const log = new AuditLog(dir, 's1')
    await Promise.all(Array.from({ length: 20 }, (_, i) => log.record({ ...entry, tool: `T${i}` })))
    expect((await log.read()).map((e) => e.tool)).toEqual(Array.from({ length: 20 }, (_, i) => `T${i}`))
  })

  it('reads an empty log as []', async () => {
    expect(await new AuditLog(dir, 'none').read()).toEqual([])
  })
})
