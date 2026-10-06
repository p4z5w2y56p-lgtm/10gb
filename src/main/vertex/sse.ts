function parseEvent(block: string): unknown | undefined {
  const dataLines: string[] = []
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
  }
  const data = dataLines.join('\n').trim()
  if (!data || data === '[DONE]') return undefined
  try {
    return JSON.parse(data)
  } catch {
    throw new Error('Malformed data in the response stream')
  }
}

/** Yield each JSON payload of a Server-Sent Events body. Safe against chunk boundaries inside characters. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = done ? '' : (blocks.pop() ?? '')
      for (const block of blocks) {
        const event = parseEvent(block)
        if (event !== undefined) yield event
      }
      if (done) return
    }
  } finally {
    reader.cancel().catch(() => undefined)
  }
}
