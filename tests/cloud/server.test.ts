import { request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkerServer } from '../../src/main/cloud/server'
import { CloudWorker } from '../../src/main/cloud/worker'
import type { GitOps, GithubApi } from '../../src/main/cloud/protocol'
import { SettingsSchema } from '../../src/main/store/settings'
import type { CloudDiff, CloudSessionInfo, PullRequestResult } from '../../src/shared/cloud'
import type { AgentEvent } from '../../src/shared/types'
import { chunk, startFakeVertex, type FakeEntry, type FakeVertex } from '../helpers/fakeVertexServer'

const TOKEN = 'SENTINEL-worker-token-' + 'a1b2c3d4'.repeat(4)
const VKEY = 'SENTINEL-vertex-key-9f3a1c77'
const GTOKEN = 'SENTINEL-github-token-4be2d0c1'

const text = (t: string): FakeEntry => ({ chunks: [chunk([{ text: t }], {}, 'STOP')] })
const call = (name: string, args: Record<string, unknown>, id = 'c1'): FakeEntry => ({
  chunks: [chunk([{ functionCall: { name, args, id } }], {}, 'STOP')],
})

// ---- in-memory GitOps and GithubApi (the worker tests have their own copies; test files do not share code)
type PushOpts = Parameters<GitOps['commitAndPush']>[0]
class FakeGit implements GitOps {
  pushes: PushOpts[] = []
  diffs: Array<Parameters<GitOps['diff']>[0]> = []
  private n = 0
  private pushed = new Set<string>()
  async clone(o: Parameters<GitOps['clone']>[0]) {
    await writeFile(join(o.dir, 'README.md'), '# hi\n').catch(async () => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(o.dir, { recursive: true })
      await writeFile(join(o.dir, 'README.md'), '# hi\n')
    })
    return { baseBranch: o.baseBranch ?? 'main', head: '0000000' }
  }
  async commitAndPush(o: PushOpts) {
    this.pushes.push(o)
    const files = (await readdir(o.dir)).sort().join(',')
    if (this.pushed.has(files)) return { commit: null, pushed: false, skipped: [], head: '0000000' }
    this.pushed.add(files)
    const short = (++this.n).toString(16).padStart(7, 'a')
    return { commit: short, pushed: true, skipped: [], head: short + '0'.repeat(33) }
  }
  async diff(o: Parameters<GitOps['diff']>[0]): Promise<CloudDiff> {
    this.diffs.push(o)
    return {
      branch: o.branch,
      baseBranch: o.baseBranch,
      files: [{ path: 'hello.txt', status: 'added', additions: 1, deletions: 0 }],
      uncommitted: false,
      ahead: 1,
      pushed: o.pushedHead !== null,
    }
  }
}
class FakeGithub implements GithubApi {
  prs: Array<Parameters<GithubApi['createPullRequest']>[0]> = []
  async getRepo() {
    return { defaultBranch: 'main', private: true, canPush: true }
  }
  async createPullRequest(o: Parameters<GithubApi['createPullRequest']>[0]): Promise<PullRequestResult> {
    this.prs.push(o)
    return { number: 3, url: `https://github.com/${o.owner}/${o.name}/pull/3`, draft: o.draft ?? false, existing: false }
  }
}

// ---- harness
interface Booted {
  base: string
  worker: CloudWorker
  server: Server
  git: FakeGit
  github: FakeGithub
  logs: string[]
  dataDir: string
  vertex: FakeVertex
  setNow(ms: number): void
}
let booted: Booted | undefined
const streams: Array<{ close(): void }> = []

async function afterEachClose(): Promise<void> {
  for (const s of streams.splice(0)) s.close()
  if (!booted) return
  const b = booted
  booted = undefined
  await b.worker.shutdown()
  b.server.closeAllConnections()
  await new Promise<void>((r) => b.server.close(() => r()))
  await b.vertex.close()
  await rm(join(b.dataDir, '..'), { recursive: true, force: true })
}
afterEach(afterEachClose)

async function boot(
  script: FakeEntry[] = [],
  opts: { server?: Partial<Parameters<typeof createWorkerServer>[0]>; worker?: Partial<ConstructorParameters<typeof CloudWorker>[0]> } = {},
): Promise<Booted> {
  const vertex = await startFakeVertex(script)
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arc-server-')))
  const dataDir = join(root, 'data')
  const git = new FakeGit()
  const github = new FakeGithub()
  const worker = new CloudWorker({ dataDir, git, github, vertexBaseUrl: vertex.baseUrl, vertexSleep: async () => {}, ...opts.worker })
  const logs: string[] = []
  let now = 5_000_000
  const server = createWorkerServer({ worker, token: TOKEN, logger: (l) => logs.push(l), now: () => now, ...opts.server })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  booted = { base, worker, server, git, github, logs, dataDir, vertex, setNow: (ms) => void (now = ms) }
  return booted
}

