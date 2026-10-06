import { describe, expect, it } from 'vitest'
import { parseSse } from '../../src/main/vertex/sse'

const streamOf = (...chunks: Array<string | Uint8Array>) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === 'string' ? new TextEncoder().encode(c) : c)
      controller.close()
    },
  })

async function collect(stream: ReadableStream<Uint8Array>) {
  const out: unknown[] = []
  for await (const e of parseSse(stream)) out.push(e)
  return out
}

describe('parseSse', () => {
  it('parses two events delivered in one chunk', async () => {
    const out = await collect(streamOf('data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\n'))
    expect(out).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('parses one event split across three chunks', async () => {
    const out = await collect(streamOf('data: {"te', 'xt":"hel', 'lo"}\n\n'))
    expect(out).toEqual([{ text: 'hello' }])
  })

  it('review focus 2: decodes accents and emoji split across byte boundaries', async () => {
    const bytes = new TextEncoder().encode('data: {"t":"café 😀 ünï"}\n\n')
    // split in the middle of the multibyte sequences
    const cuts = [bytes.indexOf(0xc3) + 1, bytes.indexOf(0xf0) + 2, bytes.length - 6]
    const pieces: Uint8Array[] = []
    let prev = 0
    for (const c of cuts) {
      pieces.push(bytes.slice(prev, c))
      prev = c
    }
    pieces.push(bytes.slice(prev))
    const out = await collect(streamOf(...pieces))
    expect(out).toEqual([{ t: 'café 😀 ünï' }])
  })

  it('reassembles an event even when every byte arrives separately', async () => {
    const bytes = new TextEncoder().encode('data: {"t":"é😀"}\n\n')
    const out = await collect(streamOf(...Array.from(bytes, (b) => new Uint8Array([b]))))
    expect(out).toEqual([{ t: 'é😀' }])
  })

  it('ignores comments, empty data and [DONE]', async () => {
    const out = await collect(streamOf(': keep-alive\n\ndata:\n\ndata: [DONE]\n\ndata: {"ok":true}\n\n'))
    expect(out).toEqual([{ ok: true }])
  })

  it('handles a final event with no trailing blank line', async () => {
    const out = await collect(streamOf('data: {"last":true}'))
    expect(out).toEqual([{ last: true }])
  })

  it('joins multi-line data fields', async () => {
    const out = await collect(streamOf('data: {"a":\ndata: 1}\n\n'))
    expect(out).toEqual([{ a: 1 }])
  })

  it('throws on malformed JSON', async () => {
    await expect(collect(streamOf('data: {oops\n\n'))).rejects.toThrow(/malformed/i)
  })
})
