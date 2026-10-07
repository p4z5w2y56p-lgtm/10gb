import { describe, expect, it } from 'vitest'
import { classifyBash } from '../../src/main/safety/bashGuard'
import { decide, type DecisionContext } from '../../src/main/safety/permissions'
import { protectedWritePaths, sensitiveReadPaths } from '../../src/main/safety/protected'
import type { PermissionMode } from '../../src/shared/types'

const home = '/home/matt'
const extra = ['/data', '/srv/arc-secrets']
const ctxFor = (mode: PermissionMode): DecisionContext => ({
  mode,
  projectRoot: '/work/project',
  extraDirs: [],
  home,
  protectedPaths: [...protectedWritePaths(home, ''), ...extra],
  sensitivePaths: [...sensitiveReadPaths(home, ''), ...extra],
  rules: [],
  sandboxAvailable: true,
})
const bash = (command: string, mode: PermissionMode, rules: DecisionContext['rules'] = []) =>
  decide({ id: 't', name: 'Bash', args: { command } }, { ...ctxFor(mode), rules })

describe.each<PermissionMode>(['ask', 'auto-edit', 'auto'])('extra protected paths in %s mode', (mode) => {
  it.each([
    'cat /data/sessions/s1/state.json',
    'cat /srv/arc-secrets/token',
    'grep -r TOKEN /data',
    'cp /data/x /work/project/x',
    `python3 -c "print(open('/data/worker-token').read())"`,
    'cat < /data/token',
    'ls /data',
    'sh -c "cat /data/token"',
    'cd /data && cat token',
    'cat /data/../data/token',
  ])('Bash %s needs approval, never auto-runs, even with an always-allow rule', async (command) => {
    const v = await bash(command, mode, [{ tool: 'Bash', prefix: command.split(' ').slice(0, 2).join(' ') }])
    expect(v.verdict).toBe('ask')
    expect(v.reason).toMatch(/credential|protected/i)
  })

  it.each(['/data/x', '/data/sessions/s1/y.txt', '/srv/arc-secrets/z'])('Write %s is denied', async (file_path) => {
    const v = await decide({ id: 't', name: 'Write', args: { file_path, content: 'x' } }, ctxFor(mode))
    expect(v.verdict).toBe('deny')
  })

  it.each(['Edit'])('Edit /data/x is denied', async (name) => {
    const v = await decide({ id: 't', name, args: { file_path: '/data/x', old_string: 'a', new_string: 'b' } }, ctxFor(mode))
    expect(v.verdict).toBe('deny')
  })

  it.each(['/data/x', '/data', '/srv/arc-secrets/z'])('Read %s needs approval', async (file_path) => {
    const v = await decide({ id: 't', name: 'Read', args: { file_path } }, { ...ctxFor(mode), rules: [{ tool: 'Read' }] })
    expect(v.verdict).toBe('ask')
  })

  it('tar over a protected directory is at least not allowed', async () => {
    expect((await bash('tar cf /tmp/x.tar /data', mode)).verdict).not.toBe('allow')
  })

  it('Bash writes into them are denied', async () => {
    for (const c of ['echo x > /data/x', 'tee /data/x', 'rm /data/x', 'mv a /data/b', 'cp a /data/b']) {
      expect((await bash(c, mode)).verdict, c).toBe('deny')
    }
  })

  it('a path that only shares the prefix is not affected', async () => {
    const v = await bash('cat /database/x', mode)
    expect(v.verdict).not.toBe('deny')
    if (mode !== 'auto') expect(v.reason).not.toMatch(/credential/i)
  })
})

it('classifyBash reports a sensitive touch on a command that is otherwise not read-only', () => {
  const c = classifyBash('python3 -c "open(\'/data/x\')"', {
    projectRoot: '/work/project',
    home,
    protectedPaths: [...protectedWritePaths(home, ''), ...extra],
    sensitivePaths: [...sensitiveReadPaths(home, ''), ...extra],
  })
  expect(c).toMatchObject({ kind: 'other', sensitive: true })
})
