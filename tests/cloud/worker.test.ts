import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CloudWorker, WorkerError } from '../../src/main/cloud/worker'
import { CreateSessionBody, type GitOps, type GithubApi } from '../../src/main/cloud/protocol'
import { SettingsSchema } from '../../src/main/store/settings'
import type { CloudDiff, PullRequestResult } from '../../src/shared/cloud'
import type { AgentEvent } from '../../src/shared/types'
import { chunk, startFakeVertex, type FakeEntry, type FakeVertex } from '../helpers/fakeVertexServer'

const VKEY = 'SENTINEL-vertex-key-9f3a1c77'
const GTOKEN = 'SENTINEL-github-token-4be2d0c1'
const ENV_SENTINELS = {
  ARC_CLOUD_TOKEN: 'SENTINEL-env-arc-token-aa11bb22',
  GITHUB_TOKEN: 'SENTINEL-env-github-token-cc33dd44',
  GOOGLE_API_KEY: 'SENTINEL-env-google-key-ee55ff66',
}

const text = (t: string): FakeEntry => ({ chunks: [chunk([{ text: t }], {}, 'STOP')] })
const ideas = (first: { title: string; prompt: string }): FakeEntry =>
  text(
    JSON.stringify([
      { ...first, kind: 'feature' },
      { title: 'Idea b', prompt: 'Do thing b', kind: 'test' },
      { title: 'Idea c', prompt: 'Do thing c', kind: 'wild' },
    ]),
  )
const call = (name: string, args: Record<string, unknown>, id = 'c1'): FakeEntry => ({
  chunks: [chunk([{ functionCall: { name, args, id } }], {}, 'STOP')],
})

async function snapshot(dir: string): Promise<string> {
  const rows: string[] = []
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.name === '.git') continue
      const p = join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else rows.push(`${p}:${await readFile(p, 'utf8')}`)
    }
  }
  await walk(dir)
  return rows.sort().join('\n')
}

type CloneOpts = Parameters<GitOps['clone']>[0]
type PushOpts = Parameters<GitOps['commitAndPush']>[0]
type DiffOpts = Parameters<GitOps['diff']>[0]

class FakeGit implements GitOps {
  clones: CloneOpts[] = []
  pushes: PushOpts[] = []
  diffs: DiffOpts[] = []
  failClone: Error | null = null
  failPush: Error | null = null
  skipped: string[] = []
  pushGate: Promise<void> | null = null
  active = 0
  maxActive = 0
  private snaps = new Map<string, string>()
  private n = 0

  async clone(o: CloneOpts) {
    this.clones.push(o)
    await mkdir(o.dir, { recursive: true })
    if (this.failClone) throw this.failClone
    await writeFile(join(o.dir, 'README.md'), '# hello\n')
    this.snaps.set(o.dir, await snapshot(o.dir))
    return { baseBranch: o.baseBranch ?? 'main', head: '0000000' }
  }

  async commitAndPush(o: PushOpts) {
    this.pushes.push(o)
    this.active++
    this.maxActive = Math.max(this.maxActive, this.active)
    try {
      if (this.pushGate) await this.pushGate
      if (this.failPush) throw this.failPush
      const now = await snapshot(o.dir)
      if (now === this.snaps.get(o.dir)) return { commit: null, pushed: false, skipped: [], head: '0000000' }
      this.snaps.set(o.dir, now)
      const short = (++this.n).toString(16).padStart(7, 'a')
      return { commit: short, pushed: true, skipped: this.skipped, head: short + '0'.repeat(33) }
    } finally {
      this.active--
    }
  }

