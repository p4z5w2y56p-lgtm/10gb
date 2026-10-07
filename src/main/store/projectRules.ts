import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { AllowRule } from '../../shared/types'
import { atomicWrite } from './fsutil'

const RuleSchema = z.object({
  tool: z.enum(['Read', 'LS', 'Glob', 'Grep', 'Edit', 'Write', 'Bash', 'TodoWrite', 'WebFetch', 'AskUser']),
  prefix: z.string().min(1).optional(),
})
const FileSchema = z.object({ rules: z.array(RuleSchema) })

const same = (a: AllowRule, b: AllowRule) => a.tool === b.tool && (a.prefix ?? '') === (b.prefix ?? '')

/**
 * "Always allow" rules saved per project in ARC's own data folder, never inside the
 * project: a cloned repository must not be able to pre-approve commands for you.
 */
export class ProjectRules {
  private readonly file: string

  constructor(rulesDir: string, projectRoot: string) {
    this.file = join(rulesDir, `${createHash('sha1').update(projectRoot).digest('hex').slice(0, 12)}.json`)
  }

  async load(): Promise<AllowRule[]> {
    try {
      return FileSchema.parse(JSON.parse(await readFile(this.file, 'utf8'))).rules
    } catch {
      return []
    }
  }

  async add(rule: AllowRule): Promise<void> {
    if (rule.tool === 'Bash' && !rule.prefix) throw new Error('A Bash rule needs a command prefix')
    const rules = await this.load()
    if (rules.some((r) => same(r, rule))) return
    await this.write([...rules, rule])
  }

  async remove(rule: AllowRule): Promise<void> {
    const rules = await this.load()
    await this.write(rules.filter((r) => !same(r, rule)))
  }

  private write(rules: AllowRule[]): Promise<void> {
    return atomicWrite(this.file, JSON.stringify({ rules }, null, 2))
  }
}
