import type { BackendStatus } from '../../main/backend'
import type { CloudDiff, CloudSessionInfo, CloudStatus } from '../../shared/cloud'
import { describeCall } from '../../main/agent/narrate'
import type { SessionMeta } from '../../main/store/sessions'
import type { Settings } from '../../main/store/settings'
import type { Content } from '../../main/vertex/types'
import type {
  ActivityPhase,
  AgentEvent,
  ApprovalRequest,
  PermissionMode,
  StatusState,
  Suggestion,
  TodoItem,
  ToolCall,
} from '../../shared/types'

export type SettingsSection = 'models' | 'permissions' | 'spark' | 'cloud' | 'appearance' | 'advanced' | 'audit' | 'about'

export type ActivityState = 'running' | 'done' | 'failed' | 'denied'

export type Item =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | {
      kind: 'activity'
      id: string
      callId: string
      phase: ActivityPhase
      label: string
      state: ActivityState
      call?: ToolCall
      output?: string
      diff?: string
    }
  | { kind: 'notice'; id: string; level: 'info' | 'warn' | 'error'; message: string }

export interface AppState {
  status: { state: StatusState; label: string }
  transcript: Item[]
  todos: TodoItem[]
  usage: { promptTokens: number; totalTokens: number }
  mode: PermissionMode | null
  changes: { files: string[]; canUndo: boolean }
  suggestions: Suggestion[]
  autopilot: { running: boolean; reason?: string }
  approval: ApprovalRequest | null
  question: { id: string; question: string; options?: string[] } | null
  busy: boolean
  app: BackendStatus | null
  settings: Settings | null
  sessions: SessionMeta[]
  cloud: { status: CloudStatus | null; sessions: CloudSessionInfo[]; diff: CloudDiff | null }
  ui: {
    sidebar: boolean
    settingsOpen: boolean
    settingsSection: SettingsSection
    paletteOpen: boolean
    shortcutsOpen: boolean
    showDetails: boolean
    cloudStartOpen: boolean
    prOpen: boolean
  }
  seq: number
}

export const initialState: AppState = {
  status: { state: 'idle', label: 'Idle' },
  transcript: [],
  todos: [],
  usage: { promptTokens: 0, totalTokens: 0 },
  mode: null,
  changes: { files: [], canUndo: false },
  suggestions: [],
  autopilot: { running: false },
  approval: null,
  question: null,
  busy: false,
  app: null,
  settings: null,
  sessions: [],
  cloud: { status: null, sessions: [], diff: null },
  ui: {
    sidebar: true,
    settingsOpen: false,
    settingsSection: 'models',
    paletteOpen: false,
    shortcutsOpen: false,
    showDetails: false,
    cloudStartOpen: false,
    prOpen: false,
  },
  seq: 0,
}

export type Action =
  | { type: 'event'; event: AgentEvent }
  | { type: 'user-message'; text: string }
  | {
      type: 'loaded'
      app?: BackendStatus
      settings?: Settings | null
      sessions?: SessionMeta[]
      mode?: PermissionMode | null
      changes?: { files: string[]; canUndo: boolean }
    }
  | { type: 'ui'; patch: Partial<AppState['ui']> }
  | { type: 'cloud'; status?: CloudStatus | null; sessions?: CloudSessionInfo[]; diff?: CloudDiff | null }
  | { type: 'question-answered' }
  | { type: 'history'; history: Content[] }
  | { type: 'reset' }

type Draft<T> = T extends unknown ? Omit<T, 'id'> : never

function push(s: AppState, item: Draft<Item>, id?: string): AppState {
  const made = { ...item, id: id ?? `i${s.seq}` } as Item
  return { ...s, seq: s.seq + 1, transcript: [...s.transcript, made] }
}

/** Index of the newest activity item for a tool call. */
function findActivity(items: Item[], callId: string): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === 'activity' && it.callId === callId) return i
  }
  return -1
}

function patchItem(s: AppState, index: number, patch: Partial<Extract<Item, { kind: 'activity' }>>): AppState {
  const items = s.transcript.slice()
  items[index] = { ...(items[index] as Extract<Item, { kind: 'activity' }>), ...patch }
  return { ...s, transcript: items }
}

function addActivity(s: AppState, callId: string, fields: Draft<Extract<Item, { kind: 'activity' }>>): AppState {
  // Models sometimes reuse ids across turns; keep React keys unique.
  const taken = s.transcript.some((i) => i.id === callId)
  return push(s, fields, taken ? `${callId}#${s.seq}` : callId)
}

