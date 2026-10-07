import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { CLOUD_BRANCH_PREFIX, type CloudDiff, type CloudSessionInfo, type PullRequestResult, type PushResult } from '../../shared/cloud'
import type { IpcResult } from '../../shared/channels'
import { IPC_SCHEMAS, type IpcSchemas } from '../../shared/ipc'
import type { AgentEvent, PermissionMode } from '../../shared/types'
import { BackendApp, NoProjectError, NotReadyError } from '../backend'
import { redact } from '../safety/redact'
import { MemoryKeyStore, type Cipher } from '../store/secrets'
import type { SettingsPatch } from '../store/settings'
import type { Content } from '../vertex/types'
import { EventLog, type EventListener, type EventLogOptions, type Subscription } from './eventLog'
import {
  CLOUD_INVOKE_CHANNELS,
  SecretsBody,
  type CreateSessionBody,
  type GitOps,
  type GithubApi,
  type PrBody,
} from './protocol'
import { isSafeBranchName, makeBranchName, parseRepoRef } from './repoRef'

export type WorkerErrorCode = 'invalid' | 'not-found' | 'busy' | 'too-many-sessions' | 'git' | 'github' | 'forbidden'

/** An error the HTTP layer can show to the client as is: plain message, no secrets, no internals. */
export class WorkerError extends Error {
  constructor(
    readonly code: WorkerErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'WorkerError'
  }
}

export interface WorkerDeps {
  dataDir: string
  git: GitOps
  github: GithubApi
  /** Hosts a repository may live on (GitHub Enterprise); defaults to github.com. */
  hosts?: string[]
  maxSessions?: number
  idleMs?: number
  now?: () => number
  home?: string
  vertexBaseUrl?: string
  vertexSleep?: (ms: number) => Promise<void>
  makeId?: () => string
  /** Replay buffer limits per session (tests shrink them). */
  eventLog?: EventLogOptions
}

const ID_RE = /^[a-f0-9-]{36}$/
const PLAIN_REF = /^[A-Za-z0-9._/-]{1,200}$/
const PUSH_REASONS = new Set(['done', 'stopped', 'step-cap', 'budget'])
const EDITING_TOOLS = new Set(['Edit', 'Write', 'Bash'])
const SHUTDOWN_WAIT_MS = 6000
const REMOVE_WAIT_MS = 5000
const MARK = '[REDACTED]'

/** The key store is injected, so the encrypted store (and its cipher) is never used on the worker. */
const NO_CIPHER: Cipher = {
  isAvailable: () => false,
  encrypt: () => {
    throw new Error('No cipher on the worker')
  },
  decrypt: () => {
    throw new Error('No cipher on the worker')
  },
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
/** Wait for `p`, but no longer than `ms`; the timer does not outlive the wait. */
async function within(p: Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([p, new Promise<void>((r) => (timer = setTimeout(r, ms)))])
  } finally {
    clearTimeout(timer)
  }
}
const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Replace every secret in every string (keys included) of a JSON-like value. Returns the value itself when nothing matches. */
function scrubDeep<T>(value: T, secrets: string[]): T {
  const live = secrets.filter((s) => s.length >= 8)
  if (live.length === 0) return value
  const json = JSON.stringify(value)
  if (json === undefined || !live.some((s) => json.includes(s))) return value
  const clean = (v: unknown): unknown => {
    if (typeof v === 'string') return live.reduce((acc, s) => acc.split(s).join(MARK), v)
    if (Array.isArray(v)) return v.map(clean)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [clean(k) as string, clean(x)]))
    return v
  }
  return clean(value) as T
}

/** Carries an IpcResult out of dispatch for the business refusals that are not WorkerErrors. */
class Reply {
  constructor(readonly result: IpcResult) {}
}

