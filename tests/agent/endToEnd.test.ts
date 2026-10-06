import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BackendApp } from '../../src/main/backend'
import type { Cipher } from '../../src/main/store/secrets'
import { chunk, startFakeVertex, type FakeVertex } from '../helpers/fakeVertexServer'

const KEY = 'AIzaSy' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'
const xor: Cipher = {
  isAvailable: () => true,
  encrypt: (p) => Buffer.from(Buffer.from(p, 'utf8').map((b) => b ^ 0x5a)),
  decrypt: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString('utf8'),
}

let server: FakeVertex | undefined
let base: string | undefined
afterEach(async () => {
  await server?.close()
  if (base) await rm(base, { recursive: true, force: true })
})

async function allFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await allFiles(full)))
    else out.push(full)
  }
  return out
}

describe('end to end through the real Vertex client', () => {
  it('writes a file, and the API key never reaches the model or any file on disk', async () => {
    server = await startFakeVertex([
      { chunks: [chunk([{ functionCall: { name: 'Read', args: { file_path: '.env' }, id: 'r1' } }], {}, 'STOP')] },
      { chunks: [chunk([{ functionCall: { name: 'Write', args: { file_path: 'hello.txt', content: 'hi\n' }, id: 'w1' } }], {}, 'STOP')] },
      { chunks: [chunk([{ text: 'Wrote hello.txt.' }], {}, 'STOP')] },
    ])
    base = await realpath(await mkdtemp(join(tmpdir(), 'arc-e2e-')))
    const dataDir = join(base, 'data')
    const project = join(base, 'project')
    await mkdir(project, { recursive: true })
    await writeFile(join(project, '.env'), `GEMINI_LIKE_KEY=${KEY}\n`)

    const app = new BackendApp({
      dataDir,
      cipher: xor,
      home: join(base, 'home'),
      emit: () => undefined,
      vertexBaseUrl: server.baseUrl,
      vertexSleep: async () => {},
      sandboxAvailable: true,
    })
    await app.init()
    await app.saveSettings({ prompter: { mode: 'off' }, permissionMode: 'auto-edit' })
    await app.setApiKey(KEY)
    await app.openProject(project)
    expect(await app.send('read .env then create hello.txt')).toBe('done')

    expect(await readFile(join(project, 'hello.txt'), 'utf8')).toBe('hi\n')
    for (const r of server.requests) {
      expect(r.headers['x-goog-api-key']).toBe(KEY)
      expect(r.url).not.toContain(KEY)
      expect(JSON.stringify(r.body)).not.toContain(KEY)
    }
    expect(JSON.stringify(server.requests[1].body)).toContain('[REDACTED]')

    const files = await allFiles(dataDir)
    expect(files.some((f) => f.includes('audit'))).toBe(true)
    expect(files.some((f) => f.includes('sessions'))).toBe(true)
    for (const f of files) {
      expect((await readFile(f)).toString('latin1'), f).not.toContain(KEY)
    }
    await expect(stat(join(dataDir, 'settings.json'))).resolves.toBeTruthy()
  })
})
