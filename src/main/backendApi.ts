import type {
  CloudDiff,
  CloudSecretName,
  CloudSessionInfo,
  CloudStartRequest,
  CloudStatus,
  CloudTestResult,
  PullRequestResult,
  PushResult,
} from '../shared/cloud'
import type { AllowRule, ApprovalDecision, PermissionMode, Suggestion, TurnEndReason } from '../shared/types'
import type { BackendStatus, ConnectionResult } from './backend'
import type { AuditEntry } from './store/audit'
import type { SessionMeta } from './store/sessions'
import type { Settings, SettingsPatch } from './store/settings'
import type { Content } from './vertex/types'

export interface OpenedProject {
  root: string
  sessionId: string
  history: Content[]
}

/**
 * Everything the IPC handlers drive. BackendApp implements the local half;
 * BackendRouter implements all of it and sends session calls either to the
 * local BackendApp or to a cloud session on the worker.
 */
export interface Backend {
  // session
  /** Local: resolves when the turn ends. Cloud: resolves with 'started' once the worker accepted it. */
  send(text: string): Promise<TurnEndReason | 'started'>
  stop(): void | Promise<void>
  resolveApproval(requestId: string, decision: ApprovalDecision): void | Promise<void>
  resolveAnswer(questionId: string, answer: string): void | Promise<void>
  setMode(mode: PermissionMode): void | Promise<void>
  undo(): Promise<{ restored: string[]; removed: string[] }>
  getChanges(): Promise<{ files: string[]; canUndo: boolean }>
  spark(): Promise<Suggestion[]>
  autopilot(on: boolean): Promise<{ settings: Settings; status: BackendStatus }>
  listRules(): Promise<AllowRule[]>
  removeRule(rule: AllowRule): Promise<void>
  readAudit(): Promise<AuditEntry[]>
  listSessions(): Promise<SessionMeta[]>

  // local only
  openProject(path: string, resumeId?: string): Promise<OpenedProject>
  resumeSession(id: string): Promise<OpenedProject>

  // app level
  status(): Promise<BackendStatus>
  getSettings(): Promise<{ settings: Settings; status: BackendStatus }>
  saveSettings(patch: SettingsPatch): Promise<{ settings: Settings; status: BackendStatus }>
  setApiKey(key: string): Promise<BackendStatus>
  clearApiKey(): Promise<BackendStatus>
  testConnection(): Promise<ConnectionResult[]>

  // cloud
  cloudStatus(): Promise<CloudStatus>
  cloudSetSecret(name: CloudSecretName, value: string): Promise<CloudStatus>
  cloudClearSecret(name: CloudSecretName): Promise<CloudStatus>
  cloudTest(): Promise<CloudTestResult[]>
  cloudStart(req: CloudStartRequest): Promise<OpenedProject & { cloud: CloudSessionInfo }>
  cloudSessions(): Promise<CloudSessionInfo[]>
  cloudAttach(id: string): Promise<OpenedProject & { cloud: CloudSessionInfo }>
  /** Detach from the cloud session but leave it running on the worker. */
  cloudLeave(): Promise<BackendStatus>
  /** Stop the session on the worker and delete its workspace. */
  cloudEnd(id: string): Promise<null>
  cloudDiff(): Promise<CloudDiff>
  cloudPush(): Promise<PushResult>
  cloudPr(req: { title: string; body?: string; draft?: boolean }): Promise<PullRequestResult>
}