class Session {
  readonly log: EventLog
  readonly closers = new Set<() => void>()
  app!: BackendApp
  head: string | null = null
  pushedHead: string | null = null
  mode: PermissionMode | null = null
  /** A send was accepted and its turn has not ended yet. */
  sending = false
  autopilotRunning = false
  /** The newest prompt came from Autopilot, so the invoke-tracked text is stale. */
  autopilotTurn = false
  lastUserText: string | null = null
  /** Edit, Write or Bash ran since the last push. */
  dirty = false
  editEpoch = 0
  subscribers = 0
  pending = 0
  queue: Promise<void> = Promise.resolve()
  closed = false
  autoPush = true
  lastActiveAt: number
  readonly #known = new Set<string>()
  #githubToken: string

  constructor(
    readonly id: string,
    readonly host: string,
    readonly owner: string,
    readonly name: string,
    readonly httpsUrl: string,
    readonly branch: string,
    readonly baseBranch: string,
    readonly repoDir: string,
    readonly sessionDir: string,
    readonly createdAt: number,
    apiKey: string,
    githubToken: string,
    logOptions?: EventLogOptions,
  ) {
    this.log = new EventLog(logOptions)
    this.lastActiveAt = createdAt
    this.#githubToken = githubToken
    this.#known.add(apiKey)
    this.#known.add(githubToken)
  }

  githubToken(): string {
    return this.#githubToken
  }
  setGithubToken(token: string): void {
    this.#githubToken = token
    this.#known.add(token)
  }
  noteSecret(value: string): void {
    this.#known.add(value)
  }
  /** Every secret this session has held, for redaction. */
  secrets(): string[] {
    return [...this.#known]
  }
  scrub<T>(value: T): T {
    return scrubDeep(value, this.secrets())
  }
  redactText(text: string): string {
    return redact(text, this.secrets())
  }
}

/**
 * Runs cloud sessions: a clone of the repo plus one BackendApp (the same agent as local) per session.
 * Pure Node, so it is tested on Linux with fakes for git and GitHub.
 */
export class CloudWorker {
  private readonly sessions = new Map<string, Session>()
  private readonly creatingIds = new Set<string>()
  private readonly maxSessions: number
  private readonly idleMs: number
  private readonly now: () => number
  private readonly home: string
  private readonly makeId: () => string

  constructor(private readonly deps: WorkerDeps) {
    this.maxSessions = deps.maxSessions ?? 4
    this.idleMs = deps.idleMs ?? 24 * 60 * 60 * 1000
    this.now = deps.now ?? Date.now
    this.home = deps.home ?? join(deps.dataDir, 'home')
    this.makeId = deps.makeId ?? randomUUID
  }

  // ---------------------------------------------------------------- lookup

  private lookup(id: string): Session {
    const s = ID_RE.test(id) ? this.sessions.get(id) : undefined
    if (!s) throw new WorkerError('not-found', 404, 'That session does not exist (it may have ended or the worker restarted).')
    return s
  }

  private touch(s: Session): void {
    s.lastActiveAt = this.now()
  }

  private infoOf(s: Session): CloudSessionInfo {
    return {
      id: s.id,
      repo: `${s.owner}/${s.name}`,
      branch: s.branch,
      baseBranch: s.baseBranch,
      busy: s.sending || s.autopilotRunning,
      mode: s.mode,
      createdAt: new Date(s.createdAt).toISOString(),
      lastActiveAt: new Date(s.lastActiveAt).toISOString(),
      pushed: s.pushedHead !== null && !s.dirty,
    }
  }

  list(): CloudSessionInfo[] {
    return [...this.sessions.values()].sort((a, b) => a.createdAt - b.createdAt).map((s) => this.infoOf(s))
  }

  get(id: string): CloudSessionInfo {
    return this.infoOf(this.lookup(id))
  }

  /** Listeners attached through subscribe() (the worker's own watcher is not counted). */
  subscriberCount(id: string): number {
    return this.sessions.get(id)?.subscribers ?? 0
  }

  // ---------------------------------------------------------------- create

