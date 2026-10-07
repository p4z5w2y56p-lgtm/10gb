import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VertexClient } from '../../src/main/vertex/client'
import { VertexError, type GenerateRequest } from '../../src/main/vertex/types'
import { chunk, sse, startFakeVertex, type FakeVertex } from '../helpers/fakeVertexServer'

const KEY = 'AIzaSy' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'
let server: FakeVertex | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const req = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({
  systemInstruction: 'You are ARC.',
  contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
  ...over,
})

async function client(script: Parameters<typeof startFakeVertex>[0], over: Partial<ConstructorParameters<typeof VertexClient>[0]> = {}) {
  server = await startFakeVertex(script)
  const sleeps: number[] = []
  const c = new VertexClient({
    apiKey: KEY,
    model: 'gemini-3.8-flash',
    baseUrl: server.baseUrl,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    ...over,
  })
  return { c, sleeps }
}

const ok = (text = 'ok') => ({ chunks: [chunk([{ text }], {}, 'STOP')] })

describe('request shape', () => {
  it('sends the key as a header, never in the URL, and the expected body', async () => {
    const { c } = await client([ok()])
    await c.streamGenerate(
      req({
        tools: [{ name: 'Read', description: 'd', parameters: { type: 'object' } }],
        temperature: 1.3,
        maxOutputTokens: 100,
        responseMimeType: 'application/json',
      }),
    )
    const r = server!.requests[0]
    expect(r.url).toBe('/v1/publishers/google/models/gemini-3.8-flash:streamGenerateContent?alt=sse')
    expect(r.url).not.toContain(KEY)
    expect(r.headers['x-goog-api-key']).toBe(KEY)
    expect(r.body.systemInstruction).toEqual({ parts: [{ text: 'You are ARC.' }] })
    expect(r.body.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }])
    expect(r.body.tools).toEqual([{ functionDeclarations: [{ name: 'Read', description: 'd', parameters: { type: 'object' } }] }])
    expect(r.body.generationConfig).toEqual({ temperature: 1.3, maxOutputTokens: 100, responseMimeType: 'application/json' })
  })

  it('omits tools and generationConfig when not given', async () => {
    const { c } = await client([ok()])
    await c.streamGenerate(req())
    expect(server!.requests[0].body.tools).toBeUndefined()
    expect(server!.requests[0].body.generationConfig).toBeUndefined()
  })
})

describe('streaming', () => {
  it('streams text deltas in order and merges adjacent text parts', async () => {
    const { c } = await client([
      { chunks: [chunk([{ text: 'Hel' }]), chunk([{ text: 'lo ' }]), chunk([{ text: 'world' }], {}, 'STOP')] },
    ])
    const seen: string[] = []
    const res = await c.streamGenerate(req(), (t) => seen.push(t))
    expect(seen).toEqual(['Hel', 'lo ', 'world'])
    expect(res.parts).toEqual([{ text: 'Hello world' }])
    expect(res.finishReason).toBe('STOP')
  })

  it('keeps a functionCall part with its thoughtSignature byte-identical', async () => {
    const call = { functionCall: { name: 'Read', args: { file_path: 'a.ts' }, id: 'c1' }, thoughtSignature: 'CsgBAXLI2nw==' }
    const { c } = await client([{ chunks: [chunk([{ text: 'Looking.' }]), chunk([call], {}, 'STOP')] }])
    const res = await c.streamGenerate(req())
    expect(res.parts).toEqual([{ text: 'Looking.' }, call])
  })

  it('does not merge a text part that carries a thoughtSignature', async () => {
    const { c } = await client([
      { chunks: [chunk([{ text: 'a' }]), chunk([{ text: 'b', thoughtSignature: 'SIG' }]), chunk([{ text: 'c' }])] },
    ])
    const res = await c.streamGenerate(req())
    expect(res.parts).toEqual([{ text: 'a' }, { text: 'b', thoughtSignature: 'SIG' }, { text: 'c' }])
  })

  it('takes cumulative usage from the last chunk and maps token counts', async () => {
    const { c } = await client([
      {
        chunks: [
          chunk([{ text: 'x' }], { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1, totalTokenCount: 11 } }),
          chunk([{ text: 'y' }], { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 7, totalTokenCount: 22 } }, 'STOP'),
        ],
      },
    ])
    const res = await c.streamGenerate(req())
    expect(res.usage).toEqual({ promptTokens: 10, outputTokens: 12, totalTokens: 22 })
  })

  it('reports a blocked prompt as finishReason SAFETY', async () => {
    const { c } = await client([{ chunks: [sse({ promptFeedback: { blockReason: 'SAFETY' } })] }])
    const res = await c.streamGenerate(req())
    expect(res.finishReason).toBe('SAFETY')
    expect(res.parts).toEqual([])
  })

  it('tolerates an empty candidate chunk', async () => {
    const { c } = await client([{ chunks: [sse({ candidates: [{}] }), chunk([{ text: 'ok' }], {}, 'STOP')] }])
    expect((await c.streamGenerate(req())).parts).toEqual([{ text: 'ok' }])
  })
})

