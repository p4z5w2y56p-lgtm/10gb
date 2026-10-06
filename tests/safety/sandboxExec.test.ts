import { describe, expect, it } from 'vitest'
import { buildSandboxProfile, detectSandboxExec, wrapCommand } from '../../src/main/safety/sandboxExec'

describe('detectSandboxExec', () => {
  it('is false on linux even if the binary path exists', () => {
    expect(detectSandboxExec('linux', () => true)).toBe(false)
  })
  it('is true on darwin only when sandbox-exec exists', () => {
    expect(detectSandboxExec('darwin', (p) => p === '/usr/bin/sandbox-exec')).toBe(true)
    expect(detectSandboxExec('darwin', () => false)).toBe(false)
  })
})

describe('buildSandboxProfile', () => {
  const profile = buildSandboxProfile('/Users/matt/proj', '/private/var/folders/xx/T')

  it('denies writes by default and allows the project, temp dir and device nodes', () => {
    expect(profile).toContain('(version 1)')
    expect(profile).toContain('(allow default)')
    expect(profile).toContain('(deny file-write*)')
    expect(profile).toContain('(subpath "/Users/matt/proj")')
    expect(profile).toContain('(subpath "/private/var/folders/xx/T")')
    for (const dev of ['/dev/null', '/dev/tty', '/dev/dtracehelper']) {
      expect(profile).toContain(`(literal "${dev}")`)
    }
  })

  it('puts the deny before the allow so the allow wins', () => {
    expect(profile.indexOf('(deny file-write*)')).toBeLessThan(profile.indexOf('(allow file-write*'))
  })

  it('escapes quotes and backslashes in paths', () => {
    const p = buildSandboxProfile('/tmp/we"ird\\dir', '/tmp/t')
    expect(p).toContain('(subpath "/tmp/we\\"ird\\\\dir")')
  })
})

describe('wrapCommand', () => {
  it('runs the shell under sandbox-exec with the profile after -p and the command after -c', () => {
    const w = wrapCommand('/bin/zsh', 'echo hi', '(version 1)')
    expect(w).toEqual({ file: '/usr/bin/sandbox-exec', args: ['-p', '(version 1)', '/bin/zsh', '-c', 'echo hi'] })
  })
})
