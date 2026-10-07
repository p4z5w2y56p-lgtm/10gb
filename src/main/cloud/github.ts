import { z } from 'zod'
import type { PullRequestResult } from '../../shared/cloud'
import { redact } from '../safety/redact'
import type { GithubApi } from './protocol'

export interface GithubClientOptions {
  /** `https://api.github.com`, or `https://<host>/api/v3` for GitHub Enterprise. */
  apiBase?: string
  fetch?: typeof fetch
  /** Per request; default 20 s. */
  timeoutMs?: number
}

const DEFAULT_BASE = 'https://api.github.com'
const MAX_BODY_BYTES = 1024 * 1024
const DEFAULT_TIMEOUT_MS = 20_000

const RATE_LIMITED = 'GitHub is rate limiting ARC (too many requests). Wait a minute or two, then try again.'
const NO_ACCESS = 'The token cannot see or change that repository (it needs Contents and Pull requests write access).'

/** An answer ARC chose to report as is; anything else that fails is a network problem. */
class GithubError extends Error {}

interface Reply {
  status: number
  statusText: string
  headers: Headers
  text: string
}

const RepoReply = z.object({
  default_branch: z.string().min(1),
  private: z.boolean(),
  permissions: z.object({ push: z.boolean().optional() }).optional(),
})
const PullReply = z.object({ number: z.number().int(), html_url: z.string().min(1), draft: z.boolean().optional() })
const UserReply = z.object({ login: z.string().min(1) })

function checkBase(apiBase: string): string {
  const bad = new GithubError('The GitHub API address must be an https:// address.')
  let u: URL
  try {
    u = new URL(apiBase)
  } catch {
    throw bad
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) throw bad
  if (u.username || u.password || u.search || u.hash) throw bad
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
}

function checkToken(token: string): void {
  if (typeof token !== 'string' || !/^[\x21-\x7e]+$/.test(token)) {
    throw new GithubError('The GitHub token is empty or contains spaces or line breaks. Paste it again in Settings.')
  }
}

async function readCapped(res: Response): Promise<string> {
  const tooLarge = (): GithubError => new GithubError('GitHub sent an answer that was too large to read.')
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    await res.body?.cancel().catch(() => undefined)
    throw tooLarge()
  }
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw tooLarge()
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const unreadable = (): GithubError => new GithubError('GitHub sent an answer ARC could not read.')

class Http {
  private readonly base: string
  private readonly doFetch: typeof fetch
  private readonly timeoutMs: number

  constructor(opts: GithubClientOptions) {
    this.base = checkBase(opts.apiBase ?? DEFAULT_BASE)
    this.doFetch = opts.fetch ?? fetch
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async call(method: 'GET' | 'POST', path: string, token: string, body?: unknown): Promise<Reply> {
    checkToken(token)
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'aiven-arc',
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    try {
      const res = await this.doFetch(`${this.base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      let text: string
      try {
        text = await readCapped(res)
      } catch (e) {
        if (!(e instanceof GithubError) || res.ok) throw e
        text = ''
      }
      return { status: res.status, statusText: res.statusText, headers: res.headers, text }
    } catch (e) {
      if (e instanceof GithubError) throw e
      const slow = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
      throw new GithubError(slow ? 'Could not reach GitHub (it took too long to answer). Try again.' : 'Could not reach GitHub. Check the network and try again.')
    }
  }
}

/** GitHub's own message from an error body, with the token removed. */
function apiMessage(text: string, token: string): string {
  const j = parseJson(text) as { message?: unknown; errors?: Array<{ message?: unknown }> } | undefined
  const first = Array.isArray(j?.errors) ? j.errors.find((e) => typeof e?.message === 'string')?.message : undefined
  const msg = typeof first === 'string' ? first : typeof j?.message === 'string' ? j.message : ''
  return redact(msg, [token])
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 300)
}

/** Plain message for a non-2xx answer. Never includes the token or the raw body. */
function failure(r: Reply): GithubError {
  if (r.status === 401) return new GithubError('GitHub rejected the token. It may be wrong, expired or revoked. Create a new one and save it in Settings.')
  const limited =
    r.status === 429 ||
    (r.status === 403 && (r.headers.get('x-ratelimit-remaining') === '0' || /rate limit|abuse/i.test(r.text)))
  if (limited) return new GithubError(RATE_LIMITED)
  if (r.status === 403 || r.status === 404) return new GithubError(NO_ACCESS)
  return new GithubError(`GitHub answered with an error (${r.status}${r.statusText ? ` ${r.statusText}` : ''}).`)
}

const enc = encodeURIComponent

export class RestGithubApi implements GithubApi {
  private readonly http: Http

  constructor(opts: GithubClientOptions = {}) {
    this.http = new Http(opts)
  }

  async getRepo(o: { owner: string; name: string; token: string }): Promise<{ defaultBranch: string; private: boolean; canPush: boolean }> {
    const r = await this.http.call('GET', `/repos/${enc(o.owner)}/${enc(o.name)}`, o.token)
    if (r.status !== 200) throw failure(r)
    const p = RepoReply.safeParse(parseJson(r.text))
    if (!p.success) throw unreadable()
    return { defaultBranch: p.data.default_branch, private: p.data.private, canPush: p.data.permissions?.push === true }
  }

  async createPullRequest(o: {
    owner: string
    name: string
    token: string
    head: string
    base: string
    title: string
    body?: string
    draft?: boolean
  }): Promise<PullRequestResult> {
    const path = `/repos/${enc(o.owner)}/${enc(o.name)}/pulls`
    const payload: Record<string, unknown> = { title: o.title, head: o.head, base: o.base }
    if (o.body !== undefined) payload.body = o.body
    if (o.draft !== undefined) payload.draft = o.draft
    const r = await this.http.call('POST', path, o.token, payload)

    if (r.status === 201 || r.status === 200) {
      const p = PullReply.safeParse(parseJson(r.text))
      if (!p.success) throw unreadable()
      return { number: p.data.number, url: p.data.html_url, draft: p.data.draft === true, existing: false }
    }
    if (r.status === 422) {
      if (/pull request already exists/i.test(r.text)) return this.findOpen(o, path)
      const why = apiMessage(r.text, o.token)
      throw new GithubError(`GitHub could not create the pull request${why ? `: ${why}` : '.'}`)
    }
    throw failure(r)
  }

  private async findOpen(o: { owner: string; head: string; token: string }, path: string): Promise<PullRequestResult> {
    const head = o.head.includes(':') ? o.head : `${o.owner}:${o.head}`
    const q = new URLSearchParams({ head, state: 'open' })
    const r = await this.http.call('GET', `${path}?${q.toString()}`, o.token)
    if (r.status !== 200) throw failure(r)
    const list = parseJson(r.text)
    const first = z.array(PullReply).safeParse(list)
    const hit = first.success ? first.data[0] : undefined
    if (!hit) throw new GithubError('A pull request for this branch already exists, but ARC could not find it. Open the repository on GitHub to see it.')
    return { number: hit.number, url: hit.html_url, draft: hit.draft === true, existing: true }
  }
}

/** Checks a token against `GET /user` and returns the login it belongs to. */
export async function checkGithubToken(token: string, opts: { apiBase?: string; fetch?: typeof fetch } = {}): Promise<{ login: string }> {
  const r = await new Http(opts).call('GET', '/user', token)
  if (r.status !== 200) throw failure(r)
  const p = UserReply.safeParse(parseJson(r.text))
  if (!p.success) throw unreadable()
  return { login: p.data.login }
}
