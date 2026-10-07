import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudClient, CloudError } from '../../src/main/cloud/client'
import { SseParser, type SseMessage } from '../../src/main/cloud/sseParser'
import type { CreateSessionBody } from '../../src/main/cloud/protocol'
import { SettingsSchema } from '../../src/main/store/settings'
import type { CloudDiff, CloudSessionInfo, PullRequestResult, PushResult } from '../../src/shared/cloud'
import type { AgentEvent } from '../../src/shared/types'

const TOKEN = 'tok_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6'
const BASE = 'https://arc.example.com'
const ID = '11111111-1111-1111-1111-111111111111'
const INFO: CloudSessionInfo = {
  id: ID,
  repo: 'octo/demo',
  branch: 'arc/demo-ab12',
  baseBranch: 'main',
  busy: false,
  mode: 'ask',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastActiveAt: '2026-01-01T00:00:00.000Z',
  pushed: false,
}
const DIFF: CloudDiff = { branch: INFO.branch, baseBranch: 'main', files: [], uncommitted: false, ahead: 0, pushed: false }
const PUSH: PushResult = { branch: INFO.branch, commit: 'abc1234', pushed: true, skipped: [], url: 'https://github.com/octo/demo/tree/arc/demo-ab12' }
const PR: PullRequestResult = { number: 7, url: 'https://github.com/octo/demo/pull/7', draft: false, existing: false }
const CREATE: CreateSessionBody = {
  repo: 'octo/demo',
  settings: SettingsSchema.parse({}),
  secrets: { apiKey: 'vertex-key-value', githubToken: 'gh-token-value' },
  autoPush: true,
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

function client(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof CloudClient>[0]> = {}) {
  return new CloudClient({ baseUrl: BASE, token: TOKEN, fetch: fetchImpl, sleep: async () => {}, ...extra })
}

function fetchMock(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit; headers: Headers }> = []
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const i = init ?? {}
    calls.push({ url, init: i, headers: new Headers(i.headers) })
    return respond(url, i)
  })
  return { fetch: fn as unknown as typeof fetch, calls }
}

async function rejection(p: Promise<unknown>): Promise<CloudError> {
  try {
    await p
  } catch (err) {
    expect(err).toBeInstanceOf(CloudError)
    return err as CloudError
  }
  throw new Error('expected the call to fail')
}

// ------------------------------------------------------------------ URL validation

describe('CloudClient constructor', () => {
  const ok: Array<[string, string]> = [
    ['https://arc.example.com', 'https://arc.example.com'],
    ['https://arc.example.com/', 'https://arc.example.com'],
    ['https://arc.example.com///', 'https://arc.example.com'],
    ['https://arc.example.com:8443', 'https://arc.example.com:8443'],
    ['https://arc.example.com/prefix/', 'https://arc.example.com/prefix'],
    ['http://localhost:8080', 'http://localhost:8080'],
    ['http://127.0.0.1:3000/', 'http://127.0.0.1:3000'],
    ['http://[::1]:3000', 'http://[::1]:3000'],
    ['  https://arc.example.com  ', 'https://arc.example.com'],
  ]
  it.each(ok)('accepts %s and normalizes it to %s', (input, expected) => {
    expect(new CloudClient({ baseUrl: input, token: TOKEN }).baseUrl).toBe(expected)
  })

  const bad: Array<[string, RegExp]> = [
    ['', /address/i],
    ['not a url', /address/i],
    ['arc.example.com', /address/i],
    ['ftp://arc.example.com', /https/i],
    ['file:///etc/passwd', /https/i],
    ['http://arc.example.com', /unencrypted/i],
    ['http://10.0.0.5:8080', /unencrypted/i],
    ['http://localhost.evil.com', /unencrypted/i],
    ['https://user:pw@arc.example.com', /username or password/i],
    ['https://user@arc.example.com', /username or password/i],
    ['https://arc.example.com/?token=1', /query/i],
    ['https://arc.example.com/#frag', /fragment/i],
  ]
  it.each(bad)('refuses %j in plain language', (input, message) => {
    expect(() => new CloudClient({ baseUrl: input, token: TOKEN })).toThrow(message)
  })

  it('never repeats a password from the URL in its error', () => {
    try {
      new CloudClient({ baseUrl: 'https://admin:hunter2-secret@arc.example.com', token: TOKEN })
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as Error).message).not.toContain('hunter2-secret')
    }
  })

  it('refuses a token that cannot go in a header, without echoing it', () => {
    const odd = 'has space ' + TOKEN
    try {
      new CloudClient({ baseUrl: BASE, token: odd })
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as Error).message).toMatch(/token/i)
      expect((err as Error).message).not.toContain(TOKEN)
    }
  })
})

