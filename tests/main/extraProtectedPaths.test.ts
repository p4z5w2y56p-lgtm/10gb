import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BackendApp } from '../../src/main/backend'
import type { Cipher } from '../../src/main/store/secrets'
import type { AgentEvent } from '../../src/shared/types'
import { chunk, startFakeVertex, type FakeEntry, type FakeVertex } from '../helpers/fakeVertexServer'

const KEY = 'AIzaSy' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'
const xor: Cipher = {
  isAvailable: () => true,
  encrypt: (p) => Buffer.from(Buffer.from(p, 'utf8').map((b) => b ^ 0x5a)),
  decrypt: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString('utf8'),
}
const text = (t: string): FakeEntry => ({ chunks: [chunk([{ text: t }], {}, 'STOP')] })
const call = (name: string, args: Record<string, unknown>, id: string): FakeEntry => ({
  chunks: [chunk([{ functionCall: { name, args, id } }], {}, 'STOP')],
})
const waitFor = async (cond: () => boolean, ms = 5000) => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 15))
  }
}

let server: FakeVertex | undefined
let base: string | undefined
afterEach(async () => {
  await server?.close()
  if (base) await rm(base, { recursive: true, force: true })
  server = undefined
  base = undefined
})

async function setup(protect: boolean, script: (secretDir: string) => FakeEntry[]) {
  base = await realpath(await mkdtemp(join(tmpdir(), 'arc-extra-')))
  const projectDir = join(base, 'project')
  const secretDir = join(base, 'secret')
  await mkdir(projectDir, { recursive: true })
  await mkdir(secretDir, { recursive: true })
  await mkdir(join(base, 'home'), { recursive: true })
  await writeFile(join(secretDir, 's.txt'), 'TOP-SECRET-VALUE\n')
  server = await startFakeVertex(script(secretDir))
  const events: AgentEvent[] = []
  const app = new BackendApp({
    dataDir: join(base, 'data'),
    cipher: xor,
    home: join(base, 'home'),
    emit: (e) => events.push(e),
    vertexBaseUrl: server.baseUrl,
    vertexSleep: async () => {},
    trustContainer: true,
    ...(protect ? { extraProtectedPaths: [secretDir] } : {}),
  })
  await app.init()
  await app.saveSettings({ prompter: { mode: 'off' }, permissionMode: 'auto' })
  await app.setApiKey(KEY)
  await app.openProject(projectDir)
  return { app, events, secretDir }
}

const results = (events: AgentEvent[]) =>
  Object.fromEntries(events.filter((e): e is Extract<AgentEvent, { type: 'tool-result' }> => e.type === 'tool-result').map((e) => [e.id, e.result]))

describe('BackendDeps.extraProtectedPaths', () => {
  it('blocks Read and Bash cat until approved, and denies Write, for a protected directory', async () => {
    const { app, events, secretDir } = await setup(true, (d) => [
      call('Read', { file_path: join(d, 's.txt') }, 'r1'),
      call('Bash', { command: `cat ${join(d, 's.txt')}` }, 'b1'),
      call('Write', { file_path: join(d, 'w.txt'), content: 'pwn' }, 'w1'),
      text('done'),
    ])
    const turn = app.send('go')
    await waitFor(() => app.hasPendingApproval('r1'))
    app.resolveApproval('r1', { decision: 'deny' })
    await waitFor(() => app.hasPendingApproval('b1'))
    app.resolveApproval('b1', { decision: 'deny' })
    expect(await turn).toBe('done')
    const r = results(events)
    expect(JSON.stringify(r)).not.toContain('TOP-SECRET-VALUE')
    const verdicts = Object.fromEntries(
      events.filter((e): e is Extract<AgentEvent, { type: 'tool-call' }> => e.type === 'tool-call').map((e) => [e.call.id, e.verdict.verdict]),
    )
    expect(verdicts).toEqual({ r1: 'ask', b1: 'ask', w1: 'deny' })
    await expect(stat(join(secretDir, 'w.txt'))).rejects.toThrow()
    expect(await readFile(join(secretDir, 's.txt'), 'utf8')).toBe('TOP-SECRET-VALUE\n')
  })

  it('without the option the same Bash read runs unasked (the control)', async () => {
    const { app, events } = await setup(false, (d) => [call('Bash', { command: `cat ${join(d, 's.txt')}` }, 'b1'), text('done')])
    expect(await app.send('go')).toBe('done')
    expect(JSON.stringify(results(events))).toContain('TOP-SECRET-VALUE')
  })
})
