import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CliGitOps } from '../../src/main/cloud/gitOps'

const TOKEN = 'ghp_TestToken0123456789abcdefghijklmnop'
const SECRETISH_ENV = ['GITHUB_TOKEN', 'ARC_GIT_TOKEN', 'ARC_SERVER_SECRET', 'GIT_DIR', 'GIT_SSH_COMMAND']

let root: string
let remote: string
let remoteUrl: string
let work: string
let session: string
const savedEnv: Record<string, string | undefined> = {}

const cleanEnv = { PATH: process.env.PATH ?? '', HOME: '/nonexistent', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'protocol.file.allow=always', '-c', 'user.name=Seed', '-c', 'user.email=seed@example.com', ...args], {
    cwd,
    env: cleanEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

async function seedRemote(): Promise<void> {
  remote = join(root, 'remote.git')
  remoteUrl = `file://${remote}`
  git(root, 'init', '--bare', '--initial-branch=main', remote)
  const seed = join(root, 'seed')
  await mkdir(seed)
  git(seed, 'init', '--initial-branch=main')
  await writeFile(join(seed, 'README.md'), 'hello\nworld\n')
  await writeFile(join(seed, '.env'), 'TRACKED=1\n')
  await mkdir(join(seed, 'src'))
  await writeFile(join(seed, 'src', 'a.ts'), 'export const a = 1\n')
  await writeFile(join(seed, 'src', 'old name.ts'), 'line1\nline2\nline3\nline4\nline5\nline6\n')
  await writeFile(join(seed, 'gone.txt'), 'bye\n')
  git(seed, 'add', '-A')
  git(seed, 'commit', '-m', 'initial')
  git(seed, 'branch', 'develop')
  git(seed, 'remote', 'add', 'origin', remoteUrl)
  git(seed, 'push', 'origin', 'main', 'develop')
}

const newOps = (extra: Partial<ConstructorParameters<typeof CliGitOps>[0]> = {}): CliGitOps =>
  new CliGitOps({ workDir: work, allowFileRemotes: true, ...extra })

async function started(ops = newOps(), branch = 'arc/test-ab12'): Promise<{ ops: CliGitOps; head: string; branch: string }> {
  const r = await ops.clone({ httpsUrl: remoteUrl, dir: session, token: TOKEN, branch })
  return { ops, head: r.head, branch }
}

const push = (ops: CliGitOps, branch: string, message = 'arc: test') =>
  ops.commitAndPush({ dir: session, httpsUrl: remoteUrl, token: TOKEN, branch, message })

const remoteRef = (ref: string): string | null => {
  try {
    return git(root, '--git-dir', remote, 'rev-parse', '--verify', '--quiet', ref)
  } catch {
    return null
  }
}

/** A git wrapper that records its arguments and environment, then runs the real git. */
async function recordingGit(name = 'git-rec'): Promise<{ bin: string; calls: () => Promise<Call[]> }> {
  const dir = join(root, `${name}-log`)
  await mkdir(dir, { recursive: true })
  const bin = join(root, name)
  // One file per call so concurrent git processes cannot interleave their records.
  const script = `#!/bin/sh\nf='${dir}'/$(date +%s%N)-$$\n{ echo "ARGS $*"; env | sort; } > "$f"\nexec git "$@"\n`
  await writeFile(bin, script, { mode: 0o755 })
  return {
    bin,
    calls: async () => {
      const files = (await readdir(dir)).sort()
      const out: Call[] = []
      for (const f of files) {
        const lines = (await readFile(join(dir, f), 'utf8')).split('\n')
        const args = (lines.shift() ?? '').slice('ARGS '.length)
        const env: Record<string, string> = {}
        for (const l of lines) {
          const i = l.indexOf('=')
          if (i > 0) env[l.slice(0, i)] = l.slice(i + 1)
        }
        out.push({ args, env, sub: subcommand(args) })
      }
      return out
    },
  }
}

interface Call {
  args: string
  env: Record<string, string>
  sub: string
}

function subcommand(args: string): string {
  const parts = args.split(' ')
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '-c') i++
    else if (!parts[i].startsWith('-')) return parts[i]
  }
  return ''
}

beforeEach(async () => {
  for (const k of SECRETISH_ENV) savedEnv[k] = process.env[k]
  root = await mkdtemp(join(tmpdir(), 'arc-gitops-'))
  work = join(root, 'work')
  session = join(root, 'sessions', 's1')
  await mkdir(join(root, 'sessions'), { recursive: true })
  await seedRemote()
})

afterEach(async () => {
  for (const k of SECRETISH_ENV) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  await rm(root, { recursive: true, force: true })
})