// ------------------------------------------------------------------ requests

describe('CloudClient requests', () => {
  const cases: Array<[string, (c: CloudClient) => Promise<unknown>, string, string, unknown, unknown]> = [
    ['list', (c) => c.list(), 'GET', '/v1/sessions', undefined, [INFO]],
    ['create', (c) => c.create(CREATE), 'POST', '/v1/sessions', CREATE, INFO],
    ['get', (c) => c.get(ID), 'GET', `/v1/sessions/${ID}`, undefined, INFO],
    ['remove', (c) => c.remove(ID), 'DELETE', `/v1/sessions/${ID}`, undefined, { ok: true }],
    ['putSecrets', (c) => c.putSecrets(ID, { apiKey: 'k-new' }), 'PUT', `/v1/sessions/${ID}/secrets`, { apiKey: 'k-new' }, { ok: true }],
    ['history', (c) => c.history(ID), 'GET', `/v1/sessions/${ID}/history`, undefined, { history: [], seq: 3 }],
    ['diff', (c) => c.diff(ID), 'GET', `/v1/sessions/${ID}/diff`, undefined, DIFF],
    ['push', (c) => c.push(ID), 'POST', `/v1/sessions/${ID}/push`, undefined, PUSH],
    ['pr', (c) => c.pr(ID, { title: 'T', draft: true }), 'POST', `/v1/sessions/${ID}/pr`, { title: 'T', draft: true }, PR],
    ['invoke', (c) => c.invoke(ID, 'agent:stop'), 'POST', `/v1/sessions/${ID}/invoke`, { channel: 'agent:stop' }, { ok: true, data: null }],
  ]
  it.each(cases)('%s sends the documented request with the bearer token', async (_n, call, method, path, body, reply) => {
    const { fetch, calls } = fetchMock(() => json(reply))
    await call(client(fetch))
    expect(calls).toHaveLength(1)
    const c = calls[0]
    expect(c.url).toBe(`${BASE}${path}`)
    expect(c.init.method).toBe(method)
    expect(c.headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    if (body === undefined) expect(c.init.body).toBeUndefined()
    else {
      expect(JSON.parse(String(c.init.body))).toEqual(body)
      expect(c.headers.get('content-type')).toMatch(/application\/json/)
    }
  })

  it('health sends no Authorization header and returns when the worker says ok', async () => {
    const { fetch, calls } = fetchMock(() => json({ ok: true }))
    await client(fetch).health()
    expect(calls[0].url).toBe(`${BASE}/health`)
    expect(calls[0].headers.has('authorization')).toBe(false)
  })

  it('health rejects an answer that is not an ARC worker', async () => {
    const { fetch } = fetchMock(() => json({ hello: 'world' }))
    const err = await rejection(client(fetch).health())
    expect(err.message).toMatch(/does not look like/i)
  })

  it('does not follow redirects, so the token never reaches another address', async () => {
    const { fetch, calls } = fetchMock(() => new Response(null, { status: 302, headers: { location: 'https://evil.test/' } }))
    const err = await rejection(client(fetch).list())
    expect(calls[0].init.redirect).toBe('manual')
    expect(err.message).toMatch(/redirect/i)
    expect(calls).toHaveLength(1)
  })

  it('url-encodes a session id so it cannot change the path', async () => {
    const { fetch, calls } = fetchMock(() => json(INFO))
    await client(fetch).get('a/../b?x=1')
    expect(calls[0].url).toBe(`${BASE}/v1/sessions/a%2F..%2Fb%3Fx%3D1`)
  })

  it('refuses an authenticated call when no token is saved, without a network request', async () => {
    const { fetch, calls } = fetchMock(() => json([]))
    const c = new CloudClient({ baseUrl: BASE, token: '', fetch })
    const err = await rejection(c.list())
    expect(err.message).toMatch(/Settings > Cloud/)
    expect(calls).toHaveLength(0)
  })

  it('rejects a reply with an unexpected shape instead of passing it on', async () => {
    const { fetch } = fetchMock(() => json({ sessions: 'nope' }))
    const err = await rejection(client(fetch).list())
    expect(err.code).toBe('bad-response')
  })
})

describe('CloudClient invoke', () => {
  it('returns the unwrapped data of an ok result', async () => {
    const { fetch } = fetchMock(() => json({ ok: true, data: { restored: ['a'], removed: [] } }))
    await expect(client(fetch).invoke(ID, 'agent:undo')).resolves.toEqual({ restored: ['a'], removed: [] })
  })

  it('throws a CloudError carrying the code of a failed result', async () => {
    const { fetch } = fetchMock(() => json({ ok: false, error: 'Add your Vertex API key in Settings to start.', code: 'no-api-key' }))
    const err = await rejection(client(fetch).invoke(ID, 'agent:send', { text: 'hi' }))
    expect(err.code).toBe('no-api-key')
    expect(err.message).toBe('Add your Vertex API key in Settings to start.')
  })

  it('redacts a secret that a failed result happens to contain', async () => {
    const { fetch } = fetchMock(() => json({ ok: false, error: `boom ${TOKEN} and Bearer abcdef123456` }))
    const err = await rejection(client(fetch).invoke(ID, 'agent:send', { text: 'hi' }))
    expect(err.message).not.toContain(TOKEN)
    expect(err.message).not.toContain('abcdef123456')
  })

  it('rejects a body that is not an IpcResult', async () => {
    const { fetch } = fetchMock(() => json({ nope: true }))
    expect((await rejection(client(fetch).invoke(ID, 'agent:stop'))).code).toBe('bad-response')
  })
})

// ------------------------------------------------------------------ error mapping

describe('CloudClient error mapping', () => {
  it('maps 401 to the access token message', async () => {
    const { fetch } = fetchMock(() => json({ ok: false, error: 'unauthorized' }, 401))
    const err = await rejection(client(fetch).list())
    expect(err).toMatchObject({ code: 'unauthorized', status: 401 })
    expect(err.message).toBe('The worker rejected the access token. Check it in Settings > Cloud.')
  })

  it.each([
    ['ECONNREFUSED', 'refused'],
    ['ENOTFOUND', 'found'],
    ['ETIMEDOUT', 'time'],
  ])('maps a %s network failure to a "could not reach" message naming the host', async (code) => {
    const { fetch } = fetchMock(() => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code } })
    })
    const err = await rejection(client(fetch).list())
    expect(err.code).toBe('unreachable')
    expect(err.message).toMatch(/^Could not reach the cloud worker at arc\.example\.com\./)
  })

  it('does not leak a token that a fetch failure message contains', async () => {
    const { fetch } = fetchMock(() => {
      throw new TypeError(`invalid header value Bearer ${TOKEN}`)
    })
    const err = await rejection(client(fetch).list())
    expect(err.message).not.toContain(TOKEN)
    expect(JSON.stringify(err)).not.toContain(TOKEN)
    expect(String(err.stack)).not.toContain(TOKEN)
  })

  it('maps 404 on a session to session-gone', async () => {
    const { fetch } = fetchMock(() => json({ ok: false, error: 'No such session', code: 'not-found' }, 404))
    const err = await rejection(client(fetch).get(ID))
    expect(err).toMatchObject({ code: 'session-gone', status: 404 })
    expect(err.message).toMatch(/no longer exists/i)
  })

  it('maps 404 outside a session to a hint that this is not an ARC worker', async () => {
    const { fetch } = fetchMock(() => json({ ok: false, error: 'Not found' }, 404))
    const err = await rejection(client(fetch).list())
    expect(err.code).toBe('not-found')
    expect(err.message).toMatch(/ARC worker/)
  })

  it('maps 429 to a wait message using Retry-After', async () => {
    const { fetch } = fetchMock(() => json({ ok: false, error: 'Too many failed attempts.', code: 'rate-limited' }, 429, { 'retry-after': '12' }))
    const err = await rejection(client(fetch).list())
    expect(err).toMatchObject({ code: 'rate-limited', status: 429 })
    expect(err.message).toMatch(/wait 12 seconds/i)
  })

  it('maps 429 without Retry-After to a generic wait message', async () => {
    const { fetch } = fetchMock(() => json({ ok: false, error: 'x' }, 429))
    expect((await rejection(client(fetch).list())).message).toMatch(/wait/i)
  })

  it('uses the worker error text and code for other failures', async () => {
    const { fetch } = fetchMock(() => json({ ok: false, error: 'Too many sessions (4 of 4).', code: 'too-many-sessions' }, 409))
    const err = await rejection(client(fetch).create(CREATE))
    expect(err).toMatchObject({ code: 'too-many-sessions', status: 409 })
    expect(err.message).toBe('Too many sessions (4 of 4).')
  })

  it('gives a busy conflict (HTTP 409) the code busy, with or without the worker body', async () => {
    const withBody = fetchMock(() => json({ ok: false, error: 'A turn is already running.', code: 'busy' }, 409))
    expect(await rejection(client(withBody.fetch).invoke(ID, 'agent:send', { text: 'x' }))).toMatchObject({ code: 'busy', status: 409 })
    const noBody = fetchMock(() => new Response('conflict', { status: 409 }))
    expect(await rejection(client(noBody.fetch).invoke(ID, 'agent:send', { text: 'x' }))).toMatchObject({ code: 'busy', status: 409 })
  })

  it('history returns the pending prompts and the in-flight text, and defaults them for an older worker', async () => {
    const approval = { call: { id: 'w1', name: 'Write', args: { file_path: 'a.txt' } }, reason: 'ask' }
    const full = fetchMock(() => json({ history: [{ role: 'user', parts: [{ text: 'hi' }] }], seq: 9, pending: { approval, question: { id: 'q', question: 'Which?', options: ['a'] } }, inflight: { text: 'Hel' } }))
    expect(await client(full.fetch).history(ID)).toEqual({
      history: [{ role: 'user', parts: [{ text: 'hi' }] }],
      seq: 9,
      pending: { approval, question: { id: 'q', question: 'Which?', options: ['a'] } },
      inflight: { text: 'Hel' },
    })
    const old = fetchMock(() => json({ history: [], seq: 3 }))
    expect(await client(old.fetch).history(ID)).toEqual({ history: [], seq: 3, pending: {} })
    const bad = fetchMock(() => json({ history: [], seq: 3, pending: { approval: 'nope' } }))
    expect(await rejection(client(bad.fetch).history(ID))).toMatchObject({ code: 'bad-response' })
  })

  it('putSecrets can ask the worker to forget the API key', async () => {
    const { fetch, calls } = fetchMock(() => json({ ok: true }))
    await client(fetch).putSecrets(ID, { clearApiKey: true })
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ clearApiKey: true })
  })

  it('redacts the token when the worker echoes it back in an error', async () => {
    const { fetch } = fetchMock(() => json({ ok: false, error: `bad credentials ${TOKEN}` }, 400))
    const err = await rejection(client(fetch).list())
    expect(err.message).not.toContain(TOKEN)
  })

  it('does not echo an HTML error page from a proxy', async () => {
    const { fetch } = fetchMock(() => new Response('<html><body>Bad gateway <b>secret-internal</b></body></html>', { status: 502 }))
    const err = await rejection(client(fetch).list())
    expect(err.status).toBe(502)
    expect(err.message).not.toContain('secret-internal')
    expect(err.message).toMatch(/502/)
  })

  it('rejects a response larger than 5 MB announced by Content-Length', async () => {
    const { fetch } = fetchMock(() => new Response('{}', { status: 200, headers: { 'content-length': String(6 * 1024 * 1024) } }))
    expect((await rejection(client(fetch).list())).code).toBe('too-large')
  })

  it('rejects a response larger than 5 MB that arrives without Content-Length and stops reading', async () => {
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({
      pull(ctl) {
        pulled++
        ctl.enqueue(new Uint8Array(1024 * 1024).fill(32))
        if (pulled > 50) ctl.close()
      },
    })
    const { fetch } = fetchMock(() => new Response(body, { status: 200 }))
    expect((await rejection(client(fetch).list())).code).toBe('too-large')
    expect(pulled).toBeLessThan(20)
  })
})

