import type { BackendStatus, ConnectionResult } from '../../main/backend'
import type { AuditEntry } from '../../main/store/audit'
import type { SessionMeta } from '../../main/store/sessions'
import type { Settings, SettingsPatch } from '../../main/store/settings'
import type { Content } from '../../main/vertex/types'
import { IPC, type IpcResult } from '../../shared/channels'
import type {
  AgentEvent,
  AllowRule,
  PermissionMode,
  Suggestion,
  TurnEndReason,
} from '../../shared/types'

/** The shape window.arc has (see src/preload/index.ts). */
export interface Arc {
  invoke(channel: string, payload?: unknown): Promise<unknown>
  onEvent(listener: (event: AgentEvent) => void): () => void
}

export class ArcError extends Error {
  constructor(
    message: string,
    readonly code?: 'no-api-key' | 'no-project' | 'invalid' | 'untrusted',
  ) {
    super(message)
    this.name = 'ArcError'
  }
}

export interface OpenedProject {
  root: string
  sessionId: string
  history: Content[]
}

/** Typed, unwrapping view of the backend. Failures become ArcError. */
export function createClient(arc: Arc) {
  async function call<T>(channel: string, payload?: unknown): Promise<T> {
    let result: IpcResult<T>
    try {
      result = (await arc.invoke(channel, payload)) as IpcResult<T>
    } catch (err) {
      throw new ArcError(`Could not reach the app backend: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (!result || typeof result !== 'object' || !('ok' in result)) {
      throw new ArcError('The backend sent an unexpected reply.')
    }
    if (!result.ok) throw new ArcError(result.error, result.code)
    return result.data
  }

  return {
    send: (text: string) => call<TurnEndReason>(IPC.send, { text }),
    stop: () => call<null>(IPC.stop),
    approve: (requestId: string, decision: 'allow-once' | 'always' | 'deny', note?: string) =>
      call<null>(IPC.approval, { requestId, decision, ...(note ? { note } : {}) }),
    answer: (questionId: string, answer: string) => call<null>(IPC.answer, { questionId, answer }),
    setMode: (mode: PermissionMode) => call<null>(IPC.setMode, { mode }),
    undo: () => call<{ restored: string[]; removed: string[] }>(IPC.undo),
    changes: () => call<{ files: string[]; canUndo: boolean }>(IPC.changes),
    chooseProject: () => call<OpenedProject | null>(IPC.chooseProject),
    openProject: (path: string) => call<OpenedProject>(IPC.openProject, { path }),
    status: () => call<BackendStatus>(IPC.status),
    getSettings: () => call<{ settings: Settings; status: BackendStatus }>(IPC.settingsGet),
    saveSettings: (patch: SettingsPatch) => call<{ settings: Settings; status: BackendStatus }>(IPC.settingsSave, { patch }),
    setKey: (key: string) => call<BackendStatus>(IPC.setKey, { key }),
    clearKey: () => call<BackendStatus>(IPC.clearKey),
    testKey: () => call<ConnectionResult[]>(IPC.testKey),
    listSessions: () => call<SessionMeta[]>(IPC.sessionsList),
    resumeSession: (id: string) => call<OpenedProject>(IPC.sessionsResume, { id }),
    listRules: () => call<AllowRule[]>(IPC.rulesList),
    removeRule: (rule: AllowRule) => call<null>(IPC.rulesRemove, { rule }),
    readAudit: () => call<AuditEntry[]>(IPC.auditRead),
    spark: () => call<Suggestion[]>(IPC.spark),
    setAutopilot: (on: boolean) => call<{ settings: Settings; status: BackendStatus }>(IPC.autopilot, { on }),
    onEvent: (listener: (event: AgentEvent) => void) => arc.onEvent(listener),
  }
}

export type ArcClient = ReturnType<typeof createClient>
