import { basename } from 'node:path'
import type { ActivityPhase, TodoItem, ToolCall, ToolResult } from '../../shared/types'

const MAX_LABEL = 80

/** Plain-language labels only: short, no backticks, and never the text of a command. */
function tidy(label: string): string {
  const clean = label.replace(/`/g, '')
  return clean.length > MAX_LABEL ? `${clean.slice(0, MAX_LABEL - 1)}…` : clean
}

function nameOf(args: Record<string, unknown>, key = 'file_path'): string | null {
  const v = args[key]
  return typeof v === 'string' && v.length > 0 ? basename(v) || v : null
}

function host(args: Record<string, unknown>): string | null {
  try {
    return typeof args.url === 'string' ? new URL(args.url).hostname || null : null
  } catch {
    return null
  }
}

type BashKind = 'tests' | 'install' | 'build' | 'git' | 'other'

function bashKind(command: unknown): BashKind {
  const c = typeof command === 'string' ? command.toLowerCase() : ''
  if (/\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\bvitest\b|\bjest\b|\bpytest\b|\bmocha\b|\bcargo\s+test\b|\bgo\s+test\b|\brspec\b|\bphpunit\b/.test(c)) return 'tests'
  if (/\b(npm|pnpm|yarn|bun)\s+(run\s+)?build\b|\btsc\b|\bcargo\s+build\b|\bvite\s+build\b|\bwebpack\b|(^|[;&|]\s*)make\b|\bgo\s+build\b/.test(c)) return 'build'
  if (/\b(npm|pnpm|yarn|bun)\s+(install|add|i|ci)\b|\bpip3?\s+install\b|\bbrew\s+install\b|\bcargo\s+add\b/.test(c)) return 'install'
  if (/(^|[;&|]\s*)git\b/.test(c)) return 'git'
  return 'other'
}

export function describeCall(call: ToolCall): { phase: ActivityPhase; label: string } {
  const a = call.args
  switch (call.name) {
    case 'Read':
      return { phase: 'reading', label: tidy(`Reading ${nameOf(a) ?? 'a file'}`) }
    case 'LS':
      return { phase: 'searching', label: tidy(`Listing ${nameOf(a, 'path') ?? 'the project'}`) }
    case 'Glob':
      return { phase: 'searching', label: 'Finding files' }
    case 'Grep':
      return { phase: 'searching', label: 'Searching the project' }
    case 'Edit':
      return { phase: 'editing', label: tidy(`Editing ${nameOf(a) ?? 'a file'}`) }
    case 'Write':
      return { phase: 'writing', label: tidy(`Creating ${nameOf(a) ?? 'a file'}`) }
    case 'Bash': {
      const kind = bashKind(a.command)
      const label = {
        tests: 'Running the tests',
        install: 'Installing dependencies',
        build: 'Building the project',
        git: 'Checking git',
        other: 'Running a command',
      }[kind]
      return { phase: 'running', label }
    }
    case 'WebFetch':
      return { phase: 'fetching', label: tidy(`Fetching ${host(a) ?? 'a web page'}`) }
    case 'TodoWrite':
      return { phase: 'planning', label: 'Updating the plan' }
    case 'AskUser':
      return { phase: 'asking', label: 'Asking you a question' }
    default:
      return { phase: 'other', label: 'Working' }
  }
}

export function describeResult(call: ToolCall, result: ToolResult): string {
  const a = call.args
  const ok = result.ok
  switch (call.name) {
    case 'Read':
      return tidy(ok ? `Read ${nameOf(a) ?? 'a file'}` : `Could not read ${nameOf(a) ?? 'a file'}`)
    case 'LS':
      return tidy(ok ? `Listed ${nameOf(a, 'path') ?? 'the project'}` : 'Could not list the folder')
    case 'Glob':
      return ok ? 'Found files' : 'Search failed'
    case 'Grep':
      return ok ? 'Searched the project' : 'Search failed'
    case 'Edit':
      return tidy(ok ? `Edited ${nameOf(a) ?? 'a file'}` : `Could not edit ${nameOf(a) ?? 'a file'}`)
    case 'Write':
      return tidy(ok ? `Created ${nameOf(a) ?? 'a file'}` : `Could not write ${nameOf(a) ?? 'a file'}`)
    case 'Bash': {
      const kind = bashKind(a.command)
      const [good, bad] = {
        tests: ['Tests passed', 'Tests failed'],
        install: ['Dependencies installed', 'Install failed'],
        build: ['Build finished', 'Build failed'],
        git: ['Checked git', 'Git command failed'],
        other: ['Command finished', 'Command failed'],
      }[kind]
      return ok ? good : bad
    }
    case 'WebFetch':
      return tidy(ok ? `Fetched ${host(a) ?? 'a web page'}` : `Could not fetch ${host(a) ?? 'the page'}`)
    case 'TodoWrite':
      return ok ? 'Plan updated' : 'Could not update the plan'
    case 'AskUser':
      return ok ? 'Got your answer' : 'No answer'
    default:
      return ok ? 'Done' : 'Failed'
  }
}

export interface ActivityItem {
  id: string
  phase: ActivityPhase
  label: string
}

export interface ActivityGroup {
  ids: string[]
  phase: ActivityPhase
  label: string
}

const isExploring = (p: ActivityPhase) => p === 'reading' || p === 'searching'

/** Collapse consecutive reads and searches into one line ("Read 6 files"). */
export function groupActivities(items: ActivityItem[]): ActivityGroup[] {
  const out: ActivityGroup[] = []
  let run: ActivityItem[] = []
  const flush = () => {
    if (run.length === 0) return
    if (run.length === 1) {
      out.push({ ids: [run[0].id], phase: run[0].phase, label: run[0].label })
    } else if (run.every((r) => r.phase === 'reading')) {
      out.push({ ids: run.map((r) => r.id), phase: 'reading', label: `Read ${run.length} files` })
    } else {
      out.push({
        ids: run.map((r) => r.id),
        phase: 'searching',
        label: `Explored the project (${run.length} steps)`,
      })
    }
    run = []
  }
  for (const item of items) {
    if (isExploring(item.phase)) {
      run.push(item)
    } else {
      flush()
      out.push({ ids: [item.id], phase: item.phase, label: item.label })
    }
  }
  flush()
  return out
}

export function progressOf(todos: TodoItem[]): { done: number; total: number; current: string | null } {
  return {
    done: todos.filter((t) => t.status === 'completed').length,
    total: todos.length,
    current: todos.find((t) => t.status === 'in_progress')?.content ?? null,
  }
}