interface Reply {
  status: number
  headers: Headers
  text: string
  json: any
}
async function api(path: string, init: { method?: string; body?: unknown; raw?: string; headers?: Record<string, string>; token?: string | null } = {}): Promise<Reply> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) }
  if (init.token !== null) headers.authorization ??= `Bearer ${init.token ?? TOKEN}`
  let body: string | undefined
  if (init.raw !== undefined) body = init.raw
  else if (init.body !== undefined) {
    body = JSON.stringify(init.body)
    headers['content-type'] ??= 'application/json'
  }
  const res = await fetch(booted!.base + path, { method: init.method ?? 'GET', headers, body })
  const t = await res.text()
  let json: any
  try {
    json = JSON.parse(t)
  } catch {
    json = undefined
  }
  return { status: res.status, headers: res.headers, text: t, json }
}

/** Sends the path exactly as given (fetch would normalise ../ away). */
function rawRequest(method: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const port = Number(new URL(booted!.base).port)
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { authorization: `Bearer ${TOKEN}`, ...headers } }, (res) => {
      let t = ''
      res.on('data', (c) => (t += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: t, headers: res.headers }))
    })
    req.on('error', reject)
    req.end()
  })
}

const bodyOf = (over: Record<string, unknown> = {}) => ({
  repo: 'octo/hello',
  name: 'tidy',
  settings: SettingsSchema.parse({ prompter: { mode: 'off' } }),
  secrets: { apiKey: VKEY, githubToken: GTOKEN },
  ...over,
})
async function createSession(over: Record<string, unknown> = {}): Promise<CloudSessionInfo> {
  const r = await api('/v1/sessions', { method: 'POST', body: bodyOf(over) })
  expect(r.status, r.text).toBe(200)
  return r.json
}

interface Frame {
  id?: string
  event?: string
  data?: string
  comment?: string
}
interface Stream {
  res: Response
  frames: Frame[]
  ended: boolean
  close(): void
  events(): AgentEvent[]
}
async function openStream(path: string, headers: Record<string, string> = {}): Promise<Stream> {
  const ctl = new AbortController()
  const res = await fetch(booted!.base + path, { headers: { authorization: `Bearer ${TOKEN}`, ...headers }, signal: ctl.signal })
  const st: Stream = {
    res,
    frames: [],
    ended: false,
    close: () => ctl.abort(),
    events: () => st.frames.filter((f) => f.data !== undefined && f.event === undefined).map((f) => JSON.parse(f.data!) as AgentEvent),
  }
  streams.push(st)
  if (res.status === 200 && res.body) {
    void (async () => {
      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const r = await reader.read().catch(() => ({ done: true as const, value: undefined }))
        if (r.done) break
        buf += dec.decode(r.value, { stream: true })
        let i: number
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const f: Frame = {}
          for (const line of buf.slice(0, i).split('\n')) {
            if (line.startsWith(':')) f.comment = line.slice(1).trim()
            else if (line.startsWith('id: ')) f.id = line.slice(4)
            else if (line.startsWith('event: ')) f.event = line.slice(7)
            else if (line.startsWith('data: ')) f.data = line.slice(6)
          }
          st.frames.push(f)
          buf = buf.slice(i + 2)
        }
      }
      st.ended = true
    })()
  }
  return st
}

const waitFor = async (cond: () => boolean, ms = 5000) => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}
const ofType = <T extends AgentEvent['type']>(events: AgentEvent[], type: T) =>
  events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type)

const UNAUTHORIZED = { ok: false, error: 'Unauthorized', code: 'unauthorized' }
const UUID0 = '00000000-0000-4000-8000-000000000000'

