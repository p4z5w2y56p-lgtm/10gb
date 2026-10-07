import type {
  CloudDiff,
  CloudSecretName,
  CloudSessionInfo,
  CloudStartRequest,
  CloudStatus,
  CloudTestResult,
  PullRequestResult,
  PushResult,
} from '../../shared/cloud'
import type { AgentEvent, AllowRule, ApprovalDecision, PermissionMode, Suggestion, TurnEndReason } from '../../shared/types'
import { NoProjectError, NotReadyError, type BackendStatus } from '../backend'
import type { Backend, OpenedProject } from '../backendApi'
import { redact } from '../safety/redact'
import type { AuditEntry } from '../store/audit'
import type { KeyStore, SecretVault } from '../store/secrets'
import type { SessionMeta } from '../store/sessions'
import type { Settings, SettingsPatch } from '../store/settings'
import type { Content } from '../vertex/types'
import { CloudClient, CloudError, type AttachHandle } from './client'
import { checkGithubToken } from './github'
import type { CreateSessionBody, InvokeBody } from './protocol'

/** The half of Backend that BackendApp implements itself (everything except the cloud methods), plus its transcript. */
export type LocalBackend = Omit<Backend, Extract<keyof Backend, `cloud${string}`>> & { getHistory(): Content[] }

export interface RouterDeps {
  local: LocalBackend
  vault: SecretVault
  keys: KeyStore
  /** Current settings. Defaults to asking the local backend. */
  settingsOf?: () => Settings | Promise<Settings>
  emit: (e: AgentEvent) => void
  clientFactory?: (url: string, token: string) => CloudClient
  github?: { checkToken: typeof checkGithubToken }
}

type Channel = InvokeBody['channel']
type Opened = OpenedProject & { cloud: CloudSessionInfo }

interface Attachment {
  client: CloudClient
  info: CloudSessionInfo
  /** Last event sequence number seen, so a restarted stream can resume. */
  seq: number
  stream: AttachHandle | null
  /** Bumped whenever the stream is replaced, so callbacks of an old stream are ignored. */
  gen: number
  /** The connection to the worker is down and the user has been told. */
  lost: boolean
  /** The user is ending this session on the worker; its stream closing is not news. */
  ending: boolean
}

const GONE_NOTICE = 'The cloud session ended because the worker restarted. Your pushed branch is safe on GitHub.'
const UNAUTHORIZED_NOTICE = 'The cloud worker rejected the access token. Update it in Settings > Cloud.'
const LOST_NOTICE = 'Lost the connection to the cloud worker. Retrying...'
const BACK_NOTICE = 'Reconnected to the cloud worker.'
const CAUGHT_UP_NOTICE = 'Caught up with the cloud session.'
const NO_URL = 'Add the worker URL in Settings > Cloud first.'
const NO_TOKEN = 'Add the worker access token in Settings > Cloud first.'
const NO_GITHUB = 'Add a GitHub token in Settings > Cloud first.'

const display = (info: CloudSessionInfo): string => `${info.repo} @ ${info.branch}`

/** What the worker's settings:save takes: everything except the fields that only matter on this Mac. */
function forWorker(patch: SettingsPatch): SettingsPatch {
  const { cloud: _cloud, theme: _theme, showDetails: _showDetails, extraDirs: _extraDirs, ...rest } = patch
  if (rest.prompter && Object.keys(rest.prompter).length === 0) delete rest.prompter
  return rest
}

/**
 * Implements the whole Backend. Session calls go to the local BackendApp, or to the attached cloud session on
 * the worker; the cloud calls manage the worker's sessions. Secrets are read from the vault only when needed,
 * travel only in the create body and in putSecrets, and are scrubbed from every message that leaves this class.
 */
export class BackendRouter implements Backend {
  private readonly local: LocalBackend
  private readonly vault: SecretVault
  private readonly keys: KeyStore
  private readonly settingsOf: () => Settings | Promise<Settings>
  private readonly emit: (e: AgentEvent) => void
  private readonly factory: (url: string, token: string) => CloudClient
  private readonly checkToken: typeof checkGithubToken
  private att: Attachment | null = null
  private opening = false

  constructor(deps: RouterDeps) {
    this.local = deps.local
    this.vault = deps.vault
    this.keys = deps.keys
    this.settingsOf = deps.settingsOf ?? (async () => (await deps.local.getSettings()).settings)
    this.emit = deps.emit
    this.factory = deps.clientFactory ?? ((url, token) => new CloudClient({ baseUrl: url, token }))
    this.checkToken = deps.github?.checkToken ?? checkGithubToken
  }