describe('retries and errors', () => {
  it('retries a 429 once and succeeds after sleeping 1000 ms', async () => {
    const { c, sleeps } = await client([{ status: 429 }, ok('fine')])
    const res = await c.streamGenerate(req())
    expect(res.parts).toEqual([{ text: 'fine' }])
    expect(sleeps).toEqual([1000])
    expect(server!.requests).toHaveLength(2)
  })

  it('survives four 429s and succeeds on the fifth request', async () => {
    const { c, sleeps } = await client([{ status: 429 }, { status: 429 }, { status: 429 }, { status: 429 }, ok()])
    await c.streamGenerate(req())
    expect(sleeps).toEqual([1000, 2000, 4000, 8000])
  })

  it('gives up after exactly four retries with kind rate', async () => {
    const { c, sleeps } = await client(Array.from({ length: 6 }, () => ({ status: 429 })))
    const err = await c.streamGenerate(req()).catch((e) => e)
    expect(err).toBeInstanceOf(VertexError)
    expect(err.kind).toBe('rate')
    expect(sleeps).toEqual([1000, 2000, 4000, 8000])
    expect(server!.requests).toHaveLength(5)
  })

  it('treats 503 like 429 and reports kind server when exhausted', async () => {
    const { c } = await client([{ status: 503 }, ok('up')])
    expect((await c.streamGenerate(req())).parts).toEqual([{ text: 'up' }])
    await server!.close()
    const second = await client(Array.from({ length: 6 }, () => ({ status: 503 })))
    const err = await second.c.streamGenerate(req()).catch((e) => e)
    expect(err.kind).toBe('server')
  })

  it('does not retry 401 and reports kind auth', async () => {
    const { c, sleeps } = await client([{ status: 401 }, ok()])
    const err = await c.streamGenerate(req()).catch((e) => e)
    expect(err.kind).toBe('auth')
    expect(err.status).toBe(401)
    expect(sleeps).toEqual([])
    expect(server!.requests).toHaveLength(1)
  })

  it('does not retry 400 and reports kind bad-request with the server message', async () => {
    const { c } = await client([{ status: 400, body: JSON.stringify({ error: { message: 'Unknown model' } }) }, ok()])
    const err = await c.streamGenerate(req()).catch((e) => e)
    expect(err.kind).toBe('bad-request')
    expect(err.message).toContain('Unknown model')
    expect(server!.requests).toHaveLength(1)
  })

  it('never puts the API key in an error message', async () => {
    const body = JSON.stringify({ error: { message: `API key not valid: ${KEY}` } })
    const { c } = await client([{ status: 400, body }])
    const err = await c.streamGenerate(req()).catch((e) => e)
    expect(err.message).not.toContain(KEY)
    expect(err.message).toContain('[REDACTED]')
  })

  it('maps an abort mid-stream to kind aborted and keeps the partial output', async () => {
    const { c } = await client([{ chunks: [chunk([{ text: 'partial' }])], holdMs: Infinity }])
    const ctl = new AbortController()
    const err = await c.streamGenerate(req({ signal: ctl.signal }), () => ctl.abort()).catch((e) => e)
    expect(err.kind).toBe('aborted')
    expect(err.partial.parts).toEqual([{ text: 'partial' }])
  })

  it('reports a dropped connection as kind network with the partial output', async () => {
    const { c } = await client([{ chunks: [chunk([{ text: 'so far' }])], drop: true }])
    const err = await c.streamGenerate(req()).catch((e) => e)
    expect(err.kind).toBe('network')
    expect(err.partial.parts).toEqual([{ text: 'so far' }])
  })

  it('an already-aborted signal fails fast without a request', async () => {
    const { c } = await client([ok()])
    const ctl = new AbortController()
    ctl.abort()
    const err = await c.streamGenerate(req({ signal: ctl.signal })).catch((e) => e)
    expect(err.kind).toBe('aborted')
    expect(server!.requests).toHaveLength(0)
  })
})

describe('Stop during backoff (review finding 7)', () => {
  it('aborts promptly instead of waiting out the retry delay', async () => {
    const { c } = await client([{ status: 429 }, ok()], { sleep: () => new Promise<void>(() => undefined) })
    const ctl = new AbortController()
    const started = Date.now()
    setTimeout(() => ctl.abort(), 50)
    const err = await c.streamGenerate(req({ signal: ctl.signal })).catch((e) => e)
    expect(err.kind).toBe('aborted')
    expect(Date.now() - started).toBeLessThan(1500)
  })
})

describe('testConnection', () => {
  it('is ok on a 200', async () => {
    const { c } = await client([ok()])
    expect(await c.testConnection()).toMatchObject({ ok: true })
  })

  it('falls back to ?key= after a 401 on the header style, then keeps using it', async () => {
    const { c } = await client([{ status: 401 }, ok(), ok()])
    const t = await c.testConnection()
    expect(t.ok).toBe(true)
    expect(server!.requests[0].headers['x-goog-api-key']).toBe(KEY)
    expect(server!.requests[1].url).toContain(`key=${KEY}`)
    expect(server!.requests[1].headers['x-goog-api-key']).toBeUndefined()
    await c.streamGenerate(req())
    expect(server!.requests[2].url).toContain('key=')
  })

  it('reports failure without leaking the key when both styles fail', async () => {
    const body = JSON.stringify({ error: { message: `bad key ${KEY}` } })
    const { c } = await client([{ status: 401, body }, { status: 401, body }])
    const t = await c.testConnection()
    expect(t.ok).toBe(false)
    expect(t.message).not.toContain(KEY)
  })

  it('reports a rejected model without trying the query style', async () => {
    const { c } = await client([{ status: 404, body: JSON.stringify({ error: { message: 'model not found' } }) }])
    const t = await c.testConnection()
    expect(t.ok).toBe(false)
    expect(t.message).toContain('model not found')
    expect(server!.requests).toHaveLength(1)
  })
})