describe('CloudClient timeouts', () => {
  afterEach(() => vi.useRealTimers())

  const hang = (_url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })

  it('gives up on a request after 30 seconds', async () => {
    vi.useFakeTimers()
    const { fetch } = fetchMock(hang)
    const p = rejection(client(fetch).list())
    await vi.advanceTimersByTimeAsync(29_000)
    let settled = false
    void p.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1_500)
    const err = await p
    expect(err.code).toBe('unreachable')
    expect(err.message).toMatch(/did not answer/i)
  })

  it('allows create five minutes', async () => {
    vi.useFakeTimers()
    const { fetch } = fetchMock(hang)
    const p = rejection(client(fetch).create(CREATE))
    await vi.advanceTimersByTimeAsync(120_000)
    let settled = false
    void p.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(181_000)
    expect((await p).message).toMatch(/did not answer/i)
  })
})

// ------------------------------------------------------------------ SSE parser

function feed(parser: SseParser, ...chunks: Array<string | Uint8Array>): SseMessage[] {
  return chunks.flatMap((c) => parser.push(c))
}
const enc = (s: string) => new TextEncoder().encode(s)

describe('SseParser', () => {
  it('parses an id and a data line', () => {
    expect(feed(new SseParser(), 'id: 4\ndata: {"a":1}\n\n')).toEqual([{ event: 'message', data: '{"a":1}', id: '4' }])
  })

  it('joins multi-line data with newlines', () => {
    expect(feed(new SseParser(), 'data: one\ndata: two\ndata:three\n\n')).toEqual([{ event: 'message', data: 'one\ntwo\nthree', id: null }])
  })

  it('handles CRLF, CR and mixed line endings', () => {
    const msgs = feed(new SseParser(), 'id: 1\r\ndata: a\r\n\r\nid: 2\rdata: b\r\r', 'id: 3\ndata: c\n\n')
    expect(msgs.map((m) => [m.id, m.data])).toEqual([
      ['1', 'a'],
      ['2', 'b'],
      ['3', 'c'],
    ])
  })

  it('does not treat a CRLF split across two chunks as a blank line', () => {
    const msgs = feed(new SseParser(), 'data: a\r', '\ndata: b\r\n\r\n')
    expect(msgs).toEqual([{ event: 'message', data: 'a\nb', id: null }])
  })

  it('ignores comment lines, retry and unknown fields', () => {
    const msgs = feed(new SseParser(), ': ping\n\nretry: 3000\nfoo: bar\n: more\nid: 9\ndata: x\n\n')
    expect(msgs).toEqual([{ event: 'message', data: 'x', id: '9' }])
  })

  it('reads the event name, so a gap message is recognizable', () => {
    expect(feed(new SseParser(), 'event: gap\ndata: {"oldest":50}\n\n')).toEqual([{ event: 'gap', data: '{"oldest":50}', id: null }])
  })

  it('keeps the event name from leaking into the next message', () => {
    const msgs = feed(new SseParser(), 'event: gap\ndata: 1\n\ndata: 2\n\n')
    expect(msgs.map((m) => m.event)).toEqual(['gap', 'message'])
  })

  it('strips exactly one leading space from a value, and reads a data field without a colon as empty', () => {
    const msgs = feed(new SseParser(), 'data:  two spaces\n\ndata\n\n')
    expect(msgs).toEqual([
      { event: 'message', data: ' two spaces', id: null },
      { event: 'message', data: '', id: null },
    ])
  })

  it('does not emit an event that has no data lines', () => {
    expect(feed(new SseParser(), 'id: 5\n\n', 'event: x\n\n')).toEqual([])
  })

  it('does not emit an event that was never terminated', () => {
    expect(feed(new SseParser(), 'id: 5\ndata: half')).toEqual([])
  })

  it('reassembles a line that is split across chunks anywhere', () => {
    const wire = 'id: 12\ndata: {"type":"text-delta","text":"hello"}\n\n'
    for (let cut = 1; cut < wire.length; cut++) {
      const msgs = feed(new SseParser(), wire.slice(0, cut), wire.slice(cut))
      expect(msgs, `cut at ${cut}`).toEqual([{ event: 'message', data: '{"type":"text-delta","text":"hello"}', id: '12' }])
    }
  })

  it('decodes multi-byte characters that are split across chunks, byte by byte', () => {
    const text = 'café € \u{1F680} 中文'
    const bytes = enc(`id: 1\ndata: ${text}\n\n`)
    const parser = new SseParser()
    const msgs: SseMessage[] = []
    for (const b of bytes) msgs.push(...parser.push(new Uint8Array([b])))
    expect(msgs).toEqual([{ event: 'message', data: text, id: '1' }])
  })

  it('ignores a leading byte order mark', () => {
    expect(feed(new SseParser(), enc('﻿id: 1\ndata: x\n\n'))).toEqual([{ event: 'message', data: 'x', id: '1' }])
  })

  it('ignores an id that contains a NUL character', () => {
    expect(feed(new SseParser(), 'id: a\u0000b\ndata: x\n\n')).toEqual([{ event: 'message', data: 'x', id: null }])
  })

  it('refuses a message that grows beyond the limit instead of buffering forever', () => {
    const parser = new SseParser({ maxMessageBytes: 1000 })
    expect(() => parser.push('data: ' + 'x'.repeat(2000))).toThrow(/too large/i)
    const p2 = new SseParser({ maxMessageBytes: 1000 })
    expect(() => {
      for (let i = 0; i < 50; i++) p2.push('data: ' + 'y'.repeat(100) + '\n')
    }).toThrow(/too large/i)
  })
})