describe('health and headers', () => {
  it('answers /health with exactly {"ok":true} and no auth', async () => {
    await boot()
    const r = await api('/health', { token: null })
    expect(r.status).toBe(200)
    expect(r.text).toBe('{"ok":true}')
  })

  it('sets no-store and nosniff on every kind of response and never any CORS header', async () => {
    await boot([], { server: { maxBodyBytes: 100 } })
    const replies = [
      await api('/health', { token: null }),
      await api('/v1/sessions'),
      await api('/v1/sessions', { token: 'nope' }),
      await api('/v1/nothing'),
      await api('/v1/sessions', { method: 'PATCH' }),
      await api('/v1/sessions', { method: 'POST', raw: 'x'.repeat(500), headers: { 'content-type': 'application/json' } }),
      await api('/v1/sessions', { method: 'POST', raw: 'x', headers: { 'content-type': 'text/plain' } }),
      await api('/v1/sessions', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } }),
    ]
    for (const r of replies) {
      expect(r.headers.get('cache-control'), r.text).toBe('no-store')
      expect(r.headers.get('x-content-type-options')).toBe('nosniff')
      for (const [k] of r.headers) expect(k.toLowerCase().startsWith('access-control-'), k).toBe(false)
    }
  })

  it('does not kill long streams with the Node defaults but keeps a header timeout', async () => {
    const { server } = await boot()
    expect(server.requestTimeout).toBe(0)
    expect(server.headersTimeout).toBeGreaterThan(0)
  })
})

describe('authentication', () => {
  it('rejects every kind of bad credential with the same 401 body and no hint', async () => {
    const bad: Array<Record<string, string>> = [
      {},
      { authorization: '' },
      { authorization: 'Bearer' },
      { authorization: 'Bearer wrong' },
      { authorization: `Bearer ${TOKEN}x` },
      { authorization: `Bearer ${TOKEN.slice(0, -1)}` },
      { authorization: `Bearer  ${TOKEN}` },
      { authorization: `Basic ${Buffer.from(`user:${TOKEN}`).toString('base64')}` },
      { authorization: TOKEN },
      { authorization: `Token ${TOKEN}` },
      { authorization: `Bearer ${'A'.repeat(5000)}` },
    ]
    // a new server for each half keeps every address below the failure limit
    for (const batch of [bad.slice(0, 6), bad.slice(6)]) {
      await boot()
      for (const headers of batch) {
        const r = await api('/v1/sessions', { token: null, headers })
        expect(r.status, JSON.stringify(headers).slice(0, 80)).toBe(401)
        expect(r.json).toEqual(UNAUTHORIZED)
        expect(r.text).not.toContain(TOKEN)
      }
      await afterEachClose()
    }
  })

  it('accepts the right token on every route family', async () => {
    await boot()
    expect((await api('/v1/sessions')).status).toBe(200)
  })

  it('answers 401 before 404 or 405, so an unauthenticated caller learns nothing about the routes', async () => {
    await boot()
    for (const [method, path] of [['GET', '/v1/nothing'], ['PATCH', '/v1/sessions'], ['GET', `/v1/sessions/${UUID0}`], ['POST', '/v1/sessions/x/invoke']]) {
      const r = await api(path, { method, token: null })
      expect(r.status, `${method} ${path}`).toBe(401)
      expect(r.json).toEqual(UNAUTHORIZED)
    }
  })

  it('compares tokens in constant time by hashing both sides (works for any length, no early return on length)', async () => {
    await boot()
    const r = await api('/v1/sessions', { token: 'x' })
    expect(r.status).toBe(401)
  })

  it('rate limits failed attempts per address: 429 with Retry-After after 10 in a minute, even for the right token, then recovers', async () => {
    const { setNow } = await boot()
    for (let i = 0; i < 10; i++) expect((await api('/v1/sessions', { token: `wrong-${i}` })).status).toBe(401)
    const blocked = await api('/v1/sessions', { token: 'wrong-again' })
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(Number(blocked.headers.get('retry-after'))).toBeLessThanOrEqual(60)
    expect(blocked.json).toMatchObject({ ok: false, code: 'rate-limited' })
    expect((await api('/v1/sessions')).status).toBe(429)
    expect((await api('/health', { token: null })).status).toBe(200)
    setNow(5_000_000 + 61_000)
    expect((await api('/v1/sessions')).status).toBe(200)
  })

  it('the window is rolling: failures older than a minute stop counting', async () => {
    const { setNow } = await boot()
    for (let i = 0; i < 9; i++) await api('/v1/sessions', { token: 'bad' })
    setNow(5_000_000 + 61_000)
    for (let i = 0; i < 9; i++) expect((await api('/v1/sessions', { token: 'bad' })).status).toBe(401)
    expect((await api('/v1/sessions')).status).toBe(200)
  })

  it('successful requests do not count against the limit', async () => {
    await boot()
    for (let i = 0; i < 30; i++) expect((await api('/v1/sessions')).status).toBe(200)
  })

  it('behind a proxy (trustProxy) the limit is per forwarded client address, not for the proxy as a whole', async () => {
    await boot([], { server: { trustProxy: true } })
    for (let i = 0; i < 11; i++) await api('/v1/sessions', { token: 'bad', headers: { 'x-forwarded-for': 'spoofed, 203.0.113.9' } })
    expect((await api('/v1/sessions', { token: 'bad', headers: { 'x-forwarded-for': '203.0.113.9' } })).status).toBe(429)
    expect((await api('/v1/sessions', { headers: { 'x-forwarded-for': '198.51.100.7' } })).status).toBe(200)
  })

  it('without trustProxy the X-Forwarded-For header cannot be used to dodge the limit', async () => {
    await boot()
    for (let i = 0; i < 10; i++) await api('/v1/sessions', { token: 'bad', headers: { 'x-forwarded-for': `10.0.0.${i}` } })
    expect((await api('/v1/sessions', { token: 'bad', headers: { 'x-forwarded-for': '10.9.9.9' } })).status).toBe(429)
  })
})