  async create(body: CreateSessionBody): Promise<CloudSessionInfo> {
    if (this.sessions.size + this.creatingIds.size >= this.maxSessions) {
      throw new WorkerError('too-many-sessions', 429, `This worker already runs ${this.maxSessions} sessions. End one first.`)
    }
    const id = this.makeId()
    if (!ID_RE.test(id) || this.sessions.has(id) || this.creatingIds.has(id)) {
      throw new WorkerError('invalid', 400, 'Could not allocate a session id')
    }
    this.creatingIds.add(id)
    try {
      return await this.createChecked(id, body)
    } finally {
      this.creatingIds.delete(id)
    }
  }

  private async createChecked(id: string, body: CreateSessionBody): Promise<CloudSessionInfo> {
    const { apiKey, githubToken } = body.secrets
    const secrets = [apiKey, githubToken]
    const fail = (code: 'git' | 'github', err: unknown): never => {
      throw new WorkerError(code, 502, redact(message(err), secrets).slice(0, 500))
    }

    let ref: ReturnType<typeof parseRepoRef>
    try {
      ref = parseRepoRef(body.repo, { hosts: this.deps.hosts })
    } catch (err) {
      throw new WorkerError('invalid', 400, redact(message(err), secrets))
    }
    if (body.baseBranch !== undefined && (!PLAIN_REF.test(body.baseBranch) || body.baseBranch.startsWith('-') || body.baseBranch.includes('..'))) {
      throw new WorkerError('invalid', 400, 'The base branch name contains characters that are not allowed.')
    }

    const repo = await this.deps.github.getRepo({ owner: ref.owner, name: ref.name, token: githubToken }).catch((err) => fail('github', err))
    if (!repo.canPush) {
      throw new WorkerError(
        'forbidden',
        403,
        `Your GitHub token cannot push to ${ref.slug}. Give it Contents and Pull requests (read and write) on that repository.`,
      )
    }
    const baseBranch = body.baseBranch ?? repo.defaultBranch
    const branch = makeBranchName(body.name)
    if (!branch.startsWith(CLOUD_BRANCH_PREFIX) || !isSafeBranchName(branch)) throw new WorkerError('invalid', 400, 'Could not make a safe branch name')

    const workDir = join(this.deps.dataDir, 'work', id)
    const sessionDir = join(this.deps.dataDir, 'sessions', id)
    const s = new Session(id, ref.host, ref.owner, ref.name, ref.httpsUrl, branch, baseBranch, join(workDir, 'repo'), sessionDir, this.now(), apiKey, githubToken, this.deps.eventLog)
    try {
      await mkdir(workDir, { recursive: true })
      const cloned = await this.deps.git
        .clone({ httpsUrl: ref.httpsUrl, dir: s.repoDir, token: githubToken, baseBranch, branch })
        .catch((err) => fail('git', err))
      s.head = cloned.head
      const keyStore = new MemoryKeyStore()
      await keyStore.setApiKey(apiKey)
      await mkdir(this.home, { recursive: true })
      const app = new BackendApp({
        dataDir: join(sessionDir, 'arc'),
        cipher: NO_CIPHER,
        keyStore,
        home: this.home,
        emit: (e) => this.record(s, e),
        vertexBaseUrl: this.deps.vertexBaseUrl,
        vertexSleep: this.deps.vertexSleep,
        sandboxAvailable: false,
        trustContainer: true,
      })
      s.app = app
      await app.init()
      await app.saveSettings({ ...body.settings, extraDirs: [] } as SettingsPatch)
      await app.openProject(s.repoDir)
      s.autoPush = body.autoPush
    } catch (err) {
      s.closed = true
      await this.deleteFiles(id)
      if (err instanceof WorkerError) throw err
      throw new Error(redact(message(err), secrets))
    }
    this.sessions.set(id, s)
    return this.infoOf(s)
  }

  // ---------------------------------------------------------------- events