describe('clone', () => {
  it('clones, creates and switches to the arc branch, and returns the base branch and head', async () => {
    const { head } = await started()
    expect(git(session, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('arc/test-ab12')
    expect(head).toBe(git(session, 'rev-parse', 'HEAD'))
    expect(head).toBe(remoteRef('refs/heads/main'))
    expect(await readFile(join(session, 'README.md'), 'utf8')).toBe('hello\nworld\n')
  })

  it('reports the default branch when none is requested', async () => {
    const r = await newOps().clone({ httpsUrl: remoteUrl, dir: session, token: TOKEN, branch: 'arc/x-0001' })
    expect(r.baseBranch).toBe('main')
  })

  it('uses a requested base branch', async () => {
    const seed = join(root, 'seed')
    git(seed, 'checkout', '-q', 'develop')
    await writeFile(join(seed, 'dev.txt'), 'dev\n')
    git(seed, 'add', '-A')
    git(seed, 'commit', '-m', 'dev work')
    git(seed, 'push', 'origin', 'develop')
    const r = await newOps().clone({ httpsUrl: remoteUrl, dir: session, token: TOKEN, branch: 'arc/x-0001', baseBranch: 'develop' })
    expect(r.baseBranch).toBe('develop')
    expect(r.head).toBe(remoteRef('refs/heads/develop'))
    expect(existsSync(join(session, 'dev.txt'))).toBe(true)
  })

  it('says so in plain words when the base branch does not exist', async () => {
    await expect(
      newOps().clone({ httpsUrl: remoteUrl, dir: session, token: TOKEN, branch: 'arc/x-0001', baseBranch: 'nope' }),
    ).rejects.toThrow(/branch "nope" does not exist/)
  })

  it('does not treat a tag as a base branch', async () => {
    git(join(root, 'seed'), 'tag', 'v1')
    git(join(root, 'seed'), 'push', 'origin', 'v1')
    await expect(
      newOps().clone({ httpsUrl: remoteUrl, dir: session, token: TOKEN, branch: 'arc/x-0001', baseBranch: 'v1' }),
    ).rejects.toThrow(/does not exist/)
  })

  it('leaves no token in .git/config and keeps the credential-free remote url', async () => {
    await started()
    const config = await readFile(join(session, '.git', 'config'), 'utf8')
    expect(config).not.toContain(TOKEN)
    expect(config).not.toContain(Buffer.from(TOKEN).toString('base64'))
    expect(git(session, 'config', '--local', 'remote.origin.url')).toBe(remoteUrl)
    expect(git(session, 'config', '--local', '--list')).not.toMatch(/token|password|@/i)
  })

  it.each([
    ['an unsafe arc branch', { httpsUrl: 'file:///x', branch: 'main' }, /branch name is not allowed/],
    ['a branch that tries a refspec', { httpsUrl: 'file:///x', branch: 'arc/x:refs/heads/main' }, /branch name is not allowed/],
    ['a dash-leading base branch', { httpsUrl: 'file:///x', branch: 'arc/x-1', baseBranch: '--upload-pack=touch /tmp/pwned' }, /base branch/],
    ['a revision-looking base branch', { httpsUrl: 'file:///x', branch: 'arc/x-1', baseBranch: 'main@{1}' }, /base branch/],
  ])('refuses %s before running git', async (_n, o, message) => {
    const rec = await recordingGit()
    await expect(newOps({ gitBin: rec.bin }).clone({ dir: session, token: TOKEN, ...o })).rejects.toThrow(message)
    expect(await rec.calls()).toHaveLength(0)
  })

  it.each([
    ['plain http', 'http://github.com/o/n'],
    ['credentials in the url', 'https://user:pw@github.com/o/n'],
    ['a query string', 'https://github.com/o/n?x=1'],
    ['an option-looking address', '--upload-pack=x'],
    ['an ext transport', 'ext::sh -c id'],
    ['an ssh address', 'ssh://git@github.com/o/n'],
    ['a file url when file remotes are off', 'file:///tmp/x'],
  ])('refuses %s as a remote', async (_n, url) => {
    const rec = await recordingGit()
    const ops = new CliGitOps({ workDir: work, gitBin: rec.bin })
    await expect(ops.clone({ httpsUrl: url, dir: session, token: TOKEN, branch: 'arc/x-0001' })).rejects.toThrow(/address/)
    expect(await rec.calls()).toHaveLength(0)
  })

  it('does not recurse into submodules', async () => {
    const sub = join(root, 'sub')
    await mkdir(sub)
    git(sub, 'init', '--initial-branch=main')
    await writeFile(join(sub, 'f.txt'), 'x')
    git(sub, 'add', '-A')
    git(sub, 'commit', '-m', 'sub')
    const seed = join(root, 'seed')
    git(seed, 'submodule', 'add', `file://${sub}`, 'vendor')
    git(seed, 'commit', '-m', 'add submodule')
    git(seed, 'push', 'origin', 'main')
    await started()
    expect(await readdir(join(session, 'vendor'))).toEqual([])
  })

  it('shows a plain error for a repository that does not exist, without the token', async () => {
    const err = await newOps()
      .clone({ httpsUrl: `file://${root}/missing.git`, dir: session, token: TOKEN, branch: 'arc/x-0001' })
      .catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain(TOKEN)
  })
})

describe('git child environment', () => {
  it('is built from scratch, gives the token to clone and push only, and never inherits server secrets', async () => {
    process.env.GITHUB_TOKEN = 'server-github-token'
    process.env.ARC_GIT_TOKEN = 'server-arc-token'
    process.env.ARC_SERVER_SECRET = 'server-secret'
    process.env.GIT_SSH_COMMAND = 'evil'
    const rec = await recordingGit()
    const ops = newOps({ gitBin: rec.bin })
    const { branch } = await started(ops)
    await writeFile(join(session, 'new.txt'), 'x\n')
    await push(ops, branch)
    await ops.diff({ dir: session, baseBranch: 'main', branch, pushedHead: null })

    const calls = await rec.calls()
    expect(calls.length).toBeGreaterThan(8)
    const expected = new Set([
      'PATH', 'HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT',
      'GIT_ASKPASS', 'LC_ALL', 'GIT_OPTIONAL_LOCKS',
    ])
    for (const c of calls) {
      const keys = Object.keys(c.env).filter((k) => !['PWD', 'OLDPWD', 'SHLVL', '_'].includes(k))
      const extra = keys.filter((k) => !expected.has(k) && k !== 'ARC_GIT_TOKEN')
      expect(extra, c.args).toEqual([])
      expect(c.env.HOME).toBe(join(work, 'home'))
      expect(c.env.GIT_CONFIG_GLOBAL).toBe('/dev/null')
      expect(c.env.GIT_CONFIG_NOSYSTEM).toBe('1')
      expect(c.env.GIT_TERMINAL_PROMPT).toBe('0')
      expect(c.env.GIT_ASKPASS).toBe(join(work, 'askpass.sh'))
      expect(c.env.LC_ALL).toBe('C')
      expect(c.env.GIT_OPTIONAL_LOCKS).toBe('0')
      if (c.sub === 'clone' || c.sub === 'push') expect(c.env.ARC_GIT_TOKEN, c.args).toBe(TOKEN)
      else expect(c.env.ARC_GIT_TOKEN, c.args).toBeUndefined()
    }
    expect(calls.filter((c) => c.sub === 'clone')).toHaveLength(1)
    expect(calls.filter((c) => c.sub === 'push')).toHaveLength(1)
    expect(calls.filter((c) => c.env.ARC_GIT_TOKEN !== undefined)).toHaveLength(2)
  })

  it('passes the hardening options on every call and never runs git through a shell', async () => {
    const rec = await recordingGit()
    const ops = newOps({ gitBin: rec.bin })
    const { branch } = await started(ops)
    await writeFile(join(session, 'new.txt'), 'x\n')
    await push(ops, branch)
    for (const c of await rec.calls()) {
      for (const flag of [
        'core.hooksPath=/dev/null', 'core.fsmonitor=false', 'core.sshCommand=false', 'credential.helper=',
        'protocol.allow=never', 'protocol.https.allow=always', 'commit.gpgsign=false', 'core.autocrlf=false',
      ]) {
        expect(c.args, flag).toContain(`-c ${flag}`)
      }
      expect(c.args).toContain('-c protocol.file.allow=always')
    }
    const clone = (await rec.calls()).find((c) => c.sub === 'clone')
    expect(clone?.args).toContain('--no-recurse-submodules')
  })

  it('does not allow the file protocol unless asked to', async () => {
    const rec = await recordingGit()
    const ops = new CliGitOps({ workDir: work, gitBin: rec.bin })
    await ops.clone({ httpsUrl: 'https://127.0.0.1:1/o/n', dir: session, token: TOKEN, branch: 'arc/x-0001' }).catch(() => undefined)
    const calls = await rec.calls()
    expect(calls.length).toBeGreaterThan(0)
    for (const c of calls) expect(c.args).not.toContain('protocol.file.allow')
  })

  it('creates an empty HOME and a private askpass script that answers username and password prompts', async () => {
    await started()
    expect(await readdir(join(work, 'home'))).toEqual([])
    const st = await stat(join(work, 'askpass.sh'))
    expect(st.mode & 0o777).toBe(0o700)
    const ask = (prompt: string) =>
      execFileSync(join(work, 'askpass.sh'), [prompt], { env: { PATH: cleanEnv.PATH, ARC_GIT_TOKEN: TOKEN }, encoding: 'utf8' }).trim()
    expect(ask("Username for 'https://github.com': ")).toBe('x-access-token')
    expect(ask("Password for 'https://x-access-token@github.com': ")).toBe(TOKEN)
  })

  it('keeps an existing askpass script instead of rewriting it', async () => {
    await mkdir(work, { recursive: true })
    await writeFile(join(work, 'askpass.sh'), '#!/bin/sh\necho custom\n', { mode: 0o700 })
    await started()
    expect(await readFile(join(work, 'askpass.sh'), 'utf8')).toContain('custom')
  })
})

describe('diff', () => {
  const diff = (ops: CliGitOps, branch: string, pushedHead: string | null = null) =>
    ops.diff({ dir: session, baseBranch: 'main', branch, pushedHead })

  it('is empty on a fresh clone', async () => {
    const { ops, branch } = await started()
    expect(await diff(ops, branch)).toEqual({ branch, baseBranch: 'main', files: [], uncommitted: false, ahead: 0, pushed: false })
  })

  it('lists modified, deleted, added, untracked and renamed files with statuses and line counts', async () => {
    const { ops, branch } = await started()
    await writeFile(join(session, 'README.md'), 'hello\nthere\nworld\nextra\n') // +2 -0... see below
    await rm(join(session, 'gone.txt'))
    await writeFile(join(session, 'added.txt'), 'a\nb\n')
    git(session, 'add', 'added.txt')
    await writeFile(join(session, 'untracked.txt'), 'one\ntwo\nthree')
    git(session, 'mv', 'src/old name.ts', 'src/new name.ts')
    const d = await diff(ops, branch)
    const by = Object.fromEntries(d.files.map((f) => [f.path, f]))
    expect(by['README.md']).toEqual({ path: 'README.md', status: 'modified', additions: 2, deletions: 0 })
    expect(by['gone.txt']).toEqual({ path: 'gone.txt', status: 'deleted', additions: 0, deletions: 1 })
    expect(by['added.txt']).toEqual({ path: 'added.txt', status: 'added', additions: 2, deletions: 0 })
    expect(by['untracked.txt']).toEqual({ path: 'untracked.txt', status: 'untracked', additions: 3, deletions: 0 })
    expect(by['src/new name.ts']).toEqual({ path: 'src/new name.ts', status: 'renamed', additions: 0, deletions: 0 })
    expect(by['src/old name.ts']).toBeUndefined()
    expect(d.uncommitted).toBe(true)
  })

  it('counts renames with edits and treats binary files as zero lines', async () => {
    const { ops, branch } = await started()
    git(session, 'mv', 'src/old name.ts', 'src/renamed.ts')
    await writeFile(join(session, 'src', 'renamed.ts'), 'line1\nline2\nline3\nline4\nline5\nCHANGED\nmore\n')
    await writeFile(join(session, 'bin.dat'), Buffer.from([0, 1, 2, 3, 0, 255]))
    git(session, 'add', 'bin.dat')
    await writeFile(join(session, 'raw.bin'), Buffer.from([0, 9, 9, 0]))
    const d = await diff(ops, branch)
    const by = Object.fromEntries(d.files.map((f) => [f.path, f]))
    expect(by['src/renamed.ts']).toMatchObject({ status: 'renamed', additions: 2, deletions: 1 })
    expect(by['bin.dat']).toEqual({ path: 'bin.dat', status: 'added', additions: 0, deletions: 0 })
    expect(by['raw.bin']).toEqual({ path: 'raw.bin', status: 'untracked', additions: 0, deletions: 0 })
  })

  it('handles paths with spaces, newlines, quotes and unicode', async () => {
    const { ops, branch } = await started()
    const names = ['with space.txt', 'new\nline.txt', 'quote"s.txt', 'ünï-日本語.txt', 'tab\there.txt']
    for (const n of names) await writeFile(join(session, n), 'x\ny\n')
    await writeFile(join(session, 'README.md'), 'changed\n')
    const d = await diff(ops, branch)
    const paths = d.files.map((f) => f.path)
    for (const n of names) expect(paths).toContain(n)
    expect(d.files.find((f) => f.path === 'new\nline.txt')).toMatchObject({ status: 'untracked', additions: 2 })
    expect(paths).toContain('README.md')
  })

  it('counts a file without a trailing newline and an empty file', async () => {
    const { ops, branch } = await started()
    await writeFile(join(session, 'a.txt'), 'x')
    await writeFile(join(session, 'empty.txt'), '')
    const by = Object.fromEntries((await diff(ops, branch)).files.map((f) => [f.path, f]))
    expect(by['a.txt'].additions).toBe(1)
    expect(by['empty.txt'].additions).toBe(0)
  })

  it('sees committed work on the branch as ahead, not uncommitted, and includes it in the file list', async () => {
    const { ops, branch } = await started()
    await writeFile(join(session, 'c.txt'), '1\n2\n3\n')
    git(session, 'add', '-A')
    git(session, 'commit', '-m', 'work')
    const d = await diff(ops, branch)
    expect(d.ahead).toBe(1)
    expect(d.uncommitted).toBe(false)
    expect(d.files).toEqual([{ path: 'c.txt', status: 'added', additions: 3, deletions: 0 }])
  })

  it('is pushed only when pushedHead equals HEAD and the tree is clean', async () => {
    const { ops, branch } = await started()
    await writeFile(join(session, 'c.txt'), 'x\n')
    const r = await push(ops, branch)
    expect((await diff(ops, branch, r.head)).pushed).toBe(true)
    expect((await diff(ops, branch, null)).pushed).toBe(false)
    expect((await diff(ops, branch, 'deadbeef')).pushed).toBe(false)
    await writeFile(join(session, 'd.txt'), 'dirty\n')
    expect((await diff(ops, branch, r.head)).pushed).toBe(false)
  })

  it('caps the file list at 500 files', async () => {
    const { ops, branch } = await started()
    await mkdir(join(session, 'many'))
    await Promise.all(Array.from({ length: 520 }, (_, i) => writeFile(join(session, 'many', `f${String(i).padStart(4, '0')}.txt`), 'x\n')))
    const d = await diff(ops, branch)
    expect(d.files).toHaveLength(500)
    expect(d.uncommitted).toBe(true)
    expect(d.files[0].path).toBe('many/f0000.txt')
  })

  it('does not run external diff drivers or the agent-controlled config for file lists', async () => {
    const { ops, branch } = await started()
    git(session, 'config', 'diff.external', `sh -c 'echo x > ${join(root, 'ran')}.marker'`)
    await writeFile(join(session, 'README.md'), 'changed\n')
    await diff(ops, branch)
    expect(existsSync(join(root, 'ran.marker'))).toBe(false)
  })
})

describe('commitAndPush', () => {
  it('commits and pushes to the arc branch on the remote and leaves the base branch alone', async () => {
    const { ops, branch } = await started()
    const mainBefore = remoteRef('refs/heads/main')
    await writeFile(join(session, 'feature.txt'), 'feature\n')
    await writeFile(join(session, 'README.md'), 'edited\n')
    const r = await push(ops, branch, 'arc: add feature')
    expect(r.pushed).toBe(true)
    expect(r.skipped).toEqual([])
    expect(r.commit).toMatch(/^[0-9a-f]{7,}$/)
    expect(r.head).toMatch(/^[0-9a-f]{40}$/)
    expect(r.head.startsWith(r.commit as string)).toBe(true)
    expect(remoteRef(`refs/heads/${branch}`)).toBe(r.head)
    expect(remoteRef('refs/heads/main')).toBe(mainBefore)
    expect(git(root, '--git-dir', remote, 'show', '--format=%an <%ae>|%cn <%ce>|%s', '-s', r.head)).toBe(
      'AIVEN ARC <arc@users.noreply.github.com>|AIVEN ARC <arc@users.noreply.github.com>|arc: add feature',
    )
    expect(git(root, '--git-dir', remote, 'show', `${r.head}:feature.txt`)).toBe('feature')
  })

  it('pushes again when there is nothing new to commit, reporting no commit', async () => {
    const { ops, branch } = await started()
    await writeFile(join(session, 'a.txt'), 'a\n')
    const first = await push(ops, branch)
    const second = await push(ops, branch)
    expect(second.commit).toBeNull()
    expect(second.pushed).toBe(true)
    expect(second.head).toBe(first.head)
    expect(remoteRef(`refs/heads/${branch}`)).toBe(first.head)
  })

  it('pushes commits the agent made itself', async () => {
    const { ops, branch } = await started()
    await writeFile(join(session, 'x.txt'), 'x\n')
    git(session, 'add', '-A')
    git(session, 'commit', '-m', 'by agent')
    const r = await push(ops, branch)
    expect(r.commit).toBeNull()
    expect(remoteRef(`refs/heads/${branch}`)).toBe(git(session, 'rev-parse', 'HEAD'))
  })

  it('leaves new secret-looking files out of the commit but keeps them on disk, and reports them', async () => {
    const { ops, branch } = await started()
    const secrets: Record<string, string | Buffer> = {
      '.env.local': 'A=1\n',
      'nested/.env': 'B=2\n',
      'server.pem': 'x',
      'tls/private.key': 'x',
      'cert.p12': 'x',
      'cert.PFX': 'x',
      'id_rsa': 'x',
      'id_rsa.pub': 'x',
      'id_ed25519': 'x',
      '.npmrc': '//registry:_authToken=abc\n',
      '.netrc': 'machine x\n',
      'credentials.json': '{}',
      'app.keystore': 'x',
      'notes.txt': 'see below\n-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----\n',
      'openssh.txt': '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n',
    }
    const fine: Record<string, string> = {
      'environment.ts': 'ok\n',
      'keyboard.ts': 'ok\n',
      'monkey': 'ok\n',
      'doc.md': 'a public key: -----BEGIN PUBLIC KEY-----\nabc\n',
      'dash.txt': '-----BEGIN something else-----\n',
      'my-credentials-notes.txt': 'ok\n',
    }
    for (const [n, c] of Object.entries({ ...secrets, ...fine })) {
      await mkdir(join(session, n, '..'), { recursive: true })
      await writeFile(join(session, n), c)
    }
    const r = await push(ops, branch)
    expect([...r.skipped].sort()).toEqual(Object.keys(secrets).sort())
    const tree = git(root, '--git-dir', remote, 'ls-tree', '-r', '--name-only', r.head).split('\n')
    for (const n of Object.keys(secrets)) {
      expect(tree, n).not.toContain(n)
      expect(existsSync(join(session, n)), n).toBe(true)
    }
    for (const n of Object.keys(fine)) expect(tree, n).toContain(n)
  })

  it('leaves out new files larger than 10 MB but pushes a file of exactly 10 MB', async () => {
    const { ops, branch } = await started()
    await writeFile(join(session, 'huge.bin'), Buffer.alloc(10 * 1024 * 1024 + 1, 1))
    await writeFile(join(session, 'limit.bin'), Buffer.alloc(10 * 1024 * 1024, 2))
    const r = await push(ops, branch)
    expect(r.skipped).toEqual(['huge.bin'])
    const tree = git(root, '--git-dir', remote, 'ls-tree', '-r', '--name-only', r.head).split('\n')
    expect(tree).toContain('limit.bin')
    expect(tree).not.toContain('huge.bin')
  })

  it('does not filter files that are already tracked and only modified', async () => {
    const { ops, branch } = await started()
    await writeFile(join(session, '.env'), 'TRACKED=2\n')
    const r = await push(ops, branch)
    expect(r.skipped).toEqual([])
    expect(git(root, '--git-dir', remote, 'show', `${r.head}:.env`)).toBe('TRACKED=2')
  })

  it('commits nothing when only secret-looking files are new, and still pushes', async () => {
    const { ops, branch, head } = await started()
    await writeFile(join(session, '.env.production'), 'X=1\n')
    const r = await push(ops, branch)
    expect(r.commit).toBeNull()
    expect(r.skipped).toEqual(['.env.production'])
    expect(r.head).toBe(head)
  })

  it('treats paths with glob characters literally when leaving files out', async () => {
    const { ops, branch } = await started()
    await writeFile(join(session, 'a.txt'), 'a\n')
    await writeFile(join(session, '[abc].pem'), 'x')
    await writeFile(join(session, '*.pem'), 'x')
    await writeFile(join(session, 'b.pem'), 'x')
    const r = await push(ops, branch)
    expect([...r.skipped].sort()).toEqual(['*.pem', '[abc].pem', 'b.pem'])
    const tree = git(root, '--git-dir', remote, 'ls-tree', '-r', '--name-only', r.head).split('\n')
    expect(tree).toContain('a.txt')
    expect(tree.filter((p) => p.endsWith('.pem'))).toEqual([])
  })

  it('does not unstage innocent files that a secret-looking file name would match as a glob', async () => {
    const { ops, branch } = await started()
    const key = '-----BEGIN PRIVATE KEY-----\nabc\n'
    await writeFile(join(session, 'a*.txt'), key)
    await writeFile(join(session, 'abc.txt'), 'innocent\n')
    await writeFile(join(session, 'abd.txt'), 'innocent\n')
    const r = await push(ops, branch)
    expect(r.skipped).toEqual(['a*.txt'])
    const tree = git(root, '--git-dir', remote, 'ls-tree', '-r', '--name-only', r.head).split('\n')
    expect(tree).toContain('abc.txt')
    expect(tree).toContain('abd.txt')
    expect(tree).not.toContain('a*.txt')
  })

  it('does not run hooks planted in .git/hooks', async () => {
    const { ops, branch } = await started()
    const marker = join(root, 'hook-ran')
    for (const h of ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'pre-push', 'pre-auto-gc', 'reference-transaction']) {
      const p = join(session, '.git', 'hooks', h)
      await writeFile(p, `#!/bin/sh\necho ${h} >> '${marker}'\n`)
      await chmod(p, 0o755)
    }
    await writeFile(join(session, 'x.txt'), 'x\n')
    const r = await push(ops, branch)
    expect(r.pushed).toBe(true)
    expect(existsSync(marker)).toBe(false)
  })

  it('never forces: a diverged remote branch makes the push fail with a plain message and stays untouched', async () => {
    const rec = await recordingGit()
    const { ops, branch } = await started(newOps({ gitBin: rec.bin }))
    const other = join(root, 'other')
    git(root, 'clone', '-q', remoteUrl, other)
    git(other, 'checkout', '-q', '-b', branch)
    await writeFile(join(other, 'theirs.txt'), 'theirs\n')
    git(other, 'add', '-A')
    git(other, 'commit', '-m', 'someone else')
    git(other, 'push', 'origin', branch)
    const theirs = remoteRef(`refs/heads/${branch}`)

    await writeFile(join(session, 'mine.txt'), 'mine\n')
    const err = await push(ops, branch).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/not a fast-forward/)
    expect((err as Error).message).toMatch(/never force-pushes/)
    expect((err as Error).message).not.toContain(TOKEN)
    expect(remoteRef(`refs/heads/${branch}`)).toBe(theirs)

    for (const c of (await rec.calls()).filter((x) => x.sub === 'push')) {
      expect(c.args).not.toMatch(/--force|\s-f\b|\+HEAD|--mirror|--delete|:refs\/heads\/main/)
      expect(c.args).toContain(`HEAD:refs/heads/${branch}`)
    }
  })

  it('pushes only HEAD:refs/heads/<branch> to the explicit url', async () => {
    const rec = await recordingGit()
    const { ops, branch } = await started(newOps({ gitBin: rec.bin }))
    await writeFile(join(session, 'x.txt'), 'x\n')
    await push(ops, branch)
    const pushes = (await rec.calls()).filter((c) => c.sub === 'push')
    expect(pushes).toHaveLength(1)
    expect(pushes[0].args).toMatch(new RegExp(`push --no-verify --no-recurse-submodules -- ${remoteUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} HEAD:refs/heads/${branch}$`))
  })

  it.each([
    ['main', 'the base branch'],
    ['arc', 'the bare prefix'],
    ['arc/x:refs/heads/main', 'a refspec with a destination'],
    ['+arc/x', 'a force refspec'],
    ['arc/../main', 'a path escape'],
    ['', 'an empty name'],
  ])('refuses to push %j (%s) before doing anything', async (bad) => {
    const rec = await recordingGit()
    const { ops } = await started(newOps({ gitBin: rec.bin }))
    const before = (await rec.calls()).length
    await writeFile(join(session, 'x.txt'), 'x\n')
    await expect(push(ops, bad)).rejects.toThrow(/branch name is not allowed/)
    expect((await rec.calls()).length).toBe(before)
    expect(git(session, 'status', '--porcelain')).toContain('x.txt')
  })

  it('refuses a remote url that is not the validated https address', async () => {
    const { ops, branch } = await started()
    await expect(
      ops.commitAndPush({ dir: session, httpsUrl: 'http://github.com/o/n', token: TOKEN, branch, message: 'm' }),
    ).rejects.toThrow(/address/)
  })

  it('falls back to a default commit message when none is given', async () => {
    const { ops, branch } = await started()
    await writeFile(join(session, 'x.txt'), 'x\n')
    const r = await push(ops, branch, '  \u0000 ')
    expect(git(root, '--git-dir', remote, 'show', '-s', '--format=%s', r.head)).toBe('arc: changes')
  })

  it('accepts harmless local settings the allow-list permits', async () => {
    const { ops, branch } = await started()
    git(session, 'config', '--local', 'user.name', 'Someone')
    git(session, 'config', '--local', 'user.email', 'someone@example.com')
    git(session, 'config', '--local', 'gc.auto', '0')
    git(session, 'config', '--local', 'branch.arc/other.remote', 'origin')
    git(session, 'config', '--local', 'branch.arc/other.merge', 'refs/heads/main')
    await writeFile(join(session, 'x.txt'), 'x\n')
    expect((await push(ops, branch)).pushed).toBe(true)
  })
})

