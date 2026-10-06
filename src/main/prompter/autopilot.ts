import type { AgentEvent, PermissionMode, Suggestion, TurnEndReason } from '../../shared/types'
import type { Content } from '../vertex/types'

export type AutopilotEnd = 'rounds' | 'budget' | 'duplicate' | 'stopped' | 'no-suggestions' | 'turn-failed'

export interface AutopilotOptions {
  session: {
    readonly mode: PermissionMode
    getHistory(): Content[]
    sendMessage(text: string, signal?: AbortSignal): Promise<TurnEndReason>
  }
  suggest: () => Promise<Suggestion[]>
  maxRounds: number
  tokenBudget: number
  usedTokens: () => number
  signal: AbortSignal
  emit: (e: AgentEvent) => void
}

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

function userPrompts(history: Content[]): string[] {
  return history
    .filter((c) => c.role === 'user' && !c.parts.some((p) => p.functionResponse))
    .map((c) => c.parts.map((p) => p.text ?? '').join(' '))
    .filter((t) => t.trim().length > 0)
}

/**
 * After a finished turn, repeatedly send the top suggestion as the next prompt.
 * Bounded by a round cap, a token budget, de-duplication and the abort signal.
 * It waits naturally whenever the session is waiting on the user, and it never
 * changes the permission mode (it has no handle to do so).
 */
export async function runAutopilot(opts: AutopilotOptions): Promise<AutopilotEnd> {
  const seen = new Set(userPrompts(opts.session.getHistory()).map(normalize))
  let rounds = 0
  for (;;) {
    if (opts.signal.aborted) return 'stopped'
    if (rounds >= opts.maxRounds) return 'rounds'
    if (opts.usedTokens() >= opts.tokenBudget) return 'budget'

    const suggestions = await opts.suggest()
    if (opts.signal.aborted) return 'stopped'
    const top = suggestions[0]
    if (!top) return 'no-suggestions'
    const key = normalize(top.prompt)
    if (seen.has(key)) return 'duplicate'
    seen.add(key)

    rounds++
    opts.emit({ type: 'notice', level: 'info', message: `Autopilot ${rounds} of ${opts.maxRounds}: ${top.title}` })
    const reason = await opts.session.sendMessage(top.prompt, opts.signal)
    if (reason === 'stopped') return 'stopped'
    if (reason !== 'done') return 'turn-failed'
  }
}
