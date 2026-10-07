import { z } from 'zod'
import type { CloudDiff, CloudSessionInfo, PullRequestResult, PushResult } from '../../shared/cloud'
import type { AgentEvent } from '../../shared/types'
import { redact } from '../safety/redact'
import type { Content } from '../vertex/types'
import type { CreateSessionBody, HistoryResponse, InvokeBody, PrBody, SecretsBody } from './protocol'
import { SseParser } from './sseParser'

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 30_000
const LONG_TIMEOUT_MS = 5 * 60_000
const STREAM_IDLE_MS = 45_000
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16_000, 30_000]
const SETTINGS_HINT = 'Settings > Cloud'

/** Anything that goes wrong talking to the worker. The message is plain language and never contains the token. */
export class CloudError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 0,
  ) {
    super(redact(message))
    this.name = 'CloudError'
  }
}

export interface CloudClientOptions {
  baseUrl: string
  token: string
  fetch?: typeof fetch
  /** Waits between reconnects. Tests inject a fast one. The signal fires when the stream is closed. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** A stream with no bytes (not even a ping) for this long is dropped and reconnected. */
  streamIdleMs?: number
}

export interface AttachOptions {
  /** Last sequence number the caller already has. */
  after: number
  onEvent: (seq: number, event: AgentEvent) => void
  /** The worker no longer holds events back to `after`; reload history, then attach again. The stream stops. */
  onGap: (oldest: number) => void
  /** The session is gone or the token is no longer accepted. The stream stops. */
  onEnded: (reason: 'gone' | 'unauthorized') => void
  onState?: (state: 'connected' | 'reconnecting') => void
}

export interface AttachHandle {
  close(): void
  /** Settles when the stream loop has stopped (after close(), a gap or an ended session). */
  done: Promise<void>
}

const Mode = z.enum(['ask', 'auto-edit', 'auto'])
const InfoSchema = z.object({
  id: z.string(),
  repo: z.string(),
  branch: z.string(),
  baseBranch: z.string(),
  busy: z.boolean(),
  mode: Mode.nullable(),
  createdAt: z.string(),
  lastActiveAt: z.string(),
  pushed: z.boolean(),
})
const DiffSchema = z.object({
  branch: z.string(),
  baseBranch: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      status: z.enum(['added', 'modified', 'deleted', 'renamed', 'untracked']),
      additions: z.number(),
      deletions: z.number(),
    }),
  ),
  uncommitted: z.boolean(),
  ahead: z.number(),
  pushed: z.boolean(),
})
const PushSchema = z.object({
  branch: z.string(),
  commit: z.string().nullable(),
  pushed: z.boolean(),
  skipped: z.array(z.string()),
  url: z.string(),
})
const PrSchema = z.object({ number: z.number(), url: z.string(), draft: z.boolean(), existing: z.boolean() })
const ApprovalSchema = z.object({
  call: z.object({ id: z.string(), name: z.string(), args: z.record(z.string(), z.unknown()) }),
  reason: z.string(),
  diff: z.string().optional(),
})
const QuestionSchema = z.object({ id: z.string(), question: z.string(), options: z.array(z.string()).optional() })
const HistorySchema = z.object({
  history: z.array(z.unknown()),
  seq: z.number().int().min(0),
  // Absent on a worker from before these existed: then nothing is pending.
  pending: z.object({ approval: ApprovalSchema.optional(), question: QuestionSchema.optional() }).default({}),
  inflight: z.object({ text: z.string() }).optional(),
})
const IpcResultSchema = z.union([
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.string(), code: z.string().optional() }),
])

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

function unref(timer: ReturnType<typeof setTimeout>): void {
  ;(timer as { unref?: () => void }).unref?.()
}

function hasBodyCode(text: string): boolean {
  try {
    const b = JSON.parse(text) as { code?: unknown }
    return typeof b?.code === 'string'
  } catch {
    return false
  }
}

function causeCode(err: unknown): string {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null
  const code = e?.cause?.code ?? e?.code
  return typeof code === 'string' ? code : ''
}

