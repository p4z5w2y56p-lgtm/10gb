import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commandPrefixForRule, decide, isRuleEligible, type DecisionContext } from '../../src/main/safety/permissions'
import { protectedWritePaths, sensitiveReadPaths } from '../../src/main/safety/protected'
import type { PermissionMode, ToolCall } from '../../src/shared/types'

let base: string
let root: string
let home: string
let ctx: DecisionContext

const call = (name: string, args: Record<string, unknown>): ToolCall => ({ id: 't1', name, args })
const withMode = (mode: PermissionMode, extra: Partial<DecisionContext> = {}): DecisionContext => ({
  ...ctx,
  mode,
  ...extra,
})

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'arc-perm-')))
  root = join(base, 'project')
  home = join(base, 'home')
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(home, '.aws'), { recursive: true })
  await writeFile(join(root, 'a.txt'), 'a')
  await writeFile(join(root, 'id_rsa'), 'k')
  await writeFile(join(home, '.aws', 'credentials'), 'c')
  const arcDir = join(home, 'Library', 'Application Support', 'AIVEN ARC')
  ctx = {
    mode: 'ask',
    projectRoot: root,
    extraDirs: [],
    home,
    protectedPaths: protectedWritePaths(home, arcDir),
    sensitivePaths: sensitiveReadPaths(home, arcDir),
    rules: [],
    sandboxAvailable: true,
  }
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

const modes: PermissionMode[] = ['ask', 'auto-edit', 'auto']

describe('read-side tools', () => {
  it.each(modes)('allows Read/LS/Glob/Grep inside the project in %s mode', async (mode) => {
    for (const [name, args] of [
      ['Read', { file_path: 'a.txt' }],
      ['LS', { path: 'src' }],
      ['Glob', { pattern: '**/*.ts' }],
      ['Grep', { pattern: 'x' }],
    ] as const) {
      const v = await decide(call(name, { ...args }), withMode(mode))
      expect(v.verdict, `${name} ${mode}`).toBe('allow')
    }
  })

  it('asks for reads outside the project', async () => {
    const v = await decide(call('Read', { file_path: join(base, 'elsewhere.txt') }), ctx)
    expect(v.verdict).toBe('ask')
  })

  it('asks, naming credentials, for ~/.aws/credentials', async () => {
    const v = await decide(call('Read', { file_path: join(home, '.aws', 'credentials') }), ctx)
    expect(v.verdict).toBe('ask')
    expect(v.reason.toLowerCase()).toContain('credential')
  })

  it('asks, naming credentials, for a private key inside the project', async () => {
    const v = await decide(call('Read', { file_path: 'id_rsa' }), withMode('auto'))
    expect(v.verdict).toBe('ask')
    expect(v.reason.toLowerCase()).toContain('credential')
  })
})

describe('Edit and Write', () => {
  it.each([
    ['ask', 'ask'],
    ['auto-edit', 'allow'],
    ['auto', 'allow'],
  ] as const)('inside the project in %s mode is %s', async (mode, expected) => {
    for (const name of ['Edit', 'Write']) {
      const v = await decide(call(name, { file_path: 'src/new.ts' }), withMode(mode))
      expect(v.verdict, `${name} ${mode}`).toBe(expected)
    }
  })

  it.each(modes)('denies writes outside the project in %s mode', async (mode) => {
    const v = await decide(call('Write', { file_path: join(base, 'other.txt') }), withMode(mode))
    expect(v.verdict).toBe('deny')
  })

  it.each(modes)('denies protected paths and .arc/ in %s mode', async (mode) => {
    const ssh = await decide(call('Write', { file_path: join(home, '.ssh', 'config') }), withMode(mode))
    expect(ssh.verdict).toBe('deny')
    const arc = await decide(call('Edit', { file_path: '.arc/settings.json' }), withMode(mode))
    expect(arc.verdict).toBe('deny')
  })

  it('denies when file_path is missing', async () => {
    expect((await decide(call('Write', {}), ctx)).verdict).toBe('deny')
  })
})

