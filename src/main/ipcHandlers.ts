import type { z } from 'zod'
import { IPC, type Channel, type IpcResult } from '../shared/channels'
import { IPC_SCHEMAS, type IpcSchemas } from '../shared/ipc'
import { NoProjectError, NotReadyError, type BackendApp } from './backend'
import { redact } from './safety/redact'

export interface HandlerDeps {
  app: BackendApp
  /** Is the frame that sent this request one of ours? */
  isTrusted: (senderUrl: string) => boolean
  /** Native folder picker; null when cancelled. */
  chooseFolder: () => Promise<string | null>
}

export type Handler = (senderUrl: string, payload: unknown) => Promise<IpcResult>

function failure(err: unknown): IpcResult {
  if (err instanceof NotReadyError) return { ok: false, error: err.message, code: err.code }
  if (err instanceof NoProjectError) return { ok: false, error: err.message, code: err.code }
  return { ok: false, error: redact(err instanceof Error ? err.message : String(err)) }
}

/**
 * One handler per invokable channel. Each checks the sender, validates the
 * payload with zod, then calls the backend. Nothing else is registered.
 */
export function createHandlers(deps: HandlerDeps): Record<Channel, Handler> {
  const { app } = deps
  type Impl<C extends Channel> = (data: z.infer<IpcSchemas[C]>) => unknown

  const impls: { [C in Channel]: Impl<C> } = {
    [IPC.send]: (d) => app.send((d as { text: string }).text),
    [IPC.stop]: () => app.stop(),
    [IPC.approval]: (d) => {
      const { requestId, decision, note } = d as { requestId: string; decision: 'allow-once' | 'always' | 'deny'; note?: string }
      app.resolveApproval(requestId, { decision, ...(note ? { note } : {}) })
    },
    [IPC.answer]: (d) => {
      const { questionId, answer } = d as { questionId: string; answer: string }
      app.resolveAnswer(questionId, answer)
    },
    [IPC.setMode]: (d) => app.setMode((d as { mode: 'ask' | 'auto-edit' | 'auto' }).mode),
    [IPC.undo]: () => app.undo(),
    [IPC.changes]: () => app.getChanges(),
    [IPC.chooseProject]: async () => {
      const path = await deps.chooseFolder()
      return path ? app.openProject(path) : null
    },
    [IPC.openProject]: (d) => app.openProject((d as { path: string }).path),
    [IPC.status]: () => app.status(),
    [IPC.settingsGet]: () => app.getSettings(),
    [IPC.settingsSave]: (d) => app.saveSettings((d as { patch: Parameters<BackendApp['saveSettings']>[0] }).patch),
    [IPC.setKey]: (d) => app.setApiKey((d as { key: string }).key),
    [IPC.clearKey]: () => app.clearApiKey(),
    [IPC.testKey]: () => app.testConnection(),
    [IPC.sessionsList]: () => app.listSessions(),
    [IPC.sessionsResume]: (d) => app.resumeSession((d as { id: string }).id),
    [IPC.rulesList]: () => app.listRules(),
    [IPC.rulesRemove]: (d) => app.removeRule((d as { rule: Parameters<BackendApp['removeRule']>[0] }).rule),
    [IPC.auditRead]: () => app.readAudit(),
    [IPC.spark]: () => app.spark(),
    [IPC.autopilot]: (d) => app.autopilot((d as { on: boolean }).on),
  }

  const handlers = {} as Record<Channel, Handler>
  for (const channel of Object.keys(impls) as Channel[]) {
    handlers[channel] = async (senderUrl, payload) => {
      if (!deps.isTrusted(senderUrl)) return { ok: false, error: 'Request from an untrusted page was refused', code: 'untrusted' }
      const parsed = IPC_SCHEMAS[channel].safeParse(payload)
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        const where = issue?.path.join('.') || 'payload'
        return { ok: false, error: `Invalid request (${where}: ${issue?.message ?? 'invalid'})`, code: 'invalid' }
      }
      try {
        const data = await (impls[channel] as (d: unknown) => unknown)(parsed.data)
        return { ok: true, data: data ?? null }
      } catch (err) {
        return failure(err)
      }
    }
  }
  return handlers
}
