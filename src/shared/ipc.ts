import { z } from 'zod'
import { IPC } from './channels'

const Mode = z.enum(['ask', 'auto-edit', 'auto'])
const Rule = z.object({
  tool: z.enum(['Read', 'LS', 'Glob', 'Grep', 'Edit', 'Write', 'Bash', 'TodoWrite', 'WebFetch', 'AskUser']),
  prefix: z.string().min(1).optional(),
})

const nothing = z.undefined().or(z.null()).or(z.object({}))

/** Payload schema for every invokable channel. Anything else is rejected before it reaches the backend. */
export const IPC_SCHEMAS = {
  [IPC.send]: z.object({ text: z.string().trim().min(1).max(100_000) }),
  [IPC.stop]: nothing,
  [IPC.approval]: z.object({
    requestId: z.string().min(1),
    decision: z.enum(['allow-once', 'always', 'deny']),
    note: z.string().max(2000).optional(),
  }),
  [IPC.answer]: z.object({ questionId: z.string().min(1), answer: z.string().max(10_000) }),
  [IPC.setMode]: z.object({ mode: Mode }),
  [IPC.undo]: nothing,
  [IPC.changes]: nothing,
  [IPC.chooseProject]: nothing,
  [IPC.openProject]: z.object({ path: z.string().min(1) }),
  [IPC.status]: nothing,
  [IPC.settingsGet]: nothing,
  [IPC.settingsSave]: z.object({
    patch: z
      .object({
        model: z.string().trim().min(1),
        prompterModel: z.string().trim().min(1),
        permissionMode: Mode,
        prompter: z
          .object({
            mode: z.enum(['off', 'suggest', 'autopilot']),
            maxRounds: z.number().int(),
            tokenBudget: z.number().int(),
          })
          .partial(),
        maxSteps: z.number().int(),
        turnTokenBudget: z.number().int(),
        contextWindowTokens: z.number().int(),
        extraDirs: z.array(z.string()),
        theme: z.enum(['ai', 'studios']),
        showDetails: z.boolean(),
      })
      .partial()
      .strict(),
  }),
  [IPC.setKey]: z.object({ key: z.string().min(1).max(500) }),
  [IPC.clearKey]: nothing,
  [IPC.testKey]: nothing,
  [IPC.sessionsList]: nothing,
  [IPC.sessionsResume]: z.object({ id: z.string().min(1).max(200) }),
  [IPC.rulesList]: nothing,
  [IPC.rulesRemove]: z.object({ rule: Rule }),
  [IPC.auditRead]: nothing,
  [IPC.spark]: nothing,
  [IPC.autopilot]: z.object({ on: z.boolean() }),
} as const

export type IpcSchemas = typeof IPC_SCHEMAS
