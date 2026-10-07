import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CloudSessionInfo } from '../shared/cloud'
import type {
  AgentEvent,
  AllowRule,
  ApprovalDecision,
  PermissionMode,
  Suggestion,
  TurnEndReason,
} from '../shared/types'
import { AgentSession } from './agent/loop'
import { loadProjectMemory } from './agent/systemPrompt'
import { runAutopilot } from './prompter/autopilot'
import { generateSuggestions, summarizeProject, transcriptOf } from './prompter/prompter'
import { canonicalRoot } from './safety/pathSandbox'
import { protectedWritePaths, sensitiveReadPaths } from './safety/protected'
import { buildSandboxProfile, detectSandboxExec } from './safety/sandboxExec'
import { AuditLog, type AuditEntry } from './store/audit'
import { CheckpointStore } from './store/checkpoints'
import { ProjectRules } from './store/projectRules'
import { SecretStore, type Cipher, type KeyStore } from './store/secrets'
import { SessionStore, type SessionHandle, type SessionMeta } from './store/sessions'
import { SettingsStore, type Settings, type SettingsPatch } from './store/settings'
import { makeBashTool } from './tools/bash'
import { globTool, lsTool, makeGrepTool, readTool } from './tools/fsRead'
import { editTool, writeTool } from './tools/fsWrite'
import { askUserTool, makeWebFetchTool, todoTool } from './tools/misc'
import { createRegistry } from './tools/registry'
import { VertexClient } from './vertex/client'
import type { Content, GenerateRequest } from './vertex/types'

/** Raised when something needs the Vertex API key and none is saved. */
export class NotReadyError extends Error {
  readonly code = 'no-api-key' as const
  constructor() {
    super('Add your Vertex API key in Settings to start.')
  }
}

export class NoProjectError extends Error {
  readonly code = 'no-project' as const
  constructor() {
    super('Open a project folder first.')
  }
}

export interface BackendDeps {
  /** ARC's own data: settings, the encrypted key, sessions, audit logs, checkpoints. */
  dataDir: string
  cipher: Cipher
  /** Replaces the encrypted on-disk store, for the terminal harness. */
  keyStore?: KeyStore
  home: string
  emit: (e: AgentEvent) => void
  /** Tests point this at a local fake. */
  vertexBaseUrl?: string
  vertexSleep?: (ms: number) => Promise<void>
  sandboxAvailable?: boolean
  /** The container is the sandbox (cloud worker): Auto mode may run commands unattended without sandbox-exec. */
  trustContainer?: boolean
}

export interface BackendStatus {
  ready: boolean
  hasApiKey: boolean
  reason?: 'no-api-key'
  hasProject: boolean
  projectRoot: string | null
  busy: boolean
  mode: PermissionMode | null
  sessionId: string | null
  /** Set by the router while attached to a cloud session. */
  cloud?: CloudSessionInfo | null
}

export interface ConnectionResult {
  label: string
  ok: boolean
  message: string
}

interface Project {
  root: string
  agent: AgentSession
  handle: SessionHandle
  audit: AuditLog
  checkpoints: CheckpointStore
  rules: ProjectRules
}

interface ClientCache {
  key: string
  coderModel: string
  prompterModel: string
  coder: VertexClient
  prompter: VertexClient
}

/**
 * Everything the UI (or the terminal harness) drives: it owns the key, the
 * settings, the open project and its agent session, and relays approvals,
 * questions, suggestions and autopilot. No Electron imports, so it is testable.
 */
export class BackendApp {
  private readonly settingsStore: SettingsStore
  private readonly secrets: KeyStore
  private readonly sessions: SessionStore
  private settings!: Settings
  private cache: ClientCache | null = null
  private project: Project | null = null
  private busy = false
  private autopilotCtl: AbortController | null = null
  private autopilotUsed = 0
  private readonly approvals = new Map<string, (d: ApprovalDecision) => void>()
  private readonly answers = new Map<string, (a: string) => void>()

