import { basename, isAbsolute, resolve, sep } from 'node:path'
import { isProtectedWrite, isSensitiveRead, sensitiveReadPaths } from './protected'

export interface GuardContext {
  projectRoot: string
  home: string
  protectedPaths: string[]
  /** Credential locations; defaults to the standard list under `home`. */
  sensitivePaths?: string[]
  /** Compare paths case-insensitively (default APFS volumes). */
  caseInsensitive?: boolean
}

export type BashClass =
  | { kind: 'deny'; reason: string }
  /** `paths` are the absolute paths the command reads, so callers can check symlinks. */
  | { kind: 'readonly'; paths: string[] }
  | { kind: 'other'; unparsable: boolean }

interface Word {
  text: string
  /** Contains an expansion we cannot resolve statically ($VAR, $(...), $'...'). */
  dynamic: boolean
  /** Index in `text` of the first unquoted glob character. */
  globAt: number | null
}

interface Redirect {
  op: string
  kind: 'in' | 'out'
  target: Word | null
}

interface Segment {
  words: Word[]
  redirects: Redirect[]
  pipeFrom: Segment | null
  parent: Segment | null
  via: 'top' | 'subst'
}

interface Parsed {
  segments: Segment[]
  unparsable: boolean
  hasSubstitution: boolean
}

const PLACEHOLDER = '\u0001'

// ---------------------------------------------------------------- parsing

function newSeg(parent: Segment | null, via: 'top' | 'subst', pipeFrom: Segment | null): Segment {
  return { words: [], redirects: [], pipeFrom, parent, via }
}

/** Index of the `)` matching an already-opened `(` at `start - 1`, or -1. */
function matchParen(src: string, start: number): number {
  let depth = 1
  for (let j = start; j < src.length; j++) {
    const ch = src[j]
    if (ch === '\\') {
      j++
    } else if (ch === "'") {
      const end = src.indexOf("'", j + 1)
      if (end < 0) return -1
      j = end
    } else if (ch === '"') {
      j++
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\') j++
        j++
      }
      if (j >= src.length) return -1
    } else if (ch === '(') {
      depth++
    } else if (ch === ')') {
      depth--
      if (depth === 0) return j
    }
  }
  return -1
}

