import { randomUUID } from 'node:crypto'
import { BASH_DEFAULT_TIMEOUT_MS } from '../../shared/constants'
import type {
  AgentEvent,
  AllowRule,
  ApprovalDecision,
  Approver,
  PermissionMode,
  ToolCall,
  ToolName,
  ToolResult,
  TurnEndReason,
} from '../../shared/types'
import { commandPrefixForRule, decide, isRuleEligible, type DecisionContext } from '../safety/permissions'
import { redact } from '../safety/redact'
import type { AuditLog } from '../store/audit'
import type { CheckpointStore } from '../store/checkpoints'
import type { ProjectRules } from '../store/projectRules'
import type { SessionHandle } from '../store/sessions'
import type { Settings } from '../store/settings'
import { previewChange } from '../tools/fsWrite'
import type { SessionState, ToolContext, ToolRegistry } from '../tools/registry'
import type { VertexClient } from '../vertex/client'
import { VertexError, type Content, type GenerateResult, type Part } from '../vertex/types'
import { compact, shouldCompact } from './compaction'
import { describeCall, describeResult, tidyLabel } from './narrate'
import { buildSystemPrompt, wrapUntrusted } from './systemPrompt'

export interface AgentOptions {
  projectRoot: string
  settings: Settings
  vertex: Pick<VertexClient, 'streamGenerate'>
  registry: ToolRegistry
  audit: AuditLog
  checkpoints: CheckpointStore
  sessions: SessionHandle
  rules: ProjectRules
  approver: Approver
  askUser: ToolContext['askUser']
  emit: (e: AgentEvent) => void
  home: string
  protectedPaths: string[]
  sensitivePaths?: string[]
  sandboxAvailable: boolean
  /** Exact secrets to scrub from tool output before the model sees it. */
  secrets?: () => string[]
  history?: Content[]
  arcMd?: string | null
}

const STOPPED_OUTPUT = 'The user stopped the turn before this ran.'
const SAFETY_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY'])
/** Tools for which "always allow" may save a rule. Reads never get a standing rule. */
const RULE_TOOLS = new Set<string>(['Bash', 'Edit', 'Write', 'WebFetch'])

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'))
    const onAbort = () => reject(new Error('aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort)
        resolve(v)
      },
      (e) => {
        signal.removeEventListener('abort', onAbort)
        reject(e)
      },
    )
  })
}

const textOnly = (parts: Part[]): Part[] => parts.filter((p) => p.text !== undefined && !p.functionCall)

export class AgentSession {
  private history: Content[]
  private currentMode: PermissionMode
  private settings: Settings
  private lastTotal = 0
  private active: AbortController | null = null
  private busy = false
  private ruleCache: AllowRule[] | null = null
  private persistWarned = false
  private readonly state: SessionState = { readFiles: new Map(), todos: [] }

  constructor(private readonly o: AgentOptions) {
    this.history = [...(o.history ?? [])]
    this.settings = o.settings
    this.currentMode = o.settings.permissionMode
  }

  get mode(): PermissionMode {
    return this.currentMode
  }

  setMode(mode: PermissionMode): void {
    this.currentMode = mode
  }

  updateSettings(settings: Settings): void {
    this.settings = settings
  }

  /** Re-read the saved always-allow rules, for example after the settings screen removed one. */
  async reloadRules(): Promise<void> {
    this.ruleCache = await this.o.rules.load()
  }

  getHistory(): Content[] {
    return [...this.history]
  }

  /** Token count of the latest request, which is the current context size. */
  totalTokens(): number {
    return this.lastTotal
  }

  /** Abort the running turn, if any. */
  stop(): void {
    this.active?.abort()
  }

  async sendMessage(text: string, signal?: AbortSignal): Promise<TurnEndReason> {
    if (this.busy) throw new Error('A turn is already running')
    this.busy = true
    const ctl = new AbortController()
    const link = () => ctl.abort()
    if (signal?.aborted) ctl.abort()
    else signal?.addEventListener('abort', link, { once: true })
    this.active = ctl

    let reason: TurnEndReason
    try {
      reason = await this.runTurn(text, ctl)
    } catch (err) {
      this.notice('error', `Something went wrong inside ARC: ${err instanceof Error ? err.message : String(err)}`)
      reason = 'error'
    } finally {
      signal?.removeEventListener('abort', link)
      this.active = null
      this.busy = false
    }
    this.o.emit({ type: 'status', state: 'idle', label: 'Idle' })
    this.o.emit({ type: 'turn-end', reason })
    return reason
  }

  // ------------------------------------------------------------------ turn