// ------------------------------------------------------------------ streaming (real HTTP)

interface Hit {
  method: string
  url: string
  headers: IncomingHttpHeaders
  body: string
}
type Handler = (req: IncomingMessage, res: ServerResponse, hit: Hit, n: number) => void

const servers: Array<{ close: () => Promise<void> }> = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()))
})

async function startServer(handler: Handler) {
  const hits: Hit[] = []
  const sockets = new Set<Socket>()
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const hit: Hit = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }
      hits.push(hit)
      handler(req, res, hit, hits.length)
    })
  })
  server.on('connection', (s) => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const handle = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    hits,
    close: async () => {
      for (const s of sockets) s.destroy()
      await new Promise<void>((r) => server.close(() => r()))
    },
  }
  servers.push(handle)
  return handle
}

const sseHead = (res: ServerResponse) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
  res.flushHeaders()
}
const ev = (text: string): AgentEvent => ({ type: 'text-delta', text })
const frame = (seq: number, e: unknown) => `id: ${seq}\ndata: ${JSON.stringify(e)}\n\n`

async function until(cond: () => boolean, label = 'condition', ms = 3000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

function listener() {
  const events: Array<[number, AgentEvent]> = []
  const gaps: number[] = []
  const ended: string[] = []
  const states: string[] = []
  return {
    events,
    gaps,
    ended,
    states,
    opts: (after: number) => ({
      after,
      onEvent: (seq: number, e: AgentEvent) => void events.push([seq, e]),
      onGap: (oldest: number) => void gaps.push(oldest),
      onEnded: (reason: 'gone' | 'unauthorized') => void ended.push(reason),
      onState: (s: 'connected' | 'reconnecting') => void states.push(s),
    }),
  }
}

function realClient(url: string, extra: Partial<ConstructorParameters<typeof CloudClient>[0]> = {}) {
  const sleeps: number[] = []
  const c = new CloudClient({
    baseUrl: url,
    token: TOKEN,
    sleep: async (ms) => {
      sleeps.push(ms)
      await new Promise((r) => setTimeout(r, 1))
    },
    ...extra,
  })
  return { c, sleeps }
}

describe('CloudClient.attach', () => {
  it('delivers each event with its sequence number and sends the token and Last-Event-ID', async () => {
    const srv = await startServer((_req, res) => {
      sseHead(res)
      res.write(': ping\n\n' + frame(8, ev('a')) + frame(9, ev('b')))
    })
    const { c } = realClient(srv.url)
    const l = listener()
    const h = c.attach(ID, l.opts(7))
    await until(() => l.events.length === 2, 'two events')
    h.close()
    expect(l.events).toEqual([
      [8, ev('a')],
      [9, ev('b')],
    ])
    expect(srv.hits[0].url).toContain(`/v1/sessions/${ID}/events`)
    expect(srv.hits[0].headers['authorization']).toBe(`Bearer ${TOKEN}`)
    expect(srv.hits[0].headers['last-event-id']).toBe('7')
    expect(srv.hits[0].headers['accept']).toContain('text/event-stream')
  })

  it('reconnects when the stream ends and resumes from the last seq after 1 second', async () => {
    const srv = await startServer((_req, res, _hit, n) => {
      sseHead(res)
      if (n === 1) {
        res.write(frame(1, ev('a')) + frame(2, ev('b')))
        res.end()
      } else res.write(frame(3, ev('c')))
    })
    const { c, sleeps } = realClient(srv.url)
    const l = listener()
    const h = c.attach(ID, l.opts(0))
    await until(() => l.events.length === 3, 'three events')
    h.close()
    expect(l.events.map(([s]) => s)).toEqual([1, 2, 3])
    expect(srv.hits[1].headers['last-event-id']).toBe('2')
    expect(srv.hits[1].url).toContain('after=2')
    expect(sleeps[0]).toBe(1000)
  })

  it('backs off 1, 2, 4, 8, 16, 30, 30 seconds while failing and starts over once data flows', async () => {
    const srv = await startServer((_req, res, _hit, n) => {
      if (n <= 7) {
        res.writeHead(503)
        res.end('down')
      } else if (n === 8) {
        sseHead(res)
        res.write(frame(1, ev('a')))
        res.end()
      } else {
        sseHead(res)
        res.write(': hold\n\n')
      }
    })
    const { c, sleeps } = realClient(srv.url)
    const l = listener()
    const h = c.attach(ID, l.opts(0))
    await until(() => srv.hits.length >= 9, 'ninth request')
    h.close()
    expect(sleeps.slice(0, 8)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 1000])
  })

  it('reports reconnecting once per outage and connected when it is back', async () => {
    const srv = await startServer((_req, res, _hit, n) => {
      if (n >= 2 && n <= 4) {
        res.writeHead(503)
        res.end()
        return
      }
      sseHead(res)
      if (n === 1) {
        res.write(frame(1, ev('a')))
        res.end()
      } else res.write(frame(2, ev('b')))
    })
    const { c } = realClient(srv.url)
    const l = listener()
    const h = c.attach(ID, l.opts(0))
    await until(() => l.events.length === 2, 'both events')
    h.close()
    expect(l.states).toEqual(['connected', 'reconnecting', 'connected'])
  })

  it('on a gap message calls onGap with the oldest seq and stops without reconnecting', async () => {
    const srv = await startServer((_req, res) => {
      sseHead(res)
      res.write('event: gap\ndata: {"oldest":50}\n\n')
    })
    const { c, sleeps } = realClient(srv.url)
    const l = listener()
    const h = c.attach(ID, l.opts(3))
    await h.done
    expect(l.gaps).toEqual([50])
    expect(l.events).toEqual([])
    expect(srv.hits).toHaveLength(1)
    expect(sleeps).toEqual([])
  })

  it('stops with "gone" on 404 and "unauthorized" on 401, without retrying', async () => {
    for (const [status, reason] of [
      [404, 'gone'],
      [401, 'unauthorized'],
    ] as const) {
      const srv = await startServer((_req, res) => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end('{"ok":false,"error":"x"}')
      })
      const { c, sleeps } = realClient(srv.url)
      const l = listener()
      await c.attach(ID, l.opts(0)).done
      expect(l.ended).toEqual([reason])
      expect(srv.hits).toHaveLength(1)
      expect(sleeps).toEqual([])
    }
  })

  it('stops with "gone" when the session is missing on a reconnect, keeping what it already delivered', async () => {
    const srv = await startServer((_req, res, _hit, n) => {
      if (n === 1) {
        sseHead(res)
        res.write(frame(1, ev('a')))
        res.end()
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    const { c } = realClient(srv.url)
    const l = listener()
    await c.attach(ID, l.opts(0)).done
    expect(l.events).toHaveLength(1)
    expect(l.ended).toEqual(['gone'])
    expect(srv.hits).toHaveLength(2)
  })

  it('close() aborts the pending reconnect sleep and makes no further request', async () => {
    const srv = await startServer((_req, res) => {
      sseHead(res)
      res.write(frame(1, ev('a')))
      res.end()
    })
    let sleeping = false
    const c = new CloudClient({
      baseUrl: srv.url,
      token: TOKEN,
      sleep: () => {
        sleeping = true
        return new Promise<void>(() => {})
      },
    })
    const l = listener()
    const h = c.attach(ID, l.opts(0))
    await until(() => sleeping, 'the reconnect sleep')
    h.close()
    await h.done
    await new Promise((r) => setTimeout(r, 30))
    expect(srv.hits).toHaveLength(1)
    expect(l.ended).toEqual([])
  })

  it('close() aborts an open stream request', async () => {
    let serverSawClose = false
    const srv = await startServer((_req, res) => {
      sseHead(res)
      res.write(frame(1, ev('a')))
      res.on('close', () => (serverSawClose = true))
    })
    const { c } = realClient(srv.url)
    const l = listener()
    const h = c.attach(ID, l.opts(0))
    await until(() => l.events.length === 1, 'first event')
    h.close()
    await h.done
    await until(() => serverSawClose, 'the server to see the connection close')
    expect(srv.hits).toHaveLength(1)
  })

  it('delivers nothing after close()', async () => {
    let write: ((s: string) => void) | undefined
    const srv = await startServer((_req, res) => {
      sseHead(res)
      write = (s) => res.write(s)
      res.write(frame(1, ev('a')))
    })
    const { c } = realClient(srv.url)
    const l = listener()
    const h = c.attach(ID, l.opts(0))
    await until(() => l.events.length === 1, 'first event')
    h.close()
    write?.(frame(2, ev('late')))
    await new Promise((r) => setTimeout(r, 30))
    expect(l.events).toHaveLength(1)
  })

  it('skips payloads that are not an object with a string type, and keeps going', async () => {
    const srv = await startServer((_req, res) => {
      sseHead(res)
      res.write('id: 1\ndata: not json\n\n')
      res.write(frame(2, 'a string'))
      res.write(frame(3, { type: 7 }))
      res.write(frame(4, null))
      res.write(frame(5, [1]))
      res.write(frame(6, ev('ok')))
    })
    const { c } = realClient(srv.url)
    const l = listener()
    const h = c.attach(ID, l.opts(0))
    await until(() => l.events.length === 1, 'the valid event')
    h.close()
    expect(l.events).toEqual([[6, ev('ok')]])
  })

  it('skips events at or below the last seq it has seen (replay overlap)', async () => {
    const srv = await startServer((_req, res) => {
      sseHead(res)
      res.write(frame(5, ev('old')) + frame(6, ev('dup')) + frame(7, ev('new')))
    })
    const { c } = realClient(srv.url)
    const l = listener()
    const h = c.attach(ID, l.opts(6))
    await until(() => l.events.length === 1, 'one event')
    h.close()
    expect(l.events).toEqual([[7, ev('new')]])
  })

  it('survives a callback that throws', async () => {
    const srv = await startServer((_req, res) => {
      sseHead(res)
      res.write(frame(1, ev('a')) + frame(2, ev('b')))
    })
    const { c } = realClient(srv.url)
    const seen: number[] = []
    const h = c.attach(ID, {
      after: 0,
      onEvent: (seq) => {
        seen.push(seq)
        throw new Error('listener bug')
      },
      onGap: () => {},
      onEnded: () => {},
    })
    await until(() => seen.length === 2, 'both events')
    h.close()
  })

  it('reconnects a stream that goes silent for longer than the idle limit', async () => {
    const srv = await startServer((_req, res, _hit, n) => {
      sseHead(res)
      if (n === 2) res.write(frame(1, ev('after-silence')))
    })
    const { c } = realClient(srv.url, { streamIdleMs: 60 })
    const l = listener()
    const h = c.attach(ID, l.opts(0))
    await until(() => l.events.length === 1, 'an event after the silent stream was dropped')
    h.close()
    expect(srv.hits.length).toBeGreaterThanOrEqual(2)
  })

  it('never puts the token in anything it reports', async () => {
    const srv = await startServer((_req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: `leak ${TOKEN}` }))
    })
    const { c } = realClient(srv.url)
    const l = listener()
    const h = c.attach(ID, l.opts(0))
    await until(() => l.states.includes('reconnecting'), 'reconnecting')
    h.close()
    expect(JSON.stringify([l.events, l.gaps, l.ended, l.states])).not.toContain(TOKEN)
  })
})
