import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BackendApp } from '../../../src/main/backend'
import { CloudClient } from '../../../src/main/cloud/client'
import { CliGitOps } from '../../../src/main/cloud/gitOps'
import { RestGithubApi } from '../../../src/main/cloud/github'
import { BackendRouter } from '../../../src/main/cloud/router'
import { createWorkerServer } from '../../../src/main/cloud/server'
import { CloudWorker } from '../../../src/main/cloud/worker'
import type { EventLogOptions } from '../../../src/main/cloud/eventLog'
import { MemoryKeyStore, type Cipher } from '../../../src/main/store/secrets'
import type { SettingsPatch } from '../../../src/main/store/settings'
import type { AgentEvent, PermissionMode } from '../../../src/shared/types'
import { startFakeVertex, type FakeEntry, type FakeVertex } from '../../helpers/fakeVertexServer'
import { startFakeGithub, type FakeGithub } from './fakeGithubServer'

// Three distinct secrets. None of them matches a redaction pattern (no AIza..., sk-..., Bearer), so a leak can
// only be stopped by the exact-secret scrubbing, which is what the tests want to prove.
export const WORKER_TOKEN = 'SENTINEL-worker-token-0123456789abcdef0123456789abcdef'
export const GITHUB_TOKEN = 'SENTINEL-github-token-7c1d9e0b5a42f863'
export const VERTEX_KEY = 'SENTINEL-vertex-key-b3a8f2c4d1e6097a'
export const ALL_SECRETS = [WORKER_TOKEN, GITHUB_TOKEN, VERTEX_KEY]

const NO_CIPHER: Cipher = {
  isAvailable: () => false,
  encrypt: () => {
    throw new Error('no cipher in tests')
  },
  decrypt: () => {
    throw new Error('no cipher in tests')
  },
}

const GIT_ENV = { PATH: process.env.PATH ?? '', HOME: '/nonexistent', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

/** Plain git for fixtures and assertions (never for the code under test). */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'protocol.file.allow=always', '-c', 'user.name=Seed', '-c', 'user.email=seed@example.com', ...args], {
    cwd,
    env: GIT_ENV,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

export async function waitFor(cond: () => boolean | Promise<boolean>, what = 'condition', ms = 10_000): Promise<void> {
  const t0 = Date.now()
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error(`waitFor timed out: ${what}`)
    await new Promise((r) => setTimeout(r, 15))
  }
}

export const ofType = <T extends AgentEvent['type']>(events: AgentEvent[], type: T) =>
  events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type)
export const noticeTexts = (events: AgentEvent[]) => ofType(events, 'notice').map((n) => n.message)

/** Every regular file under `dir` (including .git internals), as absolute paths. */
export async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.isFile()) out.push(p)
    }
  }
  await walk(dir)
  return out
}

/** Files under `dir` whose bytes or whose path contain any of `needles`. */
export async function filesContaining(dir: string, needles: string[]): Promise<string[]> {
  const hits: string[] = []
  for (const f of await walkFiles(dir)) {
    const buf = await readFile(f).catch(() => Buffer.alloc(0))
    if (needles.some((n) => f.includes(n) || buf.includes(n))) hits.push(f)
  }
  return hits
}

export interface Desktop {
  router: BackendRouter
  local: BackendApp
  /** What the renderer would receive: every event the router (and the local app) emits, in order. */
  events: AgentEvent[]
  /** Gate the client's reconnect wait: while closed, reconnects wait. */
  gate: { hold(): void; release(): void }
}

export interface Stack {
  root: string
  dataDir: string
  remotes: string
  workerUrl: string
  vertex: FakeVertex
  github: FakeGithub
  readonly worker: CloudWorker
  readonly server: Server
  /** Lines the HTTP layer logged (internal errors). */
  serverLog: string[]
  /** Open SSE sockets on the server side (accepted /events requests whose socket is still open). */
  sseSockets: Set<Socket>
  /** One line per invocation of the git wrapper: `token=set|` cwd and every argument. */
  gitLog(): Promise<string[]>
  barePath(owner: string, name: string): string
  /** Create a second bare repo with a seeded main, for tests that need a hostile redirect target. */
  seedBare(base: string, owner: string, name: string): Promise<string>
  /** Kill the worker (sockets and memory), start a new one on the same port over the same disk, and purge orphans. */
  restartWorker(): Promise<void>
  desktop(opts?: { workerToken?: string; mode?: PermissionMode; autoPush?: boolean; settings?: SettingsPatch }): Promise<Desktop>
  close(): Promise<void>
}

