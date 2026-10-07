export interface SseMessage {
  /** The `event:` name, `message` when the block had none. */
  event: string
  data: string
  /** The `id:` of this block, null when it had none. */
  id: string | null
}

export interface SseParserOptions {
  /** Upper bound for one unfinished message; a worker that never ends a line cannot grow memory without limit. */
  maxMessageBytes?: number
}

const DEFAULT_MAX_MESSAGE_BYTES = 8 * 1024 * 1024

/**
 * Incremental parser for a `text/event-stream` body (WHATWG rules: LF, CR and CRLF line ends, comments,
 * multi-line data, a BOM at the start). Feed it raw bytes as they arrive; multi-byte characters may be split
 * across chunks. One instance per connection.
 */
export class SseParser {
  private readonly decoder = new TextDecoder('utf-8')
  private readonly max: number
  private buf = ''
  private started = false
  private eventName = ''
  private data: string[] = []
  private dataSize = 0
  private id: string | null = null

  constructor(opts: SseParserOptions = {}) {
    this.max = opts.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES
  }

  push(chunk: Uint8Array | string): SseMessage[] {
    let text = typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true })
    if (!this.started && text.length > 0) {
      this.started = true
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    }
    const buf = this.buf + text
    const out: SseMessage[] = []
    let pos = 0
    for (;;) {
      let i = pos
      while (i < buf.length && buf[i] !== '\n' && buf[i] !== '\r') i++
      if (i >= buf.length) break
      // A CR at the very end may be the first half of a CRLF: wait for the next chunk.
      if (buf[i] === '\r' && i + 1 >= buf.length) break
      const line = buf.slice(pos, i)
      pos = buf[i] === '\r' && buf[i + 1] === '\n' ? i + 2 : i + 1
      this.onLine(line, out)
    }
    this.buf = buf.slice(pos)
    if (this.buf.length + this.dataSize > this.max) throw new Error('The event stream sent a message that is too large to read.')
    return out
  }

  private onLine(line: string, out: SseMessage[]): void {
    if (line === '') {
      if (this.data.length > 0) {
        out.push({ event: this.eventName || 'message', data: this.data.join('\n'), id: this.id })
      }
      this.eventName = ''
      this.data = []
      this.dataSize = 0
      this.id = null
      return
    }
    if (line[0] === ':') return
    const colon = line.indexOf(':')
    const name = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value[0] === ' ') value = value.slice(1)
    if (name === 'event') this.eventName = value
    else if (name === 'data') {
      this.data.push(value)
      this.dataSize += value.length + 1
    } else if (name === 'id' && !value.includes('\u0000')) this.id = value
  }
}