function normalizeBase(input: string): { base: string; host: string } {
  const raw = typeof input === 'string' ? input.trim() : ''
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new Error(`The worker URL is not a valid address. Use something like https://arc-worker-abc123.a.run.app (set it in ${SETTINGS_HINT}).`)
  }
  if (u.protocol === 'http:') {
    if (!LOOPBACK.has(u.hostname)) {
      throw new Error(
        `Refusing to use plain http:// for ${u.hostname}: the access token would travel unencrypted. Use an https:// address (http is only allowed for localhost).`,
      )
    }
  } else if (u.protocol !== 'https:') {
    throw new Error('The worker URL must start with https:// (http:// is only allowed for localhost).')
  }
  if (u.username || u.password) {
    throw new Error('The worker URL must not contain a username or password. The access token has its own field in Settings > Cloud.')
  }
  if (raw.includes('?')) throw new Error('The worker URL must not contain a query string (anything after a ?).')
  if (raw.includes('#')) throw new Error('The worker URL must not contain a fragment (anything after a #).')
  return { base: `${u.origin}${u.pathname.replace(/\/+$/, '')}`, host: u.host }
}

/** HTTP and SSE client for the ARC worker. Never logs, and never puts the token in an error. */
export class CloudClient {
  readonly baseUrl: string
  private readonly host: string
  private readonly token: string
  private readonly fetchFn: typeof fetch
  private readonly sleepFn: (ms: number, signal?: AbortSignal) => Promise<void>
  private readonly streamIdleMs: number

  constructor(opts: CloudClientOptions) {
    const { base, host } = normalizeBase(opts.baseUrl)
    if (typeof opts.token !== 'string' || (opts.token !== '' && !/^[\x21-\x7e]+$/.test(opts.token))) {
      throw new Error(`The cloud access token contains spaces or characters that cannot be sent. Paste it again in ${SETTINGS_HINT}.`)
    }
    this.baseUrl = base
    this.host = host
    this.token = opts.token
    this.fetchFn = opts.fetch ?? ((...args) => fetch(...args))
    this.sleepFn = opts.sleep ?? defaultSleep
    this.streamIdleMs = opts.streamIdleMs ?? STREAM_IDLE_MS
  }

  // ------------------------------------------------------------------ API

  async health(): Promise<void> {
    const body = (await this.request('GET', '/health', { auth: false })) as { ok?: unknown } | null
    if (!body || typeof body !== 'object' || body.ok !== true) {
      throw new CloudError('That address answered, but it does not look like an ARC worker.', 'not-arc-worker')
    }
  }

  async list(): Promise<CloudSessionInfo[]> {
    return this.parse(z.array(InfoSchema), await this.request('GET', '/v1/sessions'))
  }

  async create(body: CreateSessionBody): Promise<CloudSessionInfo> {
    return this.parse(InfoSchema, await this.request('POST', '/v1/sessions', { body, timeoutMs: LONG_TIMEOUT_MS }))
  }

  async get(id: string): Promise<CloudSessionInfo> {
    return this.parse(InfoSchema, await this.request('GET', this.session(id)))
  }

  async remove(id: string): Promise<void> {
    await this.request('DELETE', this.session(id))
  }

  /** Runs a session channel on the worker and returns the unwrapped data, or throws the worker's error. */
  async invoke<T = unknown>(id: string, channel: InvokeBody['channel'], payload?: unknown): Promise<T> {
    const raw = await this.request('POST', `${this.session(id)}/invoke`, { body: { channel, payload } })
    const result = this.parse(IpcResultSchema, raw)
    if (result.ok) return result.data as T
    throw new CloudError(this.clean(result.error), result.code ?? 'invoke-failed', 200)
  }

  async putSecrets(id: string, body: SecretsBody): Promise<void> {
    await this.request('PUT', `${this.session(id)}/secrets`, { body })
  }

  async history(id: string): Promise<HistoryResponse> {
    const h = this.parse(HistorySchema, await this.request('GET', `${this.session(id)}/history`))
    return {
      history: h.history as Content[],
      seq: h.seq,
      pending: h.pending as HistoryResponse['pending'],
      ...(h.inflight ? { inflight: h.inflight } : {}),
    }
  }

  async diff(id: string): Promise<CloudDiff> {
    return this.parse(DiffSchema, await this.request('GET', `${this.session(id)}/diff`))
  }

  async push(id: string): Promise<PushResult> {
    return this.parse(PushSchema, await this.request('POST', `${this.session(id)}/push`, { timeoutMs: LONG_TIMEOUT_MS }))
  }

