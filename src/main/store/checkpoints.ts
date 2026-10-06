import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

interface Entry {
  existed: boolean
  backup?: string
  mode?: number
}

interface Turn {
  id: string
  index: number
  entries: Map<string, Entry>
}

/**
 * Per-session file snapshots taken before the agent writes. `undoLastTurn` puts
 * the last turn's files back. Backups live on disk; the index lives in memory,
 * so undo covers the running app session.
 */
export class CheckpointStore {
  private readonly turns: Turn[] = []
  private counter = 0

  constructor(
    private readonly dir: string,
    private readonly sessionId: string,
  ) {}

  beginTurn(turnId: string): void {
    this.turns.push({ id: turnId, index: this.counter++, entries: new Map() })
  }

  async snapshot(absPath: string): Promise<void> {
    if (this.turns.length === 0) this.beginTurn('implicit')
    const turn = this.turns[this.turns.length - 1]
    if (turn.entries.has(absPath)) return
    const st = await stat(absPath).catch(() => null)
    if (!st || !st.isFile()) {
      turn.entries.set(absPath, { existed: false })
      return
    }
    const folder = join(this.dir, this.sessionId)
    await mkdir(folder, { recursive: true })
    const backup = join(folder, `${turn.index}-${createHash('sha1').update(absPath).digest('hex')}`)
    await copyFile(absPath, backup)
    turn.entries.set(absPath, { existed: true, backup, mode: st.mode & 0o777 })
  }

  canUndo(): boolean {
    return this.turns.some((t) => t.entries.size > 0)
  }

  changedFiles(): string[] {
    const files = new Set<string>()
    for (const t of this.turns) for (const p of t.entries.keys()) files.add(p)
    return [...files]
  }

  async undoLastTurn(): Promise<{ restored: string[]; removed: string[] }> {
    const result = { restored: [] as string[], removed: [] as string[] }
    while (this.turns.length > 0) {
      const turn = this.turns.pop()!
      if (turn.entries.size === 0) continue
      for (const [path, e] of turn.entries) {
        if (e.existed && e.backup) {
          await copyFile(e.backup, path)
          if (e.mode !== undefined) await chmod(path, e.mode)
          await rm(e.backup, { force: true })
          result.restored.push(path)
        } else {
          await rm(path, { force: true })
          result.removed.push(path)
        }
      }
      break
    }
    return result
  }
}
