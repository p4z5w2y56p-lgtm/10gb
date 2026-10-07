import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { z } from 'zod'
import { redact } from '../safety/redact'
import { CLOUD_INVOKE_CHANNELS, CreateSessionBody, InvokeBody, PrBody, SecretsBody } from './protocol'
import { WorkerError, type CloudWorker } from './worker'

export interface WorkerServerOptions {
  worker: CloudWorker
  token: string
  heartbeatMs?: number
  maxBodyBytes?: number
  failLimit?: { perMinute: number }
  /** Receives one redacted line per internal error. Defaults to stderr. */
  logger?: (line: string) => void
  /** Behind a reverse proxy (Cloud Run): count failed logins per X-Forwarded-For client instead of per socket. */
  trustProxy?: boolean
  now?: () => number
}

const ID_RE = /^[a-f0-9-]{36}$/
const MAX_STREAMS_PER_SESSION = 5
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024
const BODY_TIMEOUT_MS = 30_000
const WINDOW_MS = 60_000
const MAX_TRACKED_ADDRESSES = 10_000
const JSON_TYPE = /^application\/json\s*(;.*)?$/i

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message)
  }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest()

/** Failed-login counter per address over a rolling window. */
class FailureLimiter {
  private readonly hits = new Map<string, number[]>()
  constructor(private readonly limit: number) {}

  /** Milliseconds until `addr` may try again, 0 when it may. */
  blockedFor(addr: string, now: number): number {
    const list = this.hits.get(addr)
    if (!list) return 0
    while (list.length > 0 && list[0] <= now - WINDOW_MS) list.shift()
    if (list.length === 0) {
      this.hits.delete(addr)
      return 0
    }
    return list.length >= this.limit ? list[0] + WINDOW_MS - now : 0
  }

  record(addr: string, now: number): void {
    const list = this.hits.get(addr) ?? []
    list.push(now)
    this.hits.set(addr, list)
    if (this.hits.size > MAX_TRACKED_ADDRESSES) {
      for (const key of this.hits.keys()) {
        if (this.hits.size <= MAX_TRACKED_ADDRESSES) break
        if (key !== addr) this.hits.delete(key)
      }
    }
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) return
  const data = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  })
  res.end(data)
}

const errorBody = (error: string, code: string) => ({ ok: false, error, code })

function parseSeq(value: string | string[] | null | undefined): number | undefined {
  const v = Array.isArray(value) ? value[0] : value
  return v !== undefined && v !== null && /^\d{1,15}$/.test(v) ? Number(v) : undefined
}

function check<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  const where = issue?.path.join('.')
  throw new HttpError(400, 'invalid', `Invalid request: ${where ? `${where}: ` : ''}${issue?.message ?? 'invalid'}`)
}

function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = req.headers['content-length']
    if (declared !== undefined) {
      const n = Number(declared)
      if (!Number.isFinite(n) || n < 0) return reject(new HttpError(400, 'invalid', 'Invalid Content-Length'))
      if (n > max) return reject(new HttpError(413, 'too-large', 'The request body is too large'))
    }
    const chunks: Buffer[] = []
    let total = 0
    let done = false
    const finish = (err?: HttpError): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (err) reject(err)
      else resolve(Buffer.concat(chunks))
    }
    const timer = setTimeout(() => finish(new HttpError(408, 'timeout', 'The request took too long')), BODY_TIMEOUT_MS)
    // The listener stays after an early abort so the rest of the body is thrown away instead of buffered.
    req.on('data', (c: Buffer) => {
      if (done) return
      total += c.length
      if (total > max) {
        chunks.length = 0
        finish(new HttpError(413, 'too-large', 'The request body is too large'))
      } else chunks.push(c)
    })
    req.on('end', () => finish())
    req.on('error', () => finish(new HttpError(400, 'invalid', 'The request was interrupted')))
    req.on('close', () => finish(new HttpError(400, 'invalid', 'The request was interrupted')))
  })
}

type Handler = (ctx: Ctx) => Promise<void> | void
interface Ctx {
  req: IncomingMessage
  res: ServerResponse
  id: string
  query: URLSearchParams
  body(): Promise<unknown>
}