  constructor(private readonly deps: BackendDeps) {
    this.settingsStore = new SettingsStore(deps.dataDir)
    this.secrets = deps.keyStore ?? new SecretStore(deps.dataDir, deps.cipher)
    this.sessions = new SessionStore(join(deps.dataDir, 'sessions'))
  }

  async init(): Promise<void> {
    this.settings = await this.settingsStore.load()
  }

  private emit = (e: AgentEvent): void => {
    if (e.type === 'usage' && this.autopilotCtl) this.autopilotUsed += e.totalTokens
    this.deps.emit(e)
  }

  // ------------------------------------------------------------------ status

  async status(): Promise<BackendStatus> {
    const hasApiKey = await this.secrets.hasApiKey()
    return {
      ready: hasApiKey,
      hasApiKey,
      ...(hasApiKey ? {} : { reason: 'no-api-key' as const }),
      hasProject: this.project !== null,
      projectRoot: this.project?.root ?? null,
      busy: this.busy || this.autopilotCtl !== null,
      mode: this.project?.agent.mode ?? null,
      sessionId: this.project?.handle.id ?? null,
    }
  }

  private async requireReady(): Promise<void> {
    if (!(await this.secrets.hasApiKey())) throw new NotReadyError()
  }

  private requireProject(): Project {
    if (!this.project) throw new NoProjectError()
    return this.project
  }

  // ---------------------------------------------------------------- settings

  async getSettings(): Promise<{ settings: Settings; status: BackendStatus }> {
    return { settings: this.settings, status: await this.status() }
  }

  async saveSettings(patch: SettingsPatch): Promise<{ settings: Settings; status: BackendStatus }> {
    this.settings = await this.settingsStore.save(patch)
    this.project?.agent.updateSettings(this.settings)
    return this.getSettings()
  }

  async setApiKey(key: string): Promise<BackendStatus> {
    await this.secrets.setApiKey(key)
    this.cache = null
    return this.status()
  }

  async clearApiKey(): Promise<BackendStatus> {
    this.stop()
    await this.secrets.clear()
    this.cache = null
    return this.status()
  }

  /** One tiny request per model (the second only when the prompter model differs). */
  async testConnection(): Promise<ConnectionResult[]> {
    await this.requireReady()
    const { coder, prompter } = await this.clients()
    const results: ConnectionResult[] = [
      { label: `Coder (${this.settings.model})`, ...(await coder.testConnection()) },
    ]
    if (this.settings.prompterModel !== this.settings.model) {
      results.push({ label: `Prompter (${this.settings.prompterModel})`, ...(await prompter.testConnection()) })
    }
    return results
  }

  /** Vertex clients for the current key and models; rebuilt whenever either changes. */
  private async clients(): Promise<ClientCache> {
    const key = await this.secrets.getApiKey()
    if (!key) throw new NotReadyError()
    const c = this.cache
    if (c && c.key === key && c.coderModel === this.settings.model && c.prompterModel === this.settings.prompterModel) {
      return c
    }
    const make = (model: string) =>
      new VertexClient({ apiKey: key, model, baseUrl: this.deps.vertexBaseUrl, sleep: this.deps.vertexSleep })
    this.cache = {
      key,
      coderModel: this.settings.model,
      prompterModel: this.settings.prompterModel,
      coder: make(this.settings.model),
      prompter: make(this.settings.prompterModel),
    }
    return this.cache
  }

  // ---------------------------------------------------------------- projects

