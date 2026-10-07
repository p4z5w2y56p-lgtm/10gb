import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoProjectError, NotReadyError, type BackendStatus } from '../../src/main/backend'
import { CloudClient, type AttachHandle, type AttachOptions } from '../../src/main/cloud/client'
import { CreateSessionBody, InvokeBody, PrBody, SecretsBody } from '../../src/main/cloud/protocol'
import { BackendRouter, type LocalBackend } from '../../src/main/cloud/router'
import { MemoryKeyStore } from '../../src/main/store/secrets'
import { SettingsSchema, type Settings, type SettingsPatch } from '../../src/main/store/settings'
import type { CloudDiff, CloudSessionInfo, PullRequestResult, PushResult } from '../../src/shared/cloud'
import type { AgentEvent } from '../../src/shared/types'

const CLOUD_TOKEN = 'cloudtok_' + 'q1W2e3R4t5Y6u7I8o9P0a1S2d3F4g5H6'
const NEW_CLOUD_TOKEN = 'cloudtok_' + 'Z9x8C7v6B5n4M3a2S1d0F9g8H7j6K5l4'
const GITHUB = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
const NEW_GITHUB = 'ghp_' + 'Z1y2X3w4V5u6T7s8R9q0P1o2N3m4L5k6J7i8'
const VERTEX = 'AIzaSy' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'
const NEW_VERTEX = 'AIzaSy' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J'
const ALL_SECRETS = [CLOUD_TOKEN, NEW_CLOUD_TOKEN, GITHUB, NEW_GITHUB, VERTEX, NEW_VERTEX]

// ------------------------------------------------------------------ fake worker

interface Req {
  method: string
  path: string
  headers: Record<string, string | string[] | undefined>
  raw: string
  body: unknown
}
interface WSession {
  info: CloudSessionInfo
  history: unknown[]
  seq: number
  log: Array<{ seq: number; event: AgentEvent }>
  streams: Set<ServerResponse>
  /** What /history reports besides the transcript. */
  pending: { approval?: unknown; question?: { id: string; question: string; options?: string[] } }
  inflight?: { text: string }
}

const DIFF = (info: CloudSessionInfo): CloudDiff => ({ branch: info.branch, baseBranch: info.baseBranch, files: [], uncommitted: false, ahead: 1, pushed: info.pushed })

class FakeWorker {
  url = ''
  token = CLOUD_TOKEN
  sessions = new Map<string, WSession>()
  reqs: Req[] = []
  invokeData = new Map<string, unknown>([['agent:send', 'started']])
  invokeFail = new Map<string, { error: string; code?: string }>()
  createFail: { status: number; error: string; code: string } | null = null
  /** Persistent forced status for the events route. */
  eventsStatus: number | null = null
  /** The next events connection that is behind this gets a gap message (once). */
  gapOldest: number | null = null
  /** The history route answers with this status (and no history) while set. */
  historyStatus: number | null = null
  private server = createServer((req, res) => void this.handle(req, res))
  private sockets = new Set<Socket>()

