import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectRules } from '../../src/main/store/projectRules'

let base: string
let root: string
let rulesDir: string
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'arc-rules-'))
  root = join(base, 'project')
  rulesDir = join(base, 'data', 'rules')
  await mkdir(root, { recursive: true })
})
afterEach(() => rm(base, { recursive: true, force: true }))

describe('ProjectRules', () => {
  it('is empty without a file', async () => {
    expect(await new ProjectRules(rulesDir, root).load()).toEqual([])
  })

  it('persists added rules in ARC data, keyed by project, and writes nothing into the project', async () => {
    await new ProjectRules(rulesDir, root).add({ tool: 'Bash', prefix: 'npm test' })
    expect(await new ProjectRules(rulesDir, root).load()).toEqual([{ tool: 'Bash', prefix: 'npm test' }])
    const files = await readdir(rulesDir)
    expect(files).toHaveLength(1)
    expect(JSON.parse(await readFile(join(rulesDir, files[0]), 'utf8')).rules).toHaveLength(1)
    expect(await readdir(root)).toEqual([])
  })

  it('keeps projects apart', async () => {
    const other = join(base, 'other')
    await mkdir(other)
    await new ProjectRules(rulesDir, root).add({ tool: 'Edit' })
    expect(await new ProjectRules(rulesDir, other).load()).toEqual([])
  })

  it('ignores a rules file shipped inside the project (a cloned repo cannot pre-approve commands)', async () => {
    await mkdir(join(root, '.arc'))
    await writeFile(join(root, '.arc', 'settings.json'), JSON.stringify({ rules: [{ tool: 'Bash', prefix: 'make' }, { tool: 'Edit' }] }))
    expect(await new ProjectRules(rulesDir, root).load()).toEqual([])
  })

  it('is idempotent for duplicates', async () => {
    const rules = new ProjectRules(rulesDir, root)
    await rules.add({ tool: 'Edit' })
    await rules.add({ tool: 'Edit' })
    expect(await rules.load()).toEqual([{ tool: 'Edit' }])
  })

  it('refuses a Bash rule with no prefix (no blanket shell allow)', async () => {
    await expect(new ProjectRules(rulesDir, root).add({ tool: 'Bash' })).rejects.toThrow()
  })

  it('removes a rule', async () => {
    const rules = new ProjectRules(rulesDir, root)
    await rules.add({ tool: 'Bash', prefix: 'npm test' })
    await rules.add({ tool: 'Edit' })
    await rules.remove({ tool: 'Bash', prefix: 'npm test' })
    expect(await rules.load()).toEqual([{ tool: 'Edit' }])
  })

  it('treats a malformed file as no rules', async () => {
    const rules = new ProjectRules(rulesDir, root)
    await rules.add({ tool: 'Edit' })
    const [file] = await readdir(rulesDir)
    await writeFile(join(rulesDir, file), '{{{')
    expect(await rules.load()).toEqual([])
    await writeFile(join(rulesDir, file), JSON.stringify({ rules: [{ tool: 'Nope' }] }))
    expect(await rules.load()).toEqual([])
    await expect(stat(join(root, '.arc'))).rejects.toThrow()
  })
})