function onEvent(s: AppState, e: AgentEvent): AppState {
  switch (e.type) {
    case 'text-delta': {
      const last = s.transcript[s.transcript.length - 1]
      if (last && last.kind === 'assistant' && last.streaming) {
        const items = s.transcript.slice()
        items[items.length - 1] = { ...last, text: last.text + e.text }
        return { ...s, transcript: items }
      }
      return push(s, { kind: 'assistant', text: e.text, streaming: true })
    }
    case 'tool-call': {
      const { phase, label } = describeCall(e.call)
      return addActivity(s, e.call.id, { kind: 'activity', callId: e.call.id, phase, label, state: 'running', call: e.call })
    }
    case 'activity': {
      const idx = findActivity(s.transcript, e.id)
      if (idx < 0) {
        return addActivity(s, e.id, { kind: 'activity', callId: e.id, phase: e.phase, label: e.label, state: e.state })
      }
      return patchItem(s, idx, { phase: e.phase, label: e.label, state: e.state })
    }
    case 'tool-result': {
      const idx = findActivity(s.transcript, e.id)
      return idx < 0 ? s : patchItem(s, idx, { output: e.result.output })
    }
    case 'approval-request': {
      const idx = findActivity(s.transcript, e.request.call.id)
      const next = idx < 0 || !e.request.diff ? s : patchItem(s, idx, { diff: e.request.diff })
      return { ...next, approval: e.request }
    }
    case 'tool-start':
      return { ...s, approval: null }
    case 'question':
      return { ...s, question: { id: e.id, question: e.question, ...(e.options ? { options: e.options } : {}) } }
    case 'status':
      return { ...s, status: { state: e.state, label: e.label } }
    case 'todos':
      return { ...s, todos: e.todos }
    case 'usage':
      return { ...s, usage: { promptTokens: e.promptTokens, totalTokens: e.totalTokens } }
    case 'notice':
      return push(s, { kind: 'notice', level: e.level, message: e.message })
    case 'suggestions':
      return { ...s, suggestions: e.items }
    case 'mode':
      return { ...s, mode: e.mode }
    case 'changes':
      return { ...s, changes: { files: e.files, canUndo: e.canUndo } }
    case 'autopilot':
      return { ...s, autopilot: { running: e.running, ...(e.reason ? { reason: e.reason } : {}) } }
    case 'turn-end': {
      const transcript = s.transcript.map((i): Item => {
        if (i.kind === 'assistant' && i.streaming) return { ...i, streaming: false }
        if (i.kind === 'activity' && i.state === 'running') return { ...i, state: 'failed' }
        return i
      })
      return { ...s, transcript, busy: false, approval: null, question: null, status: { state: 'idle', label: 'Idle' } }
    }
  }
}

/** A saved conversation as screen items: chat text and one finished line per tool call. */
function itemsFromHistory(history: Content[]): AppState {
  let s: AppState = { ...initialState }
  for (const c of history) {
    for (const part of c.parts) {
      if (part.text && !part.thought) {
        s = push(s, c.role === 'user' ? { kind: 'user', text: part.text } : { kind: 'assistant', text: part.text, streaming: false })
      } else if (part.functionCall) {
        const call: ToolCall = { id: part.functionCall.id ?? `h${s.seq}`, name: part.functionCall.name, args: part.functionCall.args }
        const { phase, label } = describeCall(call)
        s = addActivity(s, call.id, { kind: 'activity', callId: call.id, phase, label, state: 'done', call })
      }
    }
  }
  return s
}

export function reduce(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'event':
      return onEvent(s, a.event)
    case 'user-message':
      return { ...push(s, { kind: 'user', text: a.text }), busy: true, suggestions: [] }
    case 'loaded':
      return {
        ...s,
        ...(a.app !== undefined ? { app: a.app } : {}),
        ...(a.settings !== undefined ? { settings: a.settings } : {}),
        ...(a.sessions !== undefined ? { sessions: a.sessions } : {}),
        ...(a.mode !== undefined ? { mode: a.mode } : {}),
        ...(a.changes !== undefined ? { changes: a.changes } : {}),
      }
    case 'ui':
      return { ...s, ui: { ...s.ui, ...a.patch } }
    case 'cloud':
      return {
        ...s,
        cloud: {
          status: a.status !== undefined ? a.status : s.cloud.status,
          sessions: a.sessions !== undefined ? a.sessions : s.cloud.sessions,
          diff: a.diff !== undefined ? a.diff : s.cloud.diff,
        },
      }
    case 'question-answered':
      return { ...s, question: null }
    case 'history': {
      const rebuilt = itemsFromHistory(a.history)
      return { ...s, transcript: rebuilt.transcript, seq: rebuilt.seq, todos: [], approval: null, question: null, busy: false }
    }
    case 'reset':
      return { ...s, cloud: { ...s.cloud, diff: null }, transcript: [], todos: [], suggestions: [], approval: null, question: null, busy: false, usage: initialState.usage, status: initialState.status }
  }
}