export interface StackOptions {
  /** The fake Vertex script; a function gets the temp root first, for scripts that need to name a path in it. */
  script: FakeEntry[] | ((ctx: { root: string; remotes: string }) => FakeEntry[])
  /** Repos to create on the fake GitHub (default `octo/hello`). */
  repos?: string[]
  failLimit?: number
  eventLog?: EventLogOptions
  /** Extra env the agent's shell would see; set on process.env for the life of the stack. */
  env?: Record<string, string>
}

export async function seedBare(base: string, owner: string, name: string): Promise<string> {
  const bare = join(base, owner, name)
  await mkdir(join(base, owner), { recursive: true })
  git(base, 'init', '--bare', '--initial-branch=main', bare)
  const seed = await mkdtemp(join(tmpdir(), 'arc-e2e-seed-'))
  try {
    git(seed, 'init', '--initial-branch=main')
    await writeFile(join(seed, 'README.md'), `# ${owner}/${name}\n`)
    await mkdir(join(seed, 'src'))
    await writeFile(join(seed, 'src', 'index.ts'), 'export const answer = 41\n')
    git(seed, 'add', '-A')
    git(seed, 'commit', '-m', 'initial')
    git(seed, 'remote', 'add', 'origin', `file://${bare}`)
    git(seed, 'push', 'origin', 'main')
  } finally {
    await rm(seed, { recursive: true, force: true })
  }
  return bare
}

/**
 * The real stack in one process: BackendRouter + BackendApp (desktop) -> CloudClient -> HTTP/SSE ->
 * createWorkerServer -> CloudWorker -> CliGitOps (real git) + RestGithubApi (to a fake GitHub) + BackendApp (agent)
 * -> VertexClient (to the fake Vertex). The only fakes are the remote ends: GitHub, Vertex, and a local bare repo
 * that a gitBin wrapper maps `https://github.com/<o>/<r>` onto with url.<base>.insteadOf.
 */
