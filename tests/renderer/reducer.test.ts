import { describe, expect, it } from 'vitest'
import { initialState, reduce, type AppState } from '../../src/renderer/state/reducer'
import type { AgentEvent, ToolCall } from '../../src/shared/types'

const ev = (state: AppState, ...events: AgentEvent[]) => events.reduce((s, event) => reduce(s, { type: 'event', event }), state)
const call = (id: string, name = 'Read', args: Record<string, unknown> = { file_path: 'a.ts' }): ToolCall => ({ id, name, args })
const allow = { verdict: 'allow' as const, reason: 'ok' }

describe('transcript', () => {
  it('appends text deltas to the streaming assistant item and starts one when needed', () => {
    let s = ev(initialState, { type: 'text-delta', text: 'Hel' }, { type: 'text-delta', text: 'lo' })
    expect(s.transcript).toHaveLength(1)
    expect(s.transcript[0]).toMatchObject({ kind: 'assistant', text: 'Hello', streaming: true })
    s = ev(s, { type: 'turn-end', reason: 'done' })
    expect(s.transcript[0]).toMatchObject({ streaming: false })
  })

  it('starts a new assistant item after an activity instead of appending to the old text', () => {
    const s = ev(
      initialState,
      { type: 'text-delta', text: 'Looking.' },
      { type: 'tool-call', call: call('c1'), verdict: allow },
      { type: 'text-delta', text: 'Found it.' },
    )
    expect(s.transcript.map((i) => i.kind)).toEqual(['assistant', 'activity', 'assistant'])
    expect(s.transcript[2]).toMatchObject({ text: 'Found it.' })
  })

  it('a user message appends, marks busy and clears old suggestions', () => {
    let s = ev(initialState, { type: 'suggestions', items: [{ title: 'a', prompt: 'p', kind: 'feature' }] })
    s = reduce(s, { type: 'user-message', text: 'fix it' })
    expect(s.transcript.at(-1)).toMatchObject({ kind: 'user', text: 'fix it' })
    expect(s.busy).toBe(true)
    expect(s.suggestions).toEqual([])
  })

  it('assigns every item a unique id', () => {
    const s = ev(reduce(initialState, { type: 'user-message', text: 'x' }), { type: 'text-delta', text: 'y' }, { type: 'notice', level: 'info', message: 'z' })
    expect(new Set(s.transcript.map((i) => i.id)).size).toBe(3)
  })
})

describe('activity', () => {
  it('folds tool-call, activity, tool-result and activity into ONE finished item', () => {
    const s = ev(
      initialState,
      { type: 'tool-call', call: call('c1', 'Edit', { file_path: 'app.ts' }), verdict: allow },
      { type: 'activity', id: 'c1', phase: 'editing', label: 'Editing app.ts', state: 'running' },
      { type: 'tool-start', id: 'c1' },
      { type: 'tool-result', id: 'c1', result: { ok: true, output: 'Edited app.ts\n-a\n+b' } },
      { type: 'activity', id: 'c1', phase: 'editing', label: 'Edited app.ts', state: 'done' },
    )
    const items = s.transcript.filter((i) => i.kind === 'activity')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'c1', state: 'done', label: 'Edited app.ts', phase: 'editing',
      call: { name: 'Edit', args: { file_path: 'app.ts' } },
      output: 'Edited app.ts\n-a\n+b',
    })
  })

  it('shows a plain-language label as soon as the call is announced', () => {
    const s = ev(initialState, { type: 'tool-call', call: call('c1', 'Bash', { command: 'npm test' }), verdict: allow })
    expect(s.transcript[0]).toMatchObject({ kind: 'activity', state: 'running', label: 'Running the tests' })
  })

  it('marks a denied call as denied', () => {
    const s = ev(
      initialState,
      { type: 'tool-call', call: call('c1', 'Write', { file_path: '~/.ssh/x' }), verdict: { verdict: 'deny', reason: 'protected' } },
      { type: 'activity', id: 'c1', phase: 'writing', label: 'Blocked: Creating x', state: 'denied' },
    )
    expect(s.transcript[0]).toMatchObject({ state: 'denied', label: 'Blocked: Creating x' })
  })

  it('creates an item for an activity that was never announced', () => {
    const s = ev(initialState, { type: 'activity', id: 'z', phase: 'running', label: 'Running a command', state: 'running' })
    expect(s.transcript).toHaveLength(1)
    expect(s.transcript[0]).toMatchObject({ kind: 'activity', id: 'z' })
  })

  it('leaves no activity spinning after the turn ends', () => {
    const s = ev(initialState, { type: 'tool-call', call: call('c1'), verdict: allow }, { type: 'turn-end', reason: 'stopped' })
    expect(s.transcript[0]).toMatchObject({ state: 'failed' })
  })
})

