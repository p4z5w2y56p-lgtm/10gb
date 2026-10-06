import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolContext } from '../../src/main/tools/registry'
import type { AgentEvent } from '../../src/shared/types'

export interface Fixture {
  base: string
  root: string
  ctx: ToolContext
  events: AgentEvent[]
  snapshots: string[]
  abort: AbortController
  cleanup(): Promise<void>
}

/** A temp project directory plus a ToolContext wired to in-memory fakes. */
export async function makeFixture(overrides: Partial<ToolContext> = {}): Promise<Fixture> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'arc-tool-')))
  const root = join(base, 'project')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(root, { recursive: true })
  const events: AgentEvent[] = []
  const snapshots: string[] = []
  const abort = new AbortController()
  const ctx: ToolContext = {
    projectRoot: root,
    extraDirs: [],
    signal: abort.signal,
    session: { readFiles: new Map(), todos: [] },
    checkpoints: {
      snapshot: async (p: string) => {
        snapshots.push(p)
      },
    },
    emit: (e) => events.push(e),
    askUser: async () => 'answer',
    settings: { bashTimeoutMs: 120_000 },
    home: join(base, 'home'),
    protectedPaths: [],
    arcEnv: [],
    ...overrides,
  }
  return { base, root, ctx, events, snapshots, abort, cleanup: () => rm(base, { recursive: true, force: true }) }
}
