import { readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MODEL, MAX_STEPS, AUTOPILOT_DEFAULT_ROUNDS } from '../../shared/constants'
import { atomicWrite } from './fsutil'

const PrompterSchema = z.object({
  mode: z.enum(['off', 'suggest', 'autopilot']).default('suggest'),
  maxRounds: z.number().int().min(1).max(50).default(AUTOPILOT_DEFAULT_ROUNDS),
  tokenBudget: z.number().int().min(1000).default(200_000),
})

const CloudSchema = z.object({
  workerUrl: z.string().trim().max(500).default(''),
  autoPush: z.boolean().default(true),
})

export const SettingsSchema = z.object({
  /** Coder model id. */
  model: z.string().trim().min(1).default(DEFAULT_MODEL),
  prompterModel: z.string().trim().min(1).default(DEFAULT_MODEL),
  permissionMode: z.enum(['ask', 'auto-edit', 'auto']).default('ask'),
  prompter: PrompterSchema.default({
    mode: 'suggest',
    maxRounds: AUTOPILOT_DEFAULT_ROUNDS,
    tokenBudget: 200_000,
  }),
  maxSteps: z.number().int().min(1).max(200).default(MAX_STEPS),
  turnTokenBudget: z.number().int().min(1000).default(500_000),
  contextWindowTokens: z.number().int().min(1000).default(DEFAULT_CONTEXT_WINDOW),
  extraDirs: z.array(z.string()).default([]),
  theme: z.enum(['ai', 'studios']).default('ai'),
  showDetails: z.boolean().default(false),
  cloud: CloudSchema.default({ workerUrl: '', autoPush: true }),
})

export type Settings = z.infer<typeof SettingsSchema>
export type SettingsPatch = Partial<Omit<Settings, 'prompter' | 'cloud'>> & {
  prompter?: Partial<Settings['prompter']>
  cloud?: Partial<Settings['cloud']>
}

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({})

export class SettingsStore {
  private readonly file: string
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly dir: string) {
    this.file = join(dir, 'settings.json')
  }

  async load(): Promise<Settings> {
    let raw: string
    try {
      raw = await readFile(this.file, 'utf8')
    } catch {
      return DEFAULT_SETTINGS
    }
    try {
      return SettingsSchema.parse(JSON.parse(raw))
    } catch {
      await rename(this.file, `${this.file}.bak`).catch(() => undefined)
      return DEFAULT_SETTINGS
    }
  }

  /** Merge `patch` into the stored settings. Rejects, leaving the file as it was, if the result is invalid. */
  save(patch: SettingsPatch): Promise<Settings> {
    const run = async (): Promise<Settings> => {
      const current = await this.load()
      const merged = SettingsSchema.parse({
        ...current,
        ...patch,
        prompter: { ...current.prompter, ...patch.prompter },
        cloud: { ...current.cloud, ...patch.cloud },
      })
      await atomicWrite(this.file, JSON.stringify(merged, null, 2))
      return merged
    }
    const next = this.chain.then(run, run)
    this.chain = next.catch(() => undefined)
    return next
  }
}
