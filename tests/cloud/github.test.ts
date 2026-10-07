import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RestGithubApi, checkGithubToken } from '../../src/main/cloud/github'

const TOKEN = 'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz'

interface Seen {
  method: string
  path: string
  query: URLSearchParams
  headers: IncomingMessage['headers']
  body: string
}

type Handler = (req: Seen, res: ServerResponse) => void

let server: Server
let base: string
let seen: Seen[]
let handler: Handler
const servers: Server[] = []

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

async function listen(h: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; base: string }> {
  const s = createServer(h)
  servers.push(s)
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  return { server: s, base: `http://127.0.0.1:${(s.address() as AddressInfo).port}` }
}

beforeEach(async () => {
  seen = []
  handler = (_req, res) => json(res, 500, { message: 'unset' })
  const l = await listen((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x')
      const s: Seen = { method: req.method ?? '', path: url.pathname, query: url.searchParams, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }
      seen.push(s)
      handler(s, res)
    })
  })
  server = l.server
  base = l.base
})

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => (s.closeAllConnections(), s.close(() => r())))))
})

const api = (extra: ConstructorParameters<typeof RestGithubApi>[0] = {}) => new RestGithubApi({ apiBase: base, ...extra })

const pr = {
  owner: 'octo',
  name: 'repo',
  token: TOKEN,
  head: 'arc/fix-ab12',
  base: 'main',
  title: 'Fix it',
}

async function messageOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(Error)
    return (e as Error).message
  }
  throw new Error('expected a rejection')
}

