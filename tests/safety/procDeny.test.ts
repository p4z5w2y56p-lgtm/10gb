import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { classifyBash } from '../../src/main/safety/bashGuard'
import { decide, type DecisionContext } from '../../src/main/safety/permissions'
import { isProcSecret, protectedWritePaths, sensitiveReadPaths } from '../../src/main/safety/protected'
import type { PermissionMode } from '../../src/shared/types'

const home = '/home/matt'
const arcDir = '/data/arc'
const guardCtx = {
  projectRoot: '/work/project',
  home,
  protectedPaths: protectedWritePaths(home, arcDir),
  sensitivePaths: sensitiveReadPaths(home, arcDir),
}
const denyReason = (cmd: string): string | null => {
  const c = classifyBash(cmd, guardCtx)
  return c.kind === 'deny' ? c.reason : null
}

describe('reading process internals is hard-denied', () => {
  const denied: Array<[string, string]> = [
    ['cat environ of pid 1', 'cat /proc/1/environ'],
    ['cat environ of self', 'cat /proc/self/environ'],
    ['thread-self', 'cat /proc/thread-self/environ'],
    ['a glob over every pid', 'cat /proc/*/environ'],
    ['a bracket glob', 'cat /proc/[0-9]*/environ'],
    ['the shell pid variable', 'cat /proc/$$/environ'],
    ['another variable', 'cat /proc/$PPID/environ'],
    ['a braced variable', 'cat /proc/${PID}/environ'],
    ['a command substitution pid', 'cat /proc/$(pgrep node)/environ'],
    ['a backtick substitution pid', 'cat /proc/`pgrep node`/environ'],
    ['tr with a redirect', "tr '\\0' '\\n' < /proc/1/environ"],
    ['grep', 'grep -a TOKEN /proc/12/environ'],
    ['cp', 'cp /proc/1/environ /tmp/x'],
    ['tar', 'tar cf - /proc/1/environ'],
    ['python -c', `python3 -c "print(open('/proc/self/environ').read())"`],
    ['node -e', `node -e "console.log(require('fs').readFileSync('/proc/1/environ','utf8'))"`],
    ['a redirect into a file', 'cat /proc/1/environ > /tmp/leak'],
    ['cmdline', 'strings /proc/1/cmdline'],
    ['maps', 'cat /proc/self/maps'],
    ['mem', 'dd if=/proc/self/mem bs=1 count=10'],
    ['fd listing', 'ls /proc/1/fd'],
    ['root', 'ls /proc/self/root/data'],
    ['cwd', 'cat /proc/self/cwd/secret'],
    ['a nested task', 'cat /proc/1/task/1/environ'],
    ['a dot segment', 'cat /proc/self/./environ'],
    ['quoted pid', 'cat /proc/"1"/environ'],
    ['quoted file name', "cat /proc/1/'environ'"],
    ['a backslash split', 'cat /proc/1/envi\\ron'.replace('\\r', '')],
    ['inside a nested shell', `sh -c 'cat /proc/1/environ'`],
    ['upper case', 'cat /PROC/1/ENVIRON'.toLowerCase()],
    ['a relative path after cd', 'cd /proc/self && cat environ'],
    ['a relative path from /proc', 'cd /proc && cat 1/environ'],
    ['xargs -a', 'xargs -0 -a /proc/1/environ echo'],
    ['in a pipeline', 'cat /proc/1/environ | tr "\\0" "\\n" | grep TOKEN'],
  ]
  it.each(denied)('denies %s: %s', (_l, cmd) => {
    expect(denyReason(cmd), cmd).not.toBeNull()
  })

  it('says why, without echoing the command', () => {
    expect(denyReason('cat /proc/1/environ')).toMatch(/process/i)
    expect(denyReason('cat /proc/1/environ')).not.toContain('/proc')
  })
})

describe('ordinary /proc and environ uses are not caught', () => {
  const allowed = [
    'cat /proc/cpuinfo',
    'cat /proc/meminfo',
    'cat /proc/loadavg',
    'ls /proc',
    'cat /proc/sys/kernel/hostname',
    'echo environ',
    'cat src/environ.ts',
    'grep -rn mem src',
    'ls /tmp/proc/1/environ-docs',
    'cat docs/proc.md',
  ]
  it.each(allowed)('does not deny: %s', (cmd) => {
    expect(denyReason(cmd), cmd).toBeNull()
  })
})