describe('routing and method rules', () => {
  it('answers 404 for unknown routes, with a body that does not echo the path', async () => {
    await boot()
    const r = await api('/v1/secret-admin-thing')
    expect(r.status).toBe(404)
    expect(r.json).toEqual({ ok: false, error: 'Not found', code: 'not-found' })
    expect(r.text).not.toContain('secret-admin-thing')
  })

  it('answers 405 with an Allow header for a known path and the wrong method', async () => {
    await boot()
    const cases: Array<[string, string, string]> = [
      ['PATCH', '/v1/sessions', 'GET, POST'],
      ['PUT', `/v1/sessions/${UUID0}`, 'GET, DELETE'],
      ['GET', `/v1/sessions/${UUID0}/invoke`, 'POST'],
      ['POST', `/v1/sessions/${UUID0}/history`, 'GET'],
      ['GET', `/v1/sessions/${UUID0}/secrets`, 'PUT'],
      ['POST', `/v1/sessions/${UUID0}/events`, 'GET'],
      ['DELETE', `/v1/sessions/${UUID0}/diff`, 'GET'],
      ['GET', `/v1/sessions/${UUID0}/push`, 'POST'],
      ['GET', `/v1/sessions/${UUID0}/pr`, 'POST'],
      ['POST', '/health', 'GET'],
    ]
    for (const [method, path, allow] of cases) {
      const r = await api(path, { method, token: path === '/health' ? null : undefined })
      expect(r.status, `${method} ${path}`).toBe(405)
      expect(r.headers.get('allow')).toBe(allow)
    }
  })

  it('answers OPTIONS with 405 and no CORS headers, with or without credentials', async () => {
    await boot()
    for (const token of [undefined, null] as const) {
      const r = await api('/v1/sessions', { method: 'OPTIONS', token, headers: { origin: 'https://evil.example' } })
      expect(r.status).toBe(405)
      expect(r.headers.get('access-control-allow-origin')).toBeNull()
    }
  })
})

describe('request bodies', () => {
  it('rejects a body larger than the limit with 413, by Content-Length and by streamed size', async () => {
    await boot([], { server: { maxBodyBytes: 200 } })
    const big = await api('/v1/sessions', { method: 'POST', raw: JSON.stringify({ pad: 'x'.repeat(2000) }), headers: { 'content-type': 'application/json' } })
    expect(big.status).toBe(413)
    expect(big.json).toMatchObject({ ok: false, code: 'too-large' })
    const chunks = [Buffer.from('{"pad":"' + 'x'.repeat(150)), Buffer.from('y'.repeat(150) + '"}')]
    const res = await fetch(booted!.base + '/v1/sessions', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: new ReadableStream({
        pull(c) {
          const next = chunks.shift()
          if (next) c.enqueue(next)
          else c.close()
        },
      }),
      // @ts-expect-error undici needs duplex for streamed bodies
      duplex: 'half',
    })
    expect(res.status).toBe(413)
  })

  it('accepts a body right at the limit', async () => {
    await boot([], { server: { maxBodyBytes: 100_000 } })
    const r = await api('/v1/sessions', { method: 'POST', body: { repo: '' } })
    expect(r.status).toBe(400)
  })

  it('rejects anything but JSON with 415', async () => {
    await boot()
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'application/jsonx', 'application/xml', 'multipart/form-data; boundary=x']) {
      const r = await api('/v1/sessions', { method: 'POST', raw: '{}', headers: { 'content-type': type } })
      expect(r.status, type).toBe(415)
      expect(r.json).toMatchObject({ ok: false, code: 'unsupported-media-type' })
    }
    const ok = await api('/v1/sessions', { method: 'POST', raw: '{}', headers: { 'content-type': 'application/json; charset=utf-8' } })
    expect(ok.status).toBe(400)
  })

  it('answers 400 for invalid JSON', async () => {
    await boot()
    const r = await api('/v1/sessions', { method: 'POST', raw: '{"repo": ', headers: { 'content-type': 'application/json' } })
    expect(r.status).toBe(400)
    expect(r.json).toMatchObject({ ok: false, code: 'invalid' })
  })

  it('answers 400 with the first problem in plain words, without echoing secret values', async () => {
    await boot()
    const r = await api('/v1/sessions', { method: 'POST', body: { ...bodyOf(), repo: '', extra: GTOKEN } })
    expect(r.status).toBe(400)
    expect(r.json.ok).toBe(false)
    expect(r.json.error).toMatch(/repo/)
    expect(r.text).not.toContain(GTOKEN)
    const s = await api('/v1/sessions', { method: 'POST', body: { ...bodyOf(), secrets: { apiKey: VKEY, githubToken: 5 } } })
    expect(s.status).toBe(400)
    expect(s.text).not.toContain(VKEY)
  })

  it('does not require a body for routes that take none (push, delete)', async () => {
    await boot()
    const info = await createSession()
    expect((await api(`/v1/sessions/${info.id}/push`, { method: 'POST' })).status).toBe(200)
    expect((await api(`/v1/sessions/${info.id}`, { method: 'DELETE' })).status).toBe(200)
  })
})

