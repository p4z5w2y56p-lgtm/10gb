import type { FunctionDeclaration } from '../tools/registry'

export type { FunctionDeclaration }

export interface Part {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  functionCall?: { name: string; args: Record<string, unknown>; id?: string }
  functionResponse?: { name: string; id?: string; response: { output: string } }
}

export interface Content {
  role: 'user' | 'model'
  parts: Part[]
}

export interface Usage {
  promptTokens: number
  outputTokens: number
  totalTokens: number
}

export interface GenerateRequest {
  systemInstruction: string
  contents: Content[]
  tools?: FunctionDeclaration[]
  temperature?: number
  maxOutputTokens?: number
  responseMimeType?: string
  signal?: AbortSignal
}

export interface GenerateResult {
  parts: Part[]
  finishReason?: string
  usage?: Usage
}

export type VertexErrorKind = 'auth' | 'rate' | 'server' | 'bad-request' | 'network' | 'aborted'

export class VertexError extends Error {
  constructor(
    message: string,
    readonly kind: VertexErrorKind,
    readonly status: number,
    /** What had streamed in before the failure, so a dropped turn keeps its partial output. */
    readonly partial?: GenerateResult,
  ) {
    super(message)
    this.name = 'VertexError'
  }
}
