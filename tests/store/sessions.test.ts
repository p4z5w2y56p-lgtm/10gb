import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionStore } from '../../src/main/store/sessions'

let dir: string
let clock: number
const now = () => new Date(clock++ * 1000)
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'arc-sessions-'))
  clock = 1_700_000_000
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const user = (text: string) => ({ role: 'user', parts: [{ text }] })
const model = (text: string) => ({ role: 'model', parts: [{ text }] })

describe('SessionStore', () => {
  it('appends contents and loads them back in order with an auto title', async () => {
    const store = new SessionStore(dir, now)
    const h = store.create('/work/a')
    await h.append(user('Fix the login bug please'))
    await h.append(model('On it.'))
    const { meta, history } = await store.load(h.id)
    expect(history).toEqual([user('Fix the login bug please'), model('On it.')])
    expect(meta.title).toBe('Fix the login bug please')
    expect(meta.projectRoot).toBe('/work/a')
  })

  it('cuts the auto title to 60 characters', async () => {
    const store = new SessionStore(dir, now)
    const h = store.create('/work/a')
    await h.append(user('x'.repeat(200)))
    expect((await store.load(h.id)).meta.title).toHaveLength(60)
  })

  it('setTitle overrides the title', async () => {
    const store = new SessionStore(dir, now)
    const h = store.create('/work/a')
    await h.append(user('hello'))
    await h.setTitle('Login work')
    expect((await store.load(h.id)).meta.title).toBe('Login work')
  })

  it('lists only the project sessions, newest first, and skips empty ones', async () => {
    const store = new SessionStore(dir, now)
    const a1 = store.create('/work/a')
    await a1.append(user('first'))
    const b1 = store.create('/work/b')
    await b1.append(user('other project'))
    const a2 = store.create('/work/a')
    await a2.append(user('second'))
    store.create('/work/a') // never written to
    const list = await store.list('/work/a')
    expect(list.map((m) => m.title)).toEqual(['second', 'first'])
  })

  it('reopening an existing id appends instead of overwriting', async () => {
    const store = new SessionStore(dir, now)
    const h = store.create('/work/a')
    await h.append(user('one'))
    const again = await new SessionStore(dir, now).open(h.id)
    await again.append(model('two'))
    expect((await store.load(h.id)).history).toEqual([user('one'), model('two')])
  })

  it('rejects ids that could escape the sessions directory', async () => {
    const store = new SessionStore(dir, now)
    await expect(store.load('../../etc/passwd')).rejects.toThrow(/invalid session id/i)
    await expect(store.open('a/b')).rejects.toThrow(/invalid session id/i)
  })

  it('fails to load an unknown id', async () => {
    await expect(new SessionStore(dir, now).load('deadbeef-abc-123')).rejects.toThrow()
  })

  it('ignores corrupt lines', async () => {
    const store = new SessionStore(dir, now)
    const h = store.create('/work/a')
    await h.append(user('ok'))
    const { appendFile } = await import('node:fs/promises')
    const file = join(dir, h.id.split('-')[0], `${h.id}.jsonl`)
    await appendFile(file, '{ broken\n')
    await h.append(model('still fine'))
    expect((await store.load(h.id)).history).toHaveLength(2)
  })
})
