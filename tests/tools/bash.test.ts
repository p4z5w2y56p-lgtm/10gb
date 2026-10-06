import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeBashTool, resolveTimeout, runCommand, scrubEnv } from '../../src/main/tools/bash'
import { makeFixture, type Fixture } from '../helpers/toolContext'

let fx: Fixture
beforeEach(async () => {
  fx = await makeFixture()
})
afterEach(() => fx.cleanup())

const run = (command: string, over: Partial<Parameters<typeof runCommand>[0]> = {}) =>
  runCommand({
    command,
    cwd: fx.root,
    timeoutMs: 10_000,
    env: process.env,
    signal: fx.abort.signal,
    killGraceMs: 300,
    ...over,
  })

/** Alive means running: a killed-but-unreaped zombie (state Z) does not count. */
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) !== 'Z'
  } catch {
    return true
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('scrubEnv', () => {
  it('removes credentials and ARC variables but keeps PATH and HOME', () => {
    const out = scrubEnv({
      PATH: '/usr/bin',
      HOME: '/home/matt',
      GOOGLE_API_KEY: 'a',
      GEMINI_KEY: 'b',
      AWS_SECRET_ACCESS_KEY: 'c',
      GITHUB_TOKEN: 'd',
      MY_KEY: 'e',
      DB_PASSWORD: 'f',
      ARC_API_KEY: 'g',
      CUSTOM_ONE: 'h',
    }, ['CUSTOM_ONE'])
    expect(out).toEqual({ PATH: '/usr/bin', HOME: '/home/matt' })
  })

  it('the child process cannot see a scrubbed variable', async () => {
    const env = scrubEnv({ ...process.env, GITHUB_TOKEN: 'sekrit' })
    const r = await run('echo "[$GITHUB_TOKEN]"', { env })
    expect(r.output.trim()).toBe('[]')
  })
})

describe('runCommand', () => {
  it('captures stdout and stderr merged and the exit code', async () => {
    const r = await run('echo out; echo err 1>&2; exit 3')
    expect(r.output).toContain('out')
    expect(r.output).toContain('err')
    expect(r.exitCode).toBe(3)
    expect(r.timedOut).toBe(false)
  })

  it('runs in the given cwd', async () => {
    const r = await run('pwd')
    expect(r.output.trim()).toBe(fx.root)
  })

  it('times out quickly and kills the whole process group', async () => {
    const t0 = Date.now()
    const r = await run('sleep 30 & echo $!; wait', { timeoutMs: 300 })
    expect(r.timedOut).toBe(true)
    expect(Date.now() - t0).toBeLessThan(3000)
    const pid = Number(r.output.trim().split('\n')[0])
    expect(pid).toBeGreaterThan(1)
    await sleep(300)
    expect(alive(pid)).toBe(false)
  })

  it('SIGKILLs a process that ignores SIGTERM after the grace period', async () => {
    const t0 = Date.now()
    const r = await run("trap '' TERM; while true; do sleep 1; done", { timeoutMs: 200, killGraceMs: 400 })
    const took = Date.now() - t0
    expect(r.timedOut).toBe(true)
    expect(took).toBeGreaterThanOrEqual(500)
    expect(took).toBeLessThan(5000)
  })

  it('still returns when a detached grandchild keeps the output pipe open', async () => {
    const t0 = Date.now()
    const spawnDetached = `node -e "require('child_process').spawn('sleep',['6'],{detached:true,stdio:['ignore','inherit','inherit']}).unref()"`
    const r = await run(`${spawnDetached}; echo started; sleep 30`, { timeoutMs: 300, killGraceMs: 300 })
    expect(r.timedOut).toBe(true)
    expect(r.output).toContain('started')
    expect(Date.now() - t0).toBeLessThan(3500)
  })

  it('aborting the signal stops a running command', async () => {
    const p = run('sleep 30')
    setTimeout(() => fx.abort.abort(), 100)
    const r = await p
    expect(r.aborted).toBe(true)
  })

  it('an already-aborted signal does not start the command', async () => {
    fx.abort.abort()
    const r = await run('echo should-not-run')
    expect(r.aborted).toBe(true)
    expect(r.output).not.toContain('should-not-run')
  })
})

describe('resolveTimeout', () => {
  it('defaults to the setting, and clamps at 600,000 ms', () => {
    expect(resolveTimeout(undefined, 120_000)).toBe(120_000)
    expect(resolveTimeout(5_000, 120_000)).toBe(5_000)
    expect(resolveTimeout(9_999_999, 120_000)).toBe(600_000)
  })
})

describe('Bash tool', () => {
  const tool = makeBashTool({})

  it('returns output for a successful command', async () => {
    expect(await tool.run({ command: 'echo hi' }, fx.ctx)).toEqual({ ok: true, output: 'hi' })
  })

  it('reports a non-zero exit as ok:false with the code', async () => {
    const r = await tool.run({ command: 'echo nope; exit 2' }, fx.ctx)
    expect(r.ok).toBe(false)
    expect(r.output).toContain('nope')
    expect(r.output).toContain('exit code 2')
  })

  it('says so when a command prints nothing', async () => {
    expect((await tool.run({ command: 'true' }, fx.ctx)).output).toBe('(no output)')
  })

  it('keeps output under 30,000 characters, head and tail, with a marker', async () => {
    const r = await tool.run({ command: "head -c 80000 /dev/zero | tr '\\0' x; echo; echo THE-END" }, fx.ctx)
    expect(r.output.length).toBeLessThan(30_000)
    expect(r.output).toContain('truncated')
    expect(r.output).toContain('THE-END')
  })

  it('reports a timeout', async () => {
    const r = await tool.run({ command: 'sleep 30', timeout_ms: 200 }, fx.ctx)
    expect(r.ok).toBe(false)
    expect(r.output).toContain('timed out')
  })

  it('passes the sandbox profile to the runner only when one is provided', async () => {
    const seen: Array<string | undefined> = []
    const probe = makeBashTool({ sandboxProfile: () => (seen.push('asked'), undefined) })
    await probe.run({ command: 'true' }, fx.ctx)
    expect(seen).toEqual(['asked'])
  })
})