describe('getRepo', () => {
  it('reads the default branch, privacy and push permission with the exact request headers', async () => {
    handler = (_r, res) => json(res, 200, { default_branch: 'trunk', private: true, permissions: { admin: false, push: true, pull: true }, extra: 1 })
    const r = await api().getRepo({ owner: 'octo', name: 'repo', token: TOKEN })
    expect(r).toEqual({ defaultBranch: 'trunk', private: true, canPush: true })
    expect(seen).toHaveLength(1)
    expect(seen[0].method).toBe('GET')
    expect(seen[0].path).toBe('/repos/octo/repo')
    expect(seen[0].headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(seen[0].headers.accept).toBe('application/vnd.github+json')
    expect(seen[0].headers['x-github-api-version']).toBe('2022-11-28')
    expect(seen[0].headers['user-agent']).toBe('aiven-arc')
  })

  it('reports no push access when permissions are missing or push is false', async () => {
    handler = (_r, res) => json(res, 200, { default_branch: 'main', private: false })
    expect((await api().getRepo({ owner: 'o', name: 'r', token: TOKEN })).canPush).toBe(false)
    handler = (_r, res) => json(res, 200, { default_branch: 'main', private: false, permissions: { push: false } })
    expect((await api().getRepo({ owner: 'o', name: 'r', token: TOKEN })).canPush).toBe(false)
  })

  it('url-encodes owner and name so they cannot change the path', async () => {
    handler = (_r, res) => json(res, 200, { default_branch: 'main', private: false })
    await api().getRepo({ owner: 'a/../b', name: 'c?x=1#y', token: TOKEN })
    expect(seen[0].path).toBe('/repos/a%2F..%2Fb/c%3Fx%3D1%23y')
    expect(seen[0].query.size).toBe(0)
  })

  it('says the answer could not be read when the body is not what GitHub documents', async () => {
    handler = (_r, res) => json(res, 200, { nothing: true })
    expect(await messageOf(api().getRepo({ owner: 'o', name: 'r', token: TOKEN }))).toMatch(/could not read/i)
    handler = (_r, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('not json')
    }
    expect(await messageOf(api().getRepo({ owner: 'o', name: 'r', token: TOKEN }))).toMatch(/could not read/i)
  })

  it('works with a GitHub Enterprise style base path', async () => {
    handler = (_r, res) => json(res, 200, { default_branch: 'main', private: false })
    await new RestGithubApi({ apiBase: `${base}/api/v3/` }).getRepo({ owner: 'o', name: 'r', token: TOKEN })
    expect(seen[0].path).toBe('/api/v3/repos/o/r')
  })
})

describe('createPullRequest', () => {
  it('posts the pull request with the exact path, headers and body', async () => {
    handler = (_r, res) => json(res, 201, { number: 7, html_url: 'https://github.com/octo/repo/pull/7', draft: true })
    const r = await api().createPullRequest({ ...pr, body: 'Details', draft: true })
    expect(r).toEqual({ number: 7, url: 'https://github.com/octo/repo/pull/7', draft: true, existing: false })
    expect(seen).toHaveLength(1)
    expect(seen[0].method).toBe('POST')
    expect(seen[0].path).toBe('/repos/octo/repo/pulls')
    expect(seen[0].headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(seen[0].headers.accept).toBe('application/vnd.github+json')
    expect(seen[0].headers['x-github-api-version']).toBe('2022-11-28')
    expect(seen[0].headers['user-agent']).toBe('aiven-arc')
    expect(seen[0].headers['content-type']).toMatch(/^application\/json/)
    expect(JSON.parse(seen[0].body)).toEqual({ title: 'Fix it', head: 'arc/fix-ab12', base: 'main', body: 'Details', draft: true })
  })

  it('leaves out body and draft when they are not given', async () => {
    handler = (_r, res) => json(res, 201, { number: 8, html_url: 'https://github.com/octo/repo/pull/8' })
    const r = await api().createPullRequest(pr)
    expect(JSON.parse(seen[0].body)).toEqual({ title: 'Fix it', head: 'arc/fix-ab12', base: 'main' })
    expect(r).toMatchObject({ number: 8, draft: false, existing: false })
  })

  it('reuses the open pull request when GitHub says one already exists', async () => {
    handler = (req, res) => {
      if (req.method === 'POST') {
        json(res, 422, {
          message: 'Validation Failed',
          errors: [{ resource: 'PullRequest', code: 'custom', message: 'A pull request already exists for octo:arc/fix-ab12.' }],
        })
      } else {
        json(res, 200, [{ number: 5, html_url: 'https://github.com/octo/repo/pull/5', draft: false }])
      }
    }
    const r = await api().createPullRequest(pr)
    expect(r).toEqual({ number: 5, url: 'https://github.com/octo/repo/pull/5', draft: false, existing: true })
    expect(seen).toHaveLength(2)
    expect(seen[1].method).toBe('GET')
    expect(seen[1].path).toBe('/repos/octo/repo/pulls')
    expect(seen[1].query.get('head')).toBe('octo:arc/fix-ab12')
    expect(seen[1].query.get('state')).toBe('open')
    expect(seen[1].headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(seen[1].body).toBe('')
  })

  it('does not double the owner when head already names one', async () => {
    handler = (req, res) => {
      if (req.method === 'POST') json(res, 422, { message: 'Validation Failed', errors: [{ message: 'A pull request already exists for fork:arc/x.' }] })
      else json(res, 200, [{ number: 5, html_url: 'https://github.com/octo/repo/pull/5' }])
    }
    await api().createPullRequest({ ...pr, head: 'fork:arc/x' })
    expect(seen[1].query.get('head')).toBe('fork:arc/x')
  })

  it('says so when the pull request exists but cannot be found', async () => {
    handler = (req, res) => {
      if (req.method === 'POST') json(res, 422, { message: 'Validation Failed', errors: [{ message: 'A pull request already exists for octo:arc/x.' }] })
      else json(res, 200, [])
    }
    expect(await messageOf(api().createPullRequest(pr))).toMatch(/already exists/i)
  })

  it('explains other validation failures in plain words', async () => {
    handler = (_r, res) => json(res, 422, { message: 'Validation Failed', errors: [{ resource: 'PullRequest', code: 'custom', message: 'No commits between main and arc/fix-ab12' }] })
    const m = await messageOf(api().createPullRequest(pr))
    expect(m).toMatch(/could not create the pull request/i)
    expect(m).toContain('No commits between main and arc/fix-ab12')
  })

  it('url-encodes owner and name in the pull request path', async () => {
    handler = (_r, res) => json(res, 201, { number: 1, html_url: 'https://github.com/a/b/pull/1' })
    await api().createPullRequest({ ...pr, owner: 'a b', name: 'c/d' })
    expect(seen[0].path).toBe('/repos/a%20b/c%2Fd/pulls')
  })
})

describe('error mapping never leaks the token', () => {
  const calls: Array<[string, () => Promise<unknown>]> = [
    ['getRepo', () => api().getRepo({ owner: 'o', name: 'r', token: TOKEN })],
    ['createPullRequest', () => api().createPullRequest(pr)],
    ['checkGithubToken', () => checkGithubToken(TOKEN, { apiBase: base })],
  ]

  describe.each(calls)('%s', (_n, call) => {
    it('maps 401 to a rejected-token message', async () => {
      handler = (_r, res) => json(res, 401, { message: `Bad credentials ${TOKEN}` })
      const m = await messageOf(call())
      expect(m).toMatch(/^GitHub rejected the token\. /)
      expect(m).not.toContain(TOKEN)
      expect(m).not.toContain('Bad credentials')
    })

    it.each([403, 404])('maps %i to the cannot-see-or-change message', async (status) => {
      handler = (_r, res) => json(res, status, { message: `Resource not accessible by personal access token ${TOKEN}` })
      const m = await messageOf(call())
      expect(m).toBe('The token cannot see or change that repository (it needs Contents and Pull requests write access).')
    })

    it('maps 429 to a wait message', async () => {
      handler = (_r, res) => json(res, 429, { message: 'slow down' }, { 'retry-after': '30' })
      const m = await messageOf(call())
      expect(m).toMatch(/wait/i)
      expect(m).toMatch(/rate limit/i)
      expect(m).not.toContain(TOKEN)
    })

    it('maps a 403 rate limit to a wait message instead of a permission message', async () => {
      handler = (_r, res) => json(res, 403, { message: 'API rate limit exceeded for user ID 1.' }, { 'x-ratelimit-remaining': '0' })
      const m = await messageOf(call())
      expect(m).toMatch(/wait/i)
      expect(m).not.toMatch(/cannot see or change/)
    })

    it('maps a 403 secondary rate limit to a wait message', async () => {
      handler = (_r, res) => json(res, 403, { message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.' })
      expect(await messageOf(call())).toMatch(/wait/i)
    })

    it('maps a failed connection to "Could not reach GitHub"', async () => {
      const closed = await listen(() => undefined)
      const dead = closed.base
      await new Promise<void>((r) => closed.server.close(() => r()))
      const m = await messageOf(
        _n === 'getRepo'
          ? new RestGithubApi({ apiBase: dead }).getRepo({ owner: 'o', name: 'r', token: TOKEN })
          : _n === 'createPullRequest'
            ? new RestGithubApi({ apiBase: dead }).createPullRequest(pr)
            : checkGithubToken(TOKEN, { apiBase: dead }),
      )
      expect(m).toMatch(/^Could not reach GitHub/)
      expect(m).not.toContain(TOKEN)
    })

    it('gives the status for anything else, without the response body', async () => {
      handler = (_r, res) => {
        res.writeHead(502, 'Bad Gateway', { 'content-type': 'text/html' })
        res.end(`<html>${TOKEN}</html>`)
      }
      const m = await messageOf(call())
      expect(m).toMatch(/502/)
      expect(m).not.toContain(TOKEN)
      expect(m).not.toContain('<html>')
    })
  })

  it('redacts the token from a GitHub message that is passed on', async () => {
    handler = (_r, res) => json(res, 422, { message: 'Validation Failed', errors: [{ message: `weird echo of ${TOKEN} here` }] })
    const m = await messageOf(api().createPullRequest(pr))
    expect(m).not.toContain(TOKEN)
    expect(m).toContain('weird echo of')
  })

  it('does not put the token in a network error even when fetch throws it', async () => {
    const throwing = (async () => {
      throw new TypeError(`fetch failed: Bearer ${TOKEN}`, { cause: new Error(TOKEN) })
    }) as unknown as typeof fetch
    const m = await messageOf(new RestGithubApi({ apiBase: base, fetch: throwing }).getRepo({ owner: 'o', name: 'r', token: TOKEN }))
    expect(m).toMatch(/^Could not reach GitHub/)
    expect(m).not.toContain(TOKEN)
  })
})

describe('limits and safety', () => {
  it('stops reading a response larger than 1 MB', async () => {
    handler = (_r, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{"default_branch":"' + 'a'.repeat(512 * 1024))
      res.write('a'.repeat(600 * 1024))
      res.end('","private":false}')
    }
    expect(await messageOf(api().getRepo({ owner: 'o', name: 'r', token: TOKEN }))).toMatch(/too large/i)
  })

  it('accepts a response just under the cap', async () => {
    handler = (_r, res) => json(res, 200, { default_branch: 'a'.repeat(900 * 1024), private: false })
    const r = await api().getRepo({ owner: 'o', name: 'r', token: TOKEN })
    expect(r.defaultBranch).toHaveLength(900 * 1024)
  })

  it('gives up after the timeout and says GitHub could not be reached', async () => {
    handler = () => undefined
    const t = Date.now()
    const m = await messageOf(api({ timeoutMs: 150 }).getRepo({ owner: 'o', name: 'r', token: TOKEN }))
    expect(m).toMatch(/^Could not reach GitHub/)
    expect(m).toMatch(/too long|timed out/i)
    expect(Date.now() - t).toBeLessThan(3000)
  })

  it('does not send the token to another origin when GitHub redirects', async () => {
    const other = await listen((req, res) => {
      seenOther.push(String(req.headers.authorization ?? ''))
      json(res, 200, { default_branch: 'main', private: false })
    })
    const seenOther: string[] = []
    handler = (_r, res) => {
      res.writeHead(301, { location: `${other.base}/repos/o/r` })
      res.end()
    }
    await api().getRepo({ owner: 'o', name: 'r', token: TOKEN }).catch(() => undefined)
    expect(seenOther).toEqual([''])
  })

  it.each([
    ['a plain http address on a real host', 'http://api.github.com'],
    ['a file address', 'file:///etc'],
    ['something that is not a url', 'nope'],
    ['an address with credentials', 'https://user:pw@api.github.com'],
  ])('refuses %s as the api base', (_n, apiBase) => {
    expect(() => new RestGithubApi({ apiBase })).toThrow(/https/i)
  })

  it('allows http only for a loopback address (tests and local fakes)', () => {
    expect(() => new RestGithubApi({ apiBase: 'http://127.0.0.1:1234' })).not.toThrow()
    expect(() => new RestGithubApi({ apiBase: 'http://localhost:1234' })).not.toThrow()
  })

  it('defaults to api.github.com', async () => {
    let url = ''
    const fake = (async (u: string) => {
      url = u
      return new Response(JSON.stringify({ default_branch: 'main', private: false }), { status: 200 })
    }) as unknown as typeof fetch
    await new RestGithubApi({ fetch: fake }).getRepo({ owner: 'o', name: 'r', token: TOKEN })
    expect(url).toBe('https://api.github.com/repos/o/r')
  })

  it.each([
    ['empty', ''],
    ['with a newline', `${TOKEN}\nX-Evil: 1`],
    ['with a space', `${TOKEN} x`],
    ['with a control character', `${TOKEN}\u0000`],
  ])('refuses a token that is %s without making a request', async (_n, token) => {
    expect(await messageOf(api().getRepo({ owner: 'o', name: 'r', token }))).toMatch(/token/i)
    expect(await messageOf(checkGithubToken(token, { apiBase: base }))).toMatch(/token/i)
    expect(seen).toHaveLength(0)
  })
})

describe('checkGithubToken', () => {
  it('returns the login of the token owner from GET /user', async () => {
    handler = (_r, res) => json(res, 200, { login: 'octocat', id: 1, name: 'Mona' })
    expect(await checkGithubToken(TOKEN, { apiBase: base })).toEqual({ login: 'octocat' })
    expect(seen).toHaveLength(1)
    expect(seen[0].method).toBe('GET')
    expect(seen[0].path).toBe('/user')
    expect(seen[0].headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(seen[0].headers['user-agent']).toBe('aiven-arc')
    expect(seen[0].headers['x-github-api-version']).toBe('2022-11-28')
  })

  it('uses the injected fetch', async () => {
    let called = ''
    const fake = (async (u: string) => {
      called = u
      return new Response(JSON.stringify({ login: 'x' }), { status: 200 })
    }) as unknown as typeof fetch
    expect(await checkGithubToken(TOKEN, { fetch: fake })).toEqual({ login: 'x' })
    expect(called).toBe('https://api.github.com/user')
  })

  it('fails in plain words when GitHub answers without a login', async () => {
    handler = (_r, res) => json(res, 200, { id: 1 })
    expect(await messageOf(checkGithubToken(TOKEN, { apiBase: base }))).toMatch(/could not read/i)
  })
})