  // ------------------------------------------------------------------ status

  async status(): Promise<BackendStatus> {
    const local = await this.local.status()
    const a = this.att
    if (!a) return local
    return {
      ...local,
      hasProject: true,
      projectRoot: display(a.info),
      busy: a.info.busy,
      mode: a.info.mode,
      sessionId: a.info.id,
      cloud: a.info,
    }
  }

  // ------------------------------------------------------------------ session calls

  async send(text: string): Promise<TurnEndReason | 'started'> {
    const a = this.att
    if (!a) return this.local.send(text)
    if (!(await this.keys.hasApiKey())) throw new NotReadyError()
    await this.call(a, 'agent:send', { text })
    if (this.att === a) a.info = { ...a.info, busy: true }
    return 'started'
  }

  async stop(): Promise<void> {
    const a = this.att
    if (!a) return this.local.stop()
    await this.call(a, 'agent:stop')
  }

  async resolveApproval(requestId: string, decision: ApprovalDecision): Promise<void> {
    const a = this.att
    if (!a) return this.local.resolveApproval(requestId, decision)
    await this.call(a, 'agent:approval', { requestId, decision: decision.decision, ...(decision.note ? { note: decision.note } : {}) })
  }

  async resolveAnswer(questionId: string, answer: string): Promise<void> {
    const a = this.att
    if (!a) return this.local.resolveAnswer(questionId, answer)
    await this.call(a, 'agent:answer', { questionId, answer })
  }

  async setMode(mode: PermissionMode): Promise<void> {
    const a = this.att
    if (!a) return this.local.setMode(mode)
    await this.call(a, 'agent:setMode', { mode })
  }

  async undo(): Promise<{ restored: string[]; removed: string[] }> {
    const a = this.att
    return a ? this.call(a, 'agent:undo') : this.local.undo()
  }

  async getChanges(): Promise<{ files: string[]; canUndo: boolean }> {
    const a = this.att
    return a ? this.call(a, 'agent:changes') : this.local.getChanges()
  }

  async spark(): Promise<Suggestion[]> {
    const a = this.att
    return a ? this.call(a, 'prompter:spark') : this.local.spark()
  }

  async autopilot(on: boolean): Promise<{ settings: Settings; status: BackendStatus }> {
    const a = this.att
    if (!a) return this.local.autopilot(on)
    await this.call(a, 'prompter:autopilot', { on })
    const { settings } = await this.local.saveSettings({ prompter: { mode: on ? 'autopilot' : 'suggest' } })
    return { settings, status: await this.status() }
  }

  async listRules(): Promise<AllowRule[]> {
    const a = this.att
    return a ? this.call(a, 'rules:list') : this.local.listRules()
  }

  async removeRule(rule: AllowRule): Promise<void> {
    const a = this.att
    if (!a) return this.local.removeRule(rule)
    await this.call(a, 'rules:remove', { rule })
  }

  async readAudit(): Promise<AuditEntry[]> {
    const a = this.att
    return a ? this.call(a, 'audit:read') : this.local.readAudit()
  }

  async listSessions(): Promise<SessionMeta[]> {
    const a = this.att
    return a ? this.call(a, 'sessions:list') : this.local.listSessions()
  }

  // ------------------------------------------------------------------ local only

  async openProject(path: string, resumeId?: string): Promise<OpenedProject> {
    this.detach()
    return this.local.openProject(path, resumeId)
  }

  async resumeSession(id: string): Promise<OpenedProject> {
    this.detach()
    return this.local.resumeSession(id)
  }

  // ------------------------------------------------------------------ app level

  async getSettings(): Promise<{ settings: Settings; status: BackendStatus }> {
    const { settings } = await this.local.getSettings()
    return { settings, status: await this.status() }
  }

  async saveSettings(patch: SettingsPatch): Promise<{ settings: Settings; status: BackendStatus }> {
    const { settings } = await this.local.saveSettings(patch)
    const a = this.att
    const remote = forWorker(patch)
    if (a && Object.keys(remote).length > 0) {
      try {
        await this.call(a, 'settings:save', { patch: remote })
      } catch (err) {
        this.notice('warn', `Saved here, but the cloud session could not apply it: ${(err as Error).message}`)
      }
    }
    return { settings, status: await this.status() }
  }

