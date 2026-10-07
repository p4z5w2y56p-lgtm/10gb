import { DEFAULT_SETTINGS } from '../../../src/main/store/settings'
import type { Arc } from '../../../src/renderer/arc/client'
import type { IpcResult } from '../../../src/shared/channels'
import { IPC } from '../../../src/shared/channels'
import type { AgentEvent } from '../../../src/shared/types'

type Responder = IpcResult | ((payload: unknown) => IpcResult | Promise<IpcResult>)

export interface FakeArc extends Arc {
  calls: Array<{ channel: string; payload: unknown }>
  emit(event: AgentEvent): void
  respond(channel: string, responder: Responder): void
  callsTo(channel: string): unknown[]
}

export const readyStatus = {
  ready: true,
  hasApiKey: true,
  hasProject: true,
  projectRoot: '/work/demo',
  busy: false,
  mode: 'ask',
  sessionId: 's1',
}

/** An in-memory stand-in for window.arc: records calls, answers from a table, lets tests push events. */
export function createFakeArc(initial: Record<string, Responder> = {}): FakeArc {
  const table = new Map<string, Responder>(Object.entries(initial))
  const listeners = new Set<(e: AgentEvent) => void>()
  const calls: Array<{ channel: string; payload: unknown }> = []

  const defaults: Record<string, Responder> = {
    [IPC.status]: { ok: true, data: readyStatus },
    [IPC.settingsGet]: { ok: true, data: { settings: DEFAULT_SETTINGS, status: readyStatus } },
    [IPC.changes]: { ok: true, data: { files: [], canUndo: false } },
    [IPC.sessionsList]: { ok: true, data: [] },
    [IPC.rulesList]: { ok: true, data: [] },
    [IPC.auditRead]: { ok: true, data: [] },
  }

  return {
    calls,
    async invoke(channel, payload) {
      calls.push({ channel, payload })
      const responder = table.get(channel) ?? defaults[channel] ?? { ok: true as const, data: null }
      return typeof responder === 'function' ? responder(payload) : responder
    },
    onEvent(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit(event) {
      for (const l of [...listeners]) l(event)
    },
    respond(channel, responder) {
      table.set(channel, responder)
    },
    callsTo(channel) {
      return calls.filter((c) => c.channel === channel).map((c) => c.payload)
    },
  }
}