  private record(s: Session, event: AgentEvent): void {
    if (s.closed) return
    this.touch(s)
    switch (event.type) {
      case 'mode':
        s.mode = event.mode
        break
      case 'autopilot':
        s.autopilotRunning = event.running
        if (event.running) s.autopilotTurn = true
        break
      case 'tool-call':
        if (EDITING_TOOLS.has(event.call.name)) {
          s.dirty = true
          s.editEpoch++
        }
        break
      case 'turn-end':
        s.sending = false
        break
    }
    s.log.append(s.scrub(event))
    if (event.type === 'turn-end' && s.autoPush && PUSH_REASONS.has(event.reason)) this.autoPush(s)
  }

  subscribe(id: string, after: number, listener: EventListener, onClosed?: () => void): Subscription {
    const s = this.lookup(id)
    this.touch(s)
    s.subscribers++
    if (onClosed) s.closers.add(onClosed)
    const sub = s.log.subscribe(after, listener)
    let done = false
    return {
      gap: sub.gap,
      unsubscribe: () => {
        if (done) return
        done = true
        sub.unsubscribe()
        s.subscribers--
        if (onClosed) s.closers.delete(onClosed)
      },
    }
  }

  history(id: string): { history: Content[]; seq: number } {
    const s = this.lookup(id)
    this.touch(s)
    return { history: s.scrub(s.app.getHistory()), seq: s.log.current() }
  }

  // ---------------------------------------------------------------- invoke

  async invoke(id: string, channel: string, payload: unknown): Promise<IpcResult> {
    const s = this.lookup(id)
    this.touch(s)
    if (!(CLOUD_INVOKE_CHANNELS as readonly string[]).includes(channel)) {
      throw new WorkerError('forbidden', 403, 'That action is not available on a cloud session.')
    }
    const ch = channel as (typeof CLOUD_INVOKE_CHANNELS)[number]
    const parsed = IPC_SCHEMAS[ch].safeParse(payload)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return { ok: false, error: `Invalid request (${issue?.path.join('.') || 'payload'}: ${issue?.message ?? 'invalid'})`, code: 'invalid' }
    }
    const data = parsed.data as never
    try {
      const out = await this.dispatch(s, ch, data)
      return { ok: true, data: s.scrub(out ?? null) }
    } catch (err) {
      if (err instanceof WorkerError) throw err
      if (err instanceof Reply) return err.result
      if (err instanceof NotReadyError || err instanceof NoProjectError) return { ok: false, error: err.message, code: err.code }
      return { ok: false, error: s.redactText(message(err)) }
    }
  }

  private async dispatch(s: Session, channel: (typeof CLOUD_INVOKE_CHANNELS)[number], d: Record<string, unknown>): Promise<unknown> {
    const app = s.app
    switch (channel) {
      case 'agent:send':
        return this.startTurn(s, d.text as string)
      case 'agent:stop':
        return app.stop()
      case 'agent:approval': {
        const note = d.note as string | undefined
        return app.resolveApproval(d.requestId as string, { decision: d.decision as 'allow-once' | 'always' | 'deny', ...(note ? { note } : {}) })
      }
      case 'agent:answer':
        return app.resolveAnswer(d.questionId as string, d.answer as string)
      case 'agent:setMode':
        return app.setMode(d.mode as PermissionMode)
      case 'agent:undo':
        return app.undo()
      case 'agent:changes':
        return app.getChanges()
      case 'settings:save': {
        const { cloud: _c, theme: _t, showDetails: _s, extraDirs: _e, ...patch } = d.patch as Record<string, unknown>
        return app.saveSettings(patch as SettingsPatch)
      }
      case 'sessions:list':
        return app.listSessions()
      case 'rules:list':
        return app.listRules()
      case 'rules:remove':
        return app.removeRule(d.rule as Parameters<BackendApp['removeRule']>[0])
      case 'audit:read':
        return app.readAudit()
      case 'prompter:spark':
        return app.spark()
      case 'prompter:autopilot':
        return app.autopilot(d.on as boolean)
      case 'app:status':
        return app.status()
    }
  }