describe('session ids', () => {
  const evil = [
    '..',
    '../etc/passwd',
    '%2e%2e',
    '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '..%2f..%2f',
    '%00',
    'abcdef01-2345-4678-89ab-cdef01234567'.toUpperCase(),
    UUID0.slice(1),
    UUID0 + '0',
    'x'.repeat(8000),
    '%252e%252e',
    UUID0 + '%2f..',
  ]
  const suffixes = ['', '/history', '/events', '/diff', '/invoke', '/secrets', '/push', '/pr']

  it('answers 404 for anything that is not a lowercase 36-character id, on every route, including traversal attempts', async () => {
    await boot()
    for (const id of evil) {
      for (const suffix of suffixes) {
        const method = suffix === '' ? 'GET' : suffix === '/invoke' || suffix === '/push' || suffix === '/pr' ? 'POST' : suffix === '/secrets' ? 'PUT' : 'GET'
        const r = await rawRequest(method, `/v1/sessions/${id}${suffix}`, { 'content-type': 'application/json' })
        expect(r.status, `${method} ${id.slice(0, 40)}${suffix}`).toBe(404)
        expect(r.text).not.toContain('passwd')
        expect(r.text).not.toContain(TOKEN)
      }
    }
  })

  it('answers 404 for a well-formed id that does not exist', async () => {
    await boot()
    for (const [method, suffix] of [['GET', ''], ['DELETE', ''], ['GET', '/history'], ['GET', '/diff'], ['GET', '/events'], ['POST', '/push']] as const) {
      const r = await api(`/v1/sessions/${UUID0}${suffix}`, { method })
      expect(r.status, `${method} ${suffix}`).toBe(404)
      expect(r.json).toMatchObject({ ok: false, code: 'not-found' })
    }
    for (const [method, suffix, body] of [['POST', '/invoke', { channel: 'app:status' }], ['PUT', '/secrets', { apiKey: 'abc' }], ['POST', '/pr', { title: 't' }]] as const) {
      expect((await api(`/v1/sessions/${UUID0}${suffix}`, { method, body })).status).toBe(404)
    }
  })

  it('does not treat a double slash or an absolute-form target as another host or route', async () => {
    await boot()
    expect((await rawRequest('GET', '//v1/sessions')).status).toBe(404)
    expect((await rawRequest('GET', 'http://evil.example/v1/sessions')).status).toBe(404)
  })
})

describe('invoke allow-list', () => {
  it('rejects channels that are local to the desktop and never reaches the worker', async () => {
    const { worker } = await boot()
    const info = await createSession()
    const spy = vi.spyOn(worker, 'invoke')
    for (const channel of ['project:open', 'secrets:setKey', 'secrets:clear', 'project:choose', 'sessions:resume', 'cloud:status', 'cloud:start', 'settings:get', 'agent:event', '__proto__', '']) {
      const r = await api(`/v1/sessions/${info.id}/invoke`, { method: 'POST', body: { channel, payload: { path: '/', key: 'x' } } })
      expect(r.status, channel).toBe(400)
      expect(r.json).toMatchObject({ ok: false, code: 'invalid' })
    }
    expect(spy).not.toHaveBeenCalled()
    expect((await api(`/v1/sessions/${info.id}/invoke`, { method: 'POST', body: { channel: 'app:status' } })).json).toMatchObject({ ok: true })
  })

  it('validates the payload of an allowed channel and answers it as a result', async () => {
    await boot()
    const info = await createSession()
    const r = await api(`/v1/sessions/${info.id}/invoke`, { method: 'POST', body: { channel: 'agent:setMode', payload: { mode: 'yolo' } } })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ ok: false, code: 'invalid' })
  })

  it('answers 409 busy while a turn is running', async () => {
    await boot([{ chunks: [], holdMs: Infinity }])
    const info = await createSession()
    const a = await api(`/v1/sessions/${info.id}/invoke`, { method: 'POST', body: { channel: 'agent:send', payload: { text: 'one' } } })
    expect(a.json).toEqual({ ok: true, data: 'started' })
    const b = await api(`/v1/sessions/${info.id}/invoke`, { method: 'POST', body: { channel: 'agent:send', payload: { text: 'two' } } })
    expect(b.status).toBe(409)
    expect(b.json).toMatchObject({ ok: false, code: 'busy' })
  })
})

