import { spawn } from 'node:child_process'
import { constants as fsc } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, open, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join, resolve as resolvePath, sep } from 'node:path'
import type { CloudDiff, CloudDiffFile } from '../../shared/cloud'
import { redact } from '../safety/redact'
import type { GitOps } from './protocol'
import { isSafeBranchName } from './repoRef'

export interface CliGitOpsOptions {
  /** Server-owned directory outside any session workspace; holds an empty HOME and, per call, a private temp directory. */
  workDir: string
  gitBin?: string
  /** Tests only: allow `file://` and absolute-path remotes (a local bare repository). */
  allowFileRemotes?: boolean
  depth?: number
  timeouts?: { cloneMs?: number; pushMs?: number; localMs?: number }
}

const MAX_FILES = 500
const MAX_NEW_FILE_BYTES = 10 * 1024 * 1024
const MAX_COUNT_BYTES = 8 * 1024 * 1024
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024
const AUTHOR_NAME = 'AIVEN ARC'
const AUTHOR_EMAIL = 'arc@users.noreply.github.com'

const ALLOWED_CONFIG_KEYS = new Set([
  'core.repositoryformatversion',
  'core.filemode',
  'core.bare',
  'core.logallrefupdates',
  'core.ignorecase',
  'core.precomposeunicode',
  'core.symlinks',
  'remote.origin.url',
  'remote.origin.fetch',
  'user.name',
  'user.email',
  'gc.auto',
])
const ALLOWED_BRANCH_KEY = /^branch\..+\.(?:remote|merge)$/

/** Where the pristine push repository keeps the branch it fetched from the workspace. */
const PUSH_REF = 'refs/heads/arc-push'

const TAMPERED = 'The repository settings were changed during the session, so ARC did not push.'

const SECRET_NAME = [
  /^\.env$/,
  /^\.env\..*/,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /^id_rsa/,
  /^id_ed25519/,
  /^\.npmrc$/,
  /^\.netrc$/,
  /^credentials/,
  /\.keystore$/,
]
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY/

const ASKPASS = `#!/bin/sh
case "$1" in
  Username*) printf '%s\\n' 'x-access-token' ;;
  *) printf '%s\\n' "$ARC_GIT_TOKEN" ;;
esac
`

interface RunOpts {
  cwd?: string
  token?: string
  /** Set internally: the per-call askpass script that answers with the token. */
  askpass?: string
  timeoutMs: number
  input?: string
  /** Exit codes that are a normal answer rather than a failure. */
  okCodes?: number[]
  /** Short name used in error messages. */
  label: string
}

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

const fail = (message: string): never => {
  throw new Error(message)
}

const b64 = (s: string): string => Buffer.from(s).toString('base64')

/** A branch name safe to hand to git as a ref: plain characters, no option or revision syntax. */
function isSafeBaseBranch(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0 || name.length > 200) return false
  if (!/^[A-Za-z0-9._/+@-]+$/.test(name)) return false
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) return false
  if (name.includes('..') || name.includes('//') || name.includes('@{') || name.endsWith('.lock')) return false
  return name.split('/').every((s) => s !== '' && !s.startsWith('.'))
}

function isNameSecretLike(path: string): boolean {
  const base = (path.split('/').pop() ?? path).toLowerCase()
  return SECRET_NAME.some((re) => re.test(base))
}

export class CliGitOps implements GitOps {
  private readonly workDir: string
  private readonly gitBin: string
  private readonly allowFile: boolean
  private readonly depth: number
  private readonly cloneMs: number
  private readonly pushMs: number
  private readonly localMs: number
  private setup: Promise<void> | null = null

  constructor(opts: CliGitOpsOptions) {
    this.workDir = join(opts.workDir)
    this.gitBin = opts.gitBin ?? 'git'
    this.allowFile = opts.allowFileRemotes === true
    this.depth = opts.depth ?? 100
    this.cloneMs = opts.timeouts?.cloneMs ?? 600_000
    this.pushMs = opts.timeouts?.pushMs ?? 180_000
    this.localMs = opts.timeouts?.localMs ?? 60_000
  }

  // ------------------------------------------------------------ plumbing