  /** Accepts a prompt and answers at once; the turn runs in the background and its end arrives as events. */
  private async startTurn(s: Session, text: string): Promise<'started'> {
    const busy = () => new WorkerError('busy', 409, 'A turn is already running. Stop it or wait for it to finish.')
    if (s.sending) throw busy()
    s.sending = true
    let accepted = false
    try {
      const st = await s.app.status()
      if (!st.hasApiKey) throw new Reply({ ok: false, error: new NotReadyError().message, code: 'no-api-key' })
      if (!st.hasProject) throw new Reply({ ok: false, error: new NoProjectError().message, code: 'no-project' })
      if (st.busy) throw busy()
      accepted = true
    } finally {
      if (!accepted) s.sending = false
    }
    s.lastUserText = text
    s.autopilotTurn = false
    void s.app.send(text).then(
      () => {
        s.sending = false
      },
      (err: unknown) => {
        s.sending = false
        this.record(s, { type: 'notice', level: 'error', message: s.redactText(message(err)) })
        this.record(s, { type: 'turn-end', reason: 'error' })
      },
    )
    return 'started'
  }

  async putSecrets(id: string, body: SecretsBody): Promise<void> {
    const s = this.lookup(id)
    this.touch(s)
    const parsed = SecretsBody.safeParse(body)
    if (!parsed.success) throw new WorkerError('invalid', 400, 'Invalid secrets')
    const { apiKey, githubToken } = parsed.data
    if (apiKey) {
      s.noteSecret(apiKey)
      await s.app.setApiKey(apiKey)
    }
    if (githubToken) s.setGithubToken(githubToken)
  }

  // ------------------------------------------------------------ git, GitHub

  private enqueue<T>(s: Session, fn: () => Promise<T>): Promise<T> {
    s.pending++
    const run = s.queue.then(fn)
    s.queue = run.then(
      () => undefined,
      () => undefined,
    ).then(() => {
      s.pending--
    })
    return run
  }

  private latestPrompt(s: Session): string | null {
    if (s.autopilotTurn) {
      for (const c of [...s.app.getHistory()].reverse()) {
        if (c.role !== 'user' || c.parts.some((p) => p.functionResponse)) continue
        const t = c.parts.map((p) => p.text ?? '').join(' ').trim()
        if (t) return t
      }
    }
    return s.lastUserText
  }

  private commitMessage(s: Session): string {
    const first = (this.latestPrompt(s) ?? '').split(/\r?\n/)[0].replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
    const msg = first ? `arc: ${first}` : 'arc: update'
    return s.redactText(msg.slice(0, 72).trimEnd())
  }

  private async commitAndPush(s: Session): Promise<PushResult> {
    const epoch = s.editEpoch
    const r = await this.deps.git
      .commitAndPush({ dir: s.repoDir, httpsUrl: s.httpsUrl, token: s.githubToken(), branch: s.branch, message: this.commitMessage(s) })
      .catch((err) => {
        throw new WorkerError('git', 502, s.redactText(message(err)).slice(0, 500))
      })
    s.head = r.head
    if (r.pushed) {
      s.pushedHead = r.head
      if (s.editEpoch === epoch) s.dirty = false
    }
    return {
      branch: s.branch,
      commit: r.commit ? r.commit.slice(0, 12) : null,
      pushed: r.pushed,
      skipped: s.scrub(r.skipped),
      url: `https://${s.host}/${s.owner}/${s.name}/tree/${s.branch.split('/').map(encodeURIComponent).join('/')}`,
    }
  }

  private autoPush(s: Session): void {
    void this.enqueue(s, async () => {
      if (s.closed) return
      const r = await this.commitAndPush(s)
      if (r.skipped.length > 0) {
        this.record(s, { type: 'notice', level: 'warn', message: `Left out of the commit (they look like secrets or are very large): ${r.skipped.join(', ')}` })
      }
      if (r.pushed) {
        this.record(s, { type: 'notice', level: 'info', message: `Saved to GitHub: ${s.branch} (${(r.commit ?? s.head ?? '').slice(0, 7)})` })
      }
    }).catch((err: unknown) => {
      if (s.closed) return
      this.record(s, { type: 'notice', level: 'warn', message: `Could not save to GitHub: ${s.redactText(message(err))}` })
    })
  }