function parseInto(src: string, P: Parsed, parent: Segment | null, via: 'top' | 'subst'): void {
  const n = src.length
  const S: { word: Word | null; pending: Redirect | null; seg: Segment; depth: number } = {
    word: null,
    pending: null,
    seg: newSeg(parent, via, null),
    depth: 0,
  }

  const ensure = (): Word => (S.word ??= { text: '', dynamic: false, globAt: null })

  const flushWord = (): void => {
    const w = S.word
    if (!w) return
    S.word = null
    // Brace expansion ({a,b} or {1..3}) can build any path, including ~ and credentials.
    if (/\{[^{}]*(?:,|\.\.)[^{}]*\}/.test(w.text)) w.dynamic = true
    if (S.pending) {
      const p = S.pending
      S.pending = null
      p.target = w
      const fdDup = p.op.endsWith('&') && /^(\d+|-)$/.test(w.text)
      if (!fdDup) S.seg.redirects.push(p)
    } else {
      S.seg.words.push(w)
    }
  }

  const endSeg = (pipe: boolean): void => {
    flushWord()
    if (S.pending) {
      S.seg.redirects.push(S.pending)
      S.pending = null
    }
    const had = S.seg.words.length > 0 || S.seg.redirects.length > 0
    if (had) P.segments.push(S.seg)
    S.seg = newSeg(parent, via, pipe && had ? S.seg : null)
  }

  const substitute = (start: number): number => {
    const w = ensure()
    w.dynamic = true
    w.text += PLACEHOLDER
    P.hasSubstitution = true
    const end = matchParen(src, start)
    if (end < 0) {
      P.unparsable = true
      parseInto(src.slice(start), P, S.seg, 'subst')
      return n
    }
    parseInto(src.slice(start, end), P, S.seg, 'subst')
    return end + 1
  }

  const backtick = (i: number): number => {
    let j = i + 1
    while (j < n && src[j] !== '`') {
      if (src[j] === '\\') j++
      j++
    }
    const w = ensure()
    w.dynamic = true
    w.text += PLACEHOLDER
    P.hasSubstitution = true
    if (j >= n) {
      P.unparsable = true
      parseInto(src.slice(i + 1), P, S.seg, 'subst')
      return n
    }
    parseInto(src.slice(i + 1, j).replace(/\\`/g, '`'), P, S.seg, 'subst')
    return j + 1
  }

  const dollar = (k: number, inDouble: boolean): number => {
    const w = ensure()
    const nx = src[k + 1]
    if (nx === '(') {
      if (src[k + 2] === '(') {
        const end = src.indexOf('))', k + 3)
        w.dynamic = true
        if (end < 0) {
          P.unparsable = true
          return n
        }
        w.text += src.slice(k, end + 2)
        return end + 2
      }
      return substitute(k + 2)
    }
    if (nx === '{') {
      const end = src.indexOf('}', k + 2)
      if (end < 0) {
        P.unparsable = true
        w.dynamic = true
        w.text += src.slice(k)
        return n
      }
      const inner = src.slice(k + 2, end)
      if (inner.startsWith('!')) P.unparsable = true
      if (inner === 'HOME') {
        w.text += '${HOME}'
      } else {
        w.dynamic = true
        w.text += src.slice(k, end + 1)
      }
      return end + 1
    }
    if (nx === "'" && !inDouble) {
      // ANSI-C quoting hides what the command really is.
      P.unparsable = true
      w.dynamic = true
      let j = k + 2
      while (j < n && src[j] !== "'") {
        if (src[j] === '\\') j++
        j++
      }
      if (j >= n) P.unparsable = true
      w.text += PLACEHOLDER
      return j + 1
    }
    if (nx === '"' && !inDouble) return k + 1
    const re = /[A-Za-z_][A-Za-z0-9_]*/y
    re.lastIndex = k + 1
    const m = re.exec(src)
    if (m) {
      if (m[0] === 'HOME') {
        w.text += '$HOME'
      } else {
        w.dynamic = true
        w.text += '$' + m[0]
      }
      return k + 1 + m[0].length
    }
    if (nx !== undefined && /[0-9?#$!@*-]/.test(nx)) {
      w.dynamic = true
      w.text += '$' + nx
      return k + 2
    }
    w.text += '$'
    return k + 1
  }

  const doubleQuote = (i: number): number => {
    const w = ensure()
    let k = i + 1
    for (;;) {
      if (k >= n) {
        P.unparsable = true
        return n
      }
      const ch = src[k]
      if (ch === '"') return k + 1
      if (ch === '\\') {
        const nx = src[k + 1]
        if (nx !== undefined && '"\\$`'.includes(nx)) {
          w.text += nx
          k += 2
        } else if (nx === '\n') {
          k += 2
        } else {
          w.text += '\\'
          k++
        }
        continue
      }
      if (ch === '$') {
        k = dollar(k, true)
        continue
      }
      if (ch === '`') {
        k = backtick(k)
        continue
      }
      w.text += ch
      k++
    }
  }

  const redirect = (i: number): number => {
    const rest = src.slice(i, i + 3)
    let op: string
    if (rest === '<<<') op = '<<<'
    else if (rest === '<<-') op = '<<-'
    else if (rest.startsWith('<<')) op = '<<'
    else if (rest.startsWith('>>')) op = '>>'
    else if (rest.startsWith('>&') || rest.startsWith('<&') || rest.startsWith('>|')) op = rest.slice(0, 2)
    else op = src[i]
    if (S.word && !S.word.dynamic && /^\d+$/.test(S.word.text)) S.word = null
    else flushWord()
    if (op === '<<<' || op === '<<' || op === '<<-') P.unparsable = true
    S.pending = { op, kind: op.startsWith('<') ? 'in' : 'out', target: null }
    return i + op.length
  }

  let i = 0
  while (i < n) {
    const c = src[i]
    if (c === ' ' || c === '\t') {
      flushWord()
      i++
    } else if (c === '\n') {
      endSeg(false)
      i++
    } else if (c === '\\') {
      if (i + 1 >= n) {
        P.unparsable = true
        i++
      } else if (src[i + 1] === '\n') {
        i += 2
      } else {
        ensure().text += src[i + 1]
        i += 2
      }
    } else if (c === "'") {
      const w = ensure()
      const j = src.indexOf("'", i + 1)
      if (j < 0) {
        P.unparsable = true
        w.text += src.slice(i + 1)
        i = n
      } else {
        w.text += src.slice(i + 1, j)
        i = j + 1
      }
    } else if (c === '"') {
      i = doubleQuote(i)
    } else if (c === '`') {
      i = backtick(i)
    } else if (c === '$') {
      i = dollar(i, false)
    } else if (c === '#' && !S.word) {
      while (i < n && src[i] !== '\n') i++
    } else if (c === ';') {
      endSeg(false)
      i++
    } else if (c === '|') {
      if (src[i + 1] === '|') {
        endSeg(false)
        i += 2
      } else {
        endSeg(true)
        i += src[i + 1] === '&' ? 2 : 1
      }
    } else if (c === '&') {
      if (src[i + 1] === '>') {
        flushWord()
        const op = src[i + 2] === '>' ? '&>>' : '&>'
        S.pending = { op, kind: 'out', target: null }
        i += op.length
      } else {
        endSeg(false)
        i += src[i + 1] === '&' ? 2 : 1
      }
    } else if ((c === '<' || c === '>') && src[i + 1] === '(') {
      i = substitute(i + 2)
    } else if (c === '<' || c === '>') {
      i = redirect(i)
    } else if (c === '(') {
      S.depth++
      endSeg(false)
      i++
    } else if (c === ')') {
      S.depth--
      if (S.depth < 0) {
        P.unparsable = true
        S.depth = 0
      }
      endSeg(false)
      i++
    } else if (c === '*' || c === '?' || c === '[' || c === '{') {
      const w = ensure()
      if (w.globAt === null) w.globAt = w.text.length
      w.text += c
      i++
    } else {
      ensure().text += c
      i++
    }
  }
  endSeg(false)
  if (S.depth !== 0) P.unparsable = true
}

function parse(cmd: string): Parsed {
  const P: Parsed = { segments: [], unparsable: false, hasSubstitution: false }
  parseInto(cmd, P, null, 'top')
  return P
}

/** Split a command line into its simple commands (substitution bodies included). */
export function splitSegments(cmd: string): { segments: string[]; unparsable: boolean } {
  const P = parse(cmd)
  const segments = P.segments
    .map((s) => s.words.map((w) => w.text.split(PLACEHOLDER).join('')).join(' ').trim())
    .filter((s) => s.length > 0)
  return { segments, unparsable: P.unparsable }
}

// --------------------------------------------------------------- analysis

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh'])
const INTERPRETERS = new Set([
  ...SHELLS,
  'python',
  'python2',
  'python3',
  'perl',
  'ruby',
  'node',
  'php',
  'osascript',
  'eval',
  'source',
  '.',
])
const FETCHERS = new Set(['curl', 'wget', 'fetch', 'aria2c', 'http', 'https'])
const PRIV = new Set(['sudo', 'su', 'doas', 'pkexec'])
const POWER = new Set(['shutdown', 'reboot', 'halt', 'poweroff'])
const DISK_TOOLS = new Set(['dd', 'fdisk', 'gdisk', 'parted'])
const WRAPPERS = new Set(['command', 'builtin', 'exec', 'nohup', 'time', 'env'])
const OPAQUE = new Set([
  'nice',
  'ionice',
  'xargs',
  'timeout',
  'watch',
  'stdbuf',
  'caffeinate',
  'parallel',
  'chroot',
  'setsid',
  'script',
  'strace',
  'unbuffer',
])
const KEYWORDS = new Set(['if', 'then', 'elif', 'else', 'do', 'while', 'until', '!', '{'])
const UNPARSABLE_CMDS = new Set(['eval', 'source', '.'])
/** Commands that can write wherever an argument points (downloads, archives, syncs). */
const WRITERS = new Set(['curl', 'wget', 'tar', 'unzip', 'rsync', 'scp', 'ditto'])
const MUTATORS = new Set([
  'mv',
  'chmod',
  'chown',
  'chgrp',
  'touch',
  'mkdir',
  'rmdir',
  'ln',
  'truncate',
  'install',
  'unlink',
])
const LAUNCHCTL_WRITES = new Set([
  'load',
  'unload',
  'bootstrap',
  'bootout',
  'enable',
  'disable',
  'kickstart',
  'remove',
  'submit',
  'start',
  'stop',
  'kill',
  'config',
  'setenv',
  'unsetenv',
  'attach',
  'debug',
  'reboot',
])
const DISKUTIL_DESTRUCTIVE = new Set([
  'secureerase',
  'partitiondisk',
  'repartitiondisk',
  'reformat',
  'zerodisk',
  'randomdisk',
  'mergepartitions',
  'splitpartition',
])
const READONLY = new Set([
  'ls',
  'pwd',
  'cat',
  'echo',
  'head',
  'tail',
  'wc',
  'which',
  'date',
  'uname',
  'file',
  'stat',
  'du',
  'df',
  'tree',
  'grep',
  'rg',
  'diff',
  'sort',
  'uniq',
  'cut',
  'basename',
  'dirname',
  'realpath',
  'whoami',
  'printf',
  'true',
  'false',
])
const VERSION_ONLY = new Set(['node', 'npm', 'pnpm', 'yarn', 'python', 'python3', 'ruby', 'cargo', 'pip', 'pip3'])
const GIT_READONLY = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files'])
const GIT_BRANCH_FLAGS = new Set(['-a', '-r', '-v', '-vv', '--list', '--show-current', '--all', '--remotes', '--verbose'])

const FORK_BOMBS = [
  /:\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:\s*&/,
  /(\w+)\s*\(\s*\)\s*\{[^}]*\b\1\s*\|\s*\1\s*&/,
]

interface Cmd {
  name: string
  args: Word[]
  dynamicCmd: boolean
  opaque: boolean
  /** A leading VAR=value (PATH, LD_PRELOAD, GIT_PAGER...) can change what a command runs. */
  hasAssign: boolean
  /** Run through env, command, time, nohup... */
  wrapped: boolean
}

const isAssign = (w: Word): boolean => !w.dynamic && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w.text)

function commandOf(seg: Segment): Cmd | null {
  const w = seg.words
  let i = 0
  let hasAssign = false
  let wrapped = false
  while (i < w.length) {
    const t = w[i]
    if (isAssign(t)) {
      hasAssign = true
      i++
      continue
    }
    if (!t.dynamic && KEYWORDS.has(t.text)) {
      i++
      continue
    }
    if (!t.dynamic && WRAPPERS.has(basename(t.text))) {
      const wrapper = basename(t.text)
      wrapped = true
      i++
      while (i < w.length) {
        const o = w[i]
        if (!o.dynamic && o.text.startsWith('-')) {
          if (wrapper === 'env' && ['-u', '-C', '-S'].includes(o.text)) i++
          i++
        } else if (isAssign(o)) {
          hasAssign = true
          i++
        } else break
      }
      continue
    }
    break
  }
  const cmd = w[i]
  if (!cmd) return null
  const args = w.slice(i + 1)
  if (cmd.dynamic) return { name: '', args, dynamicCmd: true, opaque: false, hasAssign, wrapped }
  const name = basename(cmd.text)
  return { name, args, dynamicCmd: false, opaque: OPAQUE.has(name), hasAssign, wrapped }
}

function insideProject(p: string, ctx: GuardContext): boolean {
  const root = resolve(ctx.projectRoot)
  return p === root || p.startsWith(root + sep)
}

/**
 * Resolve a word to an absolute path against `cwd` (null when a `cd` made the
 * working directory unknowable). For a glob, the directory it expands under.
 */
function resolveWord(w: Word, ctx: GuardContext, cwd: string | null): string | null {
  if (w.dynamic) return null
  let t = w.text
  if (w.globAt !== null) {
    const pre = t.slice(0, w.globAt)
    t = pre.slice(0, pre.lastIndexOf('/') + 1) || '.'
  }
  if (t === '~' || t.startsWith('~/')) t = ctx.home + t.slice(1)
  else if (t.startsWith('$HOME')) t = ctx.home + t.slice(5)
  else if (t.startsWith('${HOME}')) t = ctx.home + t.slice(7)
  else if (t.startsWith('~')) return null
  if (t.includes('$')) return null
  if (isAbsolute(t)) return resolve(t)
  return cwd === null ? null : resolve(cwd, t)
}

const nonFlag = (args: Word[]): Word[] => args.filter((a) => a.dynamic || !a.text.startsWith('-'))

interface Analysis {
  deny: string | null
  unparsable: boolean
  readonly: boolean
  readonlyPaths: string[]
}

function gitReadonly(args: Word[]): boolean {
  const lits = args.map((a) => a.text)
  const sub = lits[0]
  if (!sub || sub.startsWith('-')) return false
  const rest = lits.slice(1)
  if (rest.some((a) => a.startsWith('--output') || a.startsWith('--ext-diff'))) return false
  if (sub === 'branch') return rest.every((a) => GIT_BRANCH_FLAGS.has(a))
  return GIT_READONLY.has(sub)
}

/**
 * The absolute paths a read-only command reads, or null when the command is not
 * read-only: it has env assignments or wrappers, an argument we cannot resolve,
 * a flag that makes it write or run something, or it touches credentials.
 */
function readonlyPaths(c: Cmd, ctx: GuardContext, sensitive: string[], cwd: string | null): string[] | null {
  if (c.hasAssign || c.wrapped) return null
  if (c.args.some((a) => a.dynamic)) return null
  const lits = c.args.map((a) => a.text)
  if (c.name === 'git') {
    if (!gitReadonly(c.args)) return null
  } else if (VERSION_ONLY.has(c.name)) {
    return lits.length === 1 && /^(-v|-V|--version)$/.test(lits[0]) ? [] : null
  } else if (c.name === 'go') {
    return lits.length === 1 && lits[0] === 'version' ? [] : null
  } else {
    if (!READONLY.has(c.name)) return null
    if (c.name === 'sort' && lits.some((a) => /^(--output|--compress-program|-[a-zA-Z]*o)/.test(a))) return null
    if (c.name === 'date' && lits.some((a) => /^(-s|--set)/.test(a))) return null
    if (c.name === 'rg' && lits.some((a) => a.startsWith('--pre') || a.startsWith('--hostname-bin'))) return null
    if (c.name === 'tree' && lits.some((a) => /^-[a-zA-Z]*o/.test(a) || a.startsWith('--output'))) return null
    if (c.name === 'file' && lits.some((a) => a === '-C' || a === '--compile')) return null
    if (c.name === 'uniq' && nonFlag(c.args).length > 1) return null // the second operand is an output file
  }
  const paths: string[] = []
  for (const a of nonFlag(c.args)) {
    const p = resolveWord(a, ctx, cwd)
    if (p === null) return null
    if (isSensitiveRead(p, sensitive, ctx.caseInsensitive)) return null
    paths.push(p)
  }
  return paths
}

function analyze(cmd: string, ctx: GuardContext, depth: number, startCwd: string | null): Analysis {
  const out: Analysis = { deny: null, unparsable: false, readonly: false, readonlyPaths: [] }
  const reads: string[] = []
  if (depth > 3) {
    out.unparsable = true
    return out
  }
  if (FORK_BOMBS.some((re) => re.test(cmd))) {
    out.deny = 'fork bomb'
    return out
  }
  const P = parse(cmd)
  const sensitive = ctx.sensitivePaths ?? sensitiveReadPaths(ctx.home, '')
  let cwd = startCwd
  let allReadonly = P.segments.length > 0 && !P.hasSubstitution && !P.unparsable
  out.unparsable = P.unparsable

  const deny = (reason: string): Analysis => {
    out.deny = reason
    return out
  }
  const writeDenied = (w: Word): string | null => {
    const p = resolveWord(w, ctx, cwd)
    if (p === null) {
      out.unparsable = true
      return null
    }
    return isProtectedWrite(p, ctx.protectedPaths, ctx.projectRoot, ctx.caseInsensitive) ? w.text : null
  }

  for (const seg of P.segments) {
    // Redirections.
    for (const r of seg.redirects) {
      if (!r.target) {
        out.unparsable = true
        allReadonly = false
        continue
      }
      const p = resolveWord(r.target, ctx, cwd)
      if (p === null) {
        out.unparsable = true
        allReadonly = false
        continue
      }
      if (r.kind === 'out') {
        if (isProtectedWrite(p, ctx.protectedPaths, ctx.projectRoot, ctx.caseInsensitive)) {
          return deny(`write to a protected path: ${r.target.text}`)
        }
        if (p !== '/dev/null') allReadonly = false
      } else if (isSensitiveRead(p, sensitive, ctx.caseInsensitive)) {
        allReadonly = false
      } else {
        reads.push(p)
      }
    }

    const c = commandOf(seg)
    if (!c) {
      allReadonly = false
      continue
    }
    if (c.dynamicCmd) {
      out.unparsable = true
      allReadonly = false
      continue
    }
    if (c.opaque || UNPARSABLE_CMDS.has(c.name)) {
      out.unparsable = true
      allReadonly = false
    }
    const lits = c.args.map((a) => a.text)

    if (c.name === 'cd' || c.name === 'pushd' || c.name === 'popd') {
      const dirs = nonFlag(c.args)
      if (c.name === 'popd' || (dirs.length > 0 && (dirs[0].dynamic || dirs[0].text === '-'))) cwd = null
      else if (dirs.length === 0) cwd = resolve(ctx.home)
      else cwd = resolveWord(dirs[0], ctx, cwd)
    }

    if (PRIV.has(c.name)) return deny(`privilege escalation: ${c.name}`)
    if (POWER.has(c.name)) return deny(`power control: ${c.name}`)
    if (DISK_TOOLS.has(c.name) || c.name.startsWith('mkfs') || c.name.startsWith('newfs')) {
      return deny(`raw disk tool: ${c.name}`)
    }
    if (c.name === 'diskutil') {
      const sub = (lits[0] ?? '').toLowerCase()
      if (
        sub.startsWith('erase') ||
        DISKUTIL_DESTRUCTIVE.has(sub) ||
        (sub === 'apfs' && /^(delete|erase)/i.test(lits[1] ?? ''))
      ) {
        return deny(`destructive diskutil command: ${sub}`)
      }
    }
    if (c.name === 'launchctl' && LAUNCHCTL_WRITES.has(lits[0] ?? '')) {
      return deny(`launchctl ${lits[0]} changes system services`)
    }
    if (c.name === 'kill') {
      let rest = lits
      if (rest[0] && /^-(\d+|[A-Za-z]+)$/.test(rest[0])) rest = rest.slice(1)
      else if (rest[0] === '-s' || rest[0] === '-n') rest = rest.slice(2)
      if (rest.some((a) => a === '-1' || a === '0')) return deny('kill would signal every process')
    }

    // Remote code execution.
    if (seg.pipeFrom && INTERPRETERS.has(c.name)) {
      for (let up: Segment | null = seg.pipeFrom; up; up = up.pipeFrom) {
        const pf = commandOf(up)
        const fetchesInside = P.segments.some(
          (s2) => s2.parent === up && s2.via === 'subst' && FETCHERS.has(commandOf(s2)?.name ?? ''),
        )
        if ((pf && FETCHERS.has(pf.name)) || fetchesInside) {
          return deny('piping downloaded content into an interpreter')
        }
      }
    }
    if (seg.via === 'subst' && seg.parent && FETCHERS.has(c.name)) {
      const pc = commandOf(seg.parent)
      if (pc && INTERPRETERS.has(pc.name)) return deny('running downloaded content')
    }

    // Nested shells: bash -c "...".
    if (SHELLS.has(c.name)) {
      const k = c.args.findIndex((a) => !a.dynamic && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a.text))
      if (k >= 0) {
        const body = c.args[k + 1]
        if (!body || body.dynamic) {
          out.unparsable = true
        } else {
          const nested = analyze(body.text, ctx, depth + 1, cwd)
          if (nested.deny) return deny(nested.deny)
          if (nested.unparsable) out.unparsable = true
        }
      }
    }

    switch (c.name) {
      case 'rm': {
        const flags: string[] = []
        const targets: Word[] = []
        let endOpts = false
        for (const a of c.args) {
          if (!endOpts && !a.dynamic && a.text === '--') endOpts = true
          else if (!endOpts && !a.dynamic && a.text.startsWith('-') && a.text.length > 1) flags.push(a.text)
          else targets.push(a)
        }
        const recursive = flags.some((f) => f === '--recursive' || /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(f))
        for (const t of targets) {
          const p = resolveWord(t, ctx, cwd)
          if (p === null) {
            if (recursive) out.unparsable = true
            continue
          }
          if (isProtectedWrite(p, ctx.protectedPaths, ctx.projectRoot, ctx.caseInsensitive)) {
            return deny(`delete of a protected path: ${t.text}`)
          }
          if (recursive && !insideProject(p, ctx)) {
            return deny(`recursive delete outside the project: ${t.text}`)
          }
        }
        break
      }
      case 'find': {
        const hasDelete = lits.includes('-delete')
        if (lits.some((a) => ['-exec', '-execdir', '-ok', '-okdir'].includes(a))) out.unparsable = true
        if (hasDelete) {
          const starts: Word[] = []
          for (const a of c.args) {
            if (!a.dynamic && (a.text.startsWith('-') || a.text === '(' || a.text === '!')) break
            starts.push(a)
          }
          if (starts.length === 0) starts.push({ text: '.', dynamic: false, globAt: null })
          for (const s of starts) {
            const p = resolveWord(s, ctx, cwd)
            if (p === null) out.unparsable = true
            else if (!insideProject(p, ctx)) return deny(`find -delete outside the project: ${s.text}`)
          }
        }
        break
      }
      case 'shred': {
        for (const t of nonFlag(c.args)) {
          const p = resolveWord(t, ctx, cwd)
          if (p === null) out.unparsable = true
          else if (!insideProject(p, ctx)) return deny(`shred outside the project: ${t.text}`)
        }
        break
      }
      case 'git': {
        let i = 0
        while (i < lits.length) {
          const a = lits[i]
          if (['-C', '-c', '--git-dir', '--work-tree', '--namespace'].includes(a)) i += 2
          else if (a.startsWith('-')) i++
          else break
        }
        if (lits[i] === 'push') {
          const rest = lits.slice(i + 1)
          const forced = rest.some(
            (a) =>
              a === '--force' ||
              a === '-f' ||
              a === '--force-if-includes' ||
              a.startsWith('--force-with-lease') ||
              /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a) ||
              a.startsWith('+'),
          )
          if (forced) return deny('force push')
        }
        break
      }
      case 'cp': {
        const tIdx = lits.indexOf('-t')
        const dest = tIdx >= 0 ? c.args[tIdx + 1] : nonFlag(c.args).at(-1)
        if (dest) {
          const bad = writeDenied(dest)
          if (bad) return deny(`write to a protected path: ${bad}`)
        }
        break
      }
      case 'tee': {
        for (const t of nonFlag(c.args)) {
          const bad = writeDenied(t)
          if (bad) return deny(`write to a protected path: ${bad}`)
        }
        break
      }
      case 'sed': {
        if (lits.some((a) => a === '--in-place' || /^-[a-zA-Z]*i/.test(a))) {
          for (const t of nonFlag(c.args)) {
            const bad = writeDenied(t)
            if (bad) return deny(`write to a protected path: ${bad}`)
          }
        }
        break
      }
      default:
        if (MUTATORS.has(c.name)) {
          for (const t of nonFlag(c.args)) {
            const bad = writeDenied(t)
            if (bad) return deny(`write to a protected path: ${bad}`)
          }
        } else if (WRITERS.has(c.name)) {
          const candidates: Word[] = [...nonFlag(c.args)]
          for (const a of c.args) {
            const eq = !a.dynamic && a.text.startsWith('-') ? a.text.indexOf('=') : -1
            if (eq > 0) candidates.push({ text: a.text.slice(eq + 1), dynamic: false, globAt: null })
          }
          for (const t of candidates) {
            const bad = writeDenied(t)
            if (bad) return deny(`${c.name} would write to a protected path: ${bad}`)
          }
        }
    }

    const paths = readonlyPaths(c, ctx, sensitive, cwd)
    if (paths === null) allReadonly = false
    else reads.push(...paths)
  }

  out.readonly = allReadonly && !out.unparsable
  out.readonlyPaths = reads
  return out
}

/**
 * Classify a shell command (spec 6.2, 6.3): hard-denied, safe to auto-run because
 * it only reads, or anything else (which the permission mode decides).
 */
export function classifyBash(cmd: string, ctx: GuardContext): BashClass {
  const a = analyze(cmd, ctx, 0, resolve(ctx.projectRoot))
  if (a.deny) return { kind: 'deny', reason: a.deny }
  if (a.readonly) return { kind: 'readonly', paths: a.readonlyPaths }
  return { kind: 'other', unparsable: a.unparsable }
}