describe('config tamper check', () => {
  const tampers: Array<[string, (dir: string) => unknown, RegExp]> = [
    ['url insteadOf rewriting the remote', (d) => git(d, 'config', '--local', 'url.https://evil.example/.insteadOf', 'https://github.com/'), /url\./],
    ['url pushInsteadOf', (d) => git(d, 'config', '--local', 'url.https://evil.example/.pushInsteadOf', 'file://'), /url\./],
    ['include.path', (d) => git(d, 'config', '--local', 'include.path', '/tmp/evil.cfg'), /include\.path/],
    ['includeIf.path', (d) => git(d, 'config', '--local', 'includeIf.gitdir:/.path', '/tmp/evil.cfg'), /includeif/i],
    ['credential.helper', (d) => git(d, 'config', '--local', 'credential.helper', '!echo pwned'), /credential\.helper/],
    ['a url-scoped credential helper', (d) => git(d, 'config', '--local', 'credential.https://github.com.helper', '!f'), /credential/],
    ['core.sshCommand', (d) => git(d, 'config', '--local', 'core.sshCommand', 'sh -c id'), /core\.sshcommand/],
    ['core.hooksPath', (d) => git(d, 'config', '--local', 'core.hooksPath', '/tmp/hooks'), /core\.hookspath/],
    ['core.fsmonitor', (d) => git(d, 'config', '--local', 'core.fsmonitor', 'sh -c id'), /core\.fsmonitor/],
    ['core.gitProxy', (d) => git(d, 'config', '--local', 'core.gitProxy', 'evil'), /core\.gitproxy/],
    ['core.askPass', (d) => git(d, 'config', '--local', 'core.askPass', '/tmp/evil'), /core\.askpass/],
    ['a different remote url', (d) => git(d, 'config', '--local', 'remote.origin.url', 'https://evil.example/o/n'), /remote address/],
    ['a second remote url', (d) => git(d, 'config', '--local', '--add', 'remote.origin.url', 'https://evil.example/o/n'), /remote address/],
    ['a removed remote url', (d) => git(d, 'config', '--local', '--unset', 'remote.origin.url'), /remote address/],
    ['a push url', (d) => git(d, 'config', '--local', 'remote.origin.pushurl', 'https://evil.example/o/n'), /remote\.origin\.pushurl/],
    ['a second remote', (d) => git(d, 'config', '--local', 'remote.evil.url', 'https://evil.example/o/n'), /remote\.evil\.url/],
    ['an http proxy', (d) => git(d, 'config', '--local', 'http.proxy', 'http://evil.example:3128'), /http\.proxy/],
    ['an extra http header', (d) => git(d, 'config', '--local', 'http.extraHeader', 'X: y'), /http\.extraheader/],
    ['a clean filter', (d) => git(d, 'config', '--local', 'filter.x.clean', 'sh -c id'), /filter\./],
    ['an alias', (d) => git(d, 'config', '--local', 'alias.push', '!sh -c id'), /alias\./],
    ['a pager', (d) => git(d, 'config', '--local', 'core.pager', 'sh -c id'), /core\.pager/],
    ['an extension', (d) => git(d, 'config', '--local', 'extensions.worktreeConfig', 'true'), /extensions\./],
    ['a worktree path', (d) => git(d, 'config', '--local', 'core.worktree', '/'), /core\.worktree/],
    ['a transfer protocol override', (d) => git(d, 'config', '--local', 'protocol.ext.allow', 'always'), /protocol\.ext\.allow/],
    ['a push default override', (d) => git(d, 'config', '--local', 'push.default', 'matching'), /push\.default/],
  ]

  it.each(tampers)('refuses to push when the config has %s, before any network call or staging', async (_n, tamper, key) => {
    const rec = await recordingGit()
    const askLog = join(root, 'askpass.log')
    await mkdir(work, { recursive: true })
    await writeFile(join(work, 'askpass.sh'), `#!/bin/sh\necho "$1" >> '${askLog}'\necho "$ARC_GIT_TOKEN" >> '${askLog}'\n`, { mode: 0o700 })
    const { ops, branch, head } = await started(newOps({ gitBin: rec.bin }))
    await writeFile(join(session, 'x.txt'), 'x\n')
    const callsBefore = (await rec.calls()).length
    await tamper(session)

    const err = await push(ops, branch).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    const message = (err as Error).message
    expect(message).toMatch(/^The repository settings were changed during the session, so ARC did not push\./)
    expect(message.toLowerCase()).toMatch(key)
    expect(message).not.toContain(TOKEN)

    const after = (await rec.calls()).slice(callsBefore)
    expect(after.map((c) => c.sub)).not.toContain('push')
    expect(after.map((c) => c.sub)).not.toContain('add')
    expect(after.map((c) => c.sub)).not.toContain('commit')
    expect(after.filter((c) => c.env.ARC_GIT_TOKEN !== undefined)).toEqual([])
    expect(after.some((c) => JSON.stringify(c.env).includes(TOKEN))).toBe(false)
    expect(existsSync(askLog)).toBe(false)
    expect(remoteRef(`refs/heads/${branch}`)).toBeNull()
    expect(git(session, 'rev-parse', 'HEAD')).toBe(head)
  })

  it('does not echo setting values, which may hold secrets', async () => {
    const { ops, branch } = await started()
    git(session, 'config', '--local', 'http.extraHeader', 'Authorization: Bearer super-secret-value-123')
    const err = await push(ops, branch).catch((e: Error) => e)
    expect((err as Error).message).not.toContain('super-secret-value')
  })

  it('refuses when .git was replaced by a gitfile pointing at another repository', async () => {
    const rec = await recordingGit()
    const { ops, branch } = await started(newOps({ gitBin: rec.bin }))
    const real = join(root, 'elsewhere.git')
    await rename(join(session, '.git'), real)
    await writeFile(join(session, '.git'), `gitdir: ${real}\n`)
    const callsBefore = (await rec.calls()).length
    const err = await push(ops, branch).catch((e: Error) => e)
    expect((err as Error).message).toMatch(/^The repository settings were changed during the session, so ARC did not push\./)
    expect((await rec.calls()).length).toBe(callsBefore)
    expect(remoteRef(`refs/heads/${branch}`)).toBeNull()
  })

  it('refuses when .git was replaced by a symlink to a directory', async () => {
    const rec = await recordingGit()
    const { ops, branch } = await started(newOps({ gitBin: rec.bin }))
    const real = join(root, 'elsewhere.git')
    await rename(join(session, '.git'), real)
    await symlink(real, join(session, '.git'))
    expect((await lstat(join(session, '.git'))).isSymbolicLink()).toBe(true)
    const callsBefore = (await rec.calls()).length
    await expect(push(ops, branch)).rejects.toThrow(/did not push/)
    expect((await rec.calls()).length).toBe(callsBefore)
    expect(remoteRef(`refs/heads/${branch}`)).toBeNull()
  })

  it('refuses when .git is gone', async () => {
    const { ops, branch } = await started()
    await rm(join(session, '.git'), { recursive: true })
    await expect(push(ops, branch)).rejects.toThrow(/did not push/)
  })

  it('checks the config again right before the push, in case it changed while staging and committing', async () => {
    const { branch } = await started()
    // The wrapper changes the config as the commit step starts, after the first check has passed.
    const bin = join(root, 'git-late')
    await writeFile(
      bin,
      `#!/bin/sh\ncase " $* " in *" commit "*) git -C '${session}' config --local url.https://evil.example/.insteadOf file:// ;; esac\nexec git "$@"\n`,
      { mode: 0o755 },
    )
    const late = newOps({ gitBin: bin })
    await writeFile(join(session, 'x.txt'), 'x\n')
    const err = await push(late, branch).catch((e: Error) => e)
    expect((err as Error).message).toMatch(/did not push/)
    expect(remoteRef(`refs/heads/${branch}`)).toBeNull()
  })
})