  async start(): Promise<this> {
    this.server.on('connection', (s) => {
      this.sockets.add(s)
      s.on('close', () => this.sockets.delete(s))
    })
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r))
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
    return this
  }
  async close(): Promise<void> {
    for (const s of this.sockets) s.destroy()
    await new Promise<void>((r) => this.server.close(() => r()))
  }

  seed(partial: Partial<CloudSessionInfo> = {}, seq = 0): WSession {
    const id = partial.id ?? randomUUID()
    const s: WSession = {
      info: {
        id,
        repo: 'octo/demo',
        branch: 'arc/demo-ab12',
        baseBranch: 'main',
        busy: false,
        mode: 'ask',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastActiveAt: '2026-01-01T00:00:00.000Z',
        pushed: false,
        ...partial,
      },
      history: [{ role: 'user', parts: [{ text: 'earlier' }] }],
      seq,
      log: [],
      streams: new Set(),
      pending: {},
    }
    this.sessions.set(id, s)
    return s
  }
  emit(id: string, event: AgentEvent): void {
    const s = this.sessions.get(id)!
    const seq = ++s.seq
    s.log.push({ seq, event })
    for (const res of s.streams) res.write(`id: ${seq}\ndata: ${JSON.stringify(event)}\n\n`)
  }
  dropStreams(id: string): void {
    const s = this.sessions.get(id)
    for (const res of s?.streams ?? []) res.end()
    s?.streams.clear()
  }
  streamCount(id: string): number {
    return this.sessions.get(id)?.streams.size ?? 0
  }
  hits(method: string, pattern: RegExp): Req[] {
    return this.reqs.filter((r) => r.method === method && pattern.test(r.path))
  }
  invokes(channel: string): Req[] {
    return this.reqs.filter((r) => r.path.endsWith('/invoke') && (r.body as { channel?: string })?.channel === channel)
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const raw = Buffer.concat(chunks).toString('utf8')
    let body: unknown
    try {
      body = raw ? JSON.parse(raw) : undefined
    } catch {
      body = undefined
    }
    const url = new URL(req.url ?? '/', 'http://x')
    const path = url.pathname
    const method = req.method ?? ''
    this.reqs.push({ method, path, headers: req.headers, raw: raw + ' ' + (req.url ?? ''), body })

    if (path === '/health') return this.json(res, 200, { ok: true })
    if (req.headers['authorization'] !== `Bearer ${this.token}`) return this.json(res, 401, { ok: false, error: 'unauthorized', code: 'unauthorized' })

    if (path === '/v1/sessions' && method === 'GET') return this.json(res, 200, [...this.sessions.values()].map((s) => s.info))
    if (path === '/v1/sessions' && method === 'POST') {
      if (this.createFail) return this.json(res, this.createFail.status, { ok: false, error: this.createFail.error, code: this.createFail.code })
      const parsed = CreateSessionBody.safeParse(body)
      if (!parsed.success) return this.json(res, 400, { ok: false, error: 'invalid create body: ' + parsed.error.issues[0]?.message, code: 'invalid' })
      const s = this.seed({ repo: parsed.data.repo, baseBranch: parsed.data.baseBranch ?? 'main', branch: `arc/${parsed.data.name || 'session'}-ab12` })
      return this.json(res, 200, s.info)
    }
    const m = /^\/v1\/sessions\/([^/]+)(?:\/(\w+))?$/.exec(path)
    if (!m) return this.json(res, 404, { ok: false, error: 'Not found' })
    const s = this.sessions.get(decodeURIComponent(m[1]))
    if (!s) return this.json(res, 404, { ok: false, error: 'No such session', code: 'not-found' })
    const sub = m[2]

    if (!sub && method === 'GET') return this.json(res, 200, s.info)
    if (!sub && method === 'DELETE') {
      this.dropStreams(s.info.id)
      this.sessions.delete(s.info.id)
      return this.json(res, 200, { ok: true })
    }
    if (sub === 'history') {
      if (this.historyStatus !== null) return this.json(res, this.historyStatus, { ok: false, error: 'history failed', code: 'forced' })
      return this.json(res, 200, { history: s.history, seq: s.seq, pending: s.pending, ...(s.inflight ? { inflight: s.inflight } : {}) })
    }
    if (sub === 'diff') return this.json(res, 200, DIFF(s.info))
    if (sub === 'push') {
      s.info.pushed = true
      const out: PushResult = { branch: s.info.branch, commit: 'abc1234', pushed: true, skipped: [], url: `https://github.com/${s.info.repo}/tree/${s.info.branch}` }
      return this.json(res, 200, out)
    }
    if (sub === 'pr') {
      const parsed = PrBody.safeParse(body)
      if (!parsed.success) return this.json(res, 400, { ok: false, error: 'invalid pr body', code: 'invalid' })
      const out: PullRequestResult = { number: 7, url: `https://github.com/${s.info.repo}/pull/7`, draft: parsed.data.draft ?? false, existing: false }
      return this.json(res, 200, out)
    }
    if (sub === 'secrets') {
      if (!SecretsBody.safeParse(body).success) return this.json(res, 400, { ok: false, error: 'invalid secrets body', code: 'invalid' })
      return this.json(res, 200, { ok: true })
    }
    if (sub === 'invoke') {
      const parsed = InvokeBody.safeParse(body)
      if (!parsed.success) return this.json(res, 400, { ok: false, error: 'invalid invoke body', code: 'invalid' })
      const fail = this.invokeFail.get(parsed.data.channel)
      if (fail) return this.json(res, 200, { ok: false, ...fail })
      if (parsed.data.channel === 'agent:send') {
        s.info.busy = true
        s.info.lastActiveAt = '2026-01-02T00:00:00.000Z'
      }
      return this.json(res, 200, { ok: true, data: this.invokeData.get(parsed.data.channel) ?? null })
    }
    if (sub === 'events') {
      if (this.eventsStatus !== null) return this.json(res, this.eventsStatus, { ok: false, error: 'forced' })
      const after = Number(req.headers['last-event-id'] ?? url.searchParams.get('after') ?? 0)
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      res.flushHeaders()
      if (this.gapOldest !== null && after < this.gapOldest) {
        res.write(`event: gap\ndata: ${JSON.stringify({ oldest: this.gapOldest })}\n\n`)
        this.gapOldest = null
        return
      }
      for (const e of s.log) if (e.seq > after) res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e.event)}\n\n`)
      s.streams.add(res)
      res.on('close', () => s.streams.delete(res))
      return
    }
    return this.json(res, 404, { ok: false, error: 'Not found' })
  }
}

// ------------------------------------------------------------------ fake local backend

function fakeLocal(settings: Settings) {
  const l = {
    settings,
    busy: false,
    hasApiKey: true,
    status: vi.fn(
      async (): Promise<BackendStatus> => ({
        ready: l.hasApiKey,
        hasApiKey: l.hasApiKey,
        ...(l.hasApiKey ? {} : { reason: 'no-api-key' as const }),
        hasProject: false,
        projectRoot: null,
        busy: l.busy,
        mode: null,
        sessionId: null,
      }),
    ),
    getSettings: vi.fn(async () => ({ settings: l.settings, status: await l.status() })),
    saveSettings: vi.fn(async (patch: SettingsPatch) => {
      l.settings = SettingsSchema.parse({
        ...l.settings,
        ...patch,
        prompter: { ...l.settings.prompter, ...patch.prompter },
        cloud: { ...l.settings.cloud, ...patch.cloud },
      })
      return { settings: l.settings, status: await l.status() }
    }),
    send: vi.fn(async (_t: string) => 'done' as const),
    stop: vi.fn(),
    resolveApproval: vi.fn(),
    resolveAnswer: vi.fn(),
    setMode: vi.fn(),
    undo: vi.fn(async () => ({ restored: ['local'], removed: [] })),
    getChanges: vi.fn(async () => ({ files: ['local.ts'], canUndo: true })),
    spark: vi.fn(async () => []),
    autopilot: vi.fn(async (_on: boolean) => ({ settings: l.settings, status: await l.status() })),
    listRules: vi.fn(async () => []),
    removeRule: vi.fn(async () => undefined),
    readAudit: vi.fn(async () => []),
    listSessions: vi.fn(async () => []),
    openProject: vi.fn(async (path: string) => ({ root: path, sessionId: 'local-1', history: [] })),
    resumeSession: vi.fn(async (_id: string) => ({ root: '/p', sessionId: 'local-2', history: [] })),
    setApiKey: vi.fn(async (_k: string) => l.status()),
    clearApiKey: vi.fn(async () => {
      l.hasApiKey = false
      return l.status()
    }),
    testConnection: vi.fn(async () => [{ label: 'Coder', ok: true, message: 'ok' }]),
    getHistory: vi.fn(() => []),
  }
  return l
}

// ------------------------------------------------------------------ harness

const workers: FakeWorker[] = []
const routers: BackendRouter[] = []
afterEach(async () => {
  for (const r of routers.splice(0)) await r.dispose()
  await Promise.all(workers.splice(0).map((w) => w.close()))
})

async function until(cond: () => boolean, label = 'condition', ms = 3000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

async function untilAsync(cond: () => Promise<boolean>, label = 'condition', ms = 3000): Promise<void> {
  const start = Date.now()
  while (!(await cond())) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

interface Options {
  url?: string
  cloudToken?: string | null
  githubToken?: string | null
  apiKey?: string | null
  autoPush?: boolean
  checkToken?: (token: string) => Promise<{ login: string }>
  omitSettingsOf?: boolean
  /** Sees the stream options the router hands to the client. */
  onAttach?: (o: AttachOptions) => void
}

class SpyClient extends CloudClient {
  constructor(
    opts: ConstructorParameters<typeof CloudClient>[0],
    private readonly spy?: (o: AttachOptions) => void,
  ) {
    super(opts)
  }
  override attach(id: string, o: AttachOptions): AttachHandle {
    this.spy?.(o)
    return super.attach(id, o)
  }
}

async function setup(o: Options = {}) {
  const worker = await new FakeWorker().start()
  workers.push(worker)
  const vault = new MemoryKeyStore()
  if (o.apiKey !== null) await vault.setApiKey(o.apiKey ?? VERTEX)
  if (o.cloudToken !== null) await vault.setSecret('cloud-token', o.cloudToken ?? CLOUD_TOKEN)
  if (o.githubToken !== null) await vault.setSecret('github-token', o.githubToken ?? GITHUB)
  const local = fakeLocal(SettingsSchema.parse({ cloud: { workerUrl: o.url ?? worker.url, autoPush: o.autoPush ?? true } }))
  const emitted: AgentEvent[] = []
  const sleeps: number[] = []
  const checkToken = vi.fn(o.checkToken ?? (async () => ({ login: 'octocat' })))
  const router = new BackendRouter({
    local: local as unknown as LocalBackend,
    vault,
    keys: vault,
    ...(o.omitSettingsOf ? {} : { settingsOf: () => local.settings }),
    emit: (e) => emitted.push(e),
    clientFactory: (url, token) =>
      new SpyClient(
        {
          baseUrl: url,
          token,
          sleep: async (ms) => {
            sleeps.push(ms)
            await new Promise((r) => setTimeout(r, 2))
          },
        },
        o.onAttach,
      ),
    github: { checkToken },
  })
  routers.push(router)
  const notices = () => emitted.filter((e): e is Extract<AgentEvent, { type: 'notice' }> => e.type === 'notice')
  return { worker, vault, local, router, emitted, notices, sleeps, checkToken }
}
type Harness = Awaited<ReturnType<typeof setup>>

/** Seed a session on the worker and attach the router to it. */
async function attached(h: Harness, partial: Partial<CloudSessionInfo> = {}, seq = 0) {
  const s = h.worker.seed(partial, seq)
  await h.router.cloudAttach(s.info.id)
  await until(() => h.worker.streamCount(s.info.id) === 1, 'the stream to open')
  return s
}

const START = { repo: 'octo/demo', baseBranch: 'develop', name: 'fix-login' }

// ------------------------------------------------------------------ detached

describe('BackendRouter while no cloud session is attached', () => {
  it('sends every session call to the local backend and never touches the worker', async () => {
    const h = await setup()
    const r = h.router
    await expect(r.send('hi')).resolves.toBe('done')
    await r.stop()
    await r.resolveApproval('a1', { decision: 'allow-once' })
    await r.resolveAnswer('q1', 'yes')
    await r.setMode('auto')
    await expect(r.undo()).resolves.toEqual({ restored: ['local'], removed: [] })
    await expect(r.getChanges()).resolves.toEqual({ files: ['local.ts'], canUndo: true })
    await r.spark()
    await r.autopilot(true)
    await r.listRules()
    await r.removeRule({ tool: 'Bash', prefix: 'ls' })
    await r.readAudit()
    await r.listSessions()
    await r.openProject('/work', undefined)
    await r.resumeSession('s-1')
    await r.testConnection()
    expect(h.local.send).toHaveBeenCalledWith('hi')
    expect(h.local.stop).toHaveBeenCalled()
    expect(h.local.resolveApproval).toHaveBeenCalledWith('a1', { decision: 'allow-once' })
    expect(h.local.resolveAnswer).toHaveBeenCalledWith('q1', 'yes')
    expect(h.local.setMode).toHaveBeenCalledWith('auto')
    expect(h.local.autopilot).toHaveBeenCalledWith(true)
    expect(h.local.removeRule).toHaveBeenCalledWith({ tool: 'Bash', prefix: 'ls' })
    expect(h.local.openProject).toHaveBeenCalledWith('/work', undefined)
    expect(h.local.resumeSession).toHaveBeenCalledWith('s-1')
    expect(h.worker.reqs).toHaveLength(0)
  })

  it('reports the local status unchanged', async () => {
    const h = await setup()
    expect(await h.router.status()).toEqual(await h.local.status())
  })

  it('returns settings together with the router status', async () => {
    const h = await setup()
    const got = await h.router.getSettings()
    expect(got.settings).toBe(h.local.settings)
    expect(got.status).toEqual(await h.local.status())
  })

  it('works when no settingsOf is given, reading settings through the local backend', async () => {
    const h = await setup({ omitSettingsOf: true })
    expect((await h.router.cloudStatus()).workerUrl).toBe(h.worker.url)
  })

  it('saves settings locally only and does not call the worker', async () => {
    const h = await setup()
    await h.router.saveSettings({ model: 'm-2' })
    expect(h.local.saveSettings).toHaveBeenCalledWith({ model: 'm-2' })
    expect(h.worker.reqs).toHaveLength(0)
  })

  it('stores a Vertex key locally only and does not call the worker', async () => {
    const h = await setup()
    await h.router.setApiKey(NEW_VERTEX)
    expect(h.local.setApiKey).toHaveBeenCalledWith(NEW_VERTEX)
    expect(h.worker.reqs).toHaveLength(0)
  })
})

// ------------------------------------------------------------------ cloudStatus and secrets

describe('BackendRouter.cloudStatus and secrets', () => {
  it('reflects what is saved', async () => {
    const h = await setup({ cloudToken: null, githubToken: null, url: '', autoPush: false })
    expect(await h.router.cloudStatus()).toEqual({
      configured: false,
      workerUrl: '',
      hasCloudToken: false,
      hasGithubToken: false,
      autoPush: false,
      active: null,
    })
  })

  it('is configured only with both a worker URL and an access token', async () => {
    const noToken = await setup({ cloudToken: null })
    expect((await noToken.router.cloudStatus()).configured).toBe(false)
    const noUrl = await setup({ url: '' })
    expect((await noUrl.router.cloudStatus()).configured).toBe(false)
    const both = await setup()
    expect(await both.router.cloudStatus()).toMatchObject({ configured: true, hasCloudToken: true, hasGithubToken: true, autoPush: true })
  })

  it('saves and clears a secret in the vault and returns the new status', async () => {
    const h = await setup({ cloudToken: null })
    const after = await h.router.cloudSetSecret('cloud-token', CLOUD_TOKEN)
    expect(after).toMatchObject({ hasCloudToken: true, configured: true })
    expect(await h.vault.getSecret('cloud-token')).toBe(CLOUD_TOKEN)
    const cleared = await h.router.cloudClearSecret('cloud-token')
    expect(cleared).toMatchObject({ hasCloudToken: false, configured: false })
    expect(await h.vault.hasSecret('cloud-token')).toBe(false)
  })

  it('does not call the worker when a secret changes while detached', async () => {
    const h = await setup()
    await h.router.cloudSetSecret('github-token', NEW_GITHUB)
    expect(h.worker.reqs).toHaveLength(0)
  })

  it('pushes a new GitHub token to the attached session', async () => {
    const h = await setup()
    const s = await attached(h)
    await h.router.cloudSetSecret('github-token', NEW_GITHUB)
    const puts = h.worker.hits('PUT', /\/secrets$/)
    expect(puts).toHaveLength(1)
    expect(puts[0].path).toBe(`/v1/sessions/${s.info.id}/secrets`)
    expect(puts[0].body).toEqual({ githubToken: NEW_GITHUB })
  })

  it('keeps working after the access token is replaced while attached', async () => {
    const h = await setup()
    const s = await attached(h)
    h.worker.token = NEW_CLOUD_TOKEN
    await h.router.cloudSetSecret('cloud-token', NEW_CLOUD_TOKEN)
    await until(() => h.worker.reqs.some((r) => r.headers['authorization'] === `Bearer ${NEW_CLOUD_TOKEN}` && r.path.endsWith('/events')), 'a stream with the new token')
    await expect(h.router.send('hello')).resolves.toBe('started')
    expect(h.worker.invokes('agent:send').at(-1)?.headers['authorization']).toBe(`Bearer ${NEW_CLOUD_TOKEN}`)
    await until(() => h.worker.streamCount(s.info.id) === 1, 'only the new stream to remain')
  })

  it('leaves the session when the access token is removed while attached', async () => {
    const h = await setup()
    const s = await attached(h)
    await h.router.cloudClearSecret('cloud-token')
    expect((await h.router.status()).cloud ?? null).toBeNull()
    await until(() => h.worker.streamCount(s.info.id) === 0, 'the stream to close')
    expect(h.notices().some((n) => /access token/i.test(n.message))).toBe(true)
  })
})

// ------------------------------------------------------------------ cloudTest

describe('BackendRouter.cloudTest', () => {
  it('reports three passing steps and shows the GitHub login', async () => {
    const h = await setup()
    const results = await h.router.cloudTest()
    expect(results).toHaveLength(3)
    expect(results.map((r) => r.ok)).toEqual([true, true, true])
    expect(results[2].message).toContain('octocat')
    expect(h.checkToken).toHaveBeenCalledWith(GITHUB)
    expect(h.worker.hits('GET', /^\/health$/)[0].headers['authorization']).toBeUndefined()
    expect(h.worker.hits('GET', /^\/v1\/sessions$/)[0].headers['authorization']).toBe(`Bearer ${CLOUD_TOKEN}`)
  })

  it('says what is missing and skips the steps that depend on it', async () => {
    const h = await setup({ url: '', cloudToken: null, githubToken: null })
    const results = await h.router.cloudTest()
    expect(results).toHaveLength(3)
    expect(results.every((r) => !r.ok)).toBe(true)
    expect(results[0].message).toMatch(/worker URL/i)
    expect(results[1].message).toMatch(/skipped/i)
    expect(results[2].message).toMatch(/GitHub token/i)
    expect(h.checkToken).not.toHaveBeenCalled()
    expect(h.worker.reqs).toHaveLength(0)
  })

  it('fails the worker step and skips the token step when the worker cannot be reached', async () => {
    const h = await setup({ url: 'http://127.0.0.1:1' })
    const results = await h.router.cloudTest()
    expect(results[0]).toMatchObject({ ok: false })
    expect(results[0].message).toMatch(/Could not reach the cloud worker/)
    expect(results[1].ok).toBe(false)
    expect(results[1].message).toMatch(/skipped/i)
    expect(results[2].ok).toBe(true)
  })

  it('reports a rejected access token', async () => {
    const h = await setup()
    h.worker.token = 'something-else-entirely-1234567890'
    const results = await h.router.cloudTest()
    expect(results[0].ok).toBe(true)
    expect(results[1]).toMatchObject({ ok: false })
    expect(results[1].message).toMatch(/rejected the access token/i)
  })

  it('reports a bad worker URL in plain language', async () => {
    const h = await setup({ url: 'http://remote.example.com' })
    const results = await h.router.cloudTest()
    expect(results[0].message).toMatch(/unencrypted/i)
    expect(results[1].ok).toBe(false)
  })

  it('reports a rejected GitHub token without ever repeating it', async () => {
    const h = await setup({
      checkToken: async (t) => {
        throw new Error(`GitHub said no to ${t}`)
      },
    })
    const results = await h.router.cloudTest()
    expect(results[2].ok).toBe(false)
    expect(JSON.stringify(results)).not.toContain(GITHUB)
  })

  it('never includes a secret in any result', async () => {
    const h = await setup()
    const out = JSON.stringify(await h.router.cloudTest())
    for (const s of ALL_SECRETS) expect(out).not.toContain(s)
  })
})

// ------------------------------------------------------------------ cloudStart

describe('BackendRouter.cloudStart', () => {
  it('needs a worker URL, an access token and a GitHub token, each with a plain message, before any request', async () => {
    const a = await setup({ url: '' })
    await expect(a.router.cloudStart(START)).rejects.toThrow(/worker URL.*Settings > Cloud/i)
    const b = await setup({ cloudToken: null })
    await expect(b.router.cloudStart(START)).rejects.toThrow(/access token.*Settings > Cloud/i)
    const c = await setup({ githubToken: null })
    await expect(c.router.cloudStart(START)).rejects.toThrow(/GitHub token.*Settings > Cloud/i)
    for (const h of [a, b, c]) expect(h.worker.reqs).toHaveLength(0)
  })

  it('throws NotReadyError when there is no Vertex key', async () => {
    const h = await setup({ apiKey: null })
    await expect(h.router.cloudStart(START)).rejects.toBeInstanceOf(NotReadyError)
    expect(h.worker.reqs).toHaveLength(0)
  })

  it('refuses while a local turn is running', async () => {
    const h = await setup()
    h.local.busy = true
    await expect(h.router.cloudStart(START)).rejects.toThrow(/turn/i)
    expect(h.worker.reqs).toHaveLength(0)
  })

  it('refuses while the attached cloud session is running a turn', async () => {
    const h = await setup()
    await attached(h, { busy: true })
    const before = h.worker.reqs.length
    await expect(h.router.cloudStart(START)).rejects.toThrow(/turn/i)
    expect(h.worker.hits('POST', /^\/v1\/sessions$/)).toHaveLength(0)
    expect(h.worker.reqs.length).toBe(before)
  })

  it('creates the session with the repo, settings, secrets and auto-push choice', async () => {
    const h = await setup({ autoPush: false })
    await h.router.cloudStart(START)
    const create = h.worker.hits('POST', /^\/v1\/sessions$/)
    expect(create).toHaveLength(1)
    expect(create[0].headers['authorization']).toBe(`Bearer ${CLOUD_TOKEN}`)
    expect(create[0].body).toMatchObject({
      repo: 'octo/demo',
      baseBranch: 'develop',
      name: 'fix-login',
      settings: JSON.parse(JSON.stringify(h.local.settings)),
      secrets: { apiKey: VERTEX, githubToken: GITHUB },
      autoPush: false,
    })
  })

  it('omits the optional fields the user left empty', async () => {
    const h = await setup()
    await h.router.cloudStart({ repo: 'octo/demo' })
    const body = h.worker.hits('POST', /^\/v1\/sessions$/)[0].body as Record<string, unknown>
    expect('baseBranch' in body).toBe(false)
    expect('name' in body).toBe(false)
  })

  it('attaches: loads history, follows the stream from its seq, and returns the session', async () => {
    const h = await setup()
    const opened = await h.router.cloudStart(START)
    expect(opened.cloud).toMatchObject({ repo: 'octo/demo', branch: 'arc/fix-login-ab12' })
    expect(opened.sessionId).toBe(opened.cloud.id)
    expect(opened.root).toBe('octo/demo @ arc/fix-login-ab12')
    expect(opened.history).toEqual([{ role: 'user', parts: [{ text: 'earlier' }] }])
    await until(() => h.worker.streamCount(opened.cloud.id) === 1, 'the stream')
    const events = h.worker.hits('GET', /\/events$/)
    expect(events[0].headers['last-event-id']).toBe('0')
    expect(h.worker.hits('GET', /\/history$/)).toHaveLength(1)
  })

  it('resumes the stream after the history seq, not from the start', async () => {
    const h = await setup()
    const s = h.worker.seed({}, 12)
    await h.router.cloudAttach(s.info.id)
    await until(() => h.worker.streamCount(s.info.id) === 1, 'the stream')
    expect(h.worker.hits('GET', /\/events$/)[0].headers['last-event-id']).toBe('12')
  })

  it('emits a mode event for the new session', async () => {
    const h = await setup()
    await h.router.cloudStart(START)
    expect(h.emitted).toContainEqual({ type: 'mode', mode: 'ask' })
  })

  it('forwards the worker events to emit', async () => {
    const h = await setup()
    const { cloud } = await h.router.cloudStart(START)
    await until(() => h.worker.streamCount(cloud.id) === 1, 'the stream')
    h.worker.emit(cloud.id, { type: 'text-delta', text: 'hello' })
    h.worker.emit(cloud.id, { type: 'tool-start', id: 't1' })
    await until(() => h.emitted.some((e) => e.type === 'tool-start'), 'forwarded events')
    expect(h.emitted.filter((e) => !['mode', 'history-reload', 'status'].includes(e.type))).toEqual([
      { type: 'text-delta', text: 'hello' },
      { type: 'tool-start', id: 't1' },
    ])
  })

  it('merges the cloud session into status', async () => {
    const h = await setup()
    const { cloud } = await h.router.cloudStart(START)
    const status = await h.router.status()
    expect(status).toMatchObject({
      ready: true,
      hasApiKey: true,
      hasProject: true,
      projectRoot: 'octo/demo @ arc/fix-login-ab12',
      busy: false,
      mode: 'ask',
      sessionId: cloud.id,
      cloud,
    })
    expect(await h.router.cloudStatus()).toMatchObject({ active: cloud })
  })

  it('keeps the readiness of the local Vertex key in the merged status', async () => {
    const h = await setup()
    await h.router.cloudStart(START)
    h.local.hasApiKey = false
    expect(await h.router.status()).toMatchObject({ ready: false, hasApiKey: false, reason: 'no-api-key' })
  })

  it('leaves the previous cloud session running when it attaches to a new one', async () => {
    const h = await setup()
    const first = await h.router.cloudStart(START)
    await until(() => h.worker.streamCount(first.cloud.id) === 1, 'first stream')
    const second = await h.router.cloudStart({ repo: 'octo/other' })
    await until(() => h.worker.streamCount(first.cloud.id) === 0, 'first stream closed')
    expect(h.worker.sessions.has(first.cloud.id)).toBe(true)
    expect(h.worker.hits('DELETE', /./)).toHaveLength(0)
    expect((await h.router.status()).sessionId).toBe(second.cloud.id)
    const before = h.emitted.length
    h.worker.emit(first.cloud.id, { type: 'text-delta', text: 'from the old one' })
    await new Promise((r) => setTimeout(r, 40))
    expect(h.emitted).toHaveLength(before)
  })

  it('does not attach when the worker refuses to create the session', async () => {
    const h = await setup()
    h.worker.createFail = { status: 409, error: 'Too many sessions (4 of 4).', code: 'too-many-sessions' }
    await expect(h.router.cloudStart(START)).rejects.toThrow('Too many sessions (4 of 4).')
    expect((await h.router.status()).cloud ?? null).toBeNull()
    expect(h.worker.hits('GET', /\/events$/)).toHaveLength(0)
  })

  it('refuses a second start while one is still in progress', async () => {
    const h = await setup()
    const first = h.router.cloudStart(START)
    await expect(h.router.cloudStart(START)).rejects.toThrow(/already/i)
    await first
    expect(h.worker.hits('POST', /^\/v1\/sessions$/)).toHaveLength(1)
  })
})

// ------------------------------------------------------------------ attached routing

describe('BackendRouter while attached to a cloud session', () => {
  it('sends a message to the worker and returns "started"', async () => {
    const h = await setup()
    const s = await attached(h)
    await expect(h.router.send('fix it')).resolves.toBe('started')
    const calls = h.worker.invokes('agent:send')
    expect(calls).toHaveLength(1)
    expect(calls[0].path).toBe(`/v1/sessions/${s.info.id}/invoke`)
    expect(calls[0].body).toEqual({ channel: 'agent:send', payload: { text: 'fix it' } })
    expect(h.local.send).not.toHaveBeenCalled()
    expect((await h.router.status()).busy).toBe(true)
  })

  it('maps each session call onto its worker channel and never calls the local backend', async () => {
    const h = await setup()
    await attached(h)
    const rule = { tool: 'Bash' as const, prefix: 'npm' }
    h.worker.invokeData.set('agent:undo', { restored: ['a.ts'], removed: [] })
    h.worker.invokeData.set('agent:changes', { files: ['a.ts'], canUndo: true })
    h.worker.invokeData.set('prompter:spark', [{ title: 't', prompt: 'p', kind: 'fix' }])
    h.worker.invokeData.set('rules:list', [rule])
    h.worker.invokeData.set('audit:read', [{ n: 1 }])
    h.worker.invokeData.set('sessions:list', [{ id: 'w1' }])
    await h.router.stop()
    await h.router.resolveApproval('r1', { decision: 'always', note: 'ok' })
    await h.router.resolveAnswer('q1', 'blue')
    await h.router.setMode('auto-edit')
    await expect(h.router.undo()).resolves.toEqual({ restored: ['a.ts'], removed: [] })
    await expect(h.router.getChanges()).resolves.toEqual({ files: ['a.ts'], canUndo: true })
    await expect(h.router.spark()).resolves.toEqual([{ title: 't', prompt: 'p', kind: 'fix' }])
    await expect(h.router.listRules()).resolves.toEqual([rule])
    await h.router.removeRule(rule)
    await expect(h.router.readAudit()).resolves.toEqual([{ n: 1 }])
    await expect(h.router.listSessions()).resolves.toEqual([{ id: 'w1' }])
    const sent = h.worker.reqs.filter((r) => r.path.endsWith('/invoke')).map((r) => r.body)
    expect(sent).toEqual([
      { channel: 'agent:stop' },
      { channel: 'agent:approval', payload: { requestId: 'r1', decision: 'always', note: 'ok' } },
      { channel: 'agent:answer', payload: { questionId: 'q1', answer: 'blue' } },
      { channel: 'agent:setMode', payload: { mode: 'auto-edit' } },
      { channel: 'agent:undo' },
      { channel: 'agent:changes' },
      { channel: 'prompter:spark' },
      { channel: 'rules:list' },
      { channel: 'rules:remove', payload: { rule } },
      { channel: 'audit:read' },
      { channel: 'sessions:list' },
    ])
    for (const fn of [h.local.stop, h.local.resolveApproval, h.local.resolveAnswer, h.local.setMode, h.local.undo, h.local.getChanges, h.local.spark, h.local.listRules, h.local.removeRule, h.local.readAudit, h.local.listSessions]) {
      expect(fn).not.toHaveBeenCalled()
    }
  })

  it('omits an empty approval note', async () => {
    const h = await setup()
    await attached(h)
    await h.router.resolveApproval('r1', { decision: 'deny' })
    expect(h.worker.invokes('agent:approval')[0].body).toEqual({ channel: 'agent:approval', payload: { requestId: 'r1', decision: 'deny' } })
  })

  it('turns autopilot on the worker, keeps the local setting in step and answers with the merged status', async () => {
    const h = await setup()
    const s = await attached(h)
    const out = await h.router.autopilot(true)
    expect(h.worker.invokes('prompter:autopilot')[0].body).toEqual({ channel: 'prompter:autopilot', payload: { on: true } })
    expect(h.local.autopilot).not.toHaveBeenCalled()
    expect(h.local.settings.prompter.mode).toBe('autopilot')
    expect(out.settings.prompter.mode).toBe('autopilot')
    expect(out.status.sessionId).toBe(s.info.id)
    await h.router.autopilot(false)
    expect(h.local.settings.prompter.mode).toBe('suggest')
  })

  it('refuses to send when the local Vertex key is gone', async () => {
    const h = await setup({ apiKey: null })
    await attached(h)
    await expect(h.router.send('hi')).rejects.toBeInstanceOf(NotReadyError)
    expect(h.worker.invokes('agent:send')).toHaveLength(0)
  })

  it('turns the worker no-api-key and no-project answers back into the usual errors', async () => {
    const h = await setup()
    await attached(h)
    h.worker.invokeFail.set('agent:send', { error: 'Add your Vertex API key in Settings to start.', code: 'no-api-key' })
    h.worker.invokeFail.set('prompter:spark', { error: 'Open a project folder first.', code: 'no-project' })
    await expect(h.router.send('hi')).rejects.toBeInstanceOf(NotReadyError)
    await expect(h.router.spark()).rejects.toBeInstanceOf(NoProjectError)
  })

  it('passes other worker errors through in plain language', async () => {
    const h = await setup()
    await attached(h)
    h.worker.invokeFail.set('agent:send', { error: 'A turn is already running' })
    await expect(h.router.send('hi')).rejects.toThrow('A turn is already running')
  })

  it('ends the attachment when a call finds the session gone', async () => {
    const h = await setup()
    const s = await attached(h)
    h.worker.sessions.delete(s.info.id)
    await expect(h.router.undo()).rejects.toThrow(/no longer exists/i)
    expect((await h.router.status()).cloud ?? null).toBeNull()
    expect(h.notices().some((n) => n.level === 'error' && /worker restarted/.test(n.message))).toBe(true)
  })

  it('serves the session list from the worker while attached', async () => {
    const h = await setup()
    await attached(h)
    h.worker.invokeData.set('sessions:list', [])
    await h.router.listSessions()
    expect(h.local.listSessions).not.toHaveBeenCalled()
    expect(h.worker.invokes('sessions:list')).toHaveLength(1)
  })

  it('calls the local backend, and leaves the cloud session once that has opened the project', async () => {
    const h = await setup()
    const s = await attached(h)
    h.local.openProject.mockImplementationOnce(async (path: string) => {
      expect((await h.router.status()).cloud?.id).toBe(s.info.id)
      return { root: path, sessionId: 'local-1', history: [] }
    })
    await h.router.openProject('/work')
    await until(() => h.worker.streamCount(s.info.id) === 0, 'the stream to close')
    expect(h.local.openProject).toHaveBeenCalledWith('/work', undefined)
    expect((await h.router.status()).cloud ?? null).toBeNull()
    expect(h.worker.sessions.has(s.info.id)).toBe(true)
    await h.router.send('now local')
    expect(h.local.send).toHaveBeenCalledWith('now local')
  })

  it('detaches before resuming a local session', async () => {
    const h = await setup()
    const s = await attached(h)
    await h.router.resumeSession('old-1')
    expect(h.local.resumeSession).toHaveBeenCalledWith('old-1')
    await until(() => h.worker.streamCount(s.info.id) === 0, 'the stream to close')
    expect((await h.router.status()).cloud ?? null).toBeNull()
  })
})

// ------------------------------------------------------------------ settings and keys while attached

describe('BackendRouter settings and keys while attached', () => {
  it('saves settings locally and also sends them to the worker without the local-only fields', async () => {
    const h = await setup()
    await attached(h)
    const out = await h.router.saveSettings({
      model: 'm-2',
      prompter: { mode: 'off' },
      theme: 'studios',
      showDetails: true,
      extraDirs: ['/x'],
      cloud: { autoPush: false },
    })
    expect(h.local.saveSettings).toHaveBeenCalledWith({
      model: 'm-2',
      prompter: { mode: 'off' },
      theme: 'studios',
      showDetails: true,
      extraDirs: ['/x'],
      cloud: { autoPush: false },
    })
    expect(h.worker.invokes('settings:save')).toHaveLength(1)
    expect(h.worker.invokes('settings:save')[0].body).toEqual({
      channel: 'settings:save',
      payload: { patch: { model: 'm-2', prompter: { mode: 'off' }, cloud: { autoPush: false } } },
    })
    expect(out.settings.model).toBe('m-2')
    expect(out.status.cloud).toBeTruthy()
  })

  it('does not bother the worker with a change that only concerns the desktop', async () => {
    const h = await setup()
    await attached(h)
    await h.router.saveSettings({ theme: 'studios', cloud: { workerUrl: h.worker.url } })
    expect(h.worker.invokes('settings:save')).toHaveLength(0)
  })

  it('keeps the local save and warns when the worker cannot apply it', async () => {
    const h = await setup()
    await attached(h)
    h.worker.invokeFail.set('settings:save', { error: 'nope' })
    const out = await h.router.saveSettings({ model: 'm-3' })
    expect(out.settings.model).toBe('m-3')
    expect(h.notices().some((n) => n.level === 'warn' && /cloud session/i.test(n.message))).toBe(true)
  })

  it('refreshes the worker key when a new Vertex key is saved', async () => {
    const h = await setup()
    const s = await attached(h)
    await h.router.setApiKey(NEW_VERTEX)
    expect(h.local.setApiKey).toHaveBeenCalledWith(NEW_VERTEX)
    const puts = h.worker.hits('PUT', /\/secrets$/)
    expect(puts).toHaveLength(1)
    expect(puts[0].path).toBe(`/v1/sessions/${s.info.id}/secrets`)
    expect(puts[0].body).toEqual({ apiKey: NEW_VERTEX })
  })

  it('still saves the key and warns, without repeating it, when the worker cannot take it', async () => {
    const h = await setup()
    const s = await attached(h)
    h.worker.sessions.delete(s.info.id)
    await h.router.setApiKey(NEW_VERTEX)
    expect(h.local.setApiKey).toHaveBeenCalled()
    expect(JSON.stringify(h.emitted)).not.toContain(NEW_VERTEX)
  })

  it('stops the cloud turn when the key is cleared, and ends nothing else', async () => {
    const h = await setup()
    const s = await attached(h)
    await h.router.clearApiKey()
    expect(h.local.clearApiKey).toHaveBeenCalled()
    expect(h.worker.invokes('agent:stop')).toHaveLength(1)
    expect(h.worker.hits('DELETE', /./)).toHaveLength(0)
    expect(h.worker.sessions.has(s.info.id)).toBe(true)
    expect((await h.router.status()).cloud?.id).toBe(s.info.id)
  })

  it('keeps testConnection local', async () => {
    const h = await setup()
    await attached(h)
    await h.router.testConnection()
    expect(h.local.testConnection).toHaveBeenCalled()
    expect(h.worker.reqs.every((r) => !r.path.includes('test'))).toBe(true)
  })
})

// ------------------------------------------------------------------ attach, leave, end, list

describe('BackendRouter.cloudAttach, cloudLeave, cloudEnd, cloudSessions', () => {
  it('attaches to an existing session and returns its history', async () => {
    const h = await setup()
    const s = h.worker.seed({ repo: 'octo/older', branch: 'arc/older-1234' })
    const out = await h.router.cloudAttach(s.info.id)
    expect(out).toMatchObject({ sessionId: s.info.id, root: 'octo/older @ arc/older-1234', cloud: { id: s.info.id } })
    expect(out.history).toHaveLength(1)
  })

  it('says so when the session no longer exists, and stays detached', async () => {
    const h = await setup()
    await expect(h.router.cloudAttach(randomUUID())).rejects.toThrow(/no longer exists/i)
    expect((await h.router.status()).cloud ?? null).toBeNull()
  })

  it('refuses to attach while a local turn is running', async () => {
    const h = await setup()
    const s = h.worker.seed()
    h.local.busy = true
    await expect(h.router.cloudAttach(s.info.id)).rejects.toThrow(/turn/i)
  })

  it('needs the worker URL and token to attach', async () => {
    const h = await setup({ cloudToken: null })
    await expect(h.router.cloudAttach(randomUUID())).rejects.toThrow(/access token/i)
  })

  it('attaching again to the same session rebuilds from history and leaves a single stream', async () => {
    const h = await setup()
    const s = await attached(h, {}, 4)
    await h.router.cloudAttach(s.info.id)
    await until(() => h.worker.hits('GET', /\/events$/).length >= 2, 'a second stream request')
    await until(() => h.worker.streamCount(s.info.id) === 1, 'one stream')
    await new Promise((r) => setTimeout(r, 30))
    expect(h.worker.streamCount(s.info.id)).toBe(1)
  })

  it('cloudLeave closes the stream, keeps the session on the worker and returns the local status', async () => {
    const h = await setup()
    const s = await attached(h)
    const status = await h.router.cloudLeave()
    expect(status).toEqual(await h.local.status())
    expect(status.cloud ?? null).toBeNull()
    await until(() => h.worker.streamCount(s.info.id) === 0, 'stream closed')
    expect(h.worker.sessions.has(s.info.id)).toBe(true)
    expect(h.worker.hits('DELETE', /./)).toHaveLength(0)
    await h.router.send('local again')
    expect(h.local.send).toHaveBeenCalledWith('local again')
  })

  it('cloudEnd deletes the attached session on the worker and detaches', async () => {
    const h = await setup()
    const s = await attached(h)
    await expect(h.router.cloudEnd(s.info.id)).resolves.toBeNull()
    expect(h.worker.hits('DELETE', /./)).toHaveLength(1)
    expect(h.worker.sessions.has(s.info.id)).toBe(false)
    expect((await h.router.status()).cloud ?? null).toBeNull()
  })

  it('cloudEnd on another session leaves the attachment alone', async () => {
    const h = await setup()
    const s = await attached(h)
    const other = h.worker.seed()
    await h.router.cloudEnd(other.info.id)
    expect(h.worker.sessions.has(other.info.id)).toBe(false)
    expect((await h.router.status()).cloud?.id).toBe(s.info.id)
    expect(h.worker.streamCount(s.info.id)).toBe(1)
  })

  it('cloudEnd works while detached, and treats an already-gone session as ended', async () => {
    const h = await setup()
    const s = h.worker.seed()
    await expect(h.router.cloudEnd(s.info.id)).resolves.toBeNull()
    await expect(h.router.cloudEnd(s.info.id)).resolves.toBeNull()
  })

  it('cloudSessions returns the worker list, attached or not', async () => {
    const h = await setup()
    const a = h.worker.seed()
    const b = h.worker.seed({ repo: 'octo/b' })
    expect((await h.router.cloudSessions()).map((s) => s.id).sort()).toEqual([a.info.id, b.info.id].sort())
    await h.router.cloudAttach(a.info.id)
    expect(await h.router.cloudSessions()).toHaveLength(2)
  })
})

// ------------------------------------------------------------------ diff, push, pr

describe('BackendRouter.cloudDiff, cloudPush, cloudPr', () => {
  it('need an attached session and say so', async () => {
    const h = await setup()
    await expect(h.router.cloudDiff()).rejects.toThrow(/cloud session/i)
    await expect(h.router.cloudPush()).rejects.toThrow(/cloud session/i)
    await expect(h.router.cloudPr({ title: 't' })).rejects.toThrow(/cloud session/i)
    expect(h.worker.reqs).toHaveLength(0)
  })

  it('proxy to the worker', async () => {
    const h = await setup()
    const s = await attached(h)
    expect(await h.router.cloudDiff()).toMatchObject({ branch: s.info.branch, ahead: 1 })
    expect(await h.router.cloudPush()).toMatchObject({ pushed: true, commit: 'abc1234' })
    expect(await h.router.cloudPr({ title: 'Fix login', body: 'details', draft: true })).toMatchObject({ number: 7, draft: true })
    expect(h.worker.hits('POST', /\/pr$/)[0].body).toEqual({ title: 'Fix login', body: 'details', draft: true })
  })

  it('refresh the cached session after a push so "pushed" is right', async () => {
    const h = await setup()
    await attached(h)
    expect((await h.router.status()).cloud?.pushed).toBe(false)
    await h.router.cloudPush()
    expect((await h.router.status()).cloud?.pushed).toBe(true)
  })
})

// ------------------------------------------------------------------ stream handling

describe('BackendRouter stream handling', () => {
  it('refreshes the cached session when a turn ends', async () => {
    const h = await setup()
    const s = await attached(h)
    await h.router.send('go')
    expect((await h.router.status()).busy).toBe(true)
    s.info.busy = false
    s.info.pushed = true
    h.worker.emit(s.info.id, { type: 'turn-end', reason: 'done' })
    await untilAsync(async () => (await h.router.status()).cloud?.pushed === true, 'the cached session to refresh')
    const status = await h.router.status()
    expect(status.busy).toBe(false)
    expect(h.emitted).toContainEqual({ type: 'turn-end', reason: 'done' })
  })

  it('tracks mode changes from the stream', async () => {
    const h = await setup()
    const s = await attached(h)
    h.worker.emit(s.info.id, { type: 'mode', mode: 'auto' })
    await until(() => h.emitted.some((e) => e.type === 'mode' && e.mode === 'auto'), 'mode event')
    expect((await h.router.status()).mode).toBe('auto')
  })

  it('on a gap reloads history, tells the user, and follows the stream from the new seq', async () => {
    const h = await setup()
    const s = await attached(h, {}, 0)
    h.worker.gapOldest = 50
    s.seq = 60
    h.worker.dropStreams(s.info.id)
    await until(() => h.notices().some((n) => n.message === 'Caught up with the cloud session.'), 'the catch-up notice')
    expect(h.notices().find((n) => n.message === 'Caught up with the cloud session.')?.level).toBe('info')
    await until(() => h.worker.streamCount(s.info.id) === 1, 'the stream to reopen')
    expect(h.worker.hits('GET', /\/history$/)).toHaveLength(2)
    expect(h.worker.hits('GET', /\/events$/).at(-1)?.headers['last-event-id']).toBe('60')
    h.worker.emit(s.info.id, { type: 'text-delta', text: 'after the gap' })
    await until(() => h.emitted.some((e) => e.type === 'text-delta'), 'event after the gap')
  })

  it('tells the user only once however often the stream reports the same state', async () => {
    const seen: AttachOptions[] = []
    const h = await setup({ onAttach: (o) => seen.push(o) })
    await attached(h)
    const stream = seen.at(-1)!
    for (let i = 0; i < 3; i++) stream.onState?.('reconnecting')
    expect(h.notices().filter((n) => n.level === 'warn')).toHaveLength(1)
    for (let i = 0; i < 3; i++) stream.onState?.('connected')
    expect(h.notices().filter((n) => n.level === 'info')).toHaveLength(1)
    stream.onState?.('reconnecting')
    expect(h.notices().filter((n) => n.level === 'warn')).toHaveLength(2)
  })

  it('ignores callbacks from a stream that has been replaced', async () => {
    const seen: AttachOptions[] = []
    const h = await setup({ onAttach: (o) => seen.push(o) })
    const s = await attached(h)
    const old = seen.at(-1)!
    await h.router.cloudAttach(s.info.id)
    const before = h.emitted.length
    old.onEvent(99, { type: 'text-delta', text: 'stale' })
    old.onState?.('reconnecting')
    old.onEnded('gone')
    expect(h.emitted).toHaveLength(before)
    expect((await h.router.status()).cloud?.id).toBe(s.info.id)
  })

  it('ignores callbacks from the old stream of the same session after the stream is restarted', async () => {
    const seen: AttachOptions[] = []
    const h = await setup({ onAttach: (o) => seen.push(o) })
    await attached(h)
    const old = seen.at(-1)!
    h.worker.token = NEW_CLOUD_TOKEN
    await h.router.cloudSetSecret('cloud-token', NEW_CLOUD_TOKEN)
    expect(seen).toHaveLength(2)
    const before = h.emitted.length
    old.onEvent(99, { type: 'text-delta', text: 'stale' })
    old.onEnded('gone')
    expect(h.emitted).toHaveLength(before)
    expect((await h.router.status()).cloud).toBeTruthy()
  })

  it('when the worker lost the session, says the worker restarted, ends the turn and detaches', async () => {
    const h = await setup()
    const s = await attached(h)
    h.worker.eventsStatus = 404
    h.worker.dropStreams(s.info.id)
    await until(() => h.emitted.some((e) => e.type === 'turn-end'), 'the turn-end error')
    const n = h.notices().find((x) => x.level === 'error')
    expect(n?.message).toBe('The cloud session ended because the worker restarted. Your pushed branch is safe on GitHub.')
    expect(h.emitted).toContainEqual({ type: 'turn-end', reason: 'error' })
    expect((await h.router.status()).cloud ?? null).toBeNull()
    expect(h.notices().filter((x) => x.level === 'error')).toHaveLength(1)
  })

  it('when the token is refused on reconnect, points at Settings > Cloud and detaches', async () => {
    const h = await setup()
    const s = await attached(h)
    h.worker.eventsStatus = 401
    h.worker.dropStreams(s.info.id)
    await until(() => h.notices().some((n) => n.level === 'error'), 'the error notice')
    expect(h.notices().find((n) => n.level === 'error')?.message).toMatch(/Settings > Cloud/)
    expect((await h.router.status()).cloud ?? null).toBeNull()
  })

  it('warns once while the connection is down, and once when it is back', async () => {
    const h = await setup()
    const s = await attached(h)
    h.worker.eventsStatus = 503
    h.worker.dropStreams(s.info.id)
    await until(() => h.sleeps.length >= 4, 'several reconnect attempts')
    const warns = h.notices().filter((n) => n.level === 'warn')
    expect(warns).toHaveLength(1)
    expect(warns[0].message).toBe('Lost the connection to the cloud worker. Retrying...')
    expect(h.notices().filter((n) => n.level === 'info')).toHaveLength(0)

    h.worker.eventsStatus = null
    await until(() => h.worker.streamCount(s.info.id) === 1, 'the stream to come back')
    h.worker.emit(s.info.id, { type: 'text-delta', text: 'still here' })
    await until(() => h.notices().some((n) => n.level === 'info'), 'the back-online notice')
    expect(h.notices().filter((n) => n.level === 'warn')).toHaveLength(1)
    expect(h.notices().filter((n) => n.level === 'info')).toHaveLength(1)
    expect((await h.router.status()).cloud?.id).toBe(s.info.id)
  })
})

// ------------------------------------------------------------------ secrets hygiene

describe('BackendRouter secret hygiene', () => {
  it('sends secrets only in the create body and in putSecrets, and the access token only as a header', async () => {
    const h = await setup()
    await attached(h)
    await h.router.cloudStart(START)
    await h.router.send('hello')
    await h.router.saveSettings({ model: 'm-9' })
    await h.router.setApiKey(NEW_VERTEX)
    await h.router.cloudSetSecret('github-token', NEW_GITHUB)
    await h.router.cloudDiff()
    await h.router.cloudPush()
    await h.router.cloudPr({ title: 'x' })
    await h.router.clearApiKey()
    for (const r of h.worker.reqs) {
      const isCreate = r.method === 'POST' && r.path === '/v1/sessions'
      const isSecrets = r.path.endsWith('/secrets')
      for (const secret of [VERTEX, NEW_VERTEX, GITHUB, NEW_GITHUB]) {
        if (!(isCreate || isSecrets)) expect(r.raw, `${r.method} ${r.path}`).not.toContain(secret)
      }
      for (const secret of [CLOUD_TOKEN, NEW_CLOUD_TOKEN]) expect(r.raw, `${r.method} ${r.path}`).not.toContain(secret)
    }
  })

  it('never puts a secret in an emitted event, even through the failure paths', async () => {
    const h = await setup()
    const s = await attached(h)
    h.worker.invokeFail.set('settings:save', { error: `bad ${VERTEX} ${GITHUB} Bearer ${CLOUD_TOKEN}` })
    await h.router.saveSettings({ model: 'm-1' })
    h.worker.eventsStatus = 401
    h.worker.dropStreams(s.info.id)
    await until(() => h.emitted.some((e) => e.type === 'notice' && e.level === 'error'), 'the error notice')
    const text = JSON.stringify(h.emitted)
    for (const secret of ALL_SECRETS) expect(text).not.toContain(secret)
  })

  it('does not echo a secret in the errors it throws', async () => {
    const h = await setup()
    await attached(h)
    h.worker.invokeFail.set('agent:send', { error: `oops ${VERTEX} and ${GITHUB} and Bearer ${CLOUD_TOKEN}` })
    try {
      await h.router.send('x')
      throw new Error('should have failed')
    } catch (err) {
      const msg = (err as Error).message
      for (const secret of ALL_SECRETS) expect(msg).not.toContain(secret)
    }
  })
})

// ------------------------------------------------------------------ dispose

describe('BackendRouter.dispose', () => {
  it('closes the stream and stops the local agent, but leaves the cloud turn and session running', async () => {
    const h = await setup()
    const s = await attached(h, { busy: true })
    await h.router.dispose()
    await until(() => h.worker.streamCount(s.info.id) === 0, 'the stream to close')
    expect(h.local.stop).toHaveBeenCalled()
    expect(h.worker.invokes('agent:stop')).toHaveLength(0)
    expect(h.worker.hits('DELETE', /./)).toHaveLength(0)
    expect(h.worker.sessions.has(s.info.id)).toBe(true)
  })
})

// ------------------------------------------------------------------ review fixes

const APPROVAL = { call: { id: 'w1', name: 'Write', args: { file_path: 'a.txt' } }, reason: 'Write a.txt', diff: '+A' }
const types = (events: AgentEvent[]) => events.map((e) => e.type)
const reset = (h: Harness) => h.emitted.splice(0)

describe('attach shows exactly what a connected client would', () => {
  it('rebuilds the transcript, then the in-flight text, the pending approval and question, and a busy status', async () => {
    const h = await setup()
    const s = h.worker.seed({ busy: true }, 7)
    s.pending = { approval: APPROVAL, question: { id: 'q1', question: 'Which?', options: ['a', 'b'] } }
    s.inflight = { text: 'Half a sent' }
    const opened = await h.router.cloudAttach(s.info.id)
    expect(opened.history).toEqual(s.history)
    expect(types(h.emitted)).toEqual(['history-reload', 'mode', 'text-delta', 'approval-request', 'question', 'status'])
    expect(h.emitted[0]).toEqual({ type: 'history-reload', history: s.history })
    expect(h.emitted[2]).toEqual({ type: 'text-delta', text: 'Half a sent' })
    expect(h.emitted[3]).toEqual({ type: 'approval-request', request: APPROVAL })
    expect(h.emitted[4]).toEqual({ type: 'question', id: 'q1', question: 'Which?', options: ['a', 'b'] })
    expect(h.emitted[5]).toMatchObject({ type: 'status', state: 'waiting-approval' })
  })

  it('a busy session without anything pending shows a working status, an idle one shows idle and no turn-end', async () => {
    const h = await setup()
    const busy = h.worker.seed({ busy: true })
    await h.router.cloudAttach(busy.info.id)
    expect(h.emitted.at(-1)).toMatchObject({ type: 'status' })
    expect((h.emitted.at(-1) as { state: string }).state).not.toBe('idle')
    const h2 = await setup()
    const idle = h2.worker.seed({ busy: false })
    await h2.router.cloudAttach(idle.info.id)
    expect(h2.emitted.at(-1)).toMatchObject({ type: 'status', state: 'idle' })
    expect(types(h2.emitted)).not.toContain('turn-end')
  })

  it('starts the stream after the catch-up events, from the history seq', async () => {
    const h = await setup()
    const s = h.worker.seed({ busy: true }, 5)
    s.inflight = { text: 'abc' }
    await h.router.cloudAttach(s.info.id)
    await until(() => h.worker.streamCount(s.info.id) === 1, 'stream')
    h.worker.emit(s.info.id, { type: 'text-delta', text: 'def' })
    await until(() => h.emitted.filter((e) => e.type === 'text-delta').length === 2, 'live delta')
    expect(h.emitted.filter((e) => e.type === 'text-delta').map((e) => (e as { text: string }).text)).toEqual(['abc', 'def'])
  })

  it('an older worker (no pending or in-flight in /history) attaches fine', async () => {
    const h = await setup()
    const s = h.worker.seed({})
    delete (s as { inflight?: unknown }).inflight
    await expect(h.router.cloudAttach(s.info.id)).resolves.toBeDefined()
  })
})

describe('a gap makes the renderer consistent', () => {
  async function gap(h: Harness, s: ReturnType<FakeWorker['seed']>) {
    reset(h)
    h.worker.gapOldest = 50
    s.seq = 60
    h.worker.dropStreams(s.info.id)
    await until(() => h.notices().some((n) => n.message === 'Caught up with the cloud session.'), 'catch-up notice')
  }

  it('emits history-reload plus pending and in-flight, and no turn-end while the worker is busy', async () => {
    const h = await setup()
    const s = await attached(h, { busy: true })
    s.pending = { approval: APPROVAL }
    s.inflight = { text: 'partial' }
    await gap(h, s)
    expect(types(h.emitted.filter((e) => e.type !== 'notice'))).toEqual(['history-reload', 'mode', 'text-delta', 'approval-request', 'status'])
    expect(types(h.emitted)).not.toContain('turn-end')
    await until(() => h.worker.streamCount(s.info.id) === 1, 'stream again')
  })

  it('emits a turn-end when the worker says it is not busy (the real one fell into the gap)', async () => {
    const h = await setup()
    const s = await attached(h, { busy: false })
    await h.router.send('go') // the router believes a turn runs
    s.info.busy = false
    await gap(h, s)
    expect(h.emitted.filter((e) => e.type === 'turn-end')).toHaveLength(1)
    expect(types(h.emitted.filter((e) => e.type !== 'notice'))[0]).toBe('history-reload')
    expect((await h.router.status()).busy).toBe(false)
  })

  it('a token refused while reloading detaches with a turn-end and the settings hint', async () => {
    const h = await setup()
    const s = await attached(h, { busy: true })
    reset(h)
    h.worker.gapOldest = 50
    s.seq = 60
    h.worker.historyStatus = 401
    h.worker.dropStreams(s.info.id)
    await until(() => h.notices().some((n) => /Settings > Cloud/.test(n.message)), 'unauthorized notice')
    expect(h.emitted).toContainEqual({ type: 'turn-end', reason: 'error' })
    expect(h.emitted).toContainEqual({ type: 'status', state: 'idle', label: 'Idle' })
    expect((await h.router.status()).cloud ?? null).toBeNull()
  })

  it('any other reload failure also detaches with a turn-end, so the spinner cannot stay', async () => {
    const h = await setup()
    const s = await attached(h, { busy: true })
    reset(h)
    h.worker.gapOldest = 50
    s.seq = 60
    h.worker.historyStatus = 500
    h.worker.dropStreams(s.info.id)
    await until(() => h.notices().some((n) => /Could not catch up/.test(n.message)), 'catch-up failure notice')
    expect(h.emitted).toContainEqual({ type: 'turn-end', reason: 'error' })
    expect(h.emitted).toContainEqual({ type: 'status', state: 'idle', label: 'Idle' })
    expect((await h.router.status()).cloud ?? null).toBeNull()
  })
})

describe('detaching always frees the spinner', () => {
  const freed = (h: Harness) => {
    expect(h.emitted).toContainEqual({ type: 'turn-end', reason: 'error' })
    expect(h.emitted).toContainEqual({ type: 'status', state: 'idle', label: 'Idle' })
  }

  it('on an unauthorized stream', async () => {
    const h = await setup()
    const s = await attached(h, { busy: true })
    reset(h)
    h.worker.eventsStatus = 401
    h.worker.dropStreams(s.info.id)
    await until(() => h.notices().some((n) => n.level === 'error'), 'error notice')
    freed(h)
  })

  it('on cloudLeave, cloudEnd and removing the access token', async () => {
    const h = await setup()
    await attached(h, { busy: true })
    reset(h)
    await h.router.cloudLeave()
    freed(h)

    const s2 = await attached(h, { busy: true })
    reset(h)
    await h.router.cloudEnd(s2.info.id)
    freed(h)

    await attached(h, { busy: true })
    reset(h)
    await h.router.cloudClearSecret('cloud-token')
    freed(h)
  })

  it('when the session is gone exactly one turn-end is emitted', async () => {
    const h = await setup()
    const s = await attached(h, { busy: true })
    reset(h)
    h.worker.eventsStatus = 404
    h.worker.dropStreams(s.info.id)
    await until(() => h.emitted.some((e) => e.type === 'turn-end'), 'turn-end')
    await new Promise((r) => setTimeout(r, 30))
    expect(h.emitted.filter((e) => e.type === 'turn-end')).toHaveLength(1)
  })
})

describe('local operations while attached', () => {
  it('openProject and resumeSession run the local operation first and only then leave the cloud session', async () => {
    const h = await setup()
    const s = await attached(h)
    let attachedDuringOpen: boolean | undefined
    h.local.openProject.mockImplementationOnce(async (path: string) => {
      attachedDuringOpen = (await h.router.status()).cloud?.id === s.info.id
      return { root: path, sessionId: 'local-1', history: [] }
    })
    await h.router.openProject('/work')
    expect(attachedDuringOpen).toBe(true)
    expect((await h.router.status()).cloud ?? null).toBeNull()
    await until(() => h.worker.streamCount(s.info.id) === 0, 'stream closed')

    await attached(h)
    await h.router.resumeSession('s-1')
    expect((await h.router.status()).cloud ?? null).toBeNull()
  })

  it('a failing local open keeps the cloud attachment and its stream', async () => {
    const h = await setup()
    const s = await attached(h)
    reset(h)
    h.local.openProject.mockRejectedValueOnce(new Error('No such folder'))
    await expect(h.router.openProject('/nope')).rejects.toThrow('No such folder')
    h.local.resumeSession.mockRejectedValueOnce(new Error('No such session'))
    await expect(h.router.resumeSession('x')).rejects.toThrow('No such session')
    expect((await h.router.status()).cloud?.id).toBe(s.info.id)
    expect(h.worker.streamCount(s.info.id)).toBe(1)
    expect(types(h.emitted)).not.toContain('turn-end')
    h.worker.emit(s.info.id, { type: 'text-delta', text: 'still live' })
    await until(() => h.emitted.some((e) => e.type === 'text-delta'), 'live event')
  })

  it('a failing cloudAttach (history cannot load) keeps the current attachment', async () => {
    const h = await setup()
    const a = await attached(h)
    const b = h.worker.seed()
    h.worker.historyStatus = 500
    await expect(h.router.cloudAttach(b.info.id)).rejects.toThrow()
    expect((await h.router.status()).cloud?.id).toBe(a.info.id)
    expect(h.worker.streamCount(a.info.id)).toBe(1)
  })
})

describe('a rejected send', () => {
  it('a busy conflict throws an error with the code busy and marks the session busy', async () => {
    const h = await setup()
    await attached(h)
    h.worker.invokeFail.set('agent:send', { error: 'A turn is already running. Stop it or wait for it to finish.', code: 'busy' })
    const err = await h.router.send('x').catch((e) => e)
    expect(err).toMatchObject({ code: 'busy' })
    expect(err.message).toMatch(/already running/)
    expect((await h.router.status()).busy).toBe(true)
    expect(types(h.emitted)).not.toContain('turn-end')
  })
})

describe('cloud.autoPush reaches the running session', () => {
  it('forwards only cloud.autoPush, never the worker URL', async () => {
    const h = await setup()
    await attached(h)
    await h.router.saveSettings({ cloud: { workerUrl: 'https://elsewhere.example', autoPush: false } })
    const calls = h.worker.invokes('settings:save')
    expect(calls).toHaveLength(1)
    expect((calls[0].body as { payload: unknown }).payload).toEqual({ patch: { cloud: { autoPush: false } } })
    expect(calls[0].raw).not.toContain('elsewhere.example')
  })

  it('does not call the worker for a worker URL change alone, and leaves other fields as before', async () => {
    const h = await setup()
    await attached(h)
    await h.router.saveSettings({ cloud: { workerUrl: 'https://elsewhere.example' } })
    expect(h.worker.invokes('settings:save')).toHaveLength(0)
    await h.router.saveSettings({ maxSteps: 9, theme: 'studios', cloud: { autoPush: true } })
    expect((h.worker.invokes('settings:save')[0].body as { payload: unknown }).payload).toEqual({ patch: { maxSteps: 9, cloud: { autoPush: true } } })
  })
})

describe('removing the Vertex key while attached', () => {
  it('stops the cloud turn and tells the worker to drop the key', async () => {
    const h = await setup()
    await attached(h, { busy: true })
    await h.router.clearApiKey()
    expect(h.worker.invokes('agent:stop')).toHaveLength(1)
    const puts = h.worker.hits('PUT', /\/secrets$/)
    expect(puts).toHaveLength(1)
    expect(puts[0].body).toEqual({ clearApiKey: true })
  })

  it('warns, without throwing, when the worker could not be told', async () => {
    const h = await setup()
    const s = await attached(h)
    h.worker.sessions.delete(s.info.id)
    await expect(h.router.clearApiKey()).resolves.toBeDefined()
  })
})

describe('the cached session stays fresh', () => {
  it('pushed becomes true after the "Saved to GitHub" notice', async () => {
    const h = await setup()
    const s = await attached(h)
    expect((await h.router.status()).cloud?.pushed).toBe(false)
    s.info.pushed = true
    h.worker.emit(s.info.id, { type: 'notice', level: 'info', message: 'Saved to GitHub: arc/x (abc1234)' })
    await untilAsync(async () => (await h.router.status()).cloud?.pushed === true, 'pushed to refresh')
  })

  it('busy follows Autopilot events', async () => {
    const h = await setup()
    const s = await attached(h)
    s.info.busy = true
    h.worker.emit(s.info.id, { type: 'autopilot', running: true })
    await untilAsync(async () => (await h.router.status()).busy === true, 'busy to refresh')
    s.info.busy = false
    h.worker.emit(s.info.id, { type: 'autopilot', running: false })
    await untilAsync(async () => (await h.router.status()).busy === false, 'busy to clear')
  })

  it('a burst of notices does not turn into a burst of requests', async () => {
    const h = await setup()
    const s = await attached(h)
    const before = h.worker.hits('GET', new RegExp(`^/v1/sessions/${s.info.id}$`)).length
    for (let i = 0; i < 20; i++) h.worker.emit(s.info.id, { type: 'notice', level: 'info', message: `n${i}` })
    await until(() => h.emitted.filter((e) => e.type === 'notice').length === 20, 'notices')
    await new Promise((r) => setTimeout(r, 80))
    expect(h.worker.hits('GET', new RegExp(`^/v1/sessions/${s.info.id}$`)).length - before).toBeLessThan(6)
  })
})

describe('a failure after create does not orphan the session', () => {
  it('deletes the worker session when the history cannot be loaded', async () => {
    const h = await setup()
    h.worker.historyStatus = 500
    await expect(h.router.cloudStart(START)).rejects.toThrow()
    expect(h.worker.hits('DELETE', /^\/v1\/sessions\/[^/]+$/)).toHaveLength(1)
    expect(h.worker.sessions.size).toBe(0)
    expect((await h.router.status()).cloud ?? null).toBeNull()
  })

  it('does not delete anything when create itself failed', async () => {
    const h = await setup()
    h.worker.createFail = { status: 409, error: 'Too many sessions (4 of 4).', code: 'too-many-sessions' }
    await expect(h.router.cloudStart(START)).rejects.toThrow()
    expect(h.worker.hits('DELETE', /./)).toHaveLength(0)
  })

  it('does not delete a session the user merely failed to attach to', async () => {
    const h = await setup()
    const s = h.worker.seed()
    h.worker.historyStatus = 500
    await expect(h.router.cloudAttach(s.info.id)).rejects.toThrow()
    expect(h.worker.hits('DELETE', /./)).toHaveLength(0)
  })
})