  async diff(o: DiffOpts): Promise<CloudDiff> {
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

type RepoOpts = Parameters<GithubApi['getRepo']>[0]
type PrOpts = Parameters<GithubApi['createPullRequest']>[0]

class FakeGithub implements GithubApi {
  repos: RepoOpts[] = []
  prs: PrOpts[] = []
  canPush = true
  defaultBranch = 'main'
  fail: Error | null = null
  async getRepo(o: RepoOpts) {
    this.repos.push(o)
    if (this.fail) throw this.fail
    return { defaultBranch: this.defaultBranch, private: true, canPush: this.canPush }
  }
  async createPullRequest(o: PrOpts): Promise<PullRequestResult> {
    this.prs.push(o)
    if (this.fail) throw this.fail
    return { number: 7, url: `https://github.com/${o.owner}/${o.name}/pull/7`, draft: o.draft ?? false, existing: false }
  }
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
const notices = (events: AgentEvent[]) => ofType(events, 'notice').map((n) => `${n.level}: ${n.message}`)

const bodyOf = (over: Record<string, unknown> = {}) =>
  CreateSessionBody.parse({
    repo: 'octo/hello',
    name: 'tidy up',
    settings: SettingsSchema.parse({ prompter: { mode: 'off' } }),
    secrets: { apiKey: VKEY, githubToken: GTOKEN },
    ...over,
  })

let vertex: FakeVertex | undefined
let base = ''
let worker: CloudWorker | undefined
const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV_SENTINELS)) {
    savedEnv[k] = process.env[k]
    process.env[k] = v
  }
  process.env.WORKER_TEST_VISIBLE = 'visible-marker-123'
})
afterEach(async () => {
  await worker?.shutdown()
  await vertex?.close()
  if (base) await rm(base, { recursive: true, force: true })
  worker = undefined
  vertex = undefined
  base = ''
  delete process.env.WORKER_TEST_VISIBLE
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

async function make(script: FakeEntry[] = [], opts: Partial<ConstructorParameters<typeof CloudWorker>[0]> = {}) {
  vertex = await startFakeVertex(script)
  base = await realpath(await mkdtemp(join(tmpdir(), 'arc-worker-')))
  const dataDir = join(base, 'data')
  const git = new FakeGit()
  const github = new FakeGithub()
  let clock = 1_000_000
  const w = new CloudWorker({
    dataDir,
    git,
    github,
    vertexBaseUrl: vertex.baseUrl,
    vertexSleep: async () => {},
    now: () => clock,
    ...opts,
  })
  worker = w
  const events = new Map<string, AgentEvent[]>()
  const watch = (id: string) => {
    const list: AgentEvent[] = []
    events.set(id, list)
    w.subscribe(id, 0, (_s, e) => list.push(e))
    return list
  }
  return { w, git, github, dataDir, vertex, watch, advance: (ms: number) => void (clock += ms) }
}

const send = (w: CloudWorker, id: string, t: string) => w.invoke(id, 'agent:send', { text: t })

describe('create', () => {
  it('clones into the data dir with the GitHub token and returns the session info', async () => {
    const { w, git, github, dataDir } = await make()
    const info = await w.create(bodyOf())
    expect(info).toMatchObject({ repo: 'octo/hello', baseBranch: 'main', busy: false, mode: 'ask', pushed: false })
    expect(info.id).toMatch(/^[a-f0-9-]{36}$/)
    expect(info.branch).toMatch(/^arc\/tidy-up-/)
    expect(git.clones).toHaveLength(1)
    expect(git.clones[0]).toMatchObject({ httpsUrl: 'https://github.com/octo/hello', token: GTOKEN, branch: info.branch, baseBranch: 'main' })
    expect(git.clones[0].dir).toBe(join(dataDir, 'work', info.id, 'repo'))
    expect(github.repos[0]).toMatchObject({ owner: 'octo', name: 'hello', token: GTOKEN })
    expect(w.list().map((s) => s.id)).toEqual([info.id])
    expect(w.get(info.id)).toEqual(info)
  })

  it('uses the requested base branch, and the repo default otherwise', async () => {
    const { w, git, github } = await make()
    github.defaultBranch = 'trunk'
    await w.create(bodyOf())
    await w.create(bodyOf({ baseBranch: 'develop' }))
    expect(git.clones.map((c) => c.baseBranch)).toEqual(['trunk', 'develop'])
  })

  it('refuses a token that cannot push, in plain words, before cloning anything', async () => {
    const { w, git, github } = await make()
    github.canPush = false
    const err = await w.create(bodyOf()).catch((e) => e)
    expect(err).toBeInstanceOf(WorkerError)
    expect(err).toMatchObject({ code: 'forbidden', status: 403 })
    expect(err.message).toMatch(/cannot push to octo\/hello/i)
    expect(git.clones).toHaveLength(0)
  })

  it('rejects a repo that is not owner/name or an allowed host with an invalid error', async () => {
    const { w, git } = await make()
    for (const repo of ['file:///etc', '--upload-pack=x', 'ssh://git@github.com/a/b', 'https://evil.example/a/b']) {
      const err = await w.create(bodyOf({ repo })).catch((e) => e)
      expect(err, repo).toMatchObject({ code: 'invalid', status: 400 })
    }
    expect(git.clones).toHaveLength(0)
  })

  it('accepts extra hosts when configured', async () => {
    const { w, git } = await make([], { hosts: ['github.com', 'ghe.example.com'] })
    const info = await w.create(bodyOf({ repo: 'https://ghe.example.com/octo/hello' }))
    expect(git.clones[0].httpsUrl).toBe('https://ghe.example.com/octo/hello')
    expect(info.repo).toBe('octo/hello')
  })

  it('enforces the session limit with 429 too-many-sessions, counting sessions being created', async () => {
    const { w } = await make([], { maxSessions: 2 })
    const results = await Promise.allSettled([w.create(bodyOf()), w.create(bodyOf()), w.create(bodyOf())])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ code: 'too-many-sessions', status: 429 })
    expect(w.list()).toHaveLength(2)
  })

  it('a removed session frees its slot', async () => {
    const { w } = await make([], { maxSessions: 1 })
    const a = await w.create(bodyOf())
    await expect(w.create(bodyOf())).rejects.toMatchObject({ code: 'too-many-sessions' })
    await w.remove(a.id)
    await expect(w.create(bodyOf())).resolves.toBeDefined()
  })

  it('removes the workspace and session dir when the clone fails, without leaking the token', async () => {
    const { w, git, dataDir } = await make()
    git.failClone = new Error(`fatal: unable to access 'https://x:${GTOKEN}@github.com/octo/hello/'`)
    const err = await w.create(bodyOf()).catch((e) => e)
    expect(err).toMatchObject({ code: 'git', status: 502 })
    expect(err.message).not.toContain(GTOKEN)
    expect(w.list()).toEqual([])
    expect(await readdir(join(dataDir, 'work')).catch(() => [])).toEqual([])
    expect(await readdir(join(dataDir, 'sessions')).catch(() => [])).toEqual([])
  })

  it('removes the workspace when setup fails after the clone (no leaks)', async () => {
    const { w, dataDir } = await make([], { home: '/dev/null/home' })
    // home sits below a character device, so creating it fails after the clone started
    const err = await w.create(bodyOf()).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(w.list()).toEqual([])
    expect(await readdir(join(dataDir, 'work')).catch(() => [])).toEqual([])
    expect(await readdir(join(dataDir, 'sessions')).catch(() => [])).toEqual([])
  })

  it('opens the workspace as the project and forces extraDirs to empty', async () => {
    const { w, dataDir } = await make()
    const settings = SettingsSchema.parse({ prompter: { mode: 'off' }, extraDirs: ['/etc', '/root'] })
    const info = await w.create(bodyOf({ settings }))
    const saved = JSON.parse(await readFile(join(dataDir, 'sessions', info.id, 'arc', 'settings.json'), 'utf8'))
    expect(saved.extraDirs).toEqual([])
    const status = await w.invoke(info.id, 'app:status', undefined)
    expect(status).toMatchObject({ ok: true, data: { hasProject: true, projectRoot: join(dataDir, 'work', info.id, 'repo'), hasApiKey: true } })
  })

  it('rejects an unusable session id from makeId', async () => {
    const { w, git } = await make([], { makeId: () => '../../etc' })
    await expect(w.create(bodyOf())).rejects.toMatchObject({ code: 'invalid' })
    expect(git.clones).toHaveLength(0)
  })
})

describe('lookup and errors', () => {
  it('get, history, diff, invoke and remove of an unknown or malformed id are not-found', async () => {
    const { w } = await make()
    for (const id of ['00000000-0000-4000-8000-000000000000', '../etc', 'x'.repeat(5000), '']) {
      expect(() => w.get(id), id).toThrow(expect.objectContaining({ code: 'not-found', status: 404 }))
      await expect(w.invoke(id, 'app:status', undefined)).rejects.toMatchObject({ code: 'not-found' })
      await expect(w.diff(id)).rejects.toMatchObject({ code: 'not-found' })
      await expect(w.remove(id)).rejects.toMatchObject({ code: 'not-found' })
      expect(() => w.history(id)).toThrow(expect.objectContaining({ code: 'not-found' }))
    }
  })
})