describe('the token never leaks', () => {
  async function leakyGit(onlyWhen: string): Promise<string> {
    const bin = join(root, `git-leaky-${onlyWhen}`)
    const body = [
      '#!/bin/sh',
      `case " $* " in *" ${onlyWhen} "*)`,
      '  b1=$(printf %s "$ARC_GIT_TOKEN" | base64 | tr -d "\\n")',
      '  b2=$(printf "x-access-token:%s" "$ARC_GIT_TOKEN" | base64 | tr -d "\\n")',
      '  echo "fatal: bad request for https://x-access-token:$ARC_GIT_TOKEN@github.com/o/n/ remote said token=$ARC_GIT_TOKEN basic=$b1 basic2=$b2" >&2',
      '  exit 128 ;;',
      'esac',
      'exec git "$@"',
      '',
    ].join('\n')
    await writeFile(bin, body, { mode: 0o755 })
    return bin
  }

  it('is redacted from clone errors, in plain and base64 form', async () => {
    const ops = newOps({ gitBin: await leakyGit('clone') })
    const err = await ops.clone({ httpsUrl: remoteUrl, dir: session, token: TOKEN, branch: 'arc/x-0001' }).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    const m = (err as Error).message
    expect(m).not.toContain(TOKEN)
    expect(m).not.toContain(Buffer.from(TOKEN).toString('base64'))
    expect(m).not.toContain(Buffer.from(`x-access-token:${TOKEN}`).toString('base64'))
    expect(m).toMatch(/Git failed while cloning/)
  })

  it('is redacted from push errors, in plain and base64 form', async () => {
    const good = await started()
    const ops = newOps({ gitBin: await leakyGit('push') })
    await writeFile(join(session, 'x.txt'), 'x\n')
    const err = await push(ops, good.branch).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    const m = (err as Error).message
    expect(m).not.toContain(TOKEN)
    expect(m).not.toContain(Buffer.from(TOKEN).toString('base64'))
    expect(m).not.toContain(Buffer.from(`x-access-token:${TOKEN}`).toString('base64'))
    expect(m).not.toMatch(/x-access-token:/)
  })

  it('is absent from the repository after a full session', async () => {
    const { ops, branch } = await started()
    await writeFile(join(session, 'x.txt'), 'x\n')
    await push(ops, branch)
    const files: string[] = []
    const walk = async (d: string): Promise<void> => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        const p = join(d, e.name)
        if (e.isDirectory()) await walk(p)
        else files.push(p)
      }
    }
    await walk(join(session, '.git'))
    for (const f of files) {
      const buf = await readFile(f)
      expect(buf.includes(TOKEN), f).toBe(false)
      expect(buf.includes(Buffer.from(TOKEN).toString('base64')), f).toBe(false)
    }
  })

  it('maps authentication failures to a plain message', async () => {
    const bin = join(root, 'git-auth')
    await writeFile(
      bin,
      `#!/bin/sh\ncase " $* " in *" push "*) echo "remote: Invalid username or password.\nfatal: Authentication failed for 'https://github.com/o/n/'" >&2; exit 128 ;; esac\nexec git "$@"\n`,
      { mode: 0o755 },
    )
    const { branch } = await started()
    const err = await push(newOps({ gitBin: bin }), branch).catch((e: Error) => e)
    expect((err as Error).message).toMatch(/did not accept the token/)
  })
})

describe('process handling', () => {
  it('stops git that runs too long and says so', async () => {
    const bin = join(root, 'git-slow')
    await writeFile(bin, '#!/bin/sh\nsleep 30\n', { mode: 0o755 })
    const ops = newOps({ gitBin: bin, timeouts: { cloneMs: 200 } })
    const t = Date.now()
    await expect(ops.clone({ httpsUrl: remoteUrl, dir: session, token: TOKEN, branch: 'arc/x-0001' })).rejects.toThrow(/took too long/)
    expect(Date.now() - t).toBeLessThan(5000)
  })

  it('reports a missing git binary in plain words', async () => {
    const ops = newOps({ gitBin: join(root, 'no-such-git') })
    await expect(ops.clone({ httpsUrl: remoteUrl, dir: session, token: TOKEN, branch: 'arc/x-0001' })).rejects.toThrow(/Git is not installed/)
  })
})
