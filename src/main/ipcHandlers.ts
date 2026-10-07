import type { z } from 'zod'
import { IPC, type Channel, type IpcResult } from '../shared/channels'
import { IPC_SCHEMAS, type IpcSchemas } from '../shared/ipc'
import type { CloudSecretName, CloudStartRequest } from '../shared/cloud'
import type { AllowRule } from '../shared/types'
import { NoProjectError, NotReadyError } from './backend'
import type { Backend } from './backendApi'
import { redact } from './safety/redact'
import type { SettingsPatch } from './store/settings'

export interface HandlerDeps {
  app: Backend
  /** Is the frame that sent this request one of ours? */
  isTrusted: (senderUrl: string) => boolean
  /** Native folder picker; null when cancelled. */
  chooseFolder: () => Promise<string | null>
}

export type Handler = (senderUrl: string, payload: unknown) => Promise<IpcResult>

/** GitHub token shapes that redact() does not know; they can reach an error text from a failed push or API call. */
const GITHUB_TOKENS = [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, /\bgithub_pat_[A-Za-z0-9_]{20,}/g]

function scrub(text: string, secrets: string[]): string {
  let out = redact(text, secrets)
  for (const re of GITHUB_TOKENS) out = out.replace(re, '[REDACTED]')
  return out
}

function failure(err: unknown, secrets: string[] = []): IpcResult {
  if (err instanceof NotReadyError) return { ok: false, error: err.message, code: err.code }
  if (err instanceof NoProjectError) return { ok: false, error: err.message, code: err.code }
  // A cloud session that already runs a turn: the caller must not treat the refusal as the end of that turn.
  const busy = err instanceof Error && (err as { code?: unknown }).code === 'busy'
  return { ok: false, error: scrub(err instanceof Error ? err.message : String(err), secrets), ...(busy ? { code: 'busy' as const } : {}) }
}

/** Values the caller just submitted: they are scrubbed from any error that comes back, whatever they look like. */
function submittedSecrets(channel: Channel, data: unknown): string[] {
  if (channel === IPC.setKey) return [(data as { key: string }).key]
  if (channel === IPC.cloudSetSecret) return [(data as { value: string }).value]
  return []
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
    [IPC.settingsSave]: (d) => app.saveSettings((d as { patch: SettingsPatch }).patch),
    [IPC.setKey]: (d) => app.setApiKey((d as { key: string }).key),
    [IPC.clearKey]: () => app.clearApiKey(),
    [IPC.testKey]: () => app.testConnection(),
    [IPC.sessionsList]: () => app.listSessions(),
    [IPC.sessionsResume]: (d) => app.resumeSession((d as { id: string }).id),
    [IPC.rulesList]: () => app.listRules(),
    [IPC.rulesRemove]: (d) => app.removeRule((d as { rule: AllowRule }).rule),
    [IPC.auditRead]: () => app.readAudit(),
    [IPC.spark]: () => app.spark(),
    [IPC.autopilot]: (d) => app.autopilot((d as { on: boolean }).on),
    [IPC.cloudStatus]: () => app.cloudStatus(),
    [IPC.cloudSetSecret]: (d) => {
      const { name, value } = d as { name: CloudSecretName; value: string }
      return app.cloudSetSecret(name, value)
    },
    [IPC.cloudClearSecret]: (d) => app.cloudClearSecret((d as { name: CloudSecretName }).name),
    [IPC.cloudTest]: () => app.cloudTest(),
    [IPC.cloudStart]: (d) => app.cloudStart(d as CloudStartRequest),
    [IPC.cloudSessions]: () => app.cloudSessions(),
    [IPC.cloudAttach]: (d) => app.cloudAttach((d as { id: string }).id),
    [IPC.cloudLeave]: () => app.cloudLeave(),
    [IPC.cloudEnd]: (d) => app.cloudEnd((d as { id: string }).id),
    [IPC.cloudDiff]: () => app.cloudDiff(),
    [IPC.cloudPush]: () => app.cloudPush(),
    [IPC.cloudPr]: (d) => app.cloudPr(d as { title: string; body?: string; draft?: boolean }),
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
        return failure(err, submittedSecrets(channel, parsed.data))
      }
    }
  }
  return handlers
}