describe('approvals and questions', () => {
  const request = { call: call('e1', 'Edit', { file_path: 'a.ts' }), reason: 'Edit a.ts', diff: '-a\n+b' }

  it('sets the approval, attaches the diff to its activity, and clears it on tool-start', () => {
    let s = ev(initialState, { type: 'tool-call', call: request.call, verdict: { verdict: 'ask', reason: 'r' } }, { type: 'approval-request', request })
    expect(s.approval).toEqual(request)
    expect(s.transcript[0]).toMatchObject({ diff: '-a\n+b' })
    s = ev(s, { type: 'tool-start', id: 'e1' })
    expect(s.approval).toBeNull()
  })

  it('clears a pending approval or question when the turn ends', () => {
    let s = ev(initialState, { type: 'approval-request', request }, { type: 'question', id: 'q1', question: 'Which?', options: ['a', 'b'] })
    expect(s.question).toEqual({ id: 'q1', question: 'Which?', options: ['a', 'b'] })
    s = ev(s, { type: 'turn-end', reason: 'stopped' })
    expect(s.approval).toBeNull()
    expect(s.question).toBeNull()
  })
})

describe('other state', () => {
  it('tracks status, todos, usage, mode, changes, suggestions and autopilot', () => {
    const s = ev(
      initialState,
      { type: 'status', state: 'working', label: 'Editing app.ts' },
      { type: 'todos', todos: [{ id: '1', content: 'a', status: 'completed' }] },
      { type: 'usage', promptTokens: 100, outputTokens: 20, totalTokens: 120 },
      { type: 'mode', mode: 'auto-edit' },
      { type: 'changes', files: ['/p/a.ts'], canUndo: true },
      { type: 'suggestions', items: [{ title: 't', prompt: 'p', kind: 'wild' }] },
      { type: 'autopilot', running: true },
    )
    expect(s.status).toEqual({ state: 'working', label: 'Editing app.ts' })
    expect(s.todos).toHaveLength(1)
    expect(s.usage).toEqual({ promptTokens: 100, totalTokens: 120 })
    expect(s.mode).toBe('auto-edit')
    expect(s.changes).toEqual({ files: ['/p/a.ts'], canUndo: true })
    expect(s.suggestions).toHaveLength(1)
    expect(s.autopilot).toEqual({ running: true })
  })

  it('appends notices', () => {
    const s = ev(initialState, { type: 'notice', level: 'warn', message: 'Stopped after 40 steps.' })
    expect(s.transcript[0]).toMatchObject({ kind: 'notice', level: 'warn', message: 'Stopped after 40 steps.' })
  })

  it('review focus 3: after an error notice and a failed turn the composer is free and nothing says Thinking', () => {
    let s = reduce(initialState, { type: 'user-message', text: 'go' })
    s = ev(s, { type: 'status', state: 'thinking', label: 'Thinking' }, { type: 'notice', level: 'error', message: 'The connection was lost.' }, { type: 'turn-end', reason: 'error' })
    expect(s.busy).toBe(false)
    expect(s.status).toEqual({ state: 'idle', label: 'Idle' })
    expect(s.transcript.at(-1)).toMatchObject({ kind: 'notice', level: 'error' })
  })
})

describe('loading and ui', () => {
  it('merges loaded backend data', () => {
    const s = reduce(initialState, { type: 'loaded', mode: 'ask', changes: { files: [], canUndo: false } })
    expect(s.mode).toBe('ask')
  })

  it('patches ui flags without touching the rest', () => {
    const s = reduce(initialState, { type: 'ui', patch: { settingsOpen: true, settingsSection: 'models' } })
    expect(s.ui.settingsOpen).toBe(true)
    expect(s.ui.sidebar).toBe(initialState.ui.sidebar)
  })

  it('rebuilds a transcript from a resumed history', () => {
    const s = reduce(initialState, {
      type: 'history',
      history: [
        { role: 'user', parts: [{ text: 'Add a login page' }] },
        { role: 'model', parts: [{ text: 'On it.' }, { functionCall: { name: 'Write', args: { file_path: 'login.tsx' }, id: 'w1' } }] },
        { role: 'user', parts: [{ functionResponse: { name: 'Write', id: 'w1', response: { output: 'Created' } } }] },
        { role: 'model', parts: [{ text: 'Done.' }] },
      ],
    })
    expect(s.transcript.map((i) => i.kind)).toEqual(['user', 'assistant', 'activity', 'assistant'])
    expect(s.transcript[2]).toMatchObject({ state: 'done', label: 'Creating login.tsx' })
    expect(s.transcript.every((i) => i.kind !== 'assistant' || !i.streaming)).toBe(true)
  })

  it('reset clears the conversation but keeps settings and app status', () => {
    let s = reduce(initialState, { type: 'loaded', settings: null, app: { ready: true, hasApiKey: true, hasProject: true, projectRoot: '/p', busy: false, mode: 'ask', sessionId: 's' } })
    s = reduce(reduce(s, { type: 'user-message', text: 'x' }), { type: 'reset' })
    expect(s.transcript).toEqual([])
    expect(s.app?.projectRoot).toBe('/p')
  })
})