  private get home(): string {
    return join(this.workDir, 'home')
  }
  private ensureSetup(): Promise<void> {
    this.setup ??= mkdir(this.home, { recursive: true, mode: 0o700 })
      .then(() => undefined)
      .catch((e: unknown) => {
        this.setup = null
        throw e
      })
    return this.setup
  }

  /** A fresh directory (mode 0700) under workDir for one call. Callers remove it in `finally`. */
  private async tempDir(prefix: string): Promise<string> {
    await this.ensureSetup()
    const dir = await mkdtemp(join(this.workDir, prefix))
    await chmod(dir, 0o700)
    return dir
  }

  /**
   * The askpass script is written fresh for one network call (mode 0500, in its own 0700 directory) and the
   * directory is deleted afterwards, so there is no persistent file for anything to replace.
   */
  private async withAskpass<T>(fn: (askpass: string) => Promise<T>): Promise<T> {
    const dir = await this.tempDir('ask-')
    try {
      const script = join(dir, 'askpass.sh')
      await writeFile(script, ASKPASS, { flag: 'wx', mode: 0o500 })
      await chmod(script, 0o500)
      return await fn(script)
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /** Built from scratch: nothing from the server's environment except PATH, and the token only when `token` is given. */
  private env(token?: string, askpass?: string): Record<string, string> {
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      HOME: this.home,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C',
      GIT_OPTIONAL_LOCKS: '0',
    }
    if (token && askpass) {
      env.ARC_GIT_TOKEN = token
      env.GIT_ASKPASS = askpass
    }
    return env
  }

  private globalArgs(): string[] {
    const cfg = [
      'core.hooksPath=/dev/null',
      'core.fsmonitor=false',
      'core.sshCommand=false',
      'credential.helper=',
      'protocol.allow=never',
      'protocol.https.allow=always',
      ...(this.allowFile ? ['protocol.file.allow=always'] : []),
      'commit.gpgsign=false',
      'core.autocrlf=false',
    ]
    return ['--no-pager', '--literal-pathspecs', ...cfg.flatMap((c) => ['-c', c])]
  }

  private scrub(text: string, token?: string): string {
    const secrets = token ? [token, b64(token), b64(`x-access-token:${token}`), encodeURIComponent(token)] : []
    return redact(text, secrets).replace(/(\w+:\/\/)[^/@\s]*@/g, '$1')
  }

  private async run(args: string[], o: RunOpts, extra: string[] = []): Promise<RunResult> {
    await this.ensureSetup()
    if (o.token && !o.askpass) return this.withAskpass((askpass) => this.spawnGit(args, { ...o, askpass }, extra))
    return this.spawnGit(args, o, extra)
  }

  private spawnGit(args: string[], o: RunOpts, extra: string[]): Promise<RunResult> {
    return (
      new Promise<RunResult>((resolve, reject) => {
          const child = spawn(this.gitBin, [...this.globalArgs(), ...extra, ...args], {
            cwd: o.cwd,
            env: this.env(o.token, o.askpass),
            stdio: [o.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
            detached: true,
          })
          const out: Buffer[] = []
          const err: Buffer[] = []
          let outBytes = 0
          let errBytes = 0
          let killed: 'time' | 'size' | null = null
          const kill = (why: 'time' | 'size'): void => {
            killed ??= why
            try {
              if (child.pid) process.kill(-child.pid, 'SIGKILL')
            } catch {
              child.kill('SIGKILL')
            }
          }
          const timer = setTimeout(() => kill('time'), o.timeoutMs)
          child.stdout?.on('data', (d: Buffer) => {
            outBytes += d.length
            if (outBytes > MAX_OUTPUT_BYTES) kill('size')
            else out.push(d)
          })
          child.stderr?.on('data', (d: Buffer) => {
            errBytes += d.length
            if (errBytes <= 256 * 1024) err.push(d)
          })
          child.on('error', (e: NodeJS.ErrnoException) => {
            clearTimeout(timer)
            reject(new Error(e.code === 'ENOENT' ? 'Git is not installed on the worker.' : 'Git could not be started.'))
          })
          child.on('close', (code) => {
            clearTimeout(timer)
            if (killed === 'time') return reject(new Error(`Git took too long while ${o.label} and was stopped.`))
            if (killed === 'size') return reject(new Error(`Git produced too much output while ${o.label}.`))
            const stderr = Buffer.concat(err).toString('utf8')
            const result = { code: code ?? 1, stdout: Buffer.concat(out).toString('utf8'), stderr }
            if (result.code === 0 || o.okCodes?.includes(result.code)) return resolve(result)
            // `push --porcelain` reports a rejection (and its reason) on stdout.
            reject(new Error(this.explain(o.label, `${stderr}\n${result.stdout.slice(0, 4096)}`, o.token)))
          })
          if (o.input !== undefined && child.stdin) child.stdin.end(o.input)
        })
    )
  }

  private local(dir: string, args: string[], extra: Partial<RunOpts> & { label?: string } = {}, pre: string[] = []): Promise<RunResult> {
    return this.run(args, { cwd: dir, timeoutMs: this.localMs, label: extra.label ?? `running git ${args[0]}`, ...extra }, pre)
  }

  /** Turn git's stderr into something a person can act on, with the token removed. */
  private explain(label: string, stderr: string, token?: string): string {
    const s = this.scrub(stderr, token)
    const l = s.toLowerCase()
    if (/non-fast-forward|fetch first|\(fast-forward\)|updates were rejected/.test(l)) {
      return 'The branch on GitHub has commits this session does not have (not a fast-forward), so ARC did not overwrite it. ARC never force-pushes. Start a new cloud session or merge the branch on GitHub.'
    }
    if (/authentication failed|could not read (username|password)|invalid username|terminal prompts disabled|permission denied|returned error: 40[13]/.test(l)) {
      return 'GitHub did not accept the token for this repository. It needs Contents write access (and Pull requests write for pull requests).'
    }
    if (/repository not found|returned error: 404/.test(l)) {
      return 'GitHub could not find that repository, or the token cannot see it.'
    }
    if (/could not resolve host|failed to connect|connection (refused|reset|timed out)|operation timed out|unable to access/.test(l)) {
      return 'ARC could not reach the git server.'
    }
    const lines = s
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(' ')
      .slice(0, 400)
    return `Git failed while ${label}${lines ? `: ${lines}` : '.'}`
  }

  private checkRemote(url: string): void {
    if (typeof url !== 'string' || url === '' || /[\s\u0000-\u001f]/.test(url) || url.startsWith('-')) {
      fail('The repository address is not valid.')
    }
    if (this.allowFile && (url.startsWith('/') || url.startsWith('file://'))) return
    let u: URL
    try {
      u = new URL(url)
    } catch {
      return fail('The repository address is not valid.')
    }
    if (u.protocol !== 'https:') fail('Only https:// repository addresses are allowed.')
    if (u.username || u.password || u.search || u.hash || u.host === '') fail('The repository address cannot contain credentials, a query or a fragment.')
  }

  private async assertRealGitDir(dir: string): Promise<void> {
    let st
    try {
      st = await lstat(join(dir, '.git'))
    } catch {
      return fail(`${TAMPERED} The .git folder is missing.`)
    }
    if (!st.isDirectory()) fail(`${TAMPERED} The .git folder was replaced by a link or a file.`)
  }

  private async assertConfigClean(dir: string, url: string): Promise<void> {
    const { stdout } = await this.local(dir, ['config', '--local', '--list', '-z'], { label: 'reading the repository settings' })
    const bad: string[] = []
    const urls: string[] = []
    for (const entry of stdout.split('\0')) {
      if (entry === '') continue
      const nl = entry.indexOf('\n')
      const key = nl < 0 ? entry : entry.slice(0, nl)
      const value = nl < 0 ? '' : entry.slice(nl + 1)
      if (key === 'remote.origin.url') urls.push(value)
      if (!ALLOWED_CONFIG_KEYS.has(key) && !ALLOWED_BRANCH_KEY.test(key)) bad.push(key)
    }
    if (bad.length > 0) {
      const names = [...new Set(bad)].slice(0, 5).map((k) => k.replace(/[^\x20-\x7e]/g, '?').slice(0, 80))
      fail(`${TAMPERED} Nothing was sent to GitHub. Unexpected setting: ${names.join(', ')}. Remove it, or start a new cloud session.`)
    }
    if (urls.length === 0 || urls.some((u) => u !== url)) {
      fail(`${TAMPERED} Nothing was sent to GitHub. The remote address no longer matches the repository.`)
    }
  }

  private async head(dir: string, short = false): Promise<string> {
    const { stdout } = await this.local(dir, ['rev-parse', '--verify', ...(short ? ['--short'] : []), 'HEAD'], {
      label: 'reading the current commit',
    })
    return stdout.trim()
  }

  // --------------------------------------------------------------- clone

  async clone(opts: {
    httpsUrl: string
    dir: string
    token: string
    baseBranch?: string
    branch: string
  }): Promise<{ baseBranch: string; head: string }> {
    this.checkRemote(opts.httpsUrl)
    if (!isSafeBranchName(opts.branch)) fail('That branch name is not allowed. ARC branches must start with arc/.')
    if (opts.baseBranch !== undefined && !isSafeBaseBranch(opts.baseBranch)) {
      fail('That base branch name has characters ARC does not accept.')
    }
    const args = ['clone', '--no-recurse-submodules', `--depth=${this.depth}`]
    if (opts.baseBranch !== undefined) args.push(`--branch=${opts.baseBranch}`, '--single-branch')
    args.push('--', opts.httpsUrl, opts.dir)
    try {
      await this.run(args, { token: opts.token, timeoutMs: this.cloneMs, label: 'cloning the repository' })
    } catch (e) {
      const m = e instanceof Error ? e.message : ''
      if (opts.baseBranch !== undefined && /remote branch .* not found/i.test(m)) {
        return fail(`The branch "${opts.baseBranch}" does not exist in that repository.`)
      }
      throw e
    }

    let base = opts.baseBranch
    if (base === undefined) {
      const r = await this.local(opts.dir, ['symbolic-ref', '--short', 'HEAD'], { label: 'reading the default branch', okCodes: [128] })
      base = r.code === 0 ? r.stdout.trim() : ''
      if (!isSafeBaseBranch(base)) return fail('ARC could not work out the default branch of that repository.')
    }
    const ref = `refs/remotes/origin/${base}`
    const has = await this.local(opts.dir, ['rev-parse', '--verify', '--quiet', ref], { label: 'checking the base branch', okCodes: [1] })
    if (has.code !== 0) {
      return fail(
        opts.baseBranch === undefined
          ? 'That repository has no commits yet, so ARC cannot start a session in it.'
          : `The branch "${base}" does not exist in that repository.`,
      )
    }
    await this.local(opts.dir, ['switch', '--create', opts.branch], { label: 'creating the working branch' })
    return { baseBranch: base, head: await this.head(opts.dir) }
  }

  // ---------------------------------------------------------------- diff

  async diff(opts: { dir: string; baseBranch: string; branch: string; pushedHead: string | null }): Promise<CloudDiff> {
    const { dir } = opts
    if (!isSafeBaseBranch(opts.baseBranch)) fail('That base branch name has characters ARC does not accept.')
    const ref = `refs/remotes/origin/${opts.baseBranch}`
    const label = 'comparing with the base branch'
    const mb = await this.local(dir, ['merge-base', 'HEAD', ref], { label, okCodes: [1] })
    let since = mb.code === 0 ? mb.stdout.trim() : ''
    if (since === '') {
      const has = await this.local(dir, ['rev-parse', '--verify', '--quiet', ref], { label, okCodes: [1] })
      if (has.code !== 0) return fail(`The base branch "${opts.baseBranch}" is not in this clone.`)
      since = ref
    }
    const diffArgs = ['--no-ext-diff', '--no-textconv', '--find-renames', since]

    const [numstat, names, status, ahead, head] = await Promise.all([
      this.local(dir, ['diff', '--numstat', '-z', ...diffArgs], { label }),
      this.local(dir, ['diff', '--name-status', '-z', ...diffArgs], { label }),
      this.local(dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { label: 'reading the working tree' }),
      this.local(dir, ['rev-list', '--count', `${ref}..HEAD`], { label }),
      this.head(dir),
    ])

    const stats = new Map<string, { additions: number; deletions: number }>()
    const t = numstat.stdout.split('\0')
    for (let i = 0; i < t.length; ) {
      const m = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(t[i])
      if (!m) {
        i++
        continue
      }
      const path = m[3] === '' ? t[i + 2] : m[3]
      i += m[3] === '' ? 3 : 1
      if (path !== undefined) stats.set(path, { additions: m[1] === '-' ? 0 : Number(m[1]), deletions: m[2] === '-' ? 0 : Number(m[2]) })
    }

    const files = new Map<string, CloudDiffFile>()
    const n = names.stdout.split('\0')
    for (let i = 0; i + 1 < n.length; ) {
      const code = n[i][0]
      const renamed = code === 'R' || code === 'C'
      const path = renamed ? n[i + 2] : n[i + 1]
      i += renamed ? 3 : 2
      if (path === undefined) break
      const status: CloudDiffFile['status'] =
        code === 'A' || code === 'C' ? 'added' : code === 'D' ? 'deleted' : code === 'R' ? 'renamed' : 'modified'
      files.set(path, { path, status, additions: stats.get(path)?.additions ?? 0, deletions: stats.get(path)?.deletions ?? 0 })
    }

    let uncommitted = false
    const untracked: string[] = []
    const s = status.stdout.split('\0')
    for (let i = 0; i < s.length; i++) {
      const e = s[i]
      if (e.length < 4) continue
      uncommitted = true
      const xy = e.slice(0, 2)
      if (xy === '??') untracked.push(e.slice(3))
      else if (/[RC]/.test(xy)) i++
    }

    const all = [...files.values(), ...untracked.filter((p) => !files.has(p)).map((path): CloudDiffFile => ({ path, status: 'untracked', additions: 0, deletions: 0 }))]
    all.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    const capped = all.slice(0, MAX_FILES)
    const truncated = all.length > MAX_FILES
    for (const f of capped) if (f.status === 'untracked') f.additions = await this.countLines(dir, f.path)

    return {
      branch: opts.branch,
      baseBranch: opts.baseBranch,
      files: capped,
      uncommitted,
      ahead: Number.parseInt(ahead.stdout.trim(), 10) || 0,
      pushed: opts.pushedHead !== null && opts.pushedHead === head && !uncommitted,
      ...(truncated ? { truncated: true } : {}),
    }
  }

  /** Lines in an untracked text file; 0 for binary, oversized, or anything that is not a plain file inside `dir`. */
  private async countLines(dir: string, rel: string): Promise<number> {
    try {
      const full = join(dir, rel)
      const st = await lstat(full)
      if (st.isSymbolicLink()) return 1
      if (!st.isFile() || st.size === 0 || st.size > MAX_COUNT_BYTES) return 0
      const root = await realpath(dir)
      if (!(await realpath(full)).startsWith(root + sep)) return 0
      const buf = await readFile(full)
      if (buf.subarray(0, 8192).includes(0)) return 0
      let lines = 0
      for (const b of buf) if (b === 10) lines++
      return buf[buf.length - 1] === 10 ? lines : lines + 1
    } catch {
      return 0
    }
  }

  // ------------------------------------------------------ commit and push

  async commitAndPush(opts: {
    dir: string
    httpsUrl: string
    token: string
    branch: string
    message: string
  }): Promise<{ commit: string | null; pushed: boolean; skipped: string[]; head: string }> {
    const { dir } = opts
    this.checkRemote(opts.httpsUrl)
    if (!isSafeBranchName(opts.branch)) fail('That branch name is not allowed. ARC only pushes branches that start with arc/.')

    await this.assertRealGitDir(dir)
    await this.assertConfigClean(dir, opts.httpsUrl)

    await this.local(dir, ['add', '-A'], { label: 'staging the changes' })
    const skipped = await this.unstageRisky(dir)

    const staged = await this.local(dir, ['diff', '--cached', '--quiet', '--no-ext-diff'], { label: 'checking the staged changes', okCodes: [1] })
    let committed = false
    if (staged.code === 1) {
      const message = opts.message.replace(/\u0000/g, '').trim() || 'arc: changes'
      await this.local(
        dir,
        ['commit', '--no-verify', '--no-gpg-sign', '--quiet', `--author=${AUTHOR_NAME} <${AUTHOR_EMAIL}>`, `--message=${message}`],
        { label: 'committing the changes' },
        ['-c', `user.name=${AUTHOR_NAME}`, '-c', `user.email=${AUTHOR_EMAIL}`],
      )
      committed = true
    }

    // Checked again right before the network call so the window for a change is as small as it can be.
    await this.assertRealGitDir(dir)
    await this.assertConfigClean(dir, opts.httpsUrl)

    // The network call never reads anything the agent can write. The branch is copied into a repository
    // created just now (its config, hooks and askpass script never exist where the agent can reach them) over
    // the local file protocol with no token in the environment; only that copy talks to GitHub.
    const tmp = await this.tempDir('push-')
    try {
      const repo = join(tmp, 'repo.git')
      await this.run(['init', '--bare', '--quiet', '--template=', '--', repo], { cwd: tmp, timeoutMs: this.localMs, label: 'preparing the push' })
      await this.run(
        ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--update-shallow', '--no-recurse-submodules', '--', resolvePath(dir), `+HEAD:${PUSH_REF}`],
        { cwd: repo, timeoutMs: this.pushMs, label: 'preparing the push' },
        ['-c', 'protocol.file.allow=always'],
      )
      const head = (await this.local(repo, ['rev-parse', '--verify', PUSH_REF], { label: 'reading the current commit' })).stdout.trim()
      const pushed = await this.run(
        ['push', '--porcelain', '--no-verify', '--no-recurse-submodules', '--', opts.httpsUrl, `${PUSH_REF}:refs/heads/${opts.branch}`],
        { cwd: repo, token: opts.token, timeoutMs: this.pushMs, label: 'pushing the branch' },
      )
      // Porcelain lines: "=\t..." is "up to date"; " " (fast-forward) and "*" (new ref) mean something was sent.
      const sent = pushed.stdout.split('\n').some((l) => l.startsWith(' \t') || l.startsWith('*\t'))
      const short = (await this.local(repo, ['rev-parse', '--short', '--verify', PUSH_REF], { label: 'reading the current commit' })).stdout.trim()
      return { commit: committed ? short : null, pushed: sent, skipped, head }
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /** Unstage newly added files that look like secrets or are very large. Returns their paths. */
  private async unstageRisky(dir: string): Promise<string[]> {
    const added = await this.local(dir, ['diff', '--cached', '--name-only', '--diff-filter=A', '--no-renames', '-z', '--no-ext-diff'], {
      label: 'checking the new files',
    })
    const paths = added.stdout.split('\0').filter((p) => p !== '')
    const risky: string[] = []
    let next = 0
    const worker = async (): Promise<void> => {
      for (let i = next++; i < paths.length; i = next++) {
        if (await this.looksRisky(dir, paths[i])) risky.push(paths[i])
      }
    }
    await Promise.all(Array.from({ length: Math.min(8, paths.length) }, worker))
    risky.sort()
    if (risky.length > 0) {
      await this.local(dir, ['reset', '--quiet', '--pathspec-from-file=-', '--pathspec-file-nul'], {
        label: 'leaving out the secret-looking files',
        input: risky.join('\0') + '\0',
      })
    }
    return risky
  }

  private async looksRisky(dir: string, rel: string): Promise<boolean> {
    if (isNameSecretLike(rel)) return true
    try {
      const full = join(dir, rel)
      const st = await lstat(full)
      if (!st.isFile()) return false
      if (st.size > MAX_NEW_FILE_BYTES) return true
      const fh = await open(full, fsc.O_RDONLY | fsc.O_NOFOLLOW)
      try {
        const buf = await fh.readFile()
        return buf.includes('-----BEGIN') && PRIVATE_KEY_BLOCK.test(buf.toString('latin1'))
      } finally {
        await fh.close()
      }
    } catch {
      return false
    }
  }
}