describe('Bash', () => {
  it.each(modes)('hard denies in %s mode', async (mode) => {
    expect((await decide(call('Bash', { command: 'sudo ls' }), withMode(mode))).verdict).toBe('deny')
    expect((await decide(call('Bash', { command: 'rm -rf ~' }), withMode(mode))).verdict).toBe('deny')
  })

  it.each(modes)('auto-allows read-only commands in %s mode', async (mode) => {
    const v = await decide(call('Bash', { command: 'git status' }), withMode(mode))
    expect(v).toMatchObject({ verdict: 'allow', via: 'readonly' })
  })

  it.each([
    ['ask', true, 'ask'],
    ['auto-edit', true, 'ask'],
    ['auto', true, 'allow'],
    ['auto', false, 'ask'],
  ] as const)('npm test in %s mode, sandbox=%s -> %s', async (mode, sandbox, expected) => {
    const v = await decide(call('Bash', { command: 'npm test' }), withMode(mode, { sandboxAvailable: sandbox }))
    expect(v.verdict).toBe(expected)
  })

  it.each([
    ['ask', true, 'ask'],
    ['auto-edit', true, 'ask'],
    ['auto', true, 'allow'],
    ['auto', false, 'ask'],
  ] as const)('unparsable command in %s mode, sandbox=%s -> %s', async (mode, sandbox, expected) => {
    const v = await decide(call('Bash', { command: 'eval "$X"' }), withMode(mode, { sandboxAvailable: sandbox }))
    expect(v.verdict).toBe(expected)
  })
})

describe('other tools', () => {
  it.each([
    ['ask', 'ask'],
    ['auto-edit', 'ask'],
    ['auto', 'allow'],
  ] as const)('WebFetch in %s mode is %s', async (mode, expected) => {
    expect((await decide(call('WebFetch', { url: 'https://example.com' }), withMode(mode))).verdict).toBe(expected)
  })

  it.each(modes)('TodoWrite and AskUser are always allowed in %s mode', async (mode) => {
    expect((await decide(call('TodoWrite', { todos: [] }), withMode(mode))).verdict).toBe('allow')
    expect((await decide(call('AskUser', { question: 'x' }), withMode(mode))).verdict).toBe('allow')
  })

  it('denies unknown tools', async () => {
    expect((await decide(call('Teleport', {}), ctx)).verdict).toBe('deny')
  })
})

describe('always-allow rules', () => {
  const rules = [{ tool: 'Bash' as const, prefix: 'npm test' }]

  it('turns ask into allow for a matching single command', async () => {
    const v = await decide(call('Bash', { command: 'npm test -- foo' }), withMode('ask', { rules }))
    expect(v).toMatchObject({ verdict: 'allow', via: 'rule' })
  })

  it('does not match a longer word or a compound command', async () => {
    for (const command of ['npm testing', 'npm test && rm -rf build', 'npm test; curl x', 'npm test $(id)']) {
      const v = await decide(call('Bash', { command }), withMode('ask', { rules }))
      expect(v.verdict, command).toBe('ask')
    }
  })

  it('never overrides a deny', async () => {
    const v = await decide(
      call('Bash', { command: 'rm -rf ~' }),
      withMode('ask', { rules: [{ tool: 'Bash', prefix: 'rm' }] }),
    )
    expect(v.verdict).toBe('deny')
  })

  it('a tool-wide Edit rule allows edits in ask mode but not outside the project', async () => {
    const r = [{ tool: 'Edit' as const }]
    expect((await decide(call('Edit', { file_path: 'a.txt' }), withMode('ask', { rules: r }))).verdict).toBe('allow')
    expect((await decide(call('Edit', { file_path: join(base, 'o.txt') }), withMode('ask', { rules: r }))).verdict).toBe('deny')
  })
})