export function createWorkerServer(opts: WorkerServerOptions): Server {
  const { worker } = opts
  const tokenHash = sha256(opts.token)
  const heartbeatMs = opts.heartbeatMs ?? 15_000
  const maxBody = opts.maxBodyBytes ?? 1_000_000
  const now = opts.now ?? Date.now
  const log = opts.logger ?? ((line: string) => console.error(line))
  const limiter = new FailureLimiter(opts.failLimit?.perMinute ?? 10)
  const streams = new Map<string, number>()

  const clientAddress = (req: IncomingMessage): string => {
    if (opts.trustProxy) {
      const xff = req.headers['x-forwarded-for']
      const last = (Array.isArray(xff) ? xff.join(',') : xff)?.split(',').pop()?.trim()
      if (last) return last
    }
    return (req.socket.remoteAddress ?? 'unknown').replace(/^::ffff:/, '')
  }

  const authorized = (req: IncomingMessage): boolean => {
    const header = req.headers.authorization
    const candidate = typeof header === 'string' ? (/^Bearer (.*)$/i.exec(header)?.[1] ?? '') : ''
    return timingSafeEqual(sha256(candidate), tokenHash)
  }

  const routes: Array<{ pattern: RegExp; methods: Record<string, Handler>; label: string; takesBody?: boolean }> = [
    {
      pattern: /^\/v1\/sessions$/,
      label: '/v1/sessions',
      methods: {
        GET: ({ res }) => sendJson(res, 200, worker.list()),
        POST: async ({ res, body }) => sendJson(res, 200, await worker.create(check(CreateSessionBody, await body()))),
      },
    },
    {
      pattern: /^\/v1\/sessions\/([^/]*)$/,
      label: '/v1/sessions/:id',
      methods: {
        GET: ({ res, id }) => sendJson(res, 200, worker.get(id)),
        DELETE: async ({ res, id }) => {
          await worker.remove(id)
          sendJson(res, 200, { ok: true })
        },
      },
    },
    {
      pattern: /^\/v1\/sessions\/([^/]*)\/invoke$/,
      label: '/v1/sessions/:id/invoke',
      methods: {
        POST: async ({ res, id, body }) => {
          const raw = (await body()) as { channel?: unknown } | null
          if (raw && typeof raw === 'object' && typeof raw.channel === 'string' && !(CLOUD_INVOKE_CHANNELS as readonly string[]).includes(raw.channel)) {
            throw new HttpError(400, 'invalid', 'That action is not available on a cloud session.')
          }
          const parsed = check(InvokeBody, raw)
          sendJson(res, 200, await worker.invoke(id, parsed.channel, parsed.payload))
        },
      },
    },
    {
      pattern: /^\/v1\/sessions\/([^/]*)\/secrets$/,
      label: '/v1/sessions/:id/secrets',
      methods: {
        PUT: async ({ res, id, body }) => {
          await worker.putSecrets(id, check(SecretsBody, await body()))
          sendJson(res, 200, { ok: true })
        },
      },
    },
    {
      pattern: /^\/v1\/sessions\/([^/]*)\/history$/,
      label: '/v1/sessions/:id/history',
      methods: { GET: ({ res, id }) => sendJson(res, 200, worker.history(id)) },
    },
    {
      pattern: /^\/v1\/sessions\/([^/]*)\/events$/,
      label: '/v1/sessions/:id/events',
      methods: { GET: (ctx) => streamEvents(ctx) },
    },
    {
      pattern: /^\/v1\/sessions\/([^/]*)\/diff$/,
      label: '/v1/sessions/:id/diff',
      methods: { GET: async ({ res, id }) => sendJson(res, 200, await worker.diff(id)) },
    },
    {
      pattern: /^\/v1\/sessions\/([^/]*)\/push$/,
      label: '/v1/sessions/:id/push',
      methods: { POST: async ({ res, id }) => sendJson(res, 200, await worker.push(id)) },
    },
    {
      pattern: /^\/v1\/sessions\/([^/]*)\/pr$/,
      label: '/v1/sessions/:id/pr',
      methods: { POST: async ({ res, id, body }) => sendJson(res, 200, await worker.pr(id, check(PrBody, await body()))) },
    },
  ]

  function streamEvents({ req, res, id, query }: Ctx): void {
    worker.get(id)
    const open = streams.get(id) ?? 0
    if (open >= MAX_STREAMS_PER_SESSION) throw new HttpError(429, 'too-many-streams', 'Too many open streams for this session')
    const after = parseSeq(req.headers['last-event-id']) ?? parseSeq(query.get('after')) ?? 0

    let closed = false
    let ready = false
    const queued: string[] = []
    let timer: NodeJS.Timeout | undefined
    let sub: ReturnType<CloudWorker['subscribe']> | undefined
    const cleanup = (): void => {
      if (closed) return
      closed = true
      if (timer) clearInterval(timer)
      sub?.unsubscribe()
      const left = (streams.get(id) ?? 1) - 1
      if (left <= 0) streams.delete(id)
      else streams.set(id, left)
    }
    const write = (chunk: string): void => {
      if (closed) return
      res.write(chunk)
      if (res.writableLength > MAX_BUFFERED_BYTES) res.destroy()
    }

    streams.set(id, open + 1)
    res.on('close', cleanup)
    try {
      // Replay happens inside subscribe(), before the gap is known, so hold the frames until the gap message went out.
      sub = worker.subscribe(
        id,
        after,
        (seq, event) => {
          const frame = `id: ${seq}\ndata: ${JSON.stringify(event)}\n\n`
          if (ready) write(frame)
          else queued.push(frame)
        },
        () => {
          cleanup()
          res.end()
        },
      )
    } catch (err) {
      cleanup()
      throw err
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    })
    res.flushHeaders()
    req.socket.setNoDelay(true)
    if (sub.gap) write(`event: gap\ndata: ${JSON.stringify({ oldest: sub.gap.oldest })}\n\n`)
    for (const frame of queued) write(frame)
    queued.length = 0
    ready = true
    timer = setInterval(() => write(': ping\n\n'), heartbeatMs)
    timer.unref()
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET'
    const target = req.url ?? '/'
    const q = target.indexOf('?')
    const path = q < 0 ? target : target.slice(0, q)
    const query = new URLSearchParams(q < 0 ? '' : target.slice(q + 1))

    if (method === 'OPTIONS') throw new HttpError(405, 'method-not-allowed', 'Method not allowed', { Allow: 'GET, POST, PUT, DELETE' })
    if (path === '/health') {
      if (method !== 'GET') throw new HttpError(405, 'method-not-allowed', 'Method not allowed', { Allow: 'GET' })
      return sendJson(res, 200, { ok: true })
    }

    const addr = clientAddress(req)
    const wait = limiter.blockedFor(addr, now())
    if (wait > 0) {
      throw new HttpError(429, 'rate-limited', 'Too many failed attempts. Try again later.', { 'Retry-After': String(Math.max(1, Math.ceil(wait / 1000))) })
    }
    if (!authorized(req)) {
      limiter.record(addr, now())
      throw new HttpError(401, 'unauthorized', 'Unauthorized')
    }

    let route: (typeof routes)[number] | undefined
    let id = ''
    for (const r of routes) {
      const m = r.pattern.exec(path)
      if (m) {
        route = r
        id = m[1] ?? ''
        break
      }
    }
    if (!route) throw new HttpError(404, 'not-found', 'Not found')
    const handler = route.methods[method]
    if (!handler) throw new HttpError(405, 'method-not-allowed', 'Method not allowed', { Allow: Object.keys(route.methods).join(', ') })
    if (route.pattern.source.includes('([^/]*)') && !ID_RE.test(id)) throw new HttpError(404, 'not-found', 'Not found')

    if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
      const type = req.headers['content-type']
      const hasBody = (req.headers['content-length'] ?? '0') !== '0' || req.headers['transfer-encoding'] !== undefined
      if ((type !== undefined && !JSON_TYPE.test(type)) || (type === undefined && hasBody)) {
        throw new HttpError(415, 'unsupported-media-type', 'Send JSON with Content-Type: application/json')
      }
    }

    const body = async (): Promise<unknown> => {
      const raw = (await readBody(req, maxBody)).toString('utf8')
      if (raw.trim() === '') return undefined
      try {
        return JSON.parse(raw)
      } catch {
        throw new HttpError(400, 'invalid', 'The request body is not valid JSON')
      }
    }
    await handler({ req, res, id, query, body })
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) {
        res.destroy()
        return
      }
      if (err instanceof HttpError) {
        if (err.status === 413 || err.status === 408) {
          res.setHeader('Connection', 'close')
          res.once('finish', () => setTimeout(() => req.socket.destroy(), 2000).unref())
        }
        return sendJson(res, err.status, errorBody(err.message, err.code), err.headers)
      }
      if (err instanceof WorkerError) return sendJson(res, err.status, errorBody(err.message, err.code))
      const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
      log(`[worker] ${req.method} ${(req.url ?? '').split('?')[0].replace(/[a-f0-9-]{36}/g, ':id').slice(0, 120)} failed: ${redact(detail, [opts.token]).slice(0, 2000)}`)
      sendJson(res, 500, errorBody('Internal error', 'internal'))
    })
  })
  server.requestTimeout = 0
  server.headersTimeout = 20_000
  server.keepAliveTimeout = 65_000
  return server
}