  async openProject(path: string, resumeId?: string): Promise<{ root: string; sessionId: string; history: Content[] }> {
    if (this.busy || this.autopilotCtl) throw new Error('Stop the current turn before switching projects.')
    let root: string
    try {
      root = await canonicalRoot(path)
    } catch {
      throw new Error(`Folder not found: ${path}`)
    }
    if (!(await stat(root)).isDirectory()) throw new Error(`Not a folder: ${path}`)

    let handle: SessionHandle
    let history: Content[] = []
    if (resumeId) {
      history = (await this.sessions.load(resumeId)).history as Content[]
      handle = await this.sessions.open(resumeId)
    } else {
      handle = this.sessions.create(root)
    }

    const { dataDir, home } = this.deps
    const tmp = await realpath(tmpdir())
    const osSandbox = this.deps.sandboxAvailable ?? detectSandboxExec()
    const sandboxAvailable = osSandbox || this.deps.trustContainer === true
    const audit = new AuditLog(join(dataDir, 'audit'), handle.id, () => (this.cache ? [this.cache.key] : []))
    const checkpoints = new CheckpointStore(join(dataDir, 'checkpoints'), handle.id)
    const rules = new ProjectRules(join(dataDir, 'rules'), root)
    const arcMd = await loadProjectMemory(root)

    const coder = {
      streamGenerate: async (req: GenerateRequest, onText?: (t: string) => void) =>
        (await this.clients()).coder.streamGenerate(req, onText),
    }
    let agent: AgentSession
    const registry = createRegistry([
      readTool,
      lsTool,
      globTool,
      makeGrepTool(),
      editTool,
      writeTool,
      makeBashTool({
        sandboxProfile: () => (agent.mode === 'auto' && osSandbox ? buildSandboxProfile(root, tmp) : undefined),
      }),
      todoTool,
      askUserTool,
      makeWebFetchTool(),
    ])
    agent = new AgentSession({
      projectRoot: root,
      settings: this.settings,
      vertex: coder,
      registry,
      audit,
      checkpoints,
      sessions: handle,
      rules,
      approver: (req, signal) =>
        new Promise<ApprovalDecision>((resolve) => {
          const id = req.call.id
          this.approvals.set(id, resolve)
          signal.addEventListener(
            'abort',
            () => {
              this.approvals.delete(id)
              resolve({ decision: 'deny', note: 'Stopped' })
            },
            { once: true },
          )
        }),
      askUser: (q) =>
        new Promise<string>((resolve) => {
          const id = randomUUID()
          this.answers.set(id, resolve)
          this.emit({ type: 'question', id, question: q.question, ...(q.options ? { options: q.options } : {}) })
        }),
      emit: this.emit,
      home,
      protectedPaths: protectedWritePaths(home, dataDir),
      sensitivePaths: sensitiveReadPaths(home, dataDir),
      sandboxAvailable,
      secrets: () => (this.cache ? [this.cache.key] : []),
      history,
      arcMd,
    })
    this.project = { root, agent, handle, audit, checkpoints, rules }
    this.emit({ type: 'mode', mode: agent.mode })
    this.pushChanges()
    return { root, sessionId: handle.id, history }
  }

  /** The open conversation as the model sees it (used to rebuild the screen). */
  getHistory(): Content[] {
    return (this.project?.agent.getHistory() ?? []) as Content[]
  }

  async listSessions(): Promise<SessionMeta[]> {
    return this.sessions.list(this.requireProject().root)
  }

  async resumeSession(id: string): Promise<{ root: string; sessionId: string; history: Content[] }> {
    const { meta } = await this.sessions.load(id)
    return this.openProject(meta.projectRoot, id)
  }

  // ------------------------------------------------------------------- turns

  async send(text: string): Promise<TurnEndReason> {
    await this.requireReady()
    const p = this.requireProject()
    if (this.autopilotCtl) throw new Error('Autopilot is running. Stop it first.')
    if (this.busy) throw new Error('A turn is already running')
    this.busy = true
    let reason: TurnEndReason
    try {
      reason = await p.agent.sendMessage(text)
    } finally {
      this.busy = false
    }
    this.afterTurn(reason)
    return reason
  }

  stop(): void {
    this.project?.agent.stop()
    this.autopilotCtl?.abort()
    for (const [id, resolve] of this.approvals) resolve({ decision: 'deny', note: 'Stopped' })
    this.approvals.clear()
    for (const [, resolve] of this.answers) resolve('')
    this.answers.clear()
  }

