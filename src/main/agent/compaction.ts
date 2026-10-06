import { COMPACT_THRESHOLD } from '../../shared/constants'
import type { Content, GenerateRequest, GenerateResult } from '../vertex/types'

export function shouldCompact(totalTokens: number, window: number): boolean {
  return totalTokens >= window * COMPACT_THRESHOLD
}

const SUMMARY_PREFIX = 'Summary of earlier conversation:\n'
const SUMMARIZER_PROMPT =
  'You compress coding conversations. Write a concise plain-text summary of the conversation below. Keep: the user\'s goals, decisions made, files created or changed, commands run and their outcomes, open problems and next steps. No preamble.'

/** A real user prompt, as opposed to a user message that only carries tool results. */
const isUserPrompt = (c: Content): boolean =>
  c.role === 'user' && c.parts.some((p) => p.text !== undefined) && !c.parts.some((p) => p.functionResponse)

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)

function transcript(contents: Content[]): string {
  const lines: string[] = []
  for (const c of contents) {
    for (const p of c.parts) {
      if (p.text) lines.push(`${c.role === 'user' ? 'User' : 'Assistant'}: ${clip(p.text.trim(), 2000)}`)
      else if (p.functionCall) {
        lines.push(`Assistant called ${p.functionCall.name} ${clip(JSON.stringify(p.functionCall.args), 300)}`)
      } else if (p.functionResponse) {
        lines.push(`Tool result (${p.functionResponse.name}): ${clip(p.functionResponse.response.output, 500)}`)
      }
    }
  }
  return lines.join('\n')
}

/**
 * Replace everything before the last `keepLastTurns` user prompts with a summary.
 * The cut always falls on a user prompt, so a functionCall is never separated
 * from its functionResponse. The summary rides on the first kept message to keep
 * user and model turns alternating.
 */
export async function compact(
  vertex: { streamGenerate(req: GenerateRequest): Promise<GenerateResult> },
  history: Content[],
  keepLastTurns = 4,
): Promise<Content[]> {
  const keep = Math.max(1, keepLastTurns)
  const starts = history.flatMap((c, i) => (isUserPrompt(c) ? [i] : []))
  if (starts.length <= keep) return history
  const cut = starts[starts.length - keep]
  const older = history.slice(0, cut)
  const recent = history.slice(cut)

  const res = await vertex.streamGenerate({
    systemInstruction: SUMMARIZER_PROMPT,
    contents: [{ role: 'user', parts: [{ text: transcript(older) }] }],
    temperature: 0.3,
  })
  const summary = res.parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join('')
    .trim()
  if (!summary) throw new Error('The conversation summary came back empty')

  const [first, ...rest] = recent
  return [{ ...first, parts: [{ text: SUMMARY_PREFIX + summary }, ...first.parts] }, ...rest]
}