  async setApiKey(key: string): Promise<BackendStatus> {
    await this.local.setApiKey(key)
    const a = this.att
    if (a) {
      try {
        await this.remote(a, () => a.client.putSecrets(a.info.id, { apiKey: key.trim() }), [key])
      } catch (err) {
        this.notice('warn', `The key was saved, but the cloud session could not receive it: ${(err as Error).message}`)
      }
    }
    return this.status()
  }

  async clearApiKey(): Promise<BackendStatus> {
    await this.local.clearApiKey()
    const a = this.att
    if (a) await this.call(a, 'agent:stop').catch(() => undefined)
    return this.status()
  }

  testConnection(): Promise<{ label: string; ok: boolean; message: string }[]> {
    return this.local.testConnection()
  }

  // ------------------------------------------------------------------ cloud

  async cloudStatus(): Promise<CloudStatus> {
    const { cloud } = await this.settingsOf()
    const hasCloudToken = await this.vault.hasSecret('cloud-token')
    const hasGithubToken = await this.vault.hasSecret('github-token')
    return {
      configured: cloud.workerUrl.trim() !== '' && hasCloudToken,
      workerUrl: cloud.workerUrl,
      hasCloudToken,
      hasGithubToken,
      autoPush: cloud.autoPush,
      active: this.att?.info ?? null,
    }
  }

  async cloudSetSecret(name: CloudSecretName, value: string): Promise<CloudStatus> {
    await this.vault.setSecret(name, value)
    const a = this.att
    if (a && name === 'github-token') {
      try {
        await this.remote(a, () => a.client.putSecrets(a.info.id, { githubToken: value.trim() }), [value])
      } catch (err) {
        this.notice('warn', `The GitHub token was saved, but the cloud session could not receive it: ${(err as Error).message}`)
      }
    } else if (a && name === 'cloud-token') {
      const token = await this.vault.getSecret('cloud-token')
      if (token && this.att === a) {
        a.client = this.factory(a.client.baseUrl, token)
        this.stream(a, a.seq)
      }
    }
    return this.cloudStatus()
  }

  async cloudClearSecret(name: CloudSecretName): Promise<CloudStatus> {
    await this.vault.clearSecret(name)
    if (name === 'cloud-token' && this.att) {
      this.detach()
      this.notice('info', 'The access token was removed, so ARC left the cloud session. It keeps running on the worker.')
    }
    return this.cloudStatus()
  }

  async cloudTest(): Promise<CloudTestResult[]> {
    const { cloud } = await this.settingsOf()
    const url = cloud.workerUrl.trim()
    const token = await this.vault.getSecret('cloud-token')
    const github = await this.vault.getSecret('github-token')
    const extra = [token, github].filter((s): s is string => Boolean(s))
    const results: CloudTestResult[] = []
    const fail = async (label: string, err: unknown): Promise<CloudTestResult> => ({
      label,
      ok: false,
      message: redact(err instanceof Error ? err.message : String(err), [...(await this.secrets()), ...extra]),
    })

    // 1. The worker answers.
    const reach = 'Worker reachable'
    let client: CloudClient | null = null
    let reached = false
    if (!url) results.push({ label: reach, ok: false, message: NO_URL })
    else {
      try {
        client = this.factory(url, token ?? '')
        await client.health()
        reached = true
        results.push({ label: reach, ok: true, message: `The worker answered at ${client.baseUrl}.` })
      } catch (err) {
        results.push(await fail(reach, err))
      }
    }

    // 2. The worker accepts the access token.
    const accepted = 'Access token accepted'
    if (!token) results.push({ label: accepted, ok: false, message: `Skipped: ${NO_TOKEN.replace(' first.', '.')}` })
    else if (!client || !reached) results.push({ label: accepted, ok: false, message: 'Skipped: the worker could not be reached.' })
    else {
      try {
        const sessions = await client.list()
        results.push({ label: accepted, ok: true, message: `The worker accepted the token (${sessions.length} open ${sessions.length === 1 ? 'session' : 'sessions'}).` })
      } catch (err) {
        results.push(await fail(accepted, err))
      }
    }

    // 3. GitHub accepts the GitHub token.
    const gh = 'GitHub token valid'
    if (!github) results.push({ label: gh, ok: false, message: `Skipped: ${NO_GITHUB.replace(' first.', '.')}` })
    else {
      try {
        const { login } = await this.checkToken(github)
        results.push({ label: gh, ok: true, message: `Signed in to GitHub as ${login}.` })
      } catch (err) {
        results.push(await fail(gh, err))
      }
    }
    return results
  }