describe('invoke', () => {
  it('runs a turn in the background: send answers started at once, events follow, the file is written', async () => {
    const { w, watch, dataDir } = await make([call('Write', { file_path: 'hello.txt', content: 'hi\n' }), text('Done writing.')])
    const info = await w.create(bodyOf({ settings: SettingsSchema.parse({ prompter: { mode: 'off' }, permissionMode: 'auto-edit' }) }))
    const events = watch(info.id)
    const r = await send(w, info.id, 'Please write hello.txt')
    expect(r).toEqual({ ok: true, data: 'started' })
    await waitFor(() => ofType(events, 'turn-end').length > 0)
    expect(ofType(events, 'turn-end')[0].reason).toBe('done')
    expect(await readFile(join(dataDir, 'work', info.id, 'repo', 'hello.txt'), 'utf8')).toBe('hi\n')
    expect(w.get(info.id).busy).toBe(false)
  })

  it('answers busy (409) to a second send while a turn is running, even when sent at the same moment', async () => {
    const { w } = await make([{ chunks: [], holdMs: Infinity }])
    const info = await w.create(bodyOf())
    const results = await Promise.allSettled([send(w, info.id, 'one'), send(w, info.id, 'two')])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rej = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rej.reason).toMatchObject({ code: 'busy', status: 409 })
    expect(w.get(info.id).busy).toBe(true)
    await w.invoke(info.id, 'agent:stop', undefined)
  })

  it('stop ends a running turn and the session is usable again', async () => {
    const { w, watch } = await make([{ chunks: [], holdMs: Infinity }, text('ok')])
    const info = await w.create(bodyOf())
    const events = watch(info.id)
    await send(w, info.id, 'one')
    await waitFor(() => w.get(info.id).busy)
    expect(await w.invoke(info.id, 'agent:stop', undefined)).toEqual({ ok: true, data: null })
    await waitFor(() => ofType(events, 'turn-end').length === 1)
    expect(ofType(events, 'turn-end')[0].reason).toBe('stopped')
    await waitFor(() => !w.get(info.id).busy)
    expect(await send(w, info.id, 'two')).toEqual({ ok: true, data: 'started' })
  })

  it('turns a failing background send into an error notice and an error turn-end, with the message redacted', async () => {
    const { w, watch } = await make()
    const info = await w.create(bodyOf())
    const events = watch(info.id)
    await w.putSecrets(info.id, {})
    // Vertex has no script, so the request fails; the agent reports it and ends the turn with an error
    await send(w, info.id, 'hello')
    await waitFor(() => ofType(events, 'turn-end').length > 0)
    expect(ofType(events, 'turn-end')[0].reason).toBe('error')
    expect(JSON.stringify(events)).not.toContain(VKEY)
    await waitFor(() => !w.get(info.id).busy)
  })

  it('reports a rejected send (the app throws) as notice + turn-end error with redacted text, and frees the session', async () => {
    const { w, watch } = await make([text('fine')])
    const info = await w.create(bodyOf())
    const events = watch(info.id)
    const app = (w as unknown as { sessions: Map<string, { app: { send: (t: string) => Promise<unknown> } }> }).sessions.get(info.id)!.app
    const real = app.send.bind(app)
    app.send = async () => {
      throw new Error(`boom ${VKEY} Bearer abcdef123456`)
    }
    expect(await send(w, info.id, 'hello')).toEqual({ ok: true, data: 'started' })
    await waitFor(() => ofType(events, 'turn-end').length > 0)
    expect(ofType(events, 'turn-end')[0].reason).toBe('error')
    const n = notices(events).join('\n')
    expect(n).toContain('error: boom')
    expect(n).not.toContain(VKEY)
    expect(n).not.toContain('abcdef123456')
    app.send = real
    await waitFor(() => !w.get(info.id).busy)
    expect(await send(w, info.id, 'again')).toEqual({ ok: true, data: 'started' })
  })

  it('refuses send without a project or key with the codes the local handlers use', async () => {
    const { w } = await make([text('x')])
    const info = await w.create(bodyOf())
    const app = (w as unknown as { sessions: Map<string, { app: { clearApiKey: () => Promise<unknown> } }> }).sessions.get(info.id)!.app
    await app.clearApiKey()
    expect(await send(w, info.id, 'hi')).toMatchObject({ ok: false, code: 'no-api-key' })
    expect(vertex!.requests).toHaveLength(0)
  })

  it('validates payloads with the shared IPC schemas and answers invalid as a result, not a throw', async () => {
    const { w } = await make()
    const info = await w.create(bodyOf())
    expect(await w.invoke(info.id, 'agent:send', { text: '' })).toMatchObject({ ok: false, code: 'invalid' })
    expect(await w.invoke(info.id, 'agent:send', undefined)).toMatchObject({ ok: false, code: 'invalid' })
    expect(await w.invoke(info.id, 'agent:setMode', { mode: 'yolo' })).toMatchObject({ ok: false, code: 'invalid' })
    expect(await w.invoke(info.id, 'agent:approval', { requestId: 'x', decision: 'maybe' })).toMatchObject({ ok: false, code: 'invalid' })
  })

  it('refuses channels outside the cloud allow-list with forbidden', async () => {
    const { w } = await make()
    const info = await w.create(bodyOf())
    for (const ch of ['project:open', 'secrets:setKey', 'secrets:clear', 'project:choose', 'sessions:resume', 'cloud:status', 'nonsense']) {
      await expect(w.invoke(info.id, ch as never, { path: '/' }), ch).rejects.toMatchObject({ code: 'forbidden', status: 403 })
    }
  })

  it('maps the other channels to the app: mode, status, rules, audit, changes, sessions, settings', async () => {
    const { w, watch } = await make()
    const info = await w.create(bodyOf())
    const events = watch(info.id)
    expect(await w.invoke(info.id, 'agent:setMode', { mode: 'auto-edit' })).toEqual({ ok: true, data: null })
    expect(ofType(events, 'mode').at(-1)?.mode).toBe('auto-edit')
    expect(w.get(info.id).mode).toBe('auto-edit')
    expect(await w.invoke(info.id, 'agent:changes', undefined)).toEqual({ ok: true, data: { files: [], canUndo: false } })
    expect(await w.invoke(info.id, 'rules:list', undefined)).toEqual({ ok: true, data: [] })
    expect(await w.invoke(info.id, 'audit:read', undefined)).toEqual({ ok: true, data: [] })
    expect(await w.invoke(info.id, 'sessions:list', undefined)).toMatchObject({ ok: true })
    expect(await w.invoke(info.id, 'rules:remove', { rule: { tool: 'Bash', prefix: 'ls' } })).toEqual({ ok: true, data: null })
    expect(await w.invoke(info.id, 'app:status', undefined)).toMatchObject({ ok: true, data: { ready: true, hasProject: true, mode: 'auto-edit', busy: false } })
    expect(await w.invoke(info.id, 'agent:undo', undefined)).toEqual({ ok: true, data: { restored: [], removed: [] } })
  })

  it('settings:save applies model and limits but ignores cloud, theme, showDetails and extraDirs', async () => {
    const { w } = await make()
    const info = await w.create(bodyOf())
    const r = await w.invoke(info.id, 'settings:save', {
      patch: { maxSteps: 7, cloud: { workerUrl: 'https://evil.example' }, theme: 'studios', showDetails: true, extraDirs: ['/etc'] },
    })
    expect(r).toMatchObject({ ok: true, data: { settings: { maxSteps: 7, extraDirs: [], theme: 'ai', showDetails: false, cloud: { workerUrl: '' } } } })
  })

  it('prompter:spark and prompter:autopilot reach the app', async () => {
    const { w } = await make([ideas({ title: 'T', prompt: 'Do the thing' })])
    const info = await w.create(bodyOf())
    const spark = await w.invoke(info.id, 'prompter:spark', undefined)
    expect(spark).toMatchObject({ ok: true, data: [{ title: 'T' }, {}, {}] })
    const off = await w.invoke(info.id, 'prompter:autopilot', { on: false })
    expect(off).toMatchObject({ ok: true, data: { settings: { prompter: { mode: 'suggest' } } } })
  })
})