export async function createStack(o: StackOptions): Promise<Stack> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arc-e2e-')))
  const dataDir = join(root, 'data')
  const remotes = join(root, 'remotes')
  await mkdir(dataDir, { recursive: true })
  const repos = o.repos ?? ['octo/hello']
  for (const slug of repos) {
    const [owner, name] = slug.split('/')
    await seedBare(remotes, owner, name)
  }

  // The wrapper logs every call (whether a token was in the environment, and every argument) and then runs the
  // real git with an insteadOf for the whole of https://github.com/ plus the file transport. The worker's own
  // `-c protocol.allow=never` still applies; the tamper check reads only the repo-local config, so this is legal.
  const gitLogFile = join(root, 'git-calls.log')
  const wrapper = join(root, 'git-wrapper.sh')
  await writeFile(gitLogFile, '')
  await writeFile(
    wrapper,
    [
      '#!/bin/sh',
      `printf 'token=%s args=' "\${ARC_GIT_TOKEN:+set}" >> '${gitLogFile}'`,
      `for a in "$@"; do printf '[%s]' "$a" >> '${gitLogFile}'; done`,
      `printf '\\n' >> '${gitLogFile}'`,
      `exec git -c 'url.file://${remotes}/.insteadOf=https://github.com/' -c protocol.file.allow=always "$@"`,
      '',
    ].join('\n'),
  )
  await chmod(wrapper, 0o755)

  const barePath = (owner: string, name: string): string => join(remotes, owner, name)
  const vertex = await startFakeVertex(typeof o.script === 'function' ? o.script({ root, remotes }) : o.script)
  const github = await startFakeGithub({
    token: GITHUB_TOKEN,
    repos,
    branchExists: (owner, name, branch) => {
      try {
        git(barePath(owner, name), 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`)
        return true
      } catch {
        return false
      }
    },
  })

  const savedEnv: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(o.env ?? {})) {
    savedEnv[k] = process.env[k]
    process.env[k] = v
  }

  const makeWorker = (): CloudWorker =>
    new CloudWorker({
      dataDir,
      git: new CliGitOps({ workDir: join(dataDir, 'git'), gitBin: wrapper, allowFileRemotes: true }),
      github: new RestGithubApi({ apiBase: github.url }),
      vertexBaseUrl: vertex.baseUrl,
      vertexSleep: async () => undefined,
      eventLog: o.eventLog,
    })
  const serverLog: string[] = []
  const sockets = new Set<Socket>()
  const sseSockets = new Set<Socket>()
  const makeServer = (w: CloudWorker): Server => {
    const srv = createWorkerServer({ worker: w, token: WORKER_TOKEN, logger: (l) => serverLog.push(l), failLimit: o.failLimit ? { perMinute: o.failLimit } : undefined })
    srv.on('connection', (sock) => {
      sockets.add(sock)
      sock.on('close', () => sockets.delete(sock))
    })
    srv.on('request', (req, res) => {
      if (/\/events(\?|$)/.test(req.url ?? '')) {
        // Keep-alive sockets outlive the response, so the stream is tracked by its response, not by the socket.
        sseSockets.add(req.socket)
        res.once('close', () => sseSockets.delete(req.socket))
      }
    })
    return srv
  }
  let worker = makeWorker()
  let server = makeServer(worker)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  const workerUrl = `http://127.0.0.1:${port}`

  const desktops: Desktop[] = []
  const stack: Stack = {
    root,
    dataDir,
    remotes,
    workerUrl,
    vertex,
    github,
    get worker() {
      return worker
    },
    get server() {
      return server
    },
    serverLog,
    sseSockets,
    gitLog: async () => (await readFile(gitLogFile, 'utf8')).split('\n').filter(Boolean),
    barePath,
    seedBare: (base, owner, name) => seedBare(base, owner, name),
    async desktop(d = {}) {
      const dir = await mkdtemp(join(root, 'desktop-'))
      const events: AgentEvent[] = []
      const emit = (e: AgentEvent): void => {
        events.push(e)
      }
      const store = new MemoryKeyStore()
      const local = new BackendApp({
        dataDir: dir,
        cipher: NO_CIPHER,
        keyStore: store,
        home: join(dir, 'home'),
        emit,
        vertexBaseUrl: vertex.baseUrl,
        vertexSleep: async () => undefined,
        sandboxAvailable: false,
      })
      await local.init()
      await store.setApiKey(VERTEX_KEY)
      await store.setSecret('cloud-token', d.workerToken ?? WORKER_TOKEN)
      await store.setSecret('github-token', GITHUB_TOKEN)
      await local.saveSettings({
        permissionMode: d.mode ?? 'auto',
        prompter: { mode: 'off' },
        ...d.settings,
        cloud: { workerUrl, autoPush: d.autoPush ?? true },
      })
      let open = true
      let waiting: Array<() => void> = []
      const gate = {
        hold: () => {
          open = false
        },
        release: () => {
          open = true
          const w = waiting
          waiting = []
          for (const f of w) f()
        },
      }
      const router = new BackendRouter({
        local,
        vault: store,
        keys: store,
        emit,
        // Fast reconnects, but a test can hold them to let events pile up while the stream is down.
        clientFactory: (url, token) =>
          new CloudClient({
            baseUrl: url,
            token,
            sleep: async (_ms, signal) => {
              while (!open && !signal?.aborted) await new Promise<void>((r) => waiting.push(r))
              await new Promise((r) => setTimeout(r, 20))
            },
          }),
      })
      const desktop: Desktop = { router, local, events, gate }
      desktops.push(desktop)
      return desktop
    },
    async restartWorker() {
      // Like a container restart: every socket dies, the process memory (sessions) is gone, the disk stays.
      await worker.shutdown().catch(() => undefined)
      for (const sock of sockets) sock.destroy()
      await new Promise<void>((r) => server.close(() => r()))
      worker = makeWorker()
      await worker.purgeOrphans()
      server = makeServer(worker)
      await new Promise<void>((r) => server.listen(port, '127.0.0.1', r))
    },
    async close() {
      for (const d of desktops) {
        d.gate.release()
        await d.router.dispose().catch(() => undefined)
      }
      await worker.shutdown().catch(() => undefined)
      for (const s of sockets) s.destroy()
      await new Promise<void>((r) => server.close(() => r()))
      await vertex.close()
      await github.close()
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
      await rm(root, { recursive: true, force: true })
    },
  }
  return stack
}
