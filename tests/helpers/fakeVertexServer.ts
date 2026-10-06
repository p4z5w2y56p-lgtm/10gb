import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface FakeEntry {
  status?: number
  /** Raw pieces written one by one; strings are UTF-8 encoded. */
  chunks?: Array<string | Buffer>
  /** Wait this long after the last chunk before ending (or forever with Infinity). */
  holdMs?: number
  /** Abruptly close the connection after writing the chunks. */
  drop?: boolean
  body?: string
}

export interface FakeRequest {
  url: string
  headers: IncomingHttpHeaders
  body: any
}

export interface FakeVertex {
  baseUrl: string
  requests: FakeRequest[]
  close(): Promise<void>
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** An SSE chunk as Vertex sends it. */
export const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\r\n\r\n`

/** A candidate chunk carrying parts. */
export const chunk = (parts: unknown[], extra: Record<string, unknown> = {}, finishReason?: string) =>
  sse({ candidates: [{ content: { role: 'model', parts }, ...(finishReason ? { finishReason } : {}) }], ...extra })

/** Each script entry answers one request, in order. */
export async function startFakeVertex(script: FakeEntry[]): Promise<FakeVertex> {
  const requests: FakeRequest[] = []
  let index = 0
  const sockets = new Set<import('node:net').Socket>()
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const piece of req) raw += piece
    requests.push({ url: req.url ?? '', headers: req.headers, body: raw ? JSON.parse(raw) : undefined })
    const entry = script[index++] ?? { status: 500, body: JSON.stringify({ error: { message: 'script exhausted' } }) }
    const status = entry.status ?? 200
    if (status !== 200) {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(entry.body ?? JSON.stringify({ error: { message: `fake status ${status}` } }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const c of entry.chunks ?? []) {
      res.write(c)
      await sleep(8)
    }
    if (entry.drop) {
      res.destroy()
      return
    }
    if (entry.holdMs !== undefined) {
      if (entry.holdMs === Infinity) return
      await sleep(entry.holdMs)
    }
    res.end()
  })
  server.on('connection', (s) => {
    s.setNoDelay(true)
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy()
        server.close(() => r())
      }),
  }
}