describe('approvals', () => {
  it('relays an approval request and continues once it is answered', async () => {
    const { w, watch, dataDir } = await make([call('Write', { file_path: 'a.txt', content: 'A' }), text('wrote it')])
    const info = await w.create(bodyOf())
    const events = watch(info.id)
    await send(w, info.id, 'write a.txt')
    await waitFor(() => ofType(events, 'approval-request').length > 0)
    expect(w.get(info.id).busy).toBe(true)
    const reqId = ofType(events, 'approval-request')[0].request.call.id
    expect(await w.invoke(info.id, 'agent:approval', { requestId: reqId, decision: 'allow-once' })).toEqual({ ok: true, data: null })
    await waitFor(() => ofType(events, 'turn-end').length > 0)
    expect(await readFile(join(dataDir, 'work', info.id, 'repo', 'a.txt'), 'utf8')).toBe('A')
  })
})

describe('auto-push', () => {
  const writeScript = (): FakeEntry[] => [call('Write', { file_path: 'f.txt', content: 'x' }), text('done')]
  const autoEdit = SettingsSchema.parse({ prompter: { mode: 'off' }, permissionMode: 'auto-edit' })

  it('commits and pushes after a finished turn with "arc: <first line of the prompt>" and says so', async () => {
    const { w, git, watch } = await make(writeScript())
    const info = await w.create(bodyOf({ settings: autoEdit }))
    const events = watch(info.id)
    await send(w, info.id, 'Add the f file\nand then more details')
    await waitFor(() => notices(events).some((n) => n.startsWith('info: Saved to GitHub')))
    expect(git.pushes).toHaveLength(1)
    expect(git.pushes[0]).toMatchObject({ token: GTOKEN, branch: info.branch, httpsUrl: 'https://github.com/octo/hello', message: 'arc: Add the f file' })
    expect(notices(events)).toContain(`info: Saved to GitHub: ${info.branch} (0000001)`.replace('0000001', 'aaaaaa1'))
    expect(w.get(info.id).pushed).toBe(true)
  })

  it('caps the commit message at 72 characters and falls back to "arc: update"', async () => {
    const { w, git, watch } = await make([text('a'), text('b')])
    const info = await w.create(bodyOf())
    watch(info.id)
    await send(w, info.id, 'x'.repeat(200))
    await waitFor(() => git.pushes.length === 1)
    expect(git.pushes[0].message.length).toBeLessThanOrEqual(72)
    expect(git.pushes[0].message.startsWith('arc: xxx')).toBe(true)
  })

  it('says nothing when there was nothing to commit', async () => {
    const { w, git, watch } = await make([text('just talking')])
    const info = await w.create(bodyOf())
    const events = watch(info.id)
    await send(w, info.id, 'hi')
    await waitFor(() => git.pushes.length === 1)
    await new Promise((r) => setTimeout(r, 30))
    expect(notices(events).filter((n) => n.includes('Saved'))).toEqual([])
  })

  it('does not push when autoPush is off', async () => {
    const { w, git, watch } = await make(writeScript())
    const info = await w.create(bodyOf({ settings: autoEdit, autoPush: false }))
    const events = watch(info.id)
    await send(w, info.id, 'Add f')
    await waitFor(() => ofType(events, 'turn-end').length > 0)
    await new Promise((r) => setTimeout(r, 30))
    expect(git.pushes).toHaveLength(0)
  })

  it('does not push after a turn that ended in error', async () => {
    const { w, git, watch } = await make([{ status: 400, body: JSON.stringify({ error: { message: 'bad' } }) }])
    const info = await w.create(bodyOf())
    const events = watch(info.id)
    await send(w, info.id, 'Add f')
    await waitFor(() => ofType(events, 'turn-end').length > 0)
    expect(ofType(events, 'turn-end')[0].reason).toBe('error')
    await new Promise((r) => setTimeout(r, 30))
    expect(git.pushes).toHaveLength(0)
  })

  it('reports a failed push as a warning with a plain message and never the token', async () => {
    const { w, git, watch } = await make(writeScript())
    git.failPush = new Error(`push rejected for https://u:${GTOKEN}@github.com/octo/hello`)
    const info = await w.create(bodyOf({ settings: autoEdit }))
    const events = watch(info.id)
    await send(w, info.id, 'Add f')
    await waitFor(() => notices(events).some((n) => n.startsWith('warn:')))
    const warn = notices(events).find((n) => n.startsWith('warn:'))!
    expect(warn).toContain('push rejected')
    expect(JSON.stringify(events)).not.toContain(GTOKEN)
    expect(w.get(info.id).pushed).toBe(false)
  })

  it('lists files that were left out of the commit in a notice', async () => {
    const { w, git, watch } = await make(writeScript())
    git.skipped = ['.env', 'key.pem']
    const info = await w.create(bodyOf({ settings: autoEdit }))
    const events = watch(info.id)
    await send(w, info.id, 'Add f')
    await waitFor(() => notices(events).some((n) => n.includes('.env')))
    expect(notices(events).join('\n')).toMatch(/warn: .*\.env, key\.pem/)
  })

  it('also pushes after a turn started by Autopilot (which bypasses send)', async () => {
    const { w, git, watch } = await make([
      text('first turn done'),
      ideas({ title: 'Add g', prompt: 'Write g.txt now' }),
      call('Write', { file_path: 'g.txt', content: 'g' }),
      text('autopilot turn done'),
      { status: 500, body: '{}' },
    ])
    const info = await w.create(bodyOf({ settings: SettingsSchema.parse({ prompter: { mode: 'autopilot', maxRounds: 1 }, permissionMode: 'auto-edit' }) }))
    const events = watch(info.id)
    await send(w, info.id, 'Start something')
    await waitFor(() => ofType(events, 'autopilot').some((e) => !e.running), 8000)
    await waitFor(() => git.pushes.length >= 2, 8000)
    expect(git.pushes.some((p) => p.message === 'arc: Write g.txt now')).toBe(true)
  })

  it('runs pushes one at a time per session', async () => {
    const { w, git } = await make([text('a')])
    const info = await w.create(bodyOf())
    let release!: () => void
    git.pushGate = new Promise<void>((r) => (release = r))
    const a = w.push(info.id)
    const b = w.push(info.id)
    await waitFor(() => git.pushes.length >= 1)
    await new Promise((r) => setTimeout(r, 30))
    expect(git.maxActive).toBe(1)
    expect(git.pushes).toHaveLength(1)
    release()
    await Promise.all([a, b])
    expect(git.pushes).toHaveLength(2)
    expect(git.maxActive).toBe(1)
  })
})

