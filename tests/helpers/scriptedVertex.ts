import type { GenerateRequest, GenerateResult, Part, Usage } from '../../src/main/vertex/types'
import { VertexError } from '../../src/main/vertex/types'

export interface ScriptTurn {
  parts?: Part[]
  finishReason?: string
  usage?: Usage
  /** Throw this instead of returning. */
  error?: VertexError
  /** Text deltas to emit; defaults to the text parts. */
  textDeltas?: string[]
  /** Never finish; only an abort ends the request (mid-stream stop). */
  hold?: boolean
  /** Parts that had streamed in before a hold was aborted. */
  partialParts?: Part[]
  /** Inspect the request when it arrives. */
  onRequest?: (req: GenerateRequest) => void | Promise<void>
}

export interface ScriptedVertex {
  requests: GenerateRequest[]
  streamGenerate(req: GenerateRequest, onText?: (t: string) => void): Promise<GenerateResult>
}

export const textTurn = (text: string, extra: Partial<ScriptTurn> = {}): ScriptTurn => ({
  parts: [{ text }],
  finishReason: 'STOP',
  ...extra,
})

export const callTurn = (
  calls: Array<{ name: string; args: Record<string, unknown>; id?: string }>,
  extra: Partial<ScriptTurn> = {},
): ScriptTurn => ({
  parts: calls.map((c) => ({ functionCall: { name: c.name, args: c.args, ...(c.id ? { id: c.id } : {}) } })),
  finishReason: 'STOP',
  ...extra,
})

/** An in-memory stand-in for VertexClient that serves one scripted turn per call. */
export function scriptedVertex(turns: ScriptTurn[]): ScriptedVertex {
  const requests: GenerateRequest[] = []
  let next = 0
  return {
    requests,
    async streamGenerate(req, onText) {
      // Snapshot: the loop keeps mutating its history array after the call.
      requests.push({ ...req, contents: structuredClone(req.contents) })
      const turn = turns[next++]
      if (!turn) throw new Error('scripted vertex: script exhausted')
      await turn.onRequest?.(requests[requests.length - 1])
      if (turn.hold) {
        const partial: GenerateResult = { parts: turn.partialParts ?? [] }
        for (const p of partial.parts) if (p.text) onText?.(p.text)
        await new Promise<void>((_, reject) => {
          const abort = () => reject(new VertexError('The request was stopped', 'aborted', 0, partial))
          if (req.signal?.aborted) abort()
          else req.signal?.addEventListener('abort', abort, { once: true })
        })
      }
      if (turn.error) throw turn.error
      const parts = turn.parts ?? []
      const deltas = turn.textDeltas ?? parts.filter((p) => p.text).map((p) => p.text!)
      for (const d of deltas) onText?.(d)
      return { parts: structuredClone(parts), finishReason: turn.finishReason, usage: turn.usage }
    },
  }
}
