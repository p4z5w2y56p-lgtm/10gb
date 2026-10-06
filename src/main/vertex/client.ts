import { RETRY_MAX } from '../../shared/constants'
import { redact } from '../safety/redact'
import { parseSse } from './sse'
import {
  VertexError,
  type GenerateRequest,
  type GenerateResult,
  type Part,
  type Usage,
  type VertexErrorKind,
} from './types'

export interface VertexConfig {
  apiKey: string
  model: string
  /** Defaults to https://aiplatform.googleapis.com. Tests point this at a local fake. */
  baseUrl?: string
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  authStyle?: 'header' | 'query'
}

const DEFAULT_BASE = 'https://aiplatform.googleapis.com'
const BACKOFF_BASE_MS = 1000

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function mergeUsage(raw: any): Usage | undefined {
  if (!raw) return undefined
  const prompt = raw.promptTokenCount ?? 0
  const output = (raw.candidatesTokenCount ?? 0) + (raw.thoughtsTokenCount ?? 0)
  return { promptTokens: prompt, outputTokens: output, totalTokens: raw.totalTokenCount ?? prompt + output }
}

/** Adjacent plain text merges into one part; anything carrying a signature or a call stays verbatim. */
function addPart(parts: Part[], part: Part): void {
  const last = parts[parts.length - 1]
  const plain = (p: Part) => p.text !== undefined && !p.thoughtSignature && !p.functionCall && !p.functionResponse
  if (last && plain(last) && plain(part) && Boolean(last.thought) === Boolean(part.thought)) {
    last.text = (last.text ?? '') + (part.text ?? '')
  } else {
    parts.push({ ...part })
  }
}

export class VertexClient {
  private authStyle: 'header' | 'query'
  private readonly doFetch: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly cfg: VertexConfig) {
    this.authStyle = cfg.authStyle ?? 'header'
    this.doFetch = cfg.fetch ?? fetch
    this.sleep = cfg.sleep ?? defaultSleep
  }

  private scrub(text: string): string {
    return redact(text, [this.cfg.apiKey])
  }

  private endpoint(): string {
    const base = this.cfg.baseUrl ?? DEFAULT_BASE
    const model = encodeURIComponent(this.cfg.model)
    const key = this.authStyle === 'query' ? `&key=${encodeURIComponent(this.cfg.apiKey)}` : ''
    return `${base}/v1/publishers/google/models/${model}:streamGenerateContent?alt=sse${key}`
  }

  private body(req: GenerateRequest): string {
    const generationConfig: Record<string, unknown> = {}
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature
    if (req.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = req.maxOutputTokens
    if (req.responseMimeType) generationConfig.responseMimeType = req.responseMimeType
    return JSON.stringify({
      systemInstruction: { parts: [{ text: req.systemInstruction }] },
      contents: req.contents,
      ...(req.tools?.length ? { tools: [{ functionDeclarations: req.tools }] } : {}),
      ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
    })
  }

  private async httpError(res: Response): Promise<VertexError> {
    let detail = ''
    try {
      const json = JSON.parse(await res.text())
      detail = String(json?.error?.message ?? '')
    } catch {
      // body was not JSON
    }
    const status = res.status
    let kind: VertexErrorKind = 'bad-request'
    let lead = `The request was rejected (HTTP ${status})`
    if (status === 401 || status === 403) {
      kind = 'auth'
      lead = `The API key was rejected (HTTP ${status})`
    } else if (status === 429) {
      kind = 'rate'
      lead = 'Rate limited by Vertex AI (HTTP 429)'
    } else if (status >= 500) {
      kind = 'server'
      lead = `Vertex AI had a server error (HTTP ${status})`
    }
    return new VertexError(this.scrub(detail ? `${lead}: ${detail}` : lead), kind, status)
  }

  private aborted(partial?: GenerateResult): VertexError {
    return new VertexError('The request was stopped', 'aborted', 0, partial)
  }

  async streamGenerate(req: GenerateRequest, onText?: (text: string) => void): Promise<GenerateResult> {
    const signal = req.signal
    const body = this.body(req)
    let lastError: VertexError | undefined

    for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
      if (signal?.aborted) throw this.aborted()
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (this.authStyle === 'header') headers['x-goog-api-key'] = this.cfg.apiKey

      let res: Response
      try {
        res = await this.doFetch(this.endpoint(), { method: 'POST', headers, body, signal })
      } catch (err) {
        if (signal?.aborted) throw this.aborted()
        lastError = new VertexError(
          this.scrub(`Could not reach Vertex AI: ${err instanceof Error ? err.message : String(err)}`),
          'network',
          0,
        )
        if (attempt < RETRY_MAX) {
          await this.sleep(BACKOFF_BASE_MS * 2 ** attempt)
          continue
        }
        throw lastError
      }

      if (res.ok) return this.consume(res, onText, signal)

      lastError = await this.httpError(res)
      const retryable = res.status === 429 || res.status >= 500
      if (!retryable || attempt === RETRY_MAX) throw lastError
      await this.sleep(BACKOFF_BASE_MS * 2 ** attempt)
    }
    throw lastError ?? new VertexError('Request failed', 'network', 0)
  }

  private async consume(res: Response, onText: ((t: string) => void) | undefined, signal?: AbortSignal): Promise<GenerateResult> {
    const result: GenerateResult = { parts: [] }
    if (!res.body) throw new VertexError('Vertex AI returned an empty response', 'network', 0)
    try {
      for await (const evt of parseSse(res.body)) {
        const event = evt as any
        const cand = event?.candidates?.[0]
        for (const part of (cand?.content?.parts ?? []) as Part[]) {
          addPart(result.parts, part)
          if (part.text && !part.thought) onText?.(part.text)
        }
        if (cand?.finishReason) result.finishReason = cand.finishReason
        if (event?.promptFeedback?.blockReason) result.finishReason = 'SAFETY'
        if (event?.usageMetadata) result.usage = mergeUsage(event.usageMetadata)
      }
    } catch (err) {
      if (signal?.aborted) throw this.aborted(result)
      throw new VertexError(
        this.scrub(`The connection was lost mid-response: ${err instanceof Error ? err.message : String(err)}`),
        'network',
        0,
        result,
      )
    }
    return result
  }

  /** One tiny request. Falls back to the `?key=` auth style if the header style is rejected. */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const ping = () =>
      this.streamGenerate({
        systemInstruction: 'Reply with the single word ok.',
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        maxOutputTokens: 16,
      })
    const failure = (e: unknown) => ({
      ok: false,
      message: this.scrub(e instanceof Error ? e.message : String(e)),
    })
    try {
      await ping()
      return { ok: true, message: `Connected. ${this.cfg.model} responded.` }
    } catch (e) {
      if (e instanceof VertexError && e.kind === 'auth' && this.authStyle === 'header') {
        this.authStyle = 'query'
        try {
          await ping()
          return { ok: true, message: `Connected. ${this.cfg.model} responded (query-parameter key style).` }
        } catch (e2) {
          this.authStyle = 'header'
          return failure(e2)
        }
      }
      return failure(e)
    }
  }
}