describe('push, pr and diff', () => {
  it('push returns the result with the GitHub branch url and marks the session pushed', async () => {
    const { w, git } = await make()
    const info = await w.create(bodyOf())
    await writeFile(join(git.clones[0].dir, 'new.txt'), 'n')
    const r = await w.push(info.id)
    expect(r).toEqual({ branch: info.branch, commit: 'aaaaaa1', pushed: true, skipped: [], url: `https://github.com/octo/hello/tree/${info.branch}` })
    expect(w.get(info.id).pushed).toBe(true)
    expect(git.pushes[0].message).toBe('arc: update')
  })

  it('a push with nothing new reports pushed false and no commit', async () => {
    const { w } = await make()
    const info = await w.create(bodyOf())
    expect(await w.push(info.id)).toMatchObject({ commit: null, pushed: false })
  })

  it('diff goes through git with the base, branch and last pushed head', async () => {
    const { w, git } = await make()
    const info = await w.create(bodyOf())
    expect((await w.diff(info.id)).pushed).toBe(false)
    await writeFile(join(git.clones[0].dir, 'new.txt'), 'n')
    await w.push(info.id)
    const d = await w.diff(info.id)
    expect(d.pushed).toBe(true)
    expect(git.diffs.at(-1)).toMatchObject({ baseBranch: 'main', branch: info.branch, pushedHead: 'aaaaaa1' + '0'.repeat(33) })
    expect(git.diffs[0].pushedHead).toBeNull()
  })

  it('pr pushes first, then opens the pull request from the branch to the base', async () => {
    const { w, git, github } = await make()
    const info = await w.create(bodyOf({ baseBranch: 'develop' }))
    await writeFile(join(git.clones[0].dir, 'new.txt'), 'n')
    const pr = await w.pr(info.id, { title: 'Tidy', body: 'details', draft: true })
    expect(pr).toMatchObject({ number: 7, draft: true })
    expect(git.pushes).toHaveLength(1)
    expect(github.prs[0]).toMatchObject({ owner: 'octo', name: 'hello', token: GTOKEN, head: info.branch, base: 'develop', title: 'Tidy', body: 'details', draft: true })
  })

  it('pr does not call GitHub when the push fails', async () => {
    const { w, git, github } = await make()
    const info = await w.create(bodyOf())
    git.failPush = new Error('rejected')
    await expect(w.pr(info.id, { title: 'T' })).rejects.toMatchObject({ code: 'git', status: 502 })
    expect(github.prs).toHaveLength(0)
  })

  it('maps a GitHub failure to a github error without the token', async () => {
    const { w, github } = await make()
    const info = await w.create(bodyOf())
    github.fail = new Error(`401 for token ${GTOKEN}`)
    const err = await w.pr(info.id, { title: 'T' }).catch((e) => e)
    expect(err).toMatchObject({ code: 'github', status: 502 })
    expect(err.message).not.toContain(GTOKEN)
  })

  it('uses a rotated GitHub token for later pushes', async () => {
    const { w, git } = await make()
    const info = await w.create(bodyOf())
    await w.putSecrets(info.id, { githubToken: 'SENTINEL-rotated-token-77aa88bb' })
    await w.push(info.id)
    expect(git.pushes[0].token).toBe('SENTINEL-rotated-token-77aa88bb')
  })
})

