import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startWorker, type WorkerHandle } from '../../src/cloud/main'
import type { GitOps, GithubApi } from '../../src/main/cloud/protocol'
import { SettingsSchema } from '../../src/main/store/settings'

const TOKEN = 'SENTINEL-worker-token-' + 'f0e1d2c3'.repeat(4)
const git: GitOps = {
  async clone(o) {
    await mkdir(o.dir, { recursive: true })
    return { baseBranch: o.baseBranch ?? 'main', head: '0000000' }
  },
  async commitAndPush() {
    return { commit: null, pushed: false, skipped: [], head: '0000000' }
  },
  async diff(o) {
    return { branch: o.branch, baseBranch: o.baseBranch, files: [], uncommitted: false, ahead: 0, pushed: false }
  },
}
const github: GithubApi = {
  async getRepo() {
    return { defaultBranch: 'main', private: false, canPush: true }
  },
  async createPullRequest(o) {
    return { number: 1, url: `https://github.com/${o.owner}/${o.name}/pull/1`, draft: false, existing: false }
  },
}

let handle: WorkerHandle | undefined
let dir = ''
afterEach(async () => {
  await handle?.stop()
  handle = undefined
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = ''
})

async function start(env: Record<string, string | undefined>, logs: string[] = []): Promise<WorkerHandle> {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'arc-main-')))
  const full: NodeJS.ProcessEnv = { PORT: '0', ARC_CLOUD_TOKEN: TOKEN, ARC_DATA_DIR: join(dir, 'data'), ...env }
  handle = await startWorker(full, { git, github, log: (l) => logs.push(l) })
  return handle
}
const url = (h: WorkerHandle, path: string) => `http://127.0.0.1:${h.port}${path}`
const auth = { authorization: `Bearer ${TOKEN}` }
const createBody = (repo = 'octo/hello') => ({
  repo,
  settings: SettingsSchema.parse({ prompter: { mode: 'off' } }),
  secrets: { apiKey: 'SENTINEL-vertex-key-9f3a1c77', githubToken: 'SENTINEL-github-token-4be2d0c1' },
})
const post = (h: WorkerHandle, path: string, body: unknown) =>
  fetch(url(h, path), { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('startWorker', () => {
  it('refuses to start without a token or with one shorter than 32 characters, naming the rule and not the value', async () => {
    const untouched = join(tmpdir(), `arc-main-untouched-${process.pid}`, 'data')
    for (const token of [undefined, '', 'short-token', 'x'.repeat(31)]) {
      const env = { PORT: '0', ...(token === undefined ? {} : { ARC_CLOUD_TOKEN: token }), ARC_DATA_DIR: untouched }
      const err = await startWorker(env, { git, github, log: () => {} }).catch((e) => e)
      expect(err).toBeInstanceOf(Error)
      expect(String(err.message)).toMatch(/ARC_CLOUD_TOKEN/)
      expect(String(err.message)).toMatch(/32/)
      if (token) expect(String(err.message)).not.toContain(token)
    }
    await expect(stat(untouched)).rejects.toThrow()
  })

  it('reads the token from ARC_CLOUD_TOKEN_FILE, trimmed, and prefers it over ARC_CLOUD_TOKEN', async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'arc-main-')))
    const file = join(dir, 'arc-token')
    const FILE_TOKEN = 'FILE-token-' + 'a1b2c3d4'.repeat(4)
    await writeFile(file, `${FILE_TOKEN}\n`)
    const env: NodeJS.ProcessEnv = { PORT: '0', ARC_CLOUD_TOKEN_FILE: file, ARC_CLOUD_TOKEN: TOKEN, ARC_DATA_DIR: join(dir, 'data') }
    handle = await startWorker(env, { git, github, log: () => {} })
    expect((await fetch(url(handle, '/v1/sessions'), { headers: { authorization: `Bearer ${FILE_TOKEN}` } })).status).toBe(200)
    expect((await fetch(url(handle, '/v1/sessions'), { headers: auth })).status).toBe(401)
    expect(env.ARC_CLOUD_TOKEN).toBeUndefined()
    expect(JSON.stringify(env)).not.toContain(TOKEN)
  })

  it('works with only ARC_CLOUD_TOKEN_FILE set, and reads the file once', async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'arc-main-')))
    const file = join(dir, 'arc-token')
    await writeFile(file, `  ${TOKEN}\r\n`)
    handle = await startWorker({ PORT: '0', ARC_CLOUD_TOKEN_FILE: file, ARC_DATA_DIR: join(dir, 'data') }, { git, github, log: () => {} })
    await rm(file)
    expect((await fetch(url(handle, '/v1/sessions'), { headers: auth })).status).toBe(200)
  })

  it('rejects an unreadable, missing, empty or too short token file without echoing its content, and does not fall back to the env token', async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'arc-main-')))
    const short = join(dir, 'short')
    await writeFile(short, 'SECRETSHORT-' + 'z'.repeat(10) + '\n')
    const empty = join(dir, 'empty')
    await writeFile(empty, '\n')
    for (const file of [join(dir, 'missing'), dir, short, empty]) {
      const err = await startWorker({ PORT: '0', ARC_CLOUD_TOKEN_FILE: file, ARC_CLOUD_TOKEN: TOKEN, ARC_DATA_DIR: join(dir, 'data') }, { git, github, log: () => {} }).catch((e) => e)
      expect(err, file).toBeInstanceOf(Error)
      expect(String(err.message)).toMatch(/ARC_CLOUD_TOKEN_FILE/)
      expect(String(err.message)).not.toContain('SECRETSHORT')
      expect(String(err.message)).not.toContain(TOKEN)
    }
    await expect(stat(join(dir, 'data'))).rejects.toThrow()
  })

  it('treats an empty ARC_CLOUD_TOKEN_FILE setting as unset', async () => {
    const h = await start({ ARC_CLOUD_TOKEN_FILE: '  ' })
    expect((await fetch(url(h, '/v1/sessions'), { headers: auth })).status).toBe(200)
  })

  it('accepts a token of exactly 32 characters', async () => {
    const h = await start({ ARC_CLOUD_TOKEN: 'y'.repeat(32) })
    expect((await fetch(url(h, '/health'))).status).toBe(200)
  })

  it('starts, answers /health and requires the token elsewhere', async () => {
    const h = await start({})
    const health = await fetch(url(h, '/health'))
    expect(await health.text()).toBe('{"ok":true}')
    expect((await fetch(url(h, '/v1/sessions'))).status).toBe(401)
    const list = await fetch(url(h, '/v1/sessions'), { headers: auth })
    expect(await list.json()).toEqual([])
  })

  it('deletes the token from the environment after reading it, so child processes cannot inherit it', async () => {
    const env: NodeJS.ProcessEnv = { PORT: '0', ARC_CLOUD_TOKEN: TOKEN, ARC_DATA_DIR: join(await realpath(tmpdir()), `arc-main-env-${process.pid}`) }
    dir = env.ARC_DATA_DIR!
    handle = await startWorker(env, { git, github, log: () => {} })
    expect(env.ARC_CLOUD_TOKEN).toBeUndefined()
    expect(JSON.stringify(env)).not.toContain(TOKEN)
    expect((await fetch(url(handle, '/v1/sessions'), { headers: auth })).status).toBe(200)
  })

  it('creates the data directory and never logs the token', async () => {
    const logs: string[] = []
    const h = await start({}, logs)
    await h.stop()
    handle = undefined
    expect((await stat(join(dir, 'data'))).isDirectory()).toBe(true)
    expect(logs.length).toBeGreaterThan(0)
    expect(logs.join('\n')).not.toContain(TOKEN)
  })

  it('rejects unusable settings with a plain message', async () => {
    for (const env of [{ PORT: 'abc' }, { PORT: '70000' }, { ARC_MAX_SESSIONS: '0' }, { ARC_MAX_SESSIONS: 'many' }, { ARC_IDLE_HOURS: '-1' }, { ARC_IDLE_HOURS: 'x' }, { ARC_GITHUB_HOSTS: ' , ' }]) {
      const err = await startWorker({ ARC_CLOUD_TOKEN: TOKEN, ARC_DATA_DIR: join(tmpdir(), 'arc-main-never'), ...env, ...(env.PORT ? {} : { PORT: '0' }) }, { git, github, log: () => {} }).catch((e) => e)
      expect(err, JSON.stringify(env)).toBeInstanceOf(Error)
      expect(String(err.message)).toMatch(/PORT|ARC_MAX_SESSIONS|ARC_IDLE_HOURS|ARC_GITHUB_HOSTS/)
      expect(String(err.message)).not.toContain(TOKEN)
    }
  })

  it('applies ARC_MAX_SESSIONS', async () => {
    const h = await start({ ARC_MAX_SESSIONS: '1' })
    expect((await post(h, '/v1/sessions', createBody())).status).toBe(200)
    expect((await post(h, '/v1/sessions', createBody())).status).toBe(429)
  })

  it('applies ARC_GITHUB_HOSTS, so an Enterprise host is accepted only when listed', async () => {
    const h = await start({ ARC_GITHUB_HOSTS: 'ghe.example.com' })
    expect((await post(h, '/v1/sessions', createBody('https://ghe.example.com/octo/hello'))).status).toBe(200)
    expect((await post(h, '/v1/sessions', createBody('https://github.com/octo/hello'))).status).toBe(400)
  })

  it('removes work and session directories left by a previous run', async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'arc-main-')))
    const ghost = '22222222-2222-4222-8222-222222222222'
    await mkdir(join(dir, 'data', 'work', ghost, 'repo'), { recursive: true })
    await writeFile(join(dir, 'data', 'work', ghost, 'repo', 'old.txt'), 'x')
    await mkdir(join(dir, 'data', 'sessions', ghost), { recursive: true })
    handle = await startWorker({ PORT: '0', ARC_CLOUD_TOKEN: TOKEN, ARC_DATA_DIR: join(dir, 'data') }, { git, github, log: () => {} })
    await expect(stat(join(dir, 'data', 'work', ghost))).rejects.toThrow()
    await expect(stat(join(dir, 'data', 'sessions', ghost))).rejects.toThrow()
  })

  it('stop() ends open event streams and closes the server promptly', async () => {
    const h = await start({})
    const created = await (await post(h, '/v1/sessions', createBody())).json()
    const ctl = new AbortController()
    const res = await fetch(url(h, `/v1/sessions/${created.id}/events`), { headers: auth, signal: ctl.signal })
    expect(res.status).toBe(200)
    const reading = res.body!.getReader()
    const drained = (async () => {
      for (;;) if ((await reading.read().catch(() => ({ done: true }))).done) return
    })()
    const t0 = Date.now()
    await h.stop()
    handle = undefined
    await drained
    expect(Date.now() - t0).toBeLessThan(5000)
    await expect(fetch(url(h, '/health'))).rejects.toThrow()
  })
})