  private async runTurn(text: string, ctl: AbortController): Promise<TurnEndReason> {
    const signal = ctl.signal
    if (signal.aborted) return 'stopped'
    this.ruleCache ??= await this.o.rules.load()
    this.o.checkpoints.beginTurn(randomUUID())
    if (shouldCompact(this.lastTotal, this.settings.contextWindowTokens)) await this.tryCompact()
    await this.push({ role: 'user', parts: [{ text }] })

    const tctx = this.toolContext(signal)
    let steps = 0
    let turnTokens = 0
    for (;;) {
      if (signal.aborted) return 'stopped'
      if (steps >= this.settings.maxSteps) {
        this.notice('warn', `Stopped after ${steps} steps. Say "continue" to keep going.`)
        return 'step-cap'
      }
      if (turnTokens >= this.settings.turnTokenBudget) {
        this.notice('warn', 'Stopped because this turn used its token budget. Say "continue" to keep going.')
        return 'budget'
      }
      steps++
      this.o.emit({ type: 'status', state: 'thinking', label: 'Thinking' })

      let res: GenerateResult
      try {
        res = await this.o.vertex.streamGenerate(
          {
            systemInstruction: buildSystemPrompt({
              projectRoot: this.o.projectRoot,
              platform: process.platform,
              date: new Date().toISOString().slice(0, 10),
              mode: this.currentMode,
              arcMd: this.o.arcMd,
            }),
            contents: [...this.history],
            tools: this.o.registry.declarations(),
            signal,
          },
          (t) => this.o.emit({ type: 'text-delta', text: t }),
        )
      } catch (err) {
        return this.vertexFailure(err)
      }

      if (res.usage) {
        this.o.emit({ type: 'usage', ...res.usage })
        turnTokens += res.usage.totalTokens
        this.lastTotal = res.usage.totalTokens
      }

      const unsafe = res.finishReason !== undefined && SAFETY_REASONS.has(res.finishReason)
      // Keep the model's parts verbatim, but never leave a functionCall we cannot answer.
      const keep = unsafe ? textOnly(res.parts) : res.parts
      if (keep.length > 0) await this.push({ role: 'model', parts: keep })
      if (unsafe) {
        this.notice('warn', 'The model stopped this reply for safety reasons.')
        return 'safety'
      }
      if (res.finishReason === 'MAX_TOKENS') this.notice('warn', 'The reply hit the length limit and was cut off.')

      const calls = res.parts.filter((p) => p.functionCall)
      if (calls.length === 0) {
        if (res.parts.length === 0) this.notice('info', 'The model returned an empty reply.')
        return 'done'
      }

      const responses: Part[] = []
      for (const part of calls) {
        const fc = part.functionCall!
        const call: ToolCall = { id: fc.id ?? `call_${randomUUID().slice(0, 8)}`, name: fc.name, args: fc.args ?? {} }
        let result: ToolResult
        if (signal.aborted) {
          result = { ok: false, output: STOPPED_OUTPUT }
        } else {
          try {
            result = await this.runCall(call, tctx, signal)
          } catch (err) {
            // Whatever went wrong, the call must still be answered or the history is invalid for good.
            result = {
              ok: false,
              output: `Internal error while running ${fc.name}: ${err instanceof Error ? err.message : String(err)}. Try a different approach.`,
            }
            this.notice('warn', `A ${fc.name} call failed unexpectedly. The model was told.`)
          }
        }
        responses.push({
          functionResponse: {
            name: fc.name,
            ...(fc.id ? { id: fc.id } : {}),
            response: { output: wrapUntrusted(redact(result.output, this.o.secrets?.() ?? [])) },
          },
        })
      }
      await this.push({ role: 'user', parts: responses })
      if (signal.aborted) return 'stopped'
    }
  }

  // ----------------------------------------------------------- one tool call

  private async runCall(call: ToolCall, tctx: ToolContext, signal: AbortSignal): Promise<ToolResult> {
    const { phase, label } = describeCall(call)
    const verdict = await decide(call, this.decisionContext())
    this.o.emit({ type: 'tool-call', call, verdict })
    const record = (final: 'allow' | 'deny', reason: string, approvedBy: 'user' | 'rule' | 'mode' | 'readonly' | 'none') =>
      this.o.audit.record({ tool: call.name, args: call.args, verdict: final, reason, approvedBy }).catch(() => undefined)
    const activity = (state: 'running' | 'done' | 'failed' | 'denied', text: string) =>
      this.o.emit({ type: 'activity', id: call.id, phase, label: tidyLabel(text), state })

    if (verdict.verdict === 'deny') {
      activity('denied', `Blocked: ${label}`)
      await record('deny', verdict.reason, 'none')
      return {
        ok: false,
        output: `Denied: ${verdict.reason}. Do not retry this; choose another approach or ask the user.`,
      }
    }

    let approvedBy: 'user' | 'rule' | 'mode' | 'readonly' = verdict.via ?? 'mode'
    if (verdict.verdict === 'ask') {
      this.o.emit({ type: 'status', state: 'waiting-approval', label: tidyLabel(`Waiting for you: ${label}`) })
      const diff = await previewChange(call, tctx).catch(() => undefined)
      const request = { call, reason: verdict.reason, ...(diff ? { diff } : {}) }
      this.o.emit({ type: 'approval-request', request })

      let decision: ApprovalDecision
      try {
        decision = await raceAbort(this.o.approver(request, signal), signal)
      } catch {
        decision = { decision: 'deny', note: 'The approval prompt failed.' }
      }
      if (signal.aborted) {
        activity('denied', `Skipped: ${label}`)
        await record('deny', 'stopped before approval', 'none')
        return { ok: false, output: STOPPED_OUTPUT }
      }
      if (decision.decision === 'deny') {
        activity('denied', `Skipped: ${label}`)
        await record('deny', 'denied by the user', 'user')
        return {
          ok: false,
          output: `The user denied this action.${decision.note ? ` Their note: ${decision.note}.` : ''} Do not retry it; ask what they want instead.`,
        }
      }
      if (decision.decision === 'always' && RULE_TOOLS.has(call.name)) await this.saveRule(call)
      approvedBy = 'user'
    }

    this.o.emit({ type: 'status', state: 'working', label: tidyLabel(label) })
    activity('running', label)
    this.o.emit({ type: 'tool-start', id: call.id })
    const result = await this.o.registry.execute(call, tctx)
    this.o.emit({ type: 'tool-result', id: call.id, result })
    activity(result.ok ? 'done' : 'failed', describeResult(call, result))
    await record('allow', verdict.reason, approvedBy)
    return result
  }

