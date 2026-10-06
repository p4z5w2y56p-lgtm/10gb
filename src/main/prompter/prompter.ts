import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { PROMPTER_TEMPERATURE } from '../../shared/constants'
import type { Suggestion } from '../../shared/types'
import { loadProjectMemory } from '../agent/systemPrompt'
import type { VertexClient } from '../vertex/client'
import type { Content } from '../vertex/types'

const exec = promisify(execFile)

const SYSTEM = `You are Spark, the idea agent inside AIVEN ARC. You have no tools and you never write code. Look at the project and the recent conversation, then propose exactly 3 creative, concrete next-step prompts the user could send to the coding agent.

Rules:
- Each prompt is a complete instruction the coding agent can act on without more context, written in the user's voice, one to three sentences.
- Give each a short title of at most six words.
- Use these kinds: feature, fix, test, refactor, polish, wild.
- At least one item must have kind "wild": a lateral, surprising idea that still fits this project.
- Do not repeat work already done in the conversation.
- Reply with only a JSON array of exactly 3 objects with the keys title, prompt and kind.`

const RETRY_NUDGE =
  'That reply was not valid. Reply with only a JSON array of exactly 3 objects with the keys title, prompt and kind, and at least one item with kind "wild".'

const ListSchema = z
  .array(
    z.object({
      title: z.string().trim().min(1).max(80),
      prompt: z.string().trim().min(1),
      kind: z.enum(['feature', 'fix', 'test', 'refactor', 'polish', 'wild']),
    }),
  )
  .length(3)
  .refine((list) => list.some((i) => i.kind === 'wild'))

function parseSuggestions(raw: string): Suggestion[] | null {
  const body = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed = ListSchema.safeParse(JSON.parse(body))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export interface SparkContext {
  projectSummary: string
  transcript: string
  goal?: string
}

/**
 * Ask the prompter model for three next-step prompts. Output is optional by
 * design: any failure, including bad model output, yields an empty list.
 */
export async function generateSuggestions(
  vertex: Pick<VertexClient, 'streamGenerate'>,
  ctx: SparkContext,
  signal?: AbortSignal,
): Promise<Suggestion[]> {
  if (signal?.aborted) return []
  let contents: Content[] = [
    {
      role: 'user',
      parts: [
        {
          text: `Project:\n${ctx.projectSummary}\n\nRecent conversation:\n${ctx.transcript}${
            ctx.goal ? `\n\nThe user's goal: ${ctx.goal}` : ''
          }`,
        },
      ],
    },
  ]
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: string
    try {
      const res = await vertex.streamGenerate({
        systemInstruction: SYSTEM,
        contents,
        temperature: PROMPTER_TEMPERATURE,
        responseMimeType: 'application/json',
        maxOutputTokens: 2048,
        signal,
      })
      raw = res.parts
        .filter((p) => p.text && !p.thought)
        .map((p) => p.text)
        .join('')
    } catch {
      return []
    }
    const parsed = parseSuggestions(raw)
    if (parsed) return parsed
    contents = [
      ...contents,
      { role: 'model', parts: [{ text: raw || '(empty)' }] },
      { role: 'user', parts: [{ text: RETRY_NUDGE }] },
    ]
  }
  return []
}

/** Chat text only (no tool calls or results), newest content kept when over `maxChars`. */
export function transcriptOf(history: Content[], maxChars = 6000): string {
  const lines: string[] = []
  for (const c of history) {
    for (const p of c.parts) {
      if (p.text && !p.thought) lines.push(`${c.role === 'user' ? 'User' : 'Assistant'}: ${p.text.trim()}`)
    }
  }
  if (lines.length === 0) return '(no conversation yet)'
  const all = lines.join('\n')
  if (all.length <= maxChars) return all
  const tail = all.slice(-maxChars)
  const firstBreak = tail.indexOf('\n')
  return firstBreak >= 0 ? tail.slice(firstBreak + 1) : tail
}

const IGNORED = new Set(['.git', 'node_modules', '.arc', 'dist', 'out', 'build', '.DS_Store', '.superpowers'])
const MAX_TREE_ENTRIES = 200
const MAX_TREE_SEGMENTS = 3

/** Project notes, a shallow file tree and `git status`, for the prompter's context. */
export async function summarizeProject(projectRoot: string): Promise<string> {
  const sections: string[] = []
  const memory = await loadProjectMemory(projectRoot)
  if (memory) sections.push(`Project notes:\n${memory.slice(0, 2000)}`)

  const lines: string[] = []
  let more = false
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries = entries
      .filter((e) => !IGNORED.has(e.name))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    for (const e of entries) {
      if (lines.length >= MAX_TREE_ENTRIES) {
        more = true
        return
      }
      lines.push(`${'  '.repeat(depth - 1)}${e.name}${e.isDirectory() ? '/' : ''}`)
      if (e.isDirectory() && depth < MAX_TREE_SEGMENTS) await walk(join(dir, e.name), depth + 1)
    }
  }
  await walk(projectRoot, 1)
  sections.push(
    lines.length === 0
      ? 'Files: (the folder is empty)'
      : `Files:\n${lines.join('\n')}${more ? '\n… (more files not shown)' : ''}`,
  )

  try {
    const { stdout } = await exec('git', ['status', '--short'], { cwd: projectRoot, timeout: 3000 })
    const status = stdout.split('\n').filter(Boolean).slice(0, 30)
    if (status.length) sections.push(`Git status:\n${status.join('\n')}`)
  } catch {
    // not a repository, or git is missing
  }
  return sections.join('\n\n')
}