  async cloudStart(req: CloudStartRequest): Promise<Opened> {
    return this.opened(async () => {
      const settings = await this.settingsOf()
      const url = settings.cloud.workerUrl.trim()
      if (!url) throw new Error(NO_URL)
      const token = await this.vault.getSecret('cloud-token')
      if (!token) throw new Error(NO_TOKEN)
      const githubToken = await this.vault.getSecret('github-token')
      if (!githubToken) throw new Error(NO_GITHUB)
      const apiKey = await this.keys.getApiKey()
      if (!apiKey) throw new NotReadyError()
      if ((await this.local.status()).busy || this.att?.info.busy) throw new Error('Stop the current turn before starting a cloud session.')

      const client = this.factory(url, token)
      const body: CreateSessionBody = {
        repo: req.repo,
        ...(req.baseBranch ? { baseBranch: req.baseBranch } : {}),
        ...(req.name ? { name: req.name } : {}),
        settings,
        secrets: { apiKey, githubToken },
        autoPush: settings.cloud.autoPush,
      }
      const info = await this.remote(null, () => client.create(body))
      return this.attachTo(client, info)
    })
  }

  async cloudSessions(): Promise<CloudSessionInfo[]> {
    const client = await this.workerClient()
    return this.remote(null, () => client.list())
  }

  async cloudAttach(id: string): Promise<Opened> {
    return this.opened(async () => {
      const client = await this.workerClient()
      if ((await this.local.status()).busy) throw new Error('Stop the current turn before switching to a cloud session.')
      const info = await this.remote(null, () => client.get(id))
      return this.attachTo(client, info)
    })
  }

  async cloudLeave(): Promise<BackendStatus> {
    this.detach()
    return this.status()
  }

  async cloudEnd(id: string): Promise<null> {
    const a = this.att && this.att.info.id === id ? this.att : null
    const client = a ? a.client : await this.workerClient()
    if (a) a.ending = true
    try {
      await this.remote(null, () => client.remove(id))
    } catch (err) {
      if (!(err instanceof CloudError && err.code === 'session-gone')) {
        if (a) a.ending = false
        throw err
      }
    }
    if (a && this.att === a) this.detach()
    return null
  }

  async cloudDiff(): Promise<CloudDiff> {
    const a = this.requireAttached()
    return this.remote(a, () => a.client.diff(a.info.id))
  }

  async cloudPush(): Promise<PushResult> {
    const a = this.requireAttached()
    const result = await this.remote(a, () => a.client.push(a.info.id))
    await this.refresh(a)
    return result
  }

  async cloudPr(req: { title: string; body?: string; draft?: boolean }): Promise<PullRequestResult> {
    const a = this.requireAttached()
    return this.remote(a, () => a.client.pr(a.info.id, req))
  }

  /** Quit: let go of the stream and the local agent. The cloud turn and session keep running on the worker. */
  async dispose(): Promise<void> {
    this.detach()
    await this.local.stop()
  }

  // ------------------------------------------------------------------ attachment

  private requireAttached(): Attachment {
    if (!this.att) throw new Error('No cloud session is open. Start or attach one first.')
    return this.att
  }

  /** One start or attach at a time. */
  private async opened(run: () => Promise<Opened>): Promise<Opened> {
    if (this.opening) throw new Error('A cloud session is already being opened. Wait for it to finish.')
    this.opening = true
    try {
      return await run()
    } finally {
      this.opening = false
    }
  }

  private async workerClient(): Promise<CloudClient> {
    const url = (await this.settingsOf()).cloud.workerUrl.trim()
    if (!url) throw new Error(NO_URL)
    const token = await this.vault.getSecret('cloud-token')
    if (!token) throw new Error(NO_TOKEN)
    return this.factory(url, token)
  }

  /** Load the transcript first, so a failure leaves the current attachment untouched, then switch over. */
  private async attachTo(client: CloudClient, info: CloudSessionInfo): Promise<Opened> {
    const { history, seq } = await this.remote(null, () => client.history(info.id))
    this.detach()
    const a: Attachment = { client, info, seq, stream: null, gen: 0, lost: false, ending: false }
    this.att = a
    this.stream(a, seq)
    if (info.mode) this.emit({ type: 'mode', mode: info.mode })
    return { root: display(info), sessionId: info.id, history, cloud: info }
  }

