/** Contracts shared by the main process, the preload bridge and the renderer. */

import type { Content } from '../main/vertex/types'

export type PermissionMode = 'ask' | 'auto-edit' | 'auto'

export type ToolName =
  | 'Read'
  | 'LS'
  | 'Glob'
  | 'Grep'
  | 'Edit'
  | 'Write'
  | 'Bash'
  | 'TodoWrite'
  | 'WebFetch'
  | 'AskUser'

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface Verdict {
  verdict: 'allow' | 'ask' | 'deny'
  reason: string
  via?: 'readonly' | 'mode' | 'rule'
}

export interface ToolResult {
  ok: boolean
  output: string
}

export interface AllowRule {
  tool: ToolName
  prefix?: string
}

export interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export type SuggestionKind = 'feature' | 'fix' | 'test' | 'refactor' | 'polish' | 'wild'

export interface Suggestion {
  title: string
  prompt: string
  kind: SuggestionKind
}

export type PrompterMode = 'off' | 'suggest' | 'autopilot'

export interface ApprovalRequest {
  call: ToolCall
  reason: string
  diff?: string
}

export interface ApprovalDecision {
  decision: 'allow-once' | 'always' | 'deny'
  note?: string
}

export type Approver = (req: ApprovalRequest, signal: AbortSignal) => Promise<ApprovalDecision>

export type TurnEndReason = 'done' | 'stopped' | 'step-cap' | 'budget' | 'error' | 'safety'

export type ActivityPhase =
  | 'reading'
  | 'searching'
  | 'editing'
  | 'writing'
  | 'running'
  | 'fetching'
  | 'planning'
  | 'asking'
  | 'other'

export type StatusState = 'idle' | 'thinking' | 'working' | 'waiting-approval' | 'waiting-answer'

export type AgentEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; call: ToolCall; verdict: Verdict }
  | { type: 'approval-request'; request: ApprovalRequest }
  | { type: 'tool-start'; id: string }
  | { type: 'tool-result'; id: string; result: ToolResult }
  | { type: 'todos'; todos: TodoItem[] }
  | { type: 'usage'; promptTokens: number; outputTokens: number; totalTokens: number }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'turn-end'; reason: TurnEndReason }
  | { type: 'status'; state: StatusState; label: string }
  | { type: 'question'; id: string; question: string; options?: string[] }
  | { type: 'suggestions'; items: Suggestion[] }
  | { type: 'autopilot'; running: boolean; reason?: string }
  | { type: 'mode'; mode: PermissionMode }
  | { type: 'changes'; files: string[]; canUndo: boolean }
  /** The whole conversation was re-read (cloud attach or catch-up): rebuild the transcript from it. */
  | { type: 'history-reload'; history: Content[] }
  | {
      type: 'activity'
      id: string
      phase: ActivityPhase
      label: string
      state: 'running' | 'done' | 'failed' | 'denied'
    }
