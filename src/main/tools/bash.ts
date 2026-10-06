import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { z } from 'zod'
import { BASH_DEFAULT_TIMEOUT_MS, BASH_MAX_TIMEOUT_MS, KILL_GRACE_MS, TOOL_OUTPUT_CAP } from '../../shared/constants'
import { wrapCommand } from '../safety/sandboxExec'
import type { Tool } from './registry'

const SCRUB = [/^(GOOGLE|GEMINI|AWS|ARC|ANTHROPIC|OPENAI)_/, /_(TOKEN|KEY|SECRET|PASSWORD)$/]

/** Child environment without API keys, cloud credentials or ARC's own variables. */
export function scrubEnv(env: NodeJS.ProcessEnv, extra: string[] = []): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue
    if (extra.includes(k) || SCRUB.some((re) => re.test(k))) continue
    out[k] = v
  }
  return out
}

export function resolveTimeout(requested: number | undefined, defaultMs: number): number {
  return Math.min(requested ?? defaultMs, BASH_MAX_TIMEOUT_MS)
}

export interface RunOptions {
  command: string
  cwd: string
  timeoutMs: number
  env: NodeJS.ProcessEnv
  signal: AbortSignal
  sandboxProfile?: string
  killGraceMs?: number
}

export interface RunResult {
  output: string
  exitCode: number | null
  timedOut: boolean
  aborted: boolean
}

const MAX_CAPTURE = 2_000_000
const shell = () => (existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash')

/** Run a command in its own process group with a timeout, abort support, and merged stdout/stderr. */
export function runCommand(opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    if (opts.signal.aborted) {
      resolve({ output: '', exitCode: null, timedOut: false, aborted: true })
      return
    }
    const sh = shell()
    const spec = opts.sandboxProfile
      ? wrapCommand(sh, opts.command, opts.sandboxProfile)
      : { file: sh, args: ['-c', opts.command] }
    const child = spawn(spec.file, spec.args, {
      cwd: opts.cwd,
      env: opts.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''
    let timedOut = false
    let aborted = false
    let exited = false
    const collect = (d: Buffer) => {
      if (output.length < MAX_CAPTURE) output += d.toString('utf8')
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)

    const killTree = () => {
      const pid = child.pid
      if (!pid || exited) return
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        // already gone
      }
      setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          // already gone
        }
        // A process that left the group may still hold the output pipes open; do not wait for it.
        setTimeout(() => {
          child.stdout.destroy()
          child.stderr.destroy()
          finish(child.exitCode)
        }, 500)
      }, opts.killGraceMs ?? KILL_GRACE_MS)
    }

    const timer = setTimeout(() => {
      timedOut = true
      killTree()
    }, opts.timeoutMs)
    const onAbort = () => {
      aborted = true
      killTree()
    }
    opts.signal.addEventListener('abort', onAbort, { once: true })

    const finish = (code: number | null) => {
      if (exited) return
      exited = true
      clearTimeout(timer)
      opts.signal.removeEventListener('abort', onAbort)
      resolve({ output, exitCode: code, timedOut, aborted })
    }
    child.on('error', (err) => {
      output += `\n${err.message}`
      finish(null)
    })
    child.on('close', (code) => finish(code))
  })
}

/** Keep the start and the end of long output; the middle is the least useful part. */
function capOutput(text: string): string {
  if (text.length <= TOOL_OUTPUT_CAP - 100) return text
  const head = 9_900
  const tail = 19_900
  const dropped = text.length - head - tail
  return `${text.slice(0, head)}\n[... ${dropped} chars truncated ...]\n${text.slice(-tail)}`
}

export function makeBashTool(opts: { sandboxProfile?: () => string | undefined } = {}): Tool<{
  command: string
  timeout_ms?: number
}> {
  return {
    name: 'Bash',
    description:
      'Run a shell command in the project directory. Output is stdout and stderr together. Default timeout 120 seconds, maximum 600.',
    schema: z.object({
      command: z.string().min(1).describe('The command to run'),
      timeout_ms: z.number().int().min(1).optional().describe('Timeout in milliseconds (max 600000)'),
    }),
    async run({ command, timeout_ms }, ctx) {
      const timeoutMs = resolveTimeout(timeout_ms, ctx.settings.bashTimeoutMs ?? BASH_DEFAULT_TIMEOUT_MS)
      const r = await runCommand({
        command,
        cwd: ctx.projectRoot,
        timeoutMs,
        env: scrubEnv(process.env, ctx.arcEnv),
        signal: ctx.signal,
        sandboxProfile: opts.sandboxProfile?.(),
      })
      let output = capOutput(r.output.replace(/\n$/, '')) || '(no output)'
      if (r.timedOut) output += `\n[command timed out after ${Math.round(timeoutMs / 1000)}s]`
      else if (r.aborted) output += '\n[command was stopped]'
      else if (r.exitCode !== 0) output += `\n[exit code ${r.exitCode}]`
      return { ok: r.exitCode === 0 && !r.timedOut && !r.aborted, output }
    },
  }
}