  async diff(id: string): Promise<CloudDiff> {
    const s = this.lookup(id)
    this.touch(s)
    const d = await this.deps.git
      .diff({ dir: s.repoDir, baseBranch: s.baseBranch, branch: s.branch, pushedHead: s.pushedHead })
      .catch((err) => {
        throw new WorkerError('git', 502, s.redactText(message(err)).slice(0, 500))
      })
    return s.scrub(d)
  }

  async push(id: string): Promise<PushResult> {
    const s = this.lookup(id)
    this.touch(s)
    return this.enqueue(s, () => this.commitAndPush(s))
  }

  async pr(id: string, body: PrBody): Promise<PullRequestResult> {
    const s = this.lookup(id)
    this.touch(s)
    await this.enqueue(s, () => this.commitAndPush(s))
    return this.deps.github
      .createPullRequest({
        owner: s.owner,
        name: s.name,
        token: s.githubToken(),
        head: s.branch,
        base: s.baseBranch,
        title: body.title,
        ...(body.body !== undefined ? { body: body.body } : {}),
        ...(body.draft !== undefined ? { draft: body.draft } : {}),
      })
      .catch((err) => {
        throw new WorkerError('github', 502, s.redactText(message(err)).slice(0, 500))
      })
  }

  // ------------------------------------------------------------ life cycle

  async remove(id: string): Promise<void> {
    await this.dispose(this.lookup(id))
  }

  private async dispose(s: Session): Promise<void> {
    this.sessions.delete(s.id)
    s.closed = true
    s.app.stop()
    for (const close of [...s.closers]) close()
    s.closers.clear()
    await within(s.queue, REMOVE_WAIT_MS)
    await this.deleteFiles(s.id)
  }

  private async deleteFiles(id: string): Promise<void> {
    await rm(join(this.deps.dataDir, 'work', id), { recursive: true, force: true }).catch(() => undefined)
    await rm(join(this.deps.dataDir, 'sessions', id), { recursive: true, force: true }).catch(() => undefined)
  }

  /** Delete sessions that are not busy and have been quiet for longer than idleMs. Run by a timer the server entry owns. */
  async sweep(): Promise<void> {
    const t = this.now()
    for (const s of [...this.sessions.values()]) {
      if (s.pending > 0 || s.sending || s.autopilotRunning || t - s.lastActiveAt <= this.idleMs) continue
      const st = await s.app.status().catch(() => null)
      if (st?.busy) continue
      if (this.sessions.get(s.id) === s) await this.dispose(s)
    }
  }

  /** Remove work and session dirs left behind by a previous run (sessions do not survive a restart). */
  async purgeOrphans(): Promise<void> {
    for (const sub of ['work', 'sessions']) {
      const names = await readdir(join(this.deps.dataDir, sub)).catch(() => [] as string[])
      for (const name of names) {
        if (!ID_RE.test(name) || this.sessions.has(name) || this.creatingIds.has(name)) continue
        await rm(join(this.deps.dataDir, sub, name), { recursive: true, force: true }).catch(() => undefined)
      }
    }
  }

  /** Stop every turn, let queued pushes finish for a moment, and end the open streams. Files stay on disk. */
  async shutdown(): Promise<void> {
    const all = [...this.sessions.values()]
    for (const s of all) s.app.stop()
    const started = Date.now()
    while (Date.now() - started < 1000 && all.some((s) => s.sending || s.autopilotRunning)) await sleep(25)
    await within(Promise.all(all.map((s) => s.queue)), SHUTDOWN_WAIT_MS)
    for (const s of all) {
      for (const close of [...s.closers]) close()
      s.closers.clear()
    }
  }
}
