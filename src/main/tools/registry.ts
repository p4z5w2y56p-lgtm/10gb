import { z } from 'zod'
import { TOOL_OUTPUT_CAP } from '../../shared/constants'
import type { AgentEvent, TodoItem, ToolCall, ToolName, ToolResult } from '../../shared/types'

export interface AskUserQuestion {
  question: string
  options?: string[]
}

export interface SessionState {
  /** Files read this session: absolute path -> mtimeMs at read time. */
  readFiles: Map<string, number>
  todos: TodoItem[]
}

/** The slice of the checkpoint store the write tools need. */
export interface Checkpointer {
  snapshot(absPath: string): Promise<void>
}

export interface ToolContext {
  projectRoot: string
  extraDirs: string[]
  signal: AbortSignal
  session: SessionState
  checkpoints: Checkpointer
  emit: (e: AgentEvent) => void
  askUser: (q: AskUserQuestion) => Promise<string>
  settings: { bashTimeoutMs: number }
  home: string
  protectedPaths: string[]
  /** Compare protected paths case-insensitively (default APFS volumes). */
  caseInsensitive?: boolean
  /** Extra environment variable names to scrub from child processes. */
  arcEnv: string[]
}

export interface Tool<A = any> {
  name: ToolName
  description: string
  schema: z.ZodType<A>
  run(args: A, ctx: ToolContext): Promise<ToolResult>
}

/** Gemini function declaration. */
export interface FunctionDeclaration {
  name: string
  description: string
  parameters: object
}

export interface ToolRegistry {
  declarations(): FunctionDeclaration[]
  execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult>
}

export function truncate(text: string, cap: number = TOOL_OUTPUT_CAP): string {
  if (text.length <= cap) return text
  return `${text.slice(0, cap)}\n[truncated ${text.length - cap} chars]`
}

const STRIP_KEYS = new Set(['$schema', '$id', 'additionalProperties', 'default', 'examples'])

/** Reduce a JSON Schema to the OpenAPI subset Gemini accepts. */
function toGeminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toGeminiSchema)
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node)) {
      if (!STRIP_KEYS.has(k)) out[k] = toGeminiSchema(v)
    }
    return out
  }
  return node
}

export function createRegistry(tools: Tool[]): ToolRegistry {
  const byName = new Map<string, Tool>()
  for (const t of tools) {
    if (byName.has(t.name)) throw new Error(`Duplicate tool name: ${t.name}`)
    byName.set(t.name, t)
  }

  return {
    declarations() {
      return tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: toGeminiSchema(z.toJSONSchema(t.schema)) as object,
      }))
    },

    async execute(call, ctx) {
      const tool = byName.get(call.name)
      if (!tool) return { ok: false, output: `Unknown tool: ${call.name}` }
      const parsed = tool.schema.safeParse(call.args)
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ')
        return { ok: false, output: `Invalid arguments for ${call.name}: ${issues}` }
      }
      try {
        const result = await tool.run(parsed.data, ctx)
        return { ok: result.ok, output: truncate(result.output) }
      } catch (err) {
        return { ok: false, output: `${call.name} failed: ${err instanceof Error ? err.message : String(err)}` }
      }
    },
  }
}