  resolveApproval(requestId: string, decision: ApprovalDecision): void {
    const resolve = this.approvals.get(requestId)
    if (!resolve) return
    this.approvals.delete(requestId)
    resolve(decision)
  }

  hasPendingApproval(requestId: string): boolean {
    return this.approvals.has(requestId)
  }

  resolveAnswer(questionId: string, answer: string): void {
    const resolve = this.answers.get(questionId)
    if (!resolve) return
    this.answers.delete(questionId)
    resolve(answer)
  }

  setMode(mode: PermissionMode): void {
    const p = this.requireProject()
    p.agent.setMode(mode)
    this.emit({ type: 'mode', mode })
  }

  async getChanges(): Promise<{ files: string[]; canUndo: boolean }> {
    if (!this.project) return { files: [], canUndo: false }
    return { files: this.project.checkpoints.changedFiles(), canUndo: this.project.checkpoints.canUndo() }
  }

  async undo(): Promise<{ restored: string[]; removed: string[] }> {
    const result = await this.requireProject().checkpoints.undoLastTurn()
    this.pushChanges()
    return result
  }

  private pushChanges(): void {
    if (!this.project) return
    this.emit({
      type: 'changes',
      files: this.project.checkpoints.changedFiles(),
      canUndo: this.project.checkpoints.canUndo(),
    })
  }

  private afterTurn(reason: TurnEndReason): void {
    this.pushChanges()
    if (reason !== 'done') return
    const mode = this.settings.prompter.mode
    if (mode === 'suggest') void this.spark().catch(() => undefined)
    else if (mode === 'autopilot') void this.runAutopilotLoop().catch(() => undefined)
  }

  // ---------------------------------------------------------------- prompter

  async spark(): Promise<Suggestion[]> {
    await this.requireReady()
    const p = this.requireProject()
    const { prompter } = await this.clients()
    const items = await generateSuggestions(prompter, {
      projectSummary: await summarizeProject(p.root),
      transcript: transcriptOf(p.agent.getHistory()),
    })
    if (items.length > 0) this.emit({ type: 'suggestions', items })
    return items
  }

  async autopilot(on: boolean): Promise<{ settings: Settings; status: BackendStatus }> {
    if (on) await this.requireReady()
    this.settings = await this.settingsStore.save({ prompter: { mode: on ? 'autopilot' : 'suggest' } })
    this.project?.agent.updateSettings(this.settings)
    if (!on) this.autopilotCtl?.abort()
    else if (this.project && !this.busy && !this.autopilotCtl && this.project.agent.getHistory().length > 0) {
      void this.runAutopilotLoop().catch(() => undefined)
    }
    return this.getSettings()
  }

  private async runAutopilotLoop(): Promise<void> {
    const p = this.project
    if (!p || this.autopilotCtl) return
    const ctl = new AbortController()
    this.autopilotCtl = ctl
    this.autopilotUsed = 0
    this.emit({ type: 'autopilot', running: true })
    let reason: string
    try {
      reason = await runAutopilot({
        session: p.agent,
        suggest: () => this.spark(),
        maxRounds: this.settings.prompter.maxRounds,
        tokenBudget: this.settings.prompter.tokenBudget,
        usedTokens: () => this.autopilotUsed,
        signal: ctl.signal,
        emit: this.emit,
      })
    } catch {
      reason = 'error'
    } finally {
      this.autopilotCtl = null
    }
    this.emit({ type: 'autopilot', running: false, reason })
    this.pushChanges()
  }

  // ------------------------------------------------------------ audit, rules

  async readAudit(): Promise<AuditEntry[]> {
    return this.project ? this.project.audit.read() : []
  }

  async listRules(): Promise<AllowRule[]> {
    return this.project ? this.project.rules.load() : []
  }

  async removeRule(rule: AllowRule): Promise<void> {
    const p = this.requireProject()
    await p.rules.remove(rule)
    await p.agent.reloadRules()
  }
}