describe('history-reload (cloud attach and catch-up)', () => {
  const history = [
    { role: 'user' as const, parts: [{ text: 'Add a login page' }] },
    { role: 'model' as const, parts: [{ text: 'On it.' }, { functionCall: { name: 'Write', args: { file_path: 'login.tsx' }, id: 'w1' } }] },
  ]

  it('rebuilds the transcript from the history and keeps the rest of the state', () => {
    let s = reduce(initialState, { type: 'user-message', text: 'stale local text' })
    s = ev(
      s,
      { type: 'todos', todos: [{ id: '1', content: 'a', status: 'pending' }] },
      { type: 'usage', promptTokens: 5, outputTokens: 1, totalTokens: 6 },
      { type: 'mode', mode: 'auto' },
      { type: 'autopilot', running: true },
      { type: 'notice', level: 'info', message: 'old notice' },
    )
    const next = ev(s, { type: 'history-reload', history })
    expect(next.transcript.map((i) => i.kind)).toEqual(['user', 'assistant', 'activity'])
    expect(next.transcript[0]).toMatchObject({ text: 'Add a login page' })
    expect(next.todos).toEqual(s.todos)
    expect(next.usage).toEqual(s.usage)
    expect(next.mode).toBe('auto')
    expect(next.autopilot).toEqual({ running: true })
    expect(next.busy).toBe(true)
    expect(next.ui).toEqual(s.ui)
    expect(next.cloud).toEqual(s.cloud)
  })

  it('forgets a pending approval or question: the router sends the current ones right after', () => {
    const s = ev(
      initialState,
      { type: 'approval-request', request: { call: call('w1', 'Write', { file_path: 'a' }), reason: 'ask' } },
      { type: 'question', id: 'q1', question: 'Which?' },
    )
    expect(s.approval).not.toBeNull()
    const next = ev(s, { type: 'history-reload', history })
    expect(next.approval).toBeNull()
    expect(next.question).toBeNull()
  })

  it('then shows exactly what a connected client would: in-flight text streams on, the approval attaches to its activity', () => {
    const s = ev(
      initialState,
      { type: 'history-reload', history },
      { type: 'text-delta', text: 'Half a sent' },
      { type: 'approval-request', request: { call: call('w1', 'Write', { file_path: 'login.tsx' }), reason: 'ask', diff: '+x' } },
      { type: 'question', id: 'q1', question: 'Which?', options: ['a'] },
      { type: 'status', state: 'waiting-approval', label: 'Waiting for you' },
      { type: 'text-delta', text: 'ence' },
    )
    const assistants = s.transcript.filter((i) => i.kind === 'assistant')
    expect(assistants.at(-1)).toMatchObject({ text: 'Half a sentence', streaming: true })
    expect(s.transcript.find((i) => i.kind === 'activity')).toMatchObject({ callId: 'w1', state: 'running', diff: '+x' })
    expect(s.approval?.call.id).toBe('w1')
    expect(s.question).toEqual({ id: 'q1', question: 'Which?', options: ['a'] })
    expect(s.status.state).toBe('waiting-approval')
    expect(s.busy).toBe(true)
  })

  it('a turn-end after the reload frees the composer', () => {
    const s = ev(initialState, { type: 'history-reload', history }, { type: 'status', state: 'working', label: 'x' }, { type: 'turn-end', reason: 'error' })
    expect(s.busy).toBe(false)
    expect(s.status).toEqual({ state: 'idle', label: 'Idle' })
  })
})

describe('status marks a running turn as busy', () => {
  it('a non-idle status makes the renderer busy even when the turn started elsewhere; idle alone does not clear it', () => {
    let s = ev(initialState, { type: 'status', state: 'thinking', label: 'Thinking' })
    expect(s.busy).toBe(true)
    s = ev(s, { type: 'status', state: 'idle', label: 'Idle' })
    expect(s.busy).toBe(true)
    s = ev(s, { type: 'turn-end', reason: 'done' })
    expect(s.busy).toBe(false)
  })
})