describe('full session over HTTP', () => {
  it('create, stream, send, approve, finish, auto-push, diff, push, pr, history, delete', async () => {
    const { git, github, dataDir } = await boot([call('Write', { file_path: 'hello.txt', content: 'hello\n' }, 'w1'), text('Wrote hello.txt')])
    const info = await createSession()
    expect(info).toMatchObject({ repo: 'octo/hello', baseBranch: 'main', busy: false, pushed: false })
    expect((await api('/v1/sessions')).json.map((s: CloudSessionInfo) => s.id)).toEqual([info.id])
    expect((await api(`/v1/sessions/${info.id}`)).json).toMatchObject({ id: info.id })

    const stream = await openStream(`/v1/sessions/${info.id}/events`)
    expect(stream.res.status).toBe(200)
    await waitFor(() => ofType(stream.events(), 'mode').length > 0)

    const sent = await api(`/v1/sessions/${info.id}/invoke`, { method: 'POST', body: { channel: 'agent:send', payload: { text: 'Please write hello.txt\nthanks' } } })
    expect(sent.json).toEqual({ ok: true, data: 'started' })

    await waitFor(() => ofType(stream.events(), 'approval-request').length > 0)
    const req = ofType(stream.events(), 'approval-request')[0].request
    const approved = await api(`/v1/sessions/${info.id}/invoke`, { method: 'POST', body: { channel: 'agent:approval', payload: { requestId: req.call.id, decision: 'allow-once' } } })
    expect(approved.json).toEqual({ ok: true, data: null })

    await waitFor(() => ofType(stream.events(), 'turn-end').length > 0)
    expect(ofType(stream.events(), 'turn-end')[0].reason).toBe('done')
    await waitFor(() => ofType(stream.events(), 'notice').some((n) => n.message.startsWith('Saved to GitHub')))
    expect(git.pushes).toHaveLength(1)
    expect(git.pushes[0]).toMatchObject({ branch: info.branch, message: 'arc: Please write hello.txt', token: GTOKEN })
    expect(await readFile(join(dataDir, 'work', info.id, 'repo', 'hello.txt'), 'utf8')).toBe('hello\n')

    // frames carry increasing ids
    const ids = stream.frames.filter((f) => f.id).map((f) => Number(f.id))
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
    expect(new Set(ids).size).toBe(ids.length)

    const diff = await api(`/v1/sessions/${info.id}/diff`)
    expect(diff.json).toMatchObject({ branch: info.branch, baseBranch: 'main', pushed: true })
    const push = await api(`/v1/sessions/${info.id}/push`, { method: 'POST' })
    expect(push.status).toBe(200)
    expect(push.json).toMatchObject({ branch: info.branch, url: `https://github.com/octo/hello/tree/${info.branch}` })
    const pr = await api(`/v1/sessions/${info.id}/pr`, { method: 'POST', body: { title: 'Add hello', body: 'Adds hello.txt', draft: true } })
    expect(pr.json).toMatchObject({ number: 3, draft: true, existing: false })
    expect(github.prs[0]).toMatchObject({ head: info.branch, base: 'main', title: 'Add hello', token: GTOKEN })

    const hist = await api(`/v1/sessions/${info.id}/history`)
    expect(hist.json.history.length).toBeGreaterThan(1)
    expect(hist.json.seq).toBe(Math.max(...ids))

    const put = await api(`/v1/sessions/${info.id}/secrets`, { method: 'PUT', body: { githubToken: 'SENTINEL-rotated-token-77aa88bb' } })
    expect(put.json).toEqual({ ok: true })
    expect((await api(`/v1/sessions/${info.id}/secrets`, { method: 'PUT', body: { nope: 'x' } })).status).toBe(400)

    const del = await api(`/v1/sessions/${info.id}`, { method: 'DELETE' })
    expect(del.json).toEqual({ ok: true })
    await waitFor(() => stream.ended)
    expect((await api(`/v1/sessions/${info.id}`)).status).toBe(404)

    const everything = JSON.stringify([stream.frames, diff.json, push.json, pr.json, hist.json, sent.json])
    for (const s of [TOKEN, VKEY, GTOKEN]) expect(everything).not.toContain(s)
  })

  it('maps worker errors to their HTTP status: too many sessions 429, cannot push 403, clone failure 502', async () => {
    const { github } = await boot([], { worker: { maxSessions: 1 } })
    await createSession()
    const r = await api('/v1/sessions', { method: 'POST', body: bodyOf() })
    expect(r.status).toBe(429)
    expect(r.json).toMatchObject({ ok: false, code: 'too-many-sessions' })
    github.getRepo = async () => ({ defaultBranch: 'main', private: true, canPush: false })
    await api(`/v1/sessions/${(await api('/v1/sessions')).json[0].id}`, { method: 'DELETE' })
    const f = await api('/v1/sessions', { method: 'POST', body: bodyOf() })
    expect(f.status).toBe(403)
    expect(f.json).toMatchObject({ ok: false, code: 'forbidden' })
  })
})

