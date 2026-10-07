import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'

export interface GhRequest {
  method: string
  path: string
  query: URLSearchParams
  headers: IncomingHttpHeaders
  body: unknown
}

export interface GhPull {
  number: number
  owner: string
  name: string
  head: string
  base: string
  title: string
  body?: string
  draft: boolean
  state: 'open' | 'closed'
}

export interface FakeGithub {
  /** `http://127.0.0.1:<port>`; hand it to RestGithubApi as `apiBase`. */
  url: string
  requests: GhRequest[]
  pulls: GhPull[]
  /** The only token accepted; change it to simulate a rotated token. */
  token: string
  /** Flip to simulate a token without push rights. */
  canPush: boolean
  close(): Promise<void>
}

export interface FakeGithubOptions {
  /** The only token this fake accepts. */
  token: string
  /** `owner/name` slugs that exist. */
  repos: string[]
  defaultBranch?: string
  /** Real GitHub refuses a pull request whose head branch is not on the remote. */
  branchExists: (owner: string, name: string, branch: string) => boolean
}

/** Just enough of the GitHub REST API for RestGithubApi: GET /user, GET /repos/o/r, GET and POST /repos/o/r/pulls. */
export async function startFakeGithub(o: FakeGithubOptions): Promise<FakeGithub> {
  const requests: GhRequest[] = []
  const pulls: GhPull[] = []
  const sockets = new Set<Socket>()
  const state = { canPush: true, token: o.token }

  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const piece of req) raw += piece
    const u = new URL(req.url ?? '/', 'http://fake')
    let body: unknown
    try {
      body = raw ? JSON.parse(raw) : undefined
    } catch {
      body = raw
    }
    requests.push({ method: req.method ?? 'GET', path: u.pathname, query: u.searchParams, headers: req.headers, body })

    const send = (status: number, json: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(json))
    }
    if (req.headers.authorization !== `Bearer ${state.token}`) return send(401, { message: 'Bad credentials' })

    const method = req.method ?? 'GET'
    if (method === 'GET' && u.pathname === '/user') return send(200, { login: 'octocat' })

    const m = /^\/repos\/([^/]+)\/([^/]+)(\/pulls)?$/.exec(u.pathname)
    if (!m || !o.repos.includes(`${m[1]}/${m[2]}`)) return send(404, { message: 'Not Found' })
    const [, owner, name, isPulls] = m

    if (!isPulls && method === 'GET') {
      return send(200, { default_branch: o.defaultBranch ?? 'main', private: true, permissions: { push: state.canPush } })
    }
    if (isPulls && method === 'GET') {
      const head = u.searchParams.get('head') ?? ''
      const want = u.searchParams.get('state') ?? 'open'
      const hits = pulls.filter((p) => p.owner === owner && p.name === name && p.state === want && `${owner}:${p.head}` === head)
      return send(200, hits.map((p) => ({ number: p.number, html_url: `https://github.com/${owner}/${name}/pull/${p.number}`, draft: p.draft })))
    }
    if (isPulls && method === 'POST') {
      const b = (body ?? {}) as { title?: string; head?: string; base?: string; body?: string; draft?: boolean }
      if (!b.title || !b.head || !b.base) return send(422, { message: 'Validation Failed', errors: [{ resource: 'PullRequest', code: 'missing_field' }] })
      if (pulls.some((p) => p.owner === owner && p.name === name && p.head === b.head && p.state === 'open')) {
        return send(422, {
          message: 'Validation Failed',
          errors: [{ resource: 'PullRequest', code: 'custom', message: `A pull request already exists for ${owner}:${b.head}.` }],
        })
      }
      if (!o.branchExists(owner, name, b.head)) {
        return send(422, { message: 'Validation Failed', errors: [{ resource: 'PullRequest', field: 'head', code: 'invalid' }] })
      }
      const pr: GhPull = {
        number: pulls.length + 1,
        owner,
        name,
        head: b.head,
        base: b.base,
        title: b.title,
        ...(b.body !== undefined ? { body: b.body } : {}),
        draft: b.draft === true,
        state: 'open',
      }
      pulls.push(pr)
      return send(201, { number: pr.number, html_url: `https://github.com/${owner}/${name}/pull/${pr.number}`, draft: pr.draft })
    }
    return send(404, { message: 'Not Found' })
  })
  server.on('connection', (s) => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    url,
    requests,
    pulls,
    get token() {
      return state.token
    },
    set token(v: string) {
      state.token = v
    },
    get canPush() {
      return state.canPush
    },
    set canPush(v: boolean) {
      state.canPush = v
    },
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy()
        server.close(() => r())
      }),
  }
}
