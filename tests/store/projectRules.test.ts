import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectRules } from '../../src/main/store/projectRules'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'arc-rules-'))
})
afterEach(() => rm(root, { recursive: true, force: true }))

describe('ProjectRules', () => {
  it('is empty without a file', async () => {
    expect(await new ProjectRules(root).load()).toEqual([])
  })

  it('persists added rules to <project>/.arc/settings.json', async () => {
    const rules = new ProjectRules(root)
    await rules.add({ tool: 'Bash', prefix: 'npm test' })
    expect(await new ProjectRules(root).load()).toEqual([{ tool: 'Bash', prefix: 'npm test' }])
    const raw = JSON.parse(await readFile(join(root, '.arc', 'settings.json'), 'utf8'))
    expect(raw.rules).toHaveLength(1)
  })

  it('is idempotent for duplicates', async () => {
    const rules = new ProjectRules(root)
    await rules.add({ tool: 'Edit' })
    await rules.add({ tool: 'Edit' })
    expect(await rules.load()).toEqual([{ tool: 'Edit' }])
  })

  it('refuses a Bash rule with no prefix (no blanket shell allow)', async () => {
    await expect(new ProjectRules(root).add({ tool: 'Bash' })).rejects.toThrow()
  })

  it('removes a rule', async () => {
    const rules = new ProjectRules(root)
    await rules.add({ tool: 'Bash', prefix: 'npm test' })
    await rules.add({ tool: 'Edit' })
    await rules.remove({ tool: 'Bash', prefix: 'npm test' })
    expect(await rules.load()).toEqual([{ tool: 'Edit' }])
  })

  it('treats a malformed file as no rules', async () => {
    await mkdir(join(root, '.arc'))
    await writeFile(join(root, '.arc', 'settings.json'), '{{{')
    expect(await new ProjectRules(root).load()).toEqual([])
    await writeFile(join(root, '.arc', 'settings.json'), JSON.stringify({ rules: [{ tool: 'Nope' }] }))
    expect(await new ProjectRules(root).load()).toEqual([])
  })
})