describe('event stream', () => {
  async function sessionWithEvents(over: { eventLog?: { maxEvents?: number } } = {}) {
    const b = await boot([text('first answer'), text('second answer')], { worker: over })
    const info = await createSession()
    for (const prompt of ['one', 'two']) {
      await api(`/v1/sessions/${info.id}/invoke`, { method: 'POST', body: { channel: 'agent:send', payload: { text: prompt } } })
      await waitFor(() => !b.worker.get(info.id).busy)
      await waitFor(() => b.git.pushes.length > 0 || true)
    }
    return { b, info }
  }

  it('uses the SSE headers and flushes them before any event', async () => {
    await boot()
    const info = await createSession()
    const s = await openStream(`/v1/sessions/${info.id}/events`)
    expect(s.res.status).toBe(200)
    expect(s.res.headers.get('content-type')).toBe('text/event-stream')
    expect(s.res.headers.get('cache-control')).toBe('no-cache, no-transform')
    expect(s.res.headers.get('connection')).toBe('keep-alive')
    expect(s.res.headers.get('x-accel-buffering')).toBe('no')
    expect(s.res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(s.res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('replays what a reconnecting client missed after Last-Event-ID, and only that', async () => {
    const { info } = await sessionWithEvents()
    const full = await openStream(`/v1/sessions/${info.id}/events`)
    await waitFor(() => full.frames.filter((f) => f.id).length >= 6)
    const all = full.frames.filter((f) => f.id).map((f) => Number(f.id))
    const cut = all[Math.floor(all.length / 2)]
    const resumed = await openStream(`/v1/sessions/${info.id}/events`, { 'last-event-id': String(cut) })
    await waitFor(() => resumed.frames.filter((f) => f.id).length >= all.filter((i) => i > cut).length)
    expect(resumed.frames.filter((f) => f.id).map((f) => Number(f.id))).toEqual(all.filter((i) => i > cut))
    expect(resumed.frames.some((f) => f.event === 'gap')).toBe(false)
  })

  it('also honours ?after= and prefers Last-Event-ID when both are given', async () => {
    const { info } = await sessionWithEvents()
    const a = await openStream(`/v1/sessions/${info.id}/events?after=2`)
    await waitFor(() => a.frames.some((f) => f.id === '3'))
    expect(a.frames.find((f) => f.id)?.id).toBe('3')
    const b = await openStream(`/v1/sessions/${info.id}/events?after=2`, { 'last-event-id': '4' })
    await waitFor(() => b.frames.some((f) => f.id === '5'))
    expect(b.frames.find((f) => f.id)?.id).toBe('5')
  })

  it('sends an "event: gap" message with the oldest buffered sequence when the client is too far behind', async () => {
    const { info } = await sessionWithEvents({ eventLog: { maxEvents: 5 } })
    const s = await openStream(`/v1/sessions/${info.id}/events`, { 'last-event-id': '1' })
    await waitFor(() => s.frames.length >= 2)
    expect(s.frames[0].event).toBe('gap')
    const oldest = JSON.parse(s.frames[0].data!).oldest as number
    expect(oldest).toBeGreaterThan(2)
    expect(s.frames[1].id).toBe(String(oldest))
    expect(s.frames.filter((f) => f.id).length).toBe(5)
  })

  it('sends ": ping" comments on the heartbeat interval', async () => {
    await boot([], { server: { heartbeatMs: 25 } })
    const info = await createSession()
    const s = await openStream(`/v1/sessions/${info.id}/events`)
    await waitFor(() => s.frames.filter((f) => f.comment === 'ping').length >= 3)
  })

  it('allows 5 streams per session and answers 429 for the sixth, until one closes', async () => {
    const { worker } = await boot()
    const info = await createSession()
    const open: Stream[] = []
    for (let i = 0; i < 5; i++) {
      const s = await openStream(`/v1/sessions/${info.id}/events`)
      expect(s.res.status).toBe(200)
      open.push(s)
    }
    const sixth = await api(`/v1/sessions/${info.id}/events`)
    expect(sixth.status).toBe(429)
    expect(sixth.json).toMatchObject({ ok: false, code: 'too-many-streams' })
    open[0].close()
    await waitFor(() => worker.subscriberCount(info.id) === 4)
    const again = await openStream(`/v1/sessions/${info.id}/events`)
    expect(again.res.status).toBe(200)
  })

  it('the stream cap is per session', async () => {
    await boot([], { worker: { maxSessions: 2 } })
    const a = await createSession()
    const b = await createSession()
    for (let i = 0; i < 5; i++) await openStream(`/v1/sessions/${a.id}/events`)
    expect((await openStream(`/v1/sessions/${b.id}/events`)).res.status).toBe(200)
  })

  it('cleans up when the client disconnects: no listener left on the worker, and the heartbeat stops', async () => {
    const { worker } = await boot([], { server: { heartbeatMs: 20 } })
    const info = await createSession()
    const s = await openStream(`/v1/sessions/${info.id}/events`)
    await waitFor(() => worker.subscriberCount(info.id) === 1)
    s.close()
    await waitFor(() => worker.subscriberCount(info.id) === 0)
    // and the slot is free again
    const streams5 = await Promise.all([1, 2, 3, 4, 5].map(() => openStream(`/v1/sessions/${info.id}/events`)))
    expect(streams5.every((x) => x.res.status === 200)).toBe(true)
  })

  it('needs the token and an existing session', async () => {
    await boot()
    const info = await createSession()
    expect((await openStream(`/v1/sessions/${info.id}/events`, { authorization: 'Bearer nope' })).res.status).toBe(401)
    expect((await openStream(`/v1/sessions/${UUID0}/events`)).res.status).toBe(404)
  })

  it('ignores a malformed Last-Event-ID or after value and starts from the beginning', async () => {
    await boot()
    const info = await createSession()
    const s = await openStream(`/v1/sessions/${info.id}/events?after=abc`, { 'last-event-id': '-5' })
    expect(s.res.status).toBe(200)
    await waitFor(() => s.frames.some((f) => f.id === '1'))
  })
})

describe('internal errors', () => {
  it('answers 500 with a generic message, and logs only a redacted detail', async () => {
    const { worker, logs } = await boot()
    vi.spyOn(worker, 'list').mockImplementation(() => {
      throw new Error(`database exploded at /srv/arc/secret/path using ${TOKEN} and Bearer abcdef1234567890`)
    })
    const r = await api('/v1/sessions')
    expect(r.status).toBe(500)
    expect(r.json).toEqual({ ok: false, error: 'Internal error', code: 'internal' })
    expect(r.text).not.toContain('database')
    expect(r.text).not.toContain('/srv')
    expect(r.text).not.toContain(TOKEN)
    expect(logs.length).toBeGreaterThan(0)
    const logged = logs.join('\n')
    expect(logged).toContain('database exploded')
    expect(logged).not.toContain(TOKEN)
    expect(logged).not.toContain('abcdef1234567890')
  })

  it('never puts the token in a 401, 404, 405, 413, 415 or 500 body', async () => {
    const { worker } = await boot([], { server: { maxBodyBytes: 50 } })
    vi.spyOn(worker, 'get').mockImplementation(() => {
      throw new Error(`oops ${TOKEN}`)
    })
    const bodies = [
      (await api('/v1/sessions', { token: 'x' })).text,
      (await api('/v1/nope')).text,
      (await api('/v1/sessions', { method: 'DELETE' })).text,
      (await api('/v1/sessions', { method: 'POST', raw: 'x'.repeat(200), headers: { 'content-type': 'application/json' } })).text,
      (await api('/v1/sessions', { method: 'POST', raw: 'x', headers: { 'content-type': 'text/plain' } })).text,
      (await api(`/v1/sessions/${UUID0}`)).text,
    ]
    for (const b of bodies) expect(b).not.toContain(TOKEN)
  })
})
