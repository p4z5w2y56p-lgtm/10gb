import { isAbsolute, resolve } from 'node:path'
import type { AllowRule, PermissionMode, ToolCall, ToolName, Verdict } from '../../shared/types'
import { classifyBash, splitSegments } from './bashGuard'
import { resolveInside } from './pathSandbox'
import { isProtectedWrite, isSensitiveRead, sensitiveReadPaths } from './protected'

export interface DecisionContext {
  mode: PermissionMode
  projectRoot: string
  extraDirs: string[]
  home: string
  protectedPaths: string[]
  sensitivePaths?: string[]
  rules: AllowRule[]
  /** True when `sandbox-exec` can confine Bash writes to the project (macOS). */
  sandboxAvailable: boolean
  caseInsensitive?: boolean
}

const TOOLS = new Set<string>([
  'Read',
  'LS',
  'Glob',
  'Grep',
  'Edit',
  'Write',
  'Bash',
  'TodoWrite',
  'WebFetch',
  'AskUser',
])

const allow = (reason: string, via?: Verdict['via']): Verdict => ({ verdict: 'allow', reason, via })
const ask = (reason: string): Verdict => ({ verdict: 'ask', reason })
const deny = (reason: string): Verdict => ({ verdict: 'deny', reason })

/** First two tokens of the command, used as the scope of an "always allow" rule. */
export function commandPrefixForRule(cmd: string): string {
  const first = splitSegments(cmd).segments[0] ?? cmd.trim()
  return first.split(/\s+/).filter(Boolean).slice(0, 2).join(' ')
}

function bashRuleMatches(rule: AllowRule, command: string): boolean {
  if (rule.tool !== 'Bash' || !rule.prefix) return false
  const { segments, unparsable } = splitSegments(command)
  if (unparsable || segments.length !== 1) return false
  const text = segments[0]
  return text === rule.prefix || text.startsWith(rule.prefix + ' ')
}

function ruleAllows(call: ToolCall, ctx: DecisionContext): boolean {
  const name = call.name as ToolName
  return ctx.rules.some((r) =>
    r.tool !== name ? false : name === 'Bash' ? bashRuleMatches(r, String(call.args.command ?? '')) : true,
  )
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

async function decideRead(call: ToolCall, ctx: DecisionContext): Promise<Verdict> {
  const target = str(call.args.file_path) ?? str(call.args.path) ?? '.'
  const sensitive = ctx.sensitivePaths ?? sensitiveReadPaths(ctx.home, '')
  const abs = isAbsolute(target) ? resolve(target) : resolve(ctx.projectRoot, target)
  if (isSensitiveRead(abs, sensitive)) return ask(`This looks like a credential file: ${target}`)
  const r = await resolveInside(ctx.projectRoot, target, {
    extraDirs: ctx.extraDirs,
    caseInsensitive: ctx.caseInsensitive,
  })
  if (!r.ok) return ask(`Reads outside the project: ${target}`)
  if (isSensitiveRead(r.real, sensitive)) return ask(`This resolves to a credential file: ${target}`)
  return allow('read inside the project')
}

async function decideWrite(call: ToolCall, ctx: DecisionContext): Promise<Verdict> {
  const target = str(call.args.file_path)
  if (!target) return deny('No file path given')
  const abs = isAbsolute(target) ? resolve(target) : resolve(ctx.projectRoot, target)
  if (isProtectedWrite(abs, ctx.protectedPaths, ctx.projectRoot)) {
    return deny(`Writing to a protected path is never allowed: ${target}`)
  }
  const r = await resolveInside(ctx.projectRoot, target, {
    extraDirs: ctx.extraDirs,
    caseInsensitive: ctx.caseInsensitive,
  })
  if (!r.ok) return deny(`Writes outside the project are not allowed: ${target}`)
  if (isProtectedWrite(r.real, ctx.protectedPaths, ctx.projectRoot)) {
    return deny(`Writing to a protected path is never allowed: ${target}`)
  }
  if (ctx.mode === 'ask') return ask(`${call.name} ${target}`)
  return allow(`${ctx.mode} mode allows edits inside the project`, 'mode')
}

function decideBash(call: ToolCall, ctx: DecisionContext): Verdict {
  const command = str(call.args.command)
  if (!command) return deny('No command given')
  const cls = classifyBash(command, {
    projectRoot: ctx.projectRoot,
    home: ctx.home,
    protectedPaths: ctx.protectedPaths,
    sensitivePaths: ctx.sensitivePaths,
  })
  if (cls.kind === 'deny') return deny(`Blocked: ${cls.reason}`)
  if (cls.kind === 'readonly') return allow('read-only command', 'readonly')
  if (ruleAllows(call, ctx)) return allow('matches an always-allow rule', 'rule')
  if (ctx.mode === 'auto') {
    return ctx.sandboxAvailable
      ? allow('auto mode, running under the OS sandbox', 'mode')
      : ask('Auto mode needs the OS sandbox to run commands unattended, and it is not available')
  }
  return ask(cls.unparsable ? 'The command is too complex to check automatically' : 'Run a shell command')
}

/**
 * Decide whether a tool call may run. Order (spec 6.1): hard denies, path
 * sandbox, mode policy plus saved rules, default ask.
 */
export async function decide(call: ToolCall, ctx: DecisionContext): Promise<Verdict> {
  if (!TOOLS.has(call.name)) return deny(`Unknown tool: ${call.name}`)
  const name = call.name as ToolName

  let verdict: Verdict
  switch (name) {
    case 'TodoWrite':
    case 'AskUser':
      return allow('no side effects')
    case 'Read':
    case 'LS':
    case 'Glob':
    case 'Grep':
      verdict = await decideRead(call, ctx)
      break
    case 'Edit':
    case 'Write':
      verdict = await decideWrite(call, ctx)
      break
    case 'Bash':
      return decideBash(call, ctx)
    case 'WebFetch':
      verdict = ctx.mode === 'auto' ? allow('auto mode', 'mode') : ask('Fetch a web page')
      break
  }
  const credential = /credential/i.test(verdict.reason)
  if (verdict.verdict === 'ask' && !credential && ruleAllows(call, ctx)) {
    return allow('matches an always-allow rule', 'rule')
  }
  return verdict
}