  /** Close the stream and forget the session. It keeps running on the worker. */
  private detach(): void {
    const a = this.att
    this.att = null
    if (!a) return
    a.gen++
    a.stream?.close()
    a.stream = null
  }

  private stream(a: Attachment, after: number): void {
    a.stream?.close()
    a.seq = after
    const gen = ++a.gen
    const live = () => this.att === a && a.gen === gen && !a.ending
    a.stream = a.client.attach(a.info.id, {
      after,
      onEvent: (seq, e) => {
        if (!live()) return
        a.seq = seq
        this.onEvent(a, e)
      },
      onGap: () => {
        if (live()) void this.onGap(a, gen)
      },
      onEnded: (reason) => {
        if (live()) this.onEnded(a, reason)
      },
      onState: (state) => {
        if (live()) this.onState(a, state)
      },
    })
  }

  private onEvent(a: Attachment, e: AgentEvent): void {
    if (e.type === 'mode') a.info = { ...a.info, mode: e.mode }
    else if (e.type === 'turn-end') a.info = { ...a.info, busy: false }
    this.emit(e)
    if (e.type === 'turn-end') void this.refresh(a)
  }

  private async onGap(a: Attachment, gen: number): Promise<void> {
    try {
      const { seq } = await this.remote(a, () => a.client.history(a.info.id))
      if (this.att !== a || a.gen !== gen) return
      this.notice('info', CAUGHT_UP_NOTICE)
      this.stream(a, seq)
    } catch (err) {
      if (this.att !== a || a.gen !== gen) return
      if (err instanceof CloudError && (err.code === 'session-gone' || err.code === 'unauthorized')) return
      this.notice('warn', `Could not catch up with the cloud session: ${(err as Error).message} Open it again from the Cloud list.`)
      this.detach()
    }
  }

  private onEnded(a: Attachment, reason: 'gone' | 'unauthorized'): void {
    if (this.att !== a) return
    this.detach()
    if (reason === 'gone') {
      this.notice('error', GONE_NOTICE)
      this.emit({ type: 'turn-end', reason: 'error' })
    } else this.notice('error', UNAUTHORIZED_NOTICE)
  }

  private onState(a: Attachment, state: 'connected' | 'reconnecting'): void {
    if (state === 'reconnecting' && !a.lost) {
      a.lost = true
      this.notice('warn', LOST_NOTICE)
    } else if (state === 'connected' && a.lost) {
      a.lost = false
      this.notice('info', BACK_NOTICE)
      void this.refresh(a)
    }
  }

  /** Re-read the session so busy, mode and pushed are right. A failure here is not worth reporting. */
  private async refresh(a: Attachment): Promise<void> {
    try {
      const info = await a.client.get(a.info.id)
      if (this.att === a) a.info = info
    } catch {
      // The next turn-end or reconnect will try again.
    }
  }

  // ------------------------------------------------------------------ calls and scrubbing

  private async call<T>(a: Attachment, channel: Channel, payload?: unknown): Promise<T> {
    try {
      return await this.remote(a, () => a.client.invoke<T>(a.info.id, channel, payload))
    } catch (err) {
      if (err instanceof CloudError && err.code === 'no-api-key') throw new NotReadyError()
      if (err instanceof CloudError && err.code === 'no-project') throw new NoProjectError()
      throw err
    }
  }

  /** Run a worker call; secrets are scrubbed from its errors, and a session the worker lost ends the attachment. */
  private async remote<T>(a: Attachment | null, fn: () => Promise<T>, extra: string[] = []): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      if (a && err instanceof CloudError && err.code === 'session-gone') this.onEnded(a, 'gone')
      throw await this.scrubbed(err, extra)
    }
  }

  private async secrets(): Promise<string[]> {
    const all = [await this.keys.getApiKey(), await this.vault.getSecret('cloud-token'), await this.vault.getSecret('github-token')]
    return all.filter((s): s is string => Boolean(s))
  }

  private async scrubbed(err: unknown, extra: string[]): Promise<Error> {
    const secrets = [...(await this.secrets()), ...extra]
    if (err instanceof CloudError) {
      const message = redact(err.message, secrets)
      return message === err.message ? err : new CloudError(message, err.code, err.status)
    }
    if (err instanceof Error) {
      const message = redact(err.message, secrets)
      return message === err.message ? err : new Error(message)
    }
    return new Error(redact(String(err), secrets))
  }

  private notice(level: 'info' | 'warn' | 'error', message: string): void {
    this.emit({ type: 'notice', level, message })
  }
}
