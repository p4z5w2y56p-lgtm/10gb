import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Verdict } from '../../shared/types'
import { redact } from '../safety/redact'

export interface AuditEntry {
  ts: string
  tool: string
  /** Redacted, truncated JSON of the call arguments. */
  args: unknown
  verdict: Verdict['verdict']
  reason: string
  approvedBy: 'user' | 'rule' | 'mode' | 'readonly' | 'none'
}

const MAX_ARGS_CHARS = 500

/** Append-only JSONL record of every tool call and what decided it. Never leaves the machine. */
export class AuditLog {
  private readonly file: string
  private chain: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly dir: string,
    sessionId: string,
    private readonly secrets: () => string[] = () => [],
  ) {
    this.file = join(dir, `${sessionId}.jsonl`)
  }

  record(entry: Omit<AuditEntry, 'ts'>): Promise<void> {
    const secrets = this.secrets()
    let args = redact(JSON.stringify(entry.args) ?? '', secrets)
    if (args.length > MAX_ARGS_CHARS) args = `${args.slice(0, MAX_ARGS_CHARS)}…`
    const line: AuditEntry = {
      ...entry,
      ts: new Date().toISOString(),
      args,
      reason: redact(entry.reason, secrets),
    }
    const write = async () => {
      await mkdir(this.dir, { recursive: true })
      await appendFile(this.file, JSON.stringify(line) + '\n')
    }
    const next = this.chain.then(write, write)
    this.chain = next.catch(() => undefined)
    return next as Promise<void>
  }

  async read(): Promise<AuditEntry[]> {
    let raw: string
    try {
      raw = await readFile(this.file, 'utf8')
    } catch {
      return []
    }
    const out: AuditEntry[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        out.push(JSON.parse(line) as AuditEntry)
      } catch {
        // skip a corrupt line
      }
    }
    return out
  }
}