describe('isProcSecret', () => {
  it.each(['/proc/1', '/proc/1/environ', '/proc/self', '/proc/self/fd/3', '/proc/thread-self/mem', '/proc/12345/root/etc'])('%s', (p) => {
    expect(isProcSecret(p)).toBe(true)
  })
  it.each(['/proc', '/proc/cpuinfo', '/proc/sys/kernel/hostname', '/tmp/proc/1/environ', '/home/x/proc/self', '/procfs/1'])('not %s', (p) => {
    expect(isProcSecret(p)).toBe(false)
  })
})

describe('the permission gate never allows it, in any mode, even with rules', () => {
  const modes: PermissionMode[] = ['ask', 'auto-edit', 'auto']
  const base: DecisionContext = {
    mode: 'ask',
    projectRoot: '/work/project',
    extraDirs: [],
    home,
    protectedPaths: guardCtx.protectedPaths,
    sensitivePaths: guardCtx.sensitivePaths,
    rules: [],
    sandboxAvailable: true,
  }
  const cmds = ['cat /proc/1/environ', 'cat /proc/self/environ', 'cat /proc/*/environ', 'cat /proc/$$/environ', 'cd /proc/self && cat environ']

  describe.each(modes)('%s mode', (mode) => {
    it.each(cmds)('Bash %s is denied', async (command) => {
      const v = await decide({ id: 't', name: 'Bash', args: { command } }, { ...base, mode, rules: [{ tool: 'Bash', prefix: 'cat /proc/1/environ' }, { tool: 'Bash', prefix: 'cat' }] })
      expect(v.verdict).toBe('deny')
    })
    it.each(['/proc/1/environ', '/proc/self/environ', '/proc/self/maps', '/proc/1/cmdline'])('Read %s is denied', async (file_path) => {
      const v = await decide({ id: 't', name: 'Read', args: { file_path } }, { ...base, mode, rules: [{ tool: 'Read' }] })
      expect(v.verdict).toBe('deny')
    })
    it.each(['LS', 'Glob', 'Grep'])('%s of a process directory is denied', async (name) => {
      const v = await decide({ id: 't', name, args: { path: '/proc/self', pattern: '*' } }, { ...base, mode, rules: [{ tool: name as 'LS' }] })
      expect(v.verdict).toBe('deny')
    })
  })

  it('the read-only allow-list does not auto-allow cat /proc/1/environ', async () => {
    const v = await decide({ id: 't', name: 'Bash', args: { command: 'cat /proc/1/environ' } }, base)
    expect(v.verdict).not.toBe('allow')
    expect(v.via).not.toBe('readonly')
  })

  it('an ordinary /proc file still reads without a prompt', async () => {
    const v = await decide({ id: 't', name: 'Bash', args: { command: 'cat /proc/cpuinfo' } }, base)
    expect(v.verdict).toBe('allow')
  })
})

describe('symlinks into /proc are followed', () => {
  let dir = ''
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = ''
  })
  it('a link in the project to /proc/self/environ is denied for Read and for cat', async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'arc-proc-')))
    await mkdir(join(dir, 'p'))
    await symlink('/proc/self/environ', join(dir, 'p', 'link'))
    await writeFile(join(dir, 'ok.txt'), 'ok')
    const ctx: DecisionContext = {
      mode: 'auto',
      projectRoot: dir,
      extraDirs: [],
      home,
      protectedPaths: guardCtx.protectedPaths,
      sensitivePaths: guardCtx.sensitivePaths,
      rules: [],
      sandboxAvailable: true,
    }
    expect((await decide({ id: 't', name: 'Read', args: { file_path: 'p/link' } }, ctx)).verdict).toBe('deny')
    expect((await decide({ id: 't', name: 'Bash', args: { command: 'cat p/link' } }, ctx)).verdict).toBe('deny')
    expect((await decide({ id: 't', name: 'Read', args: { file_path: 'ok.txt' } }, ctx)).verdict).toBe('allow')
  })
})