describe('history, subscribe, secrets updates', () => {
  it('history returns the conversation and the event sequence to continue from', async () => {
    const { w, watch } = await make([text('Hello there')])
    const info = await w.create(bodyOf())
    const events = watch(info.id)
    await send(w, info.id, 'hi')
    await waitFor(() => ofType(events, 'turn-end').length > 0)
    const h = w.history(info.id)
    expect(h.history.map((c) => c.role)).toEqual(['user', 'model'])
    expect(h.seq).toBe(events.length)
  })

  it('subscribe replays from a sequence and reports a gap', async () => {
    const { w } = await make([], {})
    const info = await w.create(bodyOf())
    const seen: number[] = []
    const sub = w.subscribe(info.id, 1, (s) => seen.push(s))
    expect(seen[0]).toBe(2)
    expect(sub.gap).toBeNull()
    sub.unsubscribe()
    expect(w.subscriberCount(info.id)).toBe(0)
  })

  it('a new Vertex key replaces the old one for later requests', async () => {
    const { w, watch } = await make([text('one')])
    const info = await w.create(bodyOf())
    const events = watch(info.id)
    await w.putSecrets(info.id, { apiKey: 'SENTINEL-new-vertex-key-12ab34cd' })
    await send(w, info.id, 'hi')
    await waitFor(() => ofType(events, 'turn-end').length > 0)
    const sent = JSON.stringify(vertex!.requests[0].headers) + vertex!.requests[0].url
    expect(sent).toContain('SENTINEL-new-vertex-key-12ab34cd')
    expect(sent).not.toContain(VKEY)
  })

  it('putSecrets rejects unknown fields and empty values', async () => {
    const { w } = await make()
    const info = await w.create(bodyOf())
    await expect(w.putSecrets(info.id, { apiKey: '   ' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(w.putSecrets(info.id, { evil: 'x' } as never)).rejects.toMatchObject({ code: 'invalid' })
  })
})

describe('idle expiry, remove and shutdown', () => {
  it('sweep deletes idle sessions and their files, and keeps busy and recently active ones', async () => {
    const { w, dataDir, advance, watch } = await make([{ chunks: [], holdMs: Infinity }], { idleMs: 1000 })
    const idle = await w.create(bodyOf())
    const busy = await w.create(bodyOf())
    const fresh = await w.create(bodyOf())
    const busyEvents = watch(busy.id)
    await send(w, busy.id, 'long running')
    await waitFor(() => ofType(busyEvents, 'status').some((e) => e.state === 'thinking'))
    advance(2000)
    await w.invoke(fresh.id, 'app:status', undefined)
    await w.sweep()
    expect(w.list().map((s) => s.id).sort()).toEqual([busy.id, fresh.id].sort())
    await expect(stat(join(dataDir, 'work', idle.id))).rejects.toThrow()
    await expect(stat(join(dataDir, 'sessions', idle.id))).rejects.toThrow()
    await w.invoke(busy.id, 'agent:stop', undefined)
  })

  it('subscribing and events count as activity', async () => {
    const { w, advance } = await make([text('x')], { idleMs: 1000 })
    const a = await w.create(bodyOf())
    advance(900)
    w.subscribe(a.id, 0, () => {}).unsubscribe()
    advance(900)
    await w.sweep()
    expect(w.list()).toHaveLength(1)
    advance(1200)
    await w.sweep()
    expect(w.list()).toHaveLength(0)
  })

  it('remove stops a running turn and deletes workspace and session dir', async () => {
    const { w, dataDir } = await make([{ chunks: [], holdMs: Infinity }])
    const info = await w.create(bodyOf())
    await send(w, info.id, 'long')
    await waitFor(() => w.get(info.id).busy)
    await w.remove(info.id)
    expect(() => w.get(info.id)).toThrow()
    await expect(stat(join(dataDir, 'work', info.id))).rejects.toThrow()
    await expect(stat(join(dataDir, 'sessions', info.id))).rejects.toThrow()
  })

  it('shutdown stops every running turn', async () => {
    const { w, watch } = await make([{ chunks: [], holdMs: Infinity }])
    const info = await w.create(bodyOf())
    const events = watch(info.id)
    await send(w, info.id, 'long')
    await waitFor(() => w.get(info.id).busy)
    await w.shutdown()
    await waitFor(() => ofType(events, 'turn-end').length > 0)
    expect(ofType(events, 'turn-end')[0].reason).toBe('stopped')
  })

  it('shutdown lets the push for the turn it just stopped finish before it returns', async () => {
    const { w, git, watch } = await make([{ chunks: [], holdMs: Infinity }])
    const info = await w.create(bodyOf())
    const events = watch(info.id)
    let release!: () => void
    git.pushGate = new Promise<void>((r) => (release = r))
    await send(w, info.id, 'long')
    await waitFor(() => ofType(events, 'status').some((e) => e.state === 'thinking'))
    let finished = false
    const done = w.shutdown().then(() => void (finished = true))
    await waitFor(() => git.pushes.length === 1)
    await new Promise((r) => setTimeout(r, 50))
    expect(finished).toBe(false)
    release()
    await done
    expect(finished).toBe(true)
  })

  it('purgeOrphans removes work and session dirs that no live session owns', async () => {
    const { w, dataDir } = await make()
    const live = await w.create(bodyOf())
    const ghost = '11111111-1111-4111-8111-111111111111'
    await mkdir(join(dataDir, 'work', ghost, 'repo'), { recursive: true })
    await mkdir(join(dataDir, 'sessions', ghost, 'arc'), { recursive: true })
    await w.purgeOrphans()
    await expect(stat(join(dataDir, 'work', ghost))).rejects.toThrow()
    await expect(stat(join(dataDir, 'sessions', ghost))).rejects.toThrow()
    await expect(stat(join(dataDir, 'work', live.id))).resolves.toBeDefined()
  })
})

describe('secrets never leak', () => {
  async function grepTree(dir: string, needles: string[]): Promise<string[]> {
    const hits: string[] = []
    const walk = async (d: string): Promise<void> => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        const p = join(d, e.name)
        if (e.isDirectory()) await walk(p)
        else if (e.isFile()) {
          const body = await readFile(p, 'utf8').catch(() => '')
          for (const n of needles) if (body.includes(n) || p.includes(n)) hits.push(`${p} has ${n}`)
        }
      }
    }
    await walk(dir)
    return hits
  }

  it('keeps the Vertex key, GitHub token and the worker environment out of events, history, results and every file under the data dir', async () => {
    const { w, git, github, dataDir, watch } = await make([
      call('Bash', { command: 'env; echo ---; printenv' }, 'b1'),
      call('Write', { file_path: 'out.txt', content: 'result' }, 'w1'),
      text('All done'),
    ])
    const info = await w.create(bodyOf({ settings: SettingsSchema.parse({ prompter: { mode: 'off' }, permissionMode: 'auto' }) }))
    const events = watch(info.id)
    await send(w, info.id, 'Show me the environment')
    // the container is the sandbox, so auto mode runs the command unattended
    await waitFor(() => ofType(events, 'turn-end').length > 0)
    await waitFor(() => git.pushes.length > 0)

    expect(ofType(events, 'approval-request')).toHaveLength(0)
    const bashResult = ofType(events, 'tool-result').find((e) => e.id === 'b1')
    expect(bashResult, 'the Bash tool really ran').toBeDefined()
    const out = bashResult!.result.output
    expect(out).toContain('PATH=')
    expect(out, 'a non-secret variable is visible, so the listing is real').toContain('WORKER_TEST_VISIBLE=visible-marker-123')
    const sentinels = [VKEY, GTOKEN, ...Object.values(ENV_SENTINELS)]
    for (const s of sentinels) expect(out, s).not.toContain(s)

    await w.diff(info.id)
    await w.pr(info.id, { title: 'T' }).catch(() => undefined)
    const surfaces = JSON.stringify([
      events,
      w.history(info.id),
      await w.diff(info.id),
      w.list(),
      w.get(info.id),
      await w.invoke(info.id, 'audit:read', undefined),
      await w.invoke(info.id, 'app:status', undefined),
      await w.invoke(info.id, 'settings:save', { patch: { maxSteps: 9 } }),
      await w.invoke(info.id, 'sessions:list', undefined),
    ])
    for (const s of sentinels) expect(surfaces, s).not.toContain(s)
    expect(github.prs).toHaveLength(1)
    expect(await grepTree(dataDir, sentinels)).toEqual([])
    expect((await readdir(join(dataDir, 'sessions', info.id, 'arc', 'audit'))).length).toBeGreaterThan(0)
  })

  it('keeps the GitHub token in a private field: it is not an enumerable property of the session and not in anything the worker returns', async () => {
    const { w } = await make()
    const info = await w.create(bodyOf())
    const session = (w as unknown as { sessions: Map<string, object> }).sessions.get(info.id)!
    expect(Object.keys(session).join(',')).not.toMatch(/token|secret/i)
    const shallow = JSON.stringify(session, (k, v) => (k === 'app' || typeof v === 'function' ? undefined : v))
    expect(shallow).not.toContain(GTOKEN)
    expect(JSON.stringify([w.get(info.id), w.list()])).not.toMatch(/SENTINEL/)
  })

  it('scrubs the secrets from events even if something echoes them', async () => {
    const { w, watch } = await make([text(`the key is ${VKEY} and the token is ${GTOKEN}`)])
    const info = await w.create(bodyOf())
    const events = watch(info.id)
    await send(w, info.id, 'hi')
    await waitFor(() => ofType(events, 'turn-end').length > 0)
    const all = JSON.stringify([events, w.history(info.id)])
    expect(all).not.toContain(VKEY)
    expect(all).not.toContain(GTOKEN)
    expect(all).toContain('[REDACTED]')
  })

  it('does not echo secrets in clone, github or setup errors', async () => {
    const { w, git, github } = await make()
    github.fail = new Error(`GitHub said 401 for ${GTOKEN} and ${VKEY}`)
    const e1 = await w.create(bodyOf()).catch((e) => e)
    expect(e1).toMatchObject({ code: 'github' })
    expect(String(e1.message)).not.toContain(GTOKEN)
    expect(String(e1.message)).not.toContain(VKEY)
    github.fail = null
    git.failClone = new Error(`clone failed ${GTOKEN}`)
    const e2 = await w.create(bodyOf()).catch((e) => e)
    expect(String(e2.message)).not.toContain(GTOKEN)
  })
})

// ---------------------------------------------------------------- review fixes

describe('history carries what a connected client would know (pending prompts, in-flight text)', () => {
  const holdAfter = (t: string): FakeEntry => ({ chunks: [chunk([{ text: t }], {})], holdMs: Infinity })

  it('returns the pending approval with the seq, and clears it once the call is answered', async () => {
    const { w, watch } = await make([call('Write', { file_path: 'a.txt', content: 'A' }, 'w1'), text('wrote it')])
    const info = await w.create(bodyOf())
    const events = watch(info.id)
    await send(w, info.id, 'write a.txt')
    await waitFor(() => ofType(events, 'approval-request').length > 0)
    const h = w.history(info.id)
    expect(h.pending.approval?.call.id).toBe('w1')
    expect(h.pending.question).toBeUndefined()
    expect(h.inflight).toBeUndefined()
    expect(h.seq).toBe(events.length)
    await w.invoke(info.id, 'agent:approval', { requestId: 'w1', decision: 'deny' })
    await waitFor(() => ofType(events, 'turn-end').length > 0)
    expect(w.history(info.id).pending).toEqual({})
  })

  it('returns the pending question until it is answered', async () => {
    const { w, watch } = await make([call('AskUser', { question: 'Which one?', options: ['a', 'b'] }, 'q1'), text('ok')])
    const info = await w.create(bodyOf())
    const events = watch(info.id)
    await send(w, info.id, 'ask me')
    await waitFor(() => ofType(events, 'question').length > 0)
    const q = ofType(events, 'question')[0]
    expect(w.history(info.id).pending.question).toEqual({ id: q.id, question: 'Which one?', options: ['a', 'b'] })
    await w.invoke(info.id, 'agent:answer', { questionId: q.id, answer: 'a' })
    expect(w.history(info.id).pending.question).toBeUndefined()
    await waitFor(() => ofType(events, 'turn-end').length > 0)
  })

  it('returns the assistant text streamed so far as in-flight, and not once it is part of the history', async () => {
    const { w, watch } = await make([holdAfter('Working on it, ')])
    const info = await w.create(bodyOf())
    const events = watch(info.id)
    await send(w, info.id, 'go')
    await waitFor(() => ofType(events, 'text-delta').length > 0)
    const h = w.history(info.id)
    expect(h.inflight).toEqual({ text: 'Working on it, ' })
    expect(JSON.stringify(h.history)).not.toContain('Working on it')
    await w.invoke(info.id, 'agent:stop', undefined)
    await waitFor(() => ofType(events, 'turn-end').length > 0)
    expect(w.history(info.id).inflight).toBeUndefined()
  })

  it('never has the same text in both the history and the in-flight text (committed message, pending approval)', async () => {
    const { w, watch } = await make([
      { chunks: [chunk([{ text: 'Let me write it.' }, { functionCall: { name: 'Write', args: { file_path: 'a.txt', content: 'A' }, id: 'w1' } }], {}, 'STOP')] },
      text('done'),
    ])
    const info = await w.create(bodyOf())
    const events = watch(info.id)
    await send(w, info.id, 'go')
    await waitFor(() => ofType(events, 'approval-request').length > 0)
    const h = w.history(info.id)
    expect(JSON.stringify(h.history)).toContain('Let me write it.')
    expect(h.inflight).toBeUndefined()
    expect(h.pending.approval?.call.id).toBe('w1')
    await w.invoke(info.id, 'agent:stop', undefined)
    await waitFor(() => ofType(events, 'turn-end').length > 0)
  })

  it('scrubs secrets in the pending approval and in-flight text', async () => {
    const { w, watch } = await make([holdAfter(`my key ${VKEY} `)])
    const info = await w.create(bodyOf())
    const events = watch(info.id)
    await send(w, info.id, 'go')
    await waitFor(() => ofType(events, 'text-delta').length > 0)
    expect(JSON.stringify(w.history(info.id))).not.toContain(VKEY)
    await w.invoke(info.id, 'agent:stop', undefined)
  })
})

describe('idle sweep keeps live sessions and saves unpushed work first', () => {
  const autoEdit = SettingsSchema.parse({ prompter: { mode: 'off' }, permissionMode: 'auto-edit' })

  it('does not delete a session with an attached stream, however old', async () => {
    const { w, advance } = await make([], { idleMs: 1000 })
    const a = await w.create(bodyOf())
    const sub = w.subscribe(a.id, 0, () => {})
    advance(5000)
    await w.sweep()
    expect(w.list()).toHaveLength(1)
    sub.unsubscribe()
    advance(5000)
    await w.sweep()
    expect(w.list()).toHaveLength(0)
  })

  it('commits and pushes unpushed work before deleting an idle session', async () => {
    const { w, git, advance } = await make([call('Write', { file_path: 'f.txt', content: 'x' }), text('done')], { idleMs: 1000 })
    const info = await w.create(bodyOf({ settings: autoEdit, autoPush: false }))
    await send(w, info.id, 'write f')
    await waitFor(() => !w.get(info.id).busy)
    expect(git.pushes).toHaveLength(0)
    advance(5000)
    await w.sweep()
    expect(git.pushes).toHaveLength(1)
    expect(git.pushes[0]).toMatchObject({ branch: info.branch })
    expect(w.list()).toHaveLength(0)
  })

  it('keeps the session and logs a warning when that push fails', async () => {
    const lines: string[] = []
    const { w, git, advance } = await make([call('Write', { file_path: 'f.txt', content: 'x' }), text('done')], { idleMs: 1000, logger: (l: string) => lines.push(l) })
    const info = await w.create(bodyOf({ settings: autoEdit, autoPush: false }))
    await send(w, info.id, 'write f')
    await waitFor(() => !w.get(info.id).busy)
    git.failPush = new Error(`remote said no for ${GTOKEN}`)
    advance(5000)
    await w.sweep()
    expect(w.list()).toHaveLength(1)
    expect(lines.join('\n')).toMatch(/could not save|unpushed/i)
    expect(lines.join('\n')).not.toContain(GTOKEN)
    git.failPush = null
    await w.sweep()
    expect(w.list()).toHaveLength(0)
  })

  it('does not push for a session with nothing unpushed', async () => {
    const { w, git, advance } = await make([], { idleMs: 1000 })
    await w.create(bodyOf())
    advance(5000)
    await w.sweep()
    expect(git.pushes).toHaveLength(0)
    expect(w.list()).toHaveLength(0)
  })
})

describe('create can be abandoned', () => {
  it('passes a signal to the clone, and an abort during the clone leaves no session and no files', async () => {
    const { w, git, dataDir } = await make()
    const ctl = new AbortController()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const clone = git.clone.bind(git)
    let started = false
    git.clone = async (o) => {
      started = true
      await gate
      return clone(o)
    }
    const p = w.create(bodyOf(), ctl.signal).catch((e) => e)
    await waitFor(() => started)
    ctl.abort()
    release()
    const err = await p
    expect(err).toBeInstanceOf(Error)
    expect(w.list()).toEqual([])
    expect(await readdir(join(dataDir, 'work')).catch(() => [])).toEqual([])
    expect(await readdir(join(dataDir, 'sessions')).catch(() => [])).toEqual([])
    expect(git.clones[0].signal).toBe(ctl.signal)
  })

  it('an already aborted signal clones nothing', async () => {
    const { w, git } = await make()
    const ctl = new AbortController()
    ctl.abort()
    await expect(w.create(bodyOf(), ctl.signal)).rejects.toBeInstanceOf(Error)
    expect(git.clones).toHaveLength(0)
    expect(w.list()).toEqual([])
  })
})

describe('settings:save carries cloud.autoPush into the running session', () => {
  const autoEdit = SettingsSchema.parse({ prompter: { mode: 'off' }, permissionMode: 'auto-edit' })
  const script = (): FakeEntry[] => [call('Write', { file_path: 'f.txt', content: 'x' }), text('done'), call('Write', { file_path: 'g.txt', content: 'y' }), text('done again')]

  it('turns auto-push off and on again', async () => {
    const { w, git, watch } = await make(script())
    const info = await w.create(bodyOf({ settings: autoEdit }))
    const events = watch(info.id)
    expect(await w.invoke(info.id, 'settings:save', { patch: { cloud: { autoPush: false } } })).toMatchObject({ ok: true })
    await send(w, info.id, 'one')
    await waitFor(() => ofType(events, 'turn-end').length === 1)
    await new Promise((r) => setTimeout(r, 100))
    expect(git.pushes).toHaveLength(0)
    expect(await w.invoke(info.id, 'settings:save', { patch: { cloud: { autoPush: true } } })).toMatchObject({ ok: true })
    await send(w, info.id, 'two')
    await waitFor(() => git.pushes.length === 1)
  })

  it('still ignores the other cloud fields and rejects a bad autoPush', async () => {
    const { w } = await make()
    const info = await w.create(bodyOf())
    expect(await w.invoke(info.id, 'settings:save', { patch: { cloud: { autoPush: 'no' } } })).toMatchObject({ ok: false, code: 'invalid' })
    const r = await w.invoke(info.id, 'settings:save', { patch: { cloud: { workerUrl: 'https://evil.example', autoPush: false } } })
    expect(r).toMatchObject({ ok: true, data: { settings: { cloud: { workerUrl: '' } } } })
  })
})

describe('clearApiKey over secrets', () => {
  it('removes the key from the session and stops the turn', async () => {
    const { w, watch } = await make([{ chunks: [], holdMs: Infinity }])
    const info = await w.create(bodyOf())
    const events = watch(info.id)
    await send(w, info.id, 'long')
    await waitFor(() => w.get(info.id).busy)
    await w.putSecrets(info.id, { clearApiKey: true })
    await waitFor(() => ofType(events, 'turn-end').length > 0)
    expect(await w.invoke(info.id, 'app:status', undefined)).toMatchObject({ ok: true, data: { hasApiKey: false } })
    expect(await send(w, info.id, 'again')).toMatchObject({ ok: false, code: 'no-api-key' })
  })

  it('refuses clearApiKey together with a new key', async () => {
    const { w } = await make()
    const info = await w.create(bodyOf())
    await expect(w.putSecrets(info.id, { clearApiKey: true, apiKey: 'another-key-1234' })).rejects.toMatchObject({ code: 'invalid' })
  })
})

describe('paths in invoke results', () => {
  it('error text hides the worker data dir and secrets', async () => {
    const { w, dataDir } = await make()
    const info = await w.create(bodyOf())
    const s = (w as unknown as { sessions: Map<string, { app: { getChanges(): Promise<unknown> } }> }).sessions.get(info.id)!
    s.app.getChanges = async () => {
      throw new Error(`ENOENT: no such file ${join(dataDir, 'work', info.id, 'repo', 'x.ts')} with ${VKEY}`)
    }
    const r = await w.invoke(info.id, 'agent:changes', undefined)
    expect(r).toMatchObject({ ok: false })
    const msg = (r as { error: string }).error
    expect(msg).not.toContain(dataDir)
    expect(msg).not.toContain(VKEY)
    expect(msg).toContain('<workspace>')
  })

  it('agent:changes and agent:undo return paths relative to the repository root', async () => {
    const { w, watch } = await make([call('Write', { file_path: 'sub/f.txt', content: 'x' }), text('done')])
    const info = await w.create(bodyOf({ settings: SettingsSchema.parse({ prompter: { mode: 'off' }, permissionMode: 'auto-edit' }), autoPush: false }))
    const events = watch(info.id)
    await send(w, info.id, 'write')
    await waitFor(() => ofType(events, 'turn-end').length > 0)
    const changes = await w.invoke(info.id, 'agent:changes', undefined)
    expect(changes).toEqual({ ok: true, data: { files: ['sub/f.txt'], canUndo: true } })
    const undo = await w.invoke(info.id, 'agent:undo', undefined)
    expect(undo).toEqual({ ok: true, data: { restored: [], removed: ['sub/f.txt'] } })
  })

  it('changes events show relative paths too', async () => {
    const { w, watch } = await make([call('Write', { file_path: 'sub/f.txt', content: 'x' }), text('done')])
    const info = await w.create(bodyOf({ settings: SettingsSchema.parse({ prompter: { mode: 'off' }, permissionMode: 'auto-edit' }), autoPush: false }))
    const events = watch(info.id)
    await send(w, info.id, 'write')
    await waitFor(() => ofType(events, 'turn-end').length > 0)
    const last = ofType(events, 'changes').at(-1)
    expect(last?.files).toEqual(['sub/f.txt'])
  })
})
