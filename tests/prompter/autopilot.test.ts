import { describe, expect, it } from 'vitest'
import { runAutopilot } from '../../src/main/prompter/autopilot'
import type { Content } from '../../src/main/vertex/types'
import type { AgentEvent, PermissionMode, Suggestion, TurnEndReason } from '../../src/shared/types'

const sug = (n: number): Suggestion => ({ title: `Idea ${n}`, prompt: `Do idea ${n}`, kind: 'feature' })

function harness(over: {
  suggest?: () => Promise<Suggestion[]>
  turn?: (prompt: string) => TurnEndReason | Promise<TurnEndReason>
  maxRounds?: number
  tokenBudget?: number
  usedTokens?: () => number
  history?: Content[]
  signal?: AbortSignal
} = {}) {
  const sent: string[] = []
  const events: AgentEvent[] = []
  let n = 0
  const session = {
    mode: 'ask' as PermissionMode,
    getHistory: () => over.history ?? [],
    sendMessage: async (prompt: string) => {
      sent.push(prompt)
      return over.turn ? over.turn(prompt) : 'done'
    },
  }
  const run = () =>
    runAutopilot({
      session,
      suggest: over.suggest ?? (async () => [sug(++n), sug(100 + n), sug(200 + n)]),
      maxRounds: over.maxRounds ?? 5,
      tokenBudget: over.tokenBudget ?? 1_000_000,
      usedTokens: over.usedTokens ?? (() => 0),
      signal: over.signal ?? new AbortController().signal,
      emit: (e) => events.push(e),
    })
  return { run, sent, events, session }
}

describe('runAutopilot', () => {
  it('sends the top suggestion each round and stops at the round cap', async () => {
    const h = harness({ maxRounds: 5 })
    expect(await h.run()).toBe('rounds')
    expect(h.sent).toEqual(['Do idea 1', 'Do idea 2', 'Do idea 3', 'Do idea 4', 'Do idea 5'])
  })

  it('stops when the token budget is spent', async () => {
    let used = 0
    const h = harness({ tokenBudget: 1000, usedTokens: () => used, turn: () => ((used += 600), 'done') })
    expect(await h.run()).toBe('budget')
    expect(h.sent).toHaveLength(2)
  })

  it('stops when the suggestion repeats one already sent, ignoring case and spacing', async () => {
    const texts = ['Add tests', '  add   TESTS ']
    let i = 0
    const h = harness({ suggest: async () => [{ title: 't', prompt: texts[i++ % 2], kind: 'test' }] })
    expect(await h.run()).toBe('duplicate')
    expect(h.sent).toEqual(['Add tests'])
  })

  it('also treats an earlier user message in the session as a duplicate', async () => {
    const history: Content[] = [{ role: 'user', parts: [{ text: 'Do idea 1' }] }]
    const h = harness({ history })
    expect(await h.run()).toBe('duplicate')
    expect(h.sent).toEqual([])
  })

  it('stops with turn-failed when a turn does not end done', async () => {
    const h = harness({ turn: () => 'error' })
    expect(await h.run()).toBe('turn-failed')
    expect(h.sent).toHaveLength(1)
  })

  it('reports stopped when the turn itself was stopped', async () => {
    const h = harness({ turn: () => 'stopped' })
    expect(await h.run()).toBe('stopped')
  })

  it('stops between rounds when the signal is aborted', async () => {
    const ctl = new AbortController()
    const h = harness({ signal: ctl.signal, turn: () => (ctl.abort(), 'done') })
    expect(await h.run()).toBe('stopped')
    expect(h.sent).toHaveLength(1)
  })

  it('does not send anything when already aborted', async () => {
    const ctl = new AbortController()
    ctl.abort()
    const h = harness({ signal: ctl.signal })
    expect(await h.run()).toBe('stopped')
    expect(h.sent).toEqual([])
  })

  it('stops when there are no suggestions', async () => {
    const h = harness({ suggest: async () => [] })
    expect(await h.run()).toBe('no-suggestions')
  })

  it('stops when aborted while waiting for suggestions', async () => {
    const ctl = new AbortController()
    const h = harness({ signal: ctl.signal, suggest: async () => (ctl.abort(), [sug(1)]) })
    expect(await h.run()).toBe('stopped')
    expect(h.sent).toEqual([])
  })

  it('announces each round and never touches the permission mode', async () => {
    const h = harness({ maxRounds: 2 })
    await h.run()
    expect(h.session.mode).toBe('ask')
    const notes = h.events.filter((e) => e.type === 'notice').map((e) => (e as { message: string }).message)
    expect(notes).toEqual(['Autopilot 1 of 2: Idea 1', 'Autopilot 2 of 2: Idea 2'])
  })
})