describe('rules and credentials', () => {
  it('a tool-wide Read rule never unlocks credential files', async () => {
    const rules = [{ tool: 'Read' as const }]
    const v = await decide(call('Read', { file_path: join(home, '.aws', 'credentials') }), withMode('ask', { rules }))
    expect(v.verdict).toBe('ask')
    const outside = await decide(call('Read', { file_path: join(base, 'x.txt') }), withMode('ask', { rules }))
    expect(outside.verdict).toBe('allow')
  })
})

describe('case-insensitive volumes (review finding 2)', () => {
  it('denies case variants of .arc/ and protected paths when the volume is case-insensitive', async () => {
    for (const p of ['.arc/settings.json', '.ARC/settings.json', '.Arc/settings.json']) {
      const v = await decide(call('Write', { file_path: p, content: '{}' }), withMode('auto-edit', { caseInsensitive: true }))
      expect(v.verdict, p).toBe('deny')
    }
    const ssh = await decide(call('Write', { file_path: join(home, '.SSH', 'config'), content: 'x' }), withMode('auto-edit', { caseInsensitive: true }))
    expect(ssh.verdict).toBe('deny')
  })

  it('still treats them as different names on a case-sensitive volume', async () => {
    const v = await decide(call('Write', { file_path: '.ARC/settings.json', content: '{}' }), withMode('auto-edit', { caseInsensitive: false }))
    expect(v.verdict).toBe('allow')
  })

  it('denies a Bash redirect into a case variant of a protected path', async () => {
    const v = await decide(call('Bash', { command: 'echo x > .ARC/settings.json' }), withMode('auto', { caseInsensitive: true }))
    expect(v.verdict).toBe('deny')
  })
})

describe('rule scope (review finding 5)', () => {
  it('an interpreter prefix never matches, even if it is in the store', async () => {
    const rules = [{ tool: 'Bash' as const, prefix: 'python3 -c' }]
    const v = await decide(call('Bash', { command: 'python3 -c "print(1)"' }), withMode('ask', { rules }))
    expect(v.verdict).toBe('ask')
  })

  it('a rule does not cover a redirect that writes elsewhere, but allows harmless stream redirects', async () => {
    const rules = [{ tool: 'Bash' as const, prefix: 'npm test' }]
    expect((await decide(call('Bash', { command: 'npm test > ../out.txt' }), withMode('ask', { rules }))).verdict).toBe('ask')
    expect((await decide(call('Bash', { command: 'npm test 2>&1' }), withMode('ask', { rules }))).verdict).toBe('allow')
    expect((await decide(call('Bash', { command: 'npm test > /dev/null 2>&1' }), withMode('ask', { rules }))).verdict).toBe('allow')
  })

  it('isRuleEligible refuses interpreters and wrappers', () => {
    expect(isRuleEligible('npm test')).toBe(true)
    expect(isRuleEligible('mkdir -p')).toBe(true)
    for (const p of ['python3 -c', 'bash -c', 'node -e', 'env FOO', 'sudo ls', 'xargs rm', 'eval x', 'find .']) {
      expect(isRuleEligible(p), p).toBe(false)
    }
  })
})

describe('readonly Bash and symlinks to credentials', () => {
  it('asks when a project symlink points into ~/.ssh', async () => {
    await mkdir(join(home, '.ssh'), { recursive: true })
    await writeFile(join(home, '.ssh', 'config'), 'Host x')
    await symlink(join(home, '.ssh'), join(root, 'link'))
    const v = await decide(call('Bash', { command: 'cat link/config' }), ctx)
    expect(v.verdict).toBe('ask')
    expect(v.reason.toLowerCase()).toContain('credential')
  })
})

describe('commandPrefixForRule', () => {
  it('keeps the first two tokens', () => {
    expect(commandPrefixForRule('npm test -- x')).toBe('npm test')
    expect(commandPrefixForRule('ls')).toBe('ls')
    expect(commandPrefixForRule('git   status  -s')).toBe('git status')
  })
})
