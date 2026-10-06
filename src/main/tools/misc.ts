import { Agent, fetch as undiciFetch } from 'undici'
import { z } from 'zod'
import type { ToolResult } from '../../shared/types'
import { checkUrl, safeLookup } from '../safety/ssrf'
import type { Tool } from './registry'

const fail = (output: string): ToolResult => ({ ok: false, output })

// ------------------------------------------------------------------ TodoWrite

const TodoSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
  status: z.enum(['pending', 'in_progress', 'completed']),
})

export const todoTool: Tool<{ todos: z.infer<typeof TodoSchema>[] }> = {
  name: 'TodoWrite',
  description:
    'Keep the visible task checklist. Send the full list each time. At most one item may be in_progress.',
  schema: z.object({ todos: z.array(TodoSchema) }),
  async run({ todos }, ctx) {
    if (todos.filter((t) => t.status === 'in_progress').length > 1) {
      return fail('Only one todo can be in_progress at a time')
    }
    ctx.session.todos = todos
    ctx.emit({ type: 'todos', todos })
    const done = todos.filter((t) => t.status === 'completed').length
    return { ok: true, output: `Todos updated: ${done} of ${todos.length} done.` }
  },
}

// -------------------------------------------------------------------- AskUser

export const askUserTool: Tool<{ question: string; options?: string[] }> = {
  name: 'AskUser',
  description:
    'Ask the user a question when you are blocked on a decision only they can make. Optionally offer short answer options.',
  schema: z.object({
    question: z.string().min(1),
    options: z.array(z.string().min(1)).max(6).optional(),
  }),
  async run({ question, options }, ctx) {
    const answer = await ctx.askUser(options ? { question, options } : { question })
    return { ok: true, output: answer }
  },
}

// ------------------------------------------------------------------- WebFetch

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

const MAX_REDIRECTS = 5
const MAX_BODY_BYTES = 2 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15_000

const agent = new Agent({ connect: { lookup: safeLookup } })
const guardedFetch: FetchLike = (url, init) =>
  undiciFetch(url, { ...(init as object), dispatcher: agent }) as unknown as Promise<Response>

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#39;/g, "'")
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => ENTITIES[n])
}

function htmlToText(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|ul|ol|section|article|header|footer|pre|blockquote|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeEntities(stripped)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
}

async function readCapped(res: Response): Promise<{ text: string; cut: boolean }> {
  if (!res.body) return { text: '', cut: false }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let cut = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_BODY_BYTES) {
      chunks.push(value.slice(0, value.length - (total - MAX_BODY_BYTES)))
      cut = true
      await reader.cancel()
      break
    }
    chunks.push(value)
  }
  return { text: Buffer.concat(chunks).toString('utf8'), cut }
}

const TEXTUAL = /^(text\/|application\/(json|xml|xhtml\+xml|javascript)|.*\+(json|xml))/i

export function makeWebFetchTool(opts: {
  fetch?: FetchLike
  resolve?: (host: string) => Promise<string[]>
} = {}): Tool<{ url: string }> {
  const doFetch = opts.fetch ?? guardedFetch
  return {
    name: 'WebFetch',
    description: 'Fetch a public web page over http(s) and return its text. Private and local addresses are blocked.',
    schema: z.object({ url: z.string().min(1).describe('The http or https URL to fetch') }),
    async run({ url }, ctx) {
      let current = url
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const check = await checkUrl(current, opts.resolve)
        if (!check.ok) return fail(check.reason)
        let res: Response
        try {
          res = await doFetch(check.url.toString(), {
            redirect: 'manual',
            signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]),
            headers: { 'user-agent': 'AIVEN-ARC/0.1', accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' },
          })
        } catch (err) {
          return fail(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`)
        }
        if ([301, 302, 303, 307, 308].includes(res.status)) {
          const location = res.headers.get('location')
          if (!location) return fail(`Redirect without a location from ${current}`)
          if (hop === MAX_REDIRECTS) return fail(`Too many redirects (more than ${MAX_REDIRECTS})`)
          current = new URL(location, check.url).toString()
          continue
        }
        if (!res.ok) return fail(`HTTP ${res.status} from ${current}`)
        const type = res.headers.get('content-type') ?? ''
        if (!TEXTUAL.test(type)) return fail(`Unsupported content type: ${type || 'unknown'}`)
        const { text, cut } = await readCapped(res)
        const body = /html/i.test(type) ? htmlToText(text) : text
        return { ok: true, output: cut ? `${body}\n[content cut at 2 MB]` : body }
      }
      return fail(`Too many redirects (more than ${MAX_REDIRECTS})`)
    },
  }
}