  // --------------------------------------------------------------- helpers

  private decisionContext(): DecisionContext {
    return {
      mode: this.currentMode,
      projectRoot: this.o.projectRoot,
      extraDirs: this.settings.extraDirs,
      home: this.o.home,
      protectedPaths: this.o.protectedPaths,
      sensitivePaths: this.o.sensitivePaths,
      rules: this.ruleCache ?? [],
      sandboxAvailable: this.o.sandboxAvailable,
      caseInsensitive: process.platform === 'darwin',
    }
  }

  private toolContext(signal: AbortSignal): ToolContext {
    return {
      projectRoot: this.o.projectRoot,
      extraDirs: this.settings.extraDirs,
      signal,
      session: this.state,
      checkpoints: this.o.checkpoints,
      emit: this.o.emit,
      askUser: async (q) => {
        this.o.emit({ type: 'status', state: 'waiting-answer', label: 'Waiting for your answer' })
        return raceAbort(this.o.askUser(q), signal)
      },
      settings: { bashTimeoutMs: BASH_DEFAULT_TIMEOUT_MS },
      home: this.o.home,
      protectedPaths: this.o.protectedPaths,
      caseInsensitive: process.platform === 'darwin',
      arcEnv: [],
    }
  }

  private async saveRule(call: ToolCall): Promise<void> {
    let rule: AllowRule
    if (call.name === 'Bash') {
      const prefix = commandPrefixForRule(String(call.args.command ?? ''))
      // `python3 -c` or `bash -c` would approve any inline program, so no standing rule for those.
      if (!prefix || !isRuleEligible(prefix)) return
      rule = { tool: 'Bash', prefix }
    } else {
      rule = { tool: call.name as ToolName }
    }
    try {
      await this.o.rules.add(rule)
      this.ruleCache = await this.o.rules.load()
    } catch {
      this.notice('warn', 'Could not save the always-allow rule. This one was allowed once.')
    }
  }

  private async push(content: Content): Promise<void> {
    this.history.push(content)
    try {
      await this.o.sessions.append(content)
    } catch {
      if (!this.persistWarned) {
        this.persistWarned = true
        this.notice('warn', 'Could not save this conversation to disk.')
      }
    }
  }

  private async tryCompact(): Promise<void> {
    try {
      const next = await compact(this.o.vertex, this.history)
      if (next !== this.history) {
        this.history = next
        this.lastTotal = 0
        this.notice('info', 'Compacted the conversation to save space.')
      }
    } catch {
      this.notice('warn', 'Could not compact the conversation. Continuing without it.')
    }
  }

  private async vertexFailure(err: unknown): Promise<TurnEndReason> {
    if (!(err instanceof VertexError)) {
      this.notice('error', `The request failed: ${redact(err instanceof Error ? err.message : String(err))}`)
      return 'error'
    }
    const partial = textOnly(err.partial?.parts ?? [])
    if (partial.length > 0) await this.push({ role: 'model', parts: partial })
    if (err.kind === 'aborted') return 'stopped'
    const messages: Record<Exclude<VertexError['kind'], 'aborted' | 'bad-request'>, string> = {
      auth: 'The API key was rejected. Check it in Settings.',
      rate: 'Vertex AI is rate limiting requests. Wait a moment and try again.',
      server: 'Vertex AI had a server error. Try again in a moment.',
      network: 'The connection to Vertex AI was lost. Try again.',
    }
    this.notice(
      'error',
      err.kind === 'bad-request' ? `Vertex AI rejected the request: ${redact(err.message)}` : messages[err.kind],
    )
    return 'error'
  }

  private notice(level: 'info' | 'warn' | 'error', message: string): void {
    this.o.emit({ type: 'notice', level, message })
  }
}