  async pr(id: string, body: PrBody): Promise<PullRequestResult> {
    return this.parse(PrSchema, await this.request('POST', `${this.session(id)}/pr`, { body }))
  }

  // ------------------------------------------------------------------ stream

  /**
   * Follow a session's events. Reconnects by itself (1, 2, 4, 8, 16, then 30 s apart) and resumes from the last
   * sequence number. Stops on close(), on a gap message, and when the session is gone or the token is refused.
   */
  attach(id: string, o: AttachOptions): AttachHandle {
    const root = new AbortController()
    const done = this.follow(id, o, root.signal).catch(() => undefined)
    return { close: () => root.abort(), done }
  }

  private async follow(id: string, o: AttachOptions, signal: AbortSignal): Promise<void> {
    const guard = (fn: () => void): void => {
      try {
        fn()
      } catch {
        // A listener bug must not stop the stream.
      }
    }
    let last = o.after
    let failures = 0
    let state: 'connected' | 'reconnecting' | null = null
    const setState = (s: 'connected' | 'reconnecting'): void => {
      if (state === s) return
      state = s
      guard(() => o.onState?.(s))
    }

    while (!signal.aborted) {
      const attempt = new AbortController()
      const abortAttempt = () => attempt.abort()
      signal.addEventListener('abort', abortAttempt, { once: true })
      let idle: ReturnType<typeof setTimeout> | undefined
      const arm = () => {
        clearTimeout(idle)
        idle = setTimeout(abortAttempt, this.streamIdleMs)
        unref(idle)
      }
      let gotBytes = false
      try {
        arm()
        const res = await this.fetchFn(`${this.baseUrl}${this.session(id)}/events?after=${last}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.token}`, Accept: 'text/event-stream', 'Last-Event-ID': String(last) },
          signal: attempt.signal,
          redirect: 'manual',
        })
        if (signal.aborted) return
        if (res.status === 401 || res.status === 404) {
          void res.body?.cancel().catch(() => undefined)
          const reason = res.status === 401 ? 'unauthorized' : 'gone'
          guard(() => o.onEnded(reason))
          return
        }
        if (!res.ok || !res.body) throw new Error('stream refused')
        // After an outage, wait for the first bytes before calling it connected, so a worker that accepts and drops does not flap.
        if (state !== 'reconnecting') setState('connected')
        const parser = new SseParser()
        const reader = res.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          arm()
          if (!gotBytes) {
            gotBytes = true
            failures = 0
            setState('connected')
          }
          for (const m of parser.push(value)) {
            if (signal.aborted) return
            if (m.event === 'gap') {
              let oldest = 0
              try {
                const parsed = JSON.parse(m.data) as { oldest?: unknown }
                if (typeof parsed.oldest === 'number' && Number.isFinite(parsed.oldest)) oldest = parsed.oldest
              } catch {
                // keep 0
              }
              guard(() => o.onGap(oldest))
              return
            }
            const seq = m.id !== null && /^\d{1,15}$/.test(m.id) ? Number(m.id) : null
            if (seq === null || seq <= last) continue
            let event: unknown
            try {
              event = JSON.parse(m.data)
            } catch {
              continue
            }
            const e = event as { type?: unknown } | null
            if (!e || typeof e !== 'object' || Array.isArray(e) || typeof e.type !== 'string') continue
            last = seq
            guard(() => o.onEvent(seq, event as AgentEvent))
          }
        }
      } catch {
        // Network error, idle drop or a bad stream: fall through to the reconnect.
      } finally {
        clearTimeout(idle)
        signal.removeEventListener('abort', abortAttempt)
        attempt.abort()
      }
      if (signal.aborted) return
      setState('reconnecting')
      const delay = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)]
      failures++
      await this.pause(delay, signal)
    }
  }

  private async pause(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return
    let onAbort = (): void => undefined
    const aborted = new Promise<void>((resolve) => {
      onAbort = () => resolve()
      signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      await Promise.race([this.sleepFn(ms, signal), aborted])
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  // ------------------------------------------------------------------ plumbing

  private session(id: string): string {
    if (typeof id !== 'string' || id.length === 0) throw new CloudError('No cloud session was given.', 'invalid')
    return `/v1/sessions/${encodeURIComponent(id)}`
  }

  private clean(text: string): string {
    return redact(text, [this.token]).slice(0, 500)
  }

  private parse<S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> {
    const r = schema.safeParse(raw)
    if (!r.success) throw new CloudError('The cloud worker sent an answer ARC did not understand. Is the worker up to date?', 'bad-response')
    return r.data
  }

  private unreachable(err: unknown, timedOut: boolean): CloudError {
    const code = causeCode(err)
    let hint = `Check the worker URL in ${SETTINGS_HINT} and that the worker is running.`
    if (timedOut || /TIMEOUT|TIMEDOUT/.test(code)) hint = 'It did not answer in time. Check that the worker is running, then try again.'
    else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') hint = `The address was not found. Check the worker URL in ${SETTINGS_HINT}.`
    else if (code === 'ECONNREFUSED') hint = 'The connection was refused. Is the worker running?'
    else if (/CERT|SELF_SIGNED|TLS/.test(code)) hint = 'Its security certificate was not accepted.'
    return new CloudError(`Could not reach the cloud worker at ${this.host}. ${hint}`, 'unreachable')
  }

  private async readCapped(res: Response): Promise<string> {
    const tooLarge = () => new CloudError('The cloud worker sent an answer that was too large to read.', 'too-large', res.status)
    const length = Number(res.headers.get('content-length'))
    if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
      void res.body?.cancel().catch(() => undefined)
      throw tooLarge()
    }
    if (!res.body) return ''
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined)
        throw tooLarge()
      }
      chunks.push(value)
    }
    return new TextDecoder().decode(Buffer.concat(chunks))
  }

  private failure(status: number, path: string, text: string, headers: Headers): CloudError {
    if (status >= 300 && status < 400) {
      return new CloudError('The worker address redirected somewhere else. Use the final https:// address in Settings > Cloud.', 'redirect', status)
    }
    if (status === 401) return new CloudError(`The worker rejected the access token. Check it in ${SETTINGS_HINT}.`, 'unauthorized', status)
    if (status === 429) {
      const wait = Number(headers.get('retry-after'))
      const how = Number.isFinite(wait) && wait > 0 ? `Wait ${Math.ceil(wait)} seconds` : 'Wait a minute'
      return new CloudError(`The worker says there were too many requests. ${how}, then try again.`, 'rate-limited', status)
    }
    if (status === 409 && !hasBodyCode(text)) return new CloudError('A turn is already running. Stop it or wait for it to finish.', 'busy', status)
    if (status === 404 && /^\/v1\/sessions\/[^/]+/.test(path)) {
      return new CloudError('That cloud session no longer exists on the worker. It may have expired or the worker restarted.', 'session-gone', status)
    }
    if (status === 404) {
      return new CloudError('The worker answered "not found". That address does not look like an ARC worker.', 'not-found', status)
    }
    let body: { error?: unknown; code?: unknown } | null = null
    try {
      body = JSON.parse(text) as { error?: unknown; code?: unknown }
    } catch {
      body = null
    }
    if (body && typeof body === 'object' && typeof body.error === 'string' && body.error.trim()) {
      return new CloudError(this.clean(body.error), typeof body.code === 'string' ? body.code : `http-${status}`, status)
    }
    return new CloudError(`The cloud worker answered with an error (HTTP ${status}).`, `http-${status}`, status)
  }

  private async request(
    method: string,
    path: string,
    opts: { body?: unknown; auth?: boolean; timeoutMs?: number } = {},
  ): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (opts.auth !== false) {
      if (!this.token) throw new CloudError(`Add the worker access token in ${SETTINGS_HINT} first.`, 'no-token')
      headers['Authorization'] = `Bearer ${this.token}`
    }
    let body: string | undefined
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(opts.body)
    }
    const ctl = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      ctl.abort()
    }, opts.timeoutMs ?? REQUEST_TIMEOUT_MS)
    unref(timer)
    try {
      const res = await this.fetchFn(`${this.baseUrl}${path}`, { method, headers, body, signal: ctl.signal, redirect: 'manual' })
      const text = await this.readCapped(res)
      if (res.status < 200 || res.status >= 300) throw this.failure(res.status, path, text, res.headers)
      try {
        return JSON.parse(text)
      } catch {
        throw new CloudError('The cloud worker sent an answer ARC did not understand.', 'bad-response', res.status)
      }
    } catch (err) {
      if (err instanceof CloudError) throw err
      throw this.unreachable(err, timedOut)
    } finally {
      clearTimeout(timer)
    }
  }
}
