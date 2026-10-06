import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentSession } from '../../src/main/agent/loop'
import { protectedWritePaths } from '../../src/main/safety/protected'
import { AuditLog } from '../../src/main/store/audit'
import { CheckpointStore } from '../../src/main/store/checkpoints'
import { ProjectRules } from '../../src/main/store/projectRules'
import { SessionStore } from '../../src/main/store/sessions'
import { DEFAULT_SETTINGS, type Settings } from '../../src/main/store/settings'
import { globTool, lsTool, makeGrepTool, readTool } from '../../src/main/tools/fsRead'
import { editTool, writeTool } from '../../src/main/tools/fsWrite'
import { makeBashTool } from '../../src/main/tools/bash'
import { askUserTool, makeWebFetchTool, todoTool } from '../../src/main/tools/misc'
import { createRegistry } from '../../src/main/tools/registry'
import { VertexError, type Content } from '../../src/main/vertex/types'
import type { AgentEvent, Approver, PermissionMode } from '../../src/shared/types'
import { makeFixture, type Fixture } from '../helpers/toolContext'
import { callTurn, scriptedVertex, textTurn, type ScriptTurn } from '../helpers/scriptedVertex'

let fx: Fixture | undefined
afterEach(async () => {
  await fx?.cleanup()
  fx = undefined
})

interface Opts {
  mode?: PermissionMode
  approver?: Approver
  settings?: Partial<Settings>
  history?: Content[]
  sandboxAvailable?: boolean
  askUser?: (q: { question: string; options?: string[] }) => Promise<string>
}

async function setup(script: ScriptTurn[], opts: Opts = {}) {
  fx = await makeFixture()
  const base = fx.base
  const home = join(base, 'home')
  await mkdir(home, { recursive: true })
  const events: AgentEvent[] = []
  const vertex = scriptedVertex(script)
  const audit = new AuditLog(join(base, 'audit'), 's1')
  const checkpoints = new CheckpointStore(join(base, 'ckpt'), 's1')
  const sessionStore = new SessionStore(join(base, 'sessions'))
  const handle = sessionStore.create(fx.root)
  const rules = new ProjectRules(fx.root)
  const approvals: Array<{ tool: string; diff?: string; signal: AbortSignal }> = []
  const approver: Approver =
    opts.approver ??
    (async (req, signal) => {
      approvals.push({ tool: req.call.name, diff: req.diff, signal })
      return { decision: 'allow-once' }
    })
  const wrapped: Approver = async (req, signal) => {
    if (opts.approver) approvals.push({ tool: req.call.name, diff: req.diff, signal })
    return approver(req, signal)
  }
  const agent = new AgentSession({
    projectRoot: fx.root,
    settings: { ...DEFAULT_SETTINGS, permissionMode: opts.mode ?? 'ask', ...opts.settings },
    vertex,
    registry: createRegistry([
      readTool, lsTool, globTool, makeGrepTool({ rgPath: null }), editTool, writeTool,
      makeBashTool(), todoTool, askUserTool, makeWebFetchTool(),
    ]),
    audit,
    checkpoints,
    sessions: handle,
    rules,
    approver: wrapped,
    askUser: opts.askUser ?? (async () => 'user answer'),
    emit: (e) => events.push(e),
    home,
    protectedPaths: protectedWritePaths(home, join(base, 'arc-data')),
    sandboxAvailable: opts.sandboxAvailable ?? true,
    history: opts.history,
  })
  return { agent, events, vertex, audit, checkpoints, sessionStore, handle, rules, approvals, root: fx.root, home }
}

const statuses = (events: AgentEvent[]) =>
  events.filter((e): e is Extract<AgentEvent, { type: 'status' }> => e.type === 'status').map((e) => e.state)
const activities = (events: AgentEvent[]) =>
  events.filter((e): e is Extract<AgentEvent, { type: 'activity' }> => e.type === 'activity')
const lastResponses = (req: { contents: Content[] }) => req.contents[req.contents.length - 1].parts.map((p) => p.functionResponse!)
const waitFor = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('basic turns', () => {
  it('a text-only reply ends done and records the exchange', async () => {
    const { agent, events } = await setup([textTurn('Hello there')])
    expect(await agent.sendMessage('hi')).toBe('done')
    expect(agent.getHistory()).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ text: 'Hello there' }] },
    ])
    expect(events.filter((e) => e.type === 'text-delta')).toEqual([{ type: 'text-delta', text: 'Hello there' }])
    expect(events.at(-1)).toEqual({ type: 'turn-end', reason: 'done' })
    expect(statuses(events).at(-1)).toBe('idle')
  })

  it('a Read call returns its result wrapped as untrusted data and echoes the call id', async () => {
    const { agent, vertex, root } = await setup([
      callTurn([{ name: 'Read', args: { file_path: 'a.txt' }, id: 'c1' }]),
      textTurn('Read it.'),
    ])
    await writeFile(join(root, 'a.txt'), 'hello\n')
    expect(await agent.sendMessage('read a.txt')).toBe('done')
    const [resp] = lastResponses(vertex.requests[1])
    expect(resp.id).toBe('c1')
    expect(resp.name).toBe('Read')
    expect(resp.response.output).toMatch(/^<untrusted_data>\n/)
    expect(resp.response.output).toContain('     1\thello')
  })

  it('sends the system prompt, the tool declarations and the signal with every request', async () => {
    const { agent, vertex } = await setup([textTurn('ok')])
    await agent.sendMessage('hi')
    const req = vertex.requests[0]
    expect(req.systemInstruction).toContain('You are ARC')
    expect(req.tools?.map((t) => t.name)).toContain('Edit')
    expect(req.signal).toBeInstanceOf(AbortSignal)
  })

  it('review: keeps the model parts, thought signatures included, byte-identical in history', async () => {
    const parts = [
      { text: 'Looking.' },
      { functionCall: { name: 'Read', args: { file_path: 'a.txt' }, id: 'x' }, thoughtSignature: 'SIG123==' },
    ]
    const { agent, root } = await setup([{ parts, finishReason: 'STOP' }, textTurn('done')])
    await writeFile(join(root, 'a.txt'), 'x')
    await agent.sendMessage('go')
    expect(agent.getHistory()[1]).toEqual({ role: 'model', parts })
  })
})

describe('permissions in the loop', () => {
  it('asks for an Edit in ask mode, passes a diff, and runs it once approved', async () => {
    const { agent, root, approvals } = await setup([
      callTurn([{ name: 'Edit', args: { file_path: 'a.txt', old_string: 'hello', new_string: 'bye' } }]),
      textTurn('Edited.'),
    ])
    await writeFile(join(root, 'a.txt'), 'hello\n')
    expect(await agent.sendMessage('change it')).toBe('done')
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('bye\n')
    expect(approvals).toHaveLength(1)
    expect(approvals[0].diff).toContain('-hello')
    expect(approvals[0].diff).toContain('+bye')
  })

  it('a denied approval leaves the file alone and tells the model why', async () => {
    const { agent, root, vertex, events } = await setup(
      [
        callTurn([{ name: 'Edit', args: { file_path: 'a.txt', old_string: 'hello', new_string: 'bye' } }]),
        textTurn('Understood.'),
      ],
      { approver: async () => ({ decision: 'deny', note: 'not that file' }) },
    )
    await writeFile(join(root, 'a.txt'), 'hello\n')
    await agent.sendMessage('change it')
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('hello\n')
    const [resp] = lastResponses(vertex.requests[1])
    expect(resp.response.output).toContain('denied')
    expect(resp.response.output).toContain('not that file')
    expect(activities(events).at(-1)?.state).toBe('denied')
  })

  it('"always allow" saves a Bash rule and the next matching command needs no approval', async () => {
    const { agent, approvals, rules, root } = await setup(
      [
        callTurn([{ name: 'Bash', args: { command: 'mkdir -p out1' } }]),
        callTurn([{ name: 'Bash', args: { command: 'mkdir -p out2' } }]),
        textTurn('done'),
      ],
      { approver: async () => ({ decision: 'always' }) },
    )
    await agent.sendMessage('make dirs')
    expect(approvals).toHaveLength(1)
    expect(await rules.load()).toEqual([{ tool: 'Bash', prefix: 'mkdir -p' }])
    expect((await stat(join(root, 'out1'))).isDirectory()).toBe(true)
    expect((await stat(join(root, 'out2'))).isDirectory()).toBe(true)
  })

  it('reloadRules drops a rule that was removed, so the command asks again', async () => {
    const { agent, approvals, rules } = await setup(
      [
        callTurn([{ name: 'Bash', args: { command: 'mkdir -p r1' } }]), textTurn('one'),
        callTurn([{ name: 'Bash', args: { command: 'mkdir -p r2' } }]), textTurn('two'),
        callTurn([{ name: 'Bash', args: { command: 'mkdir -p r3' } }]), textTurn('three'),
      ],
      { approver: async () => ({ decision: 'always' }) },
    )
    await agent.sendMessage('a')
    await agent.sendMessage('b')
    expect(approvals).toHaveLength(1)
    await rules.remove({ tool: 'Bash', prefix: 'mkdir -p' })
    await agent.reloadRules()
    await agent.sendMessage('c')
    expect(approvals).toHaveLength(2)
  })

  it('"always allow" never saves a rule for a call that decide() denied', async () => {
    const { agent, rules, home } = await setup(
      [callTurn([{ name: 'Write', args: { file_path: join('..', 'outside.txt'), content: 'x' } }]), textTurn('ok')],
      { approver: async () => ({ decision: 'always' }) },
    )
    await agent.sendMessage('write outside')
    expect(await rules.load()).toEqual([])
    expect(home).toBeTruthy()
  })

  it('a denied call returns a refusal and the loop carries on to the next turn', async () => {
    const { agent, vertex, home, audit } = await setup([
      callTurn([{ name: 'Write', args: { file_path: join('..', 'home', '.ssh', 'x'), content: 'x' } }]),
      textTurn('I will not do that.'),
    ])
    expect(await agent.sendMessage('write my ssh dir')).toBe('done')
    const [resp] = lastResponses(vertex.requests[1])
    expect(resp.response.output).toMatch(/Denied/)
    await expect(stat(join(home, '.ssh', 'x'))).rejects.toThrow()
    const entries = await audit.read()
    expect(entries.at(-1)).toMatchObject({ tool: 'Write', verdict: 'deny', approvedBy: 'none' })
  })

  it('auto mode needs the OS sandbox: with it Bash runs unasked, without it Bash asks', async () => {
    const withSandbox = await setup([callTurn([{ name: 'Bash', args: { command: 'mkdir -p a' } }]), textTurn('ok')], {
      mode: 'auto',
      sandboxAvailable: true,
    })
    await withSandbox.agent.sendMessage('x')
    expect(withSandbox.approvals).toHaveLength(0)
    await fx!.cleanup()
    const without = await setup([callTurn([{ name: 'Bash', args: { command: 'mkdir -p a' } }]), textTurn('ok')], {
      mode: 'auto',
      sandboxAvailable: false,
    })
    await without.agent.sendMessage('x')
    expect(without.approvals).toHaveLength(1)
  })

  it('setMode takes effect on the next call', async () => {
    const { agent, approvals, root } = await setup([
      callTurn([{ name: 'Write', args: { file_path: 'one.txt', content: '1' } }]),
      textTurn('first'),
      callTurn([{ name: 'Write', args: { file_path: 'two.txt', content: '2' } }]),
      textTurn('second'),
    ])
    await agent.sendMessage('one')
    expect(approvals).toHaveLength(1)
    agent.setMode('auto-edit')
    expect(agent.mode).toBe('auto-edit')
    await agent.sendMessage('two')
    expect(approvals).toHaveLength(1)
    expect(await readFile(join(root, 'two.txt'), 'utf8')).toBe('2')
  })
})

describe('robustness', () => {
  it('turns malformed arguments and unknown tools into error results without throwing', async () => {
    const { agent, vertex } = await setup([
      callTurn([
        { name: 'Read', args: { file_path: 5 }, id: 'a' },
        { name: 'Teleport', args: {}, id: 'b' },
      ]),
      textTurn('ok'),
    ])
    expect(await agent.sendMessage('go')).toBe('done')
    const resps = lastResponses(vertex.requests[1])
    expect(resps).toHaveLength(2)
    expect(resps[0].response.output).toContain('Invalid arguments')
    expect(resps[1].response.output).toContain('Teleport')
  })

  it('runs several calls from one response in order', async () => {
    const { agent, root } = await setup(
      [
        callTurn([
          { name: 'Write', args: { file_path: 'n.txt', content: 'one\n' } },
          { name: 'Edit', args: { file_path: 'n.txt', old_string: 'one', new_string: 'two' } },
        ]),
        textTurn('ok'),
      ],
      { mode: 'auto-edit' },
    )
    await agent.sendMessage('go')
    expect(await readFile(join(root, 'n.txt'), 'utf8')).toBe('two\n')
  })

  it('stops at the step cap and still leaves a valid history', async () => {
    const turns = Array.from({ length: 6 }, (_, i) => callTurn([{ name: 'LS', args: {}, id: `c${i}` }]))
    const { agent, vertex, events } = await setup(turns, { settings: { maxSteps: 3 } })
    expect(await agent.sendMessage('loop')).toBe('step-cap')
    expect(vertex.requests).toHaveLength(3)
    expect(events.some((e) => e.type === 'notice' && e.level === 'warn')).toBe(true)
    const h = agent.getHistory()
    expect(h.at(-1)?.role).toBe('user')
    expect(h.at(-1)?.parts[0].functionResponse).toBeTruthy()
  })

  it('stops when the turn token budget is spent', async () => {
    const usage = { promptTokens: 1000, outputTokens: 500, totalTokens: 1500 }
    const { agent, vertex } = await setup(
      [callTurn([{ name: 'LS', args: {} }], { usage }), textTurn('never reached')],
      { settings: { turnTokenBudget: 1000 } },
    )
    expect(await agent.sendMessage('go')).toBe('budget')
    expect(vertex.requests).toHaveLength(1)
  })

  it('reports a safety stop', async () => {
    const { agent, events } = await setup([{ parts: [], finishReason: 'SAFETY' }])
    expect(await agent.sendMessage('x')).toBe('safety')
    expect(events.some((e) => e.type === 'notice' && e.level === 'warn' && /safety/i.test(e.message))).toBe(true)
    expect(agent.getHistory().every((c) => c.parts.length > 0)).toBe(true)
  })

  it('reports an API key problem without echoing the key', async () => {
    const key = 'AIzaSy' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'
    const { agent, events } = await setup([{ error: new VertexError(`rejected ${key}`, 'auth', 401) }])
    expect(await agent.sendMessage('x')).toBe('error')
    const notice = events.find((e) => e.type === 'notice' && e.level === 'error') as Extract<AgentEvent, { type: 'notice' }>
    expect(notice.message).toContain('Settings')
    expect(notice.message).not.toContain(key)
  })

  it('keeps the partial text when the connection drops mid-reply', async () => {
    const partial = { parts: [{ text: 'half an ans' }] }
    const { agent } = await setup([{ error: new VertexError('lost', 'network', 0, partial) }])
    expect(await agent.sendMessage('x')).toBe('error')
    expect(agent.getHistory().at(-1)).toEqual({ role: 'model', parts: [{ text: 'half an ans' }] })
  })

  it('answers AskUser through the injected asker and shows waiting-answer', async () => {
    const { agent, vertex, events } = await setup(
      [callTurn([{ name: 'AskUser', args: { question: 'Which?', options: ['a', 'b'] } }]), textTurn('thanks')],
      { askUser: async (q) => (q.options?.[1] ?? 'none') },
    )
    await agent.sendMessage('go')
    expect(statuses(events)).toContain('waiting-answer')
    expect(lastResponses(vertex.requests[1])[0].response.output).toContain('b')
  })
})

describe('stopping (review focus 3)', () => {
  it('stops mid-stream and keeps the partial text', async () => {
    const { agent, events } = await setup([{ hold: true, partialParts: [{ text: 'partial' }] }])
    const ctl = new AbortController()
    const p = agent.sendMessage('go', ctl.signal)
    await waitFor(() => events.some((e) => e.type === 'text-delta'))
    ctl.abort()
    expect(await p).toBe('stopped')
    expect(agent.getHistory().at(-1)).toEqual({ role: 'model', parts: [{ text: 'partial' }] })
    expect(events.at(-1)).toEqual({ type: 'turn-end', reason: 'stopped' })
  })

  it('stop() ends the turn too', async () => {
    const { agent } = await setup([{ hold: true }])
    const p = agent.sendMessage('go')
    await new Promise((r) => setTimeout(r, 30))
    agent.stop()
    expect(await p).toBe('stopped')
  })

  it('abort while an approval is pending: the tool never runs, even if the approver says yes', async () => {
    let seenSignal: AbortSignal | undefined
    const approver: Approver = (_req, signal) => {
      seenSignal = signal
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ decision: 'allow-once' })))
    }
    const { agent, events, root } = await setup(
      [callTurn([{ name: 'Edit', args: { file_path: 'a.txt', old_string: 'x', new_string: 'y' }, id: 'e1' }])],
      { approver },
    )
    await writeFile(join(root, 'a.txt'), 'x')
    const ctl = new AbortController()
    const p = agent.sendMessage('edit', ctl.signal)
    await waitFor(() => events.some((e) => e.type === 'approval-request'))
    ctl.abort()
    expect(await p).toBe('stopped')
    expect(seenSignal?.aborted).toBe(true)
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('x')
    const last = agent.getHistory().at(-1)!
    expect(last.parts[0].functionResponse?.id).toBe('e1')
  })

  it('an already-aborted signal runs nothing', async () => {
    const { agent, vertex } = await setup([textTurn('no')])
    const ctl = new AbortController()
    ctl.abort()
    expect(await agent.sendMessage('x', ctl.signal)).toBe('stopped')
    expect(vertex.requests).toHaveLength(0)
  })
})

describe('bookkeeping', () => {
  it('writes an audit entry per call with who approved it', async () => {
    const { agent, audit, root } = await setup([
      callTurn([{ name: 'Edit', args: { file_path: 'a.txt', old_string: 'a', new_string: 'b' } }]),
      callTurn([{ name: 'Bash', args: { command: 'git status' } }]),
      textTurn('ok'),
    ])
    await writeFile(join(root, 'a.txt'), 'a')
    await agent.sendMessage('go')
    const entries = await audit.read()
    expect(entries.map((e) => [e.tool, e.verdict, e.approvedBy])).toEqual([
      ['Edit', 'allow', 'user'],
      ['Bash', 'allow', 'readonly'],
    ])
  })

  it('persists every history entry to the session file', async () => {
    const { agent, sessionStore, handle } = await setup([textTurn('hello')])
    await agent.sendMessage('hi there')
    const { history, meta } = await sessionStore.load(handle.id)
    expect(history).toEqual(agent.getHistory())
    expect(meta.title).toBe('hi there')
  })

  it('checkpoints file changes per turn so they can be undone', async () => {
    const { agent, checkpoints, root } = await setup([
      callTurn([{ name: 'Write', args: { file_path: 'made.txt', content: 'x' } }]),
      textTurn('ok'),
    ])
    await agent.sendMessage('make a file')
    expect(checkpoints.canUndo()).toBe(true)
    await checkpoints.undoLastTurn()
    await expect(stat(join(root, 'made.txt'))).rejects.toThrow()
  })

  it('accumulates usage events and exposes the latest context size', async () => {
    const u1 = { promptTokens: 100, outputTokens: 10, totalTokens: 110 }
    const u2 = { promptTokens: 150, outputTokens: 20, totalTokens: 170 }
    const { agent, events } = await setup([callTurn([{ name: 'LS', args: {} }], { usage: u1 }), textTurn('ok', { usage: u2 })])
    await agent.sendMessage('go')
    expect(events.filter((e) => e.type === 'usage')).toEqual([
      { type: 'usage', ...u1 },
      { type: 'usage', ...u2 },
    ])
    expect(agent.totalTokens()).toBe(170)
  })

  it('compacts the history at turn start once the context is nearly full', async () => {
    const turns = (n: number): Content[] =>
      Array.from({ length: n }, (_, i) => [
        { role: 'user' as const, parts: [{ text: `question ${i + 1}` }] },
        { role: 'model' as const, parts: [{ text: `answer ${i + 1}` }] },
      ]).flat()
    const fullUsage = { promptTokens: 900, outputTokens: 10, totalTokens: 910 }
    const { agent, vertex, events } = await setup(
      [textTurn('first reply', { usage: fullUsage }), textTurn('SUMMARY'), textTurn('second reply')],
      { history: turns(6), settings: { contextWindowTokens: 1000 } },
    )
    await agent.sendMessage('first')
    const before = agent.getHistory().length
    await agent.sendMessage('second')
    const realRequest = vertex.requests[2]
    expect(realRequest.contents[0].parts[0].text).toContain('Summary of earlier conversation:\nSUMMARY')
    expect(realRequest.contents.length).toBeLessThan(before)
    expect(events.some((e) => e.type === 'notice' && /compact/i.test(e.message))).toBe(true)
  })
})

describe('narration', () => {
  it('emits running then done for a Read, with the same id and plain labels', async () => {
    const { agent, events, root } = await setup([
      callTurn([{ name: 'Read', args: { file_path: 'a.txt' }, id: 'r1' }]),
      textTurn('ok'),
    ])
    await writeFile(join(root, 'a.txt'), 'x')
    await agent.sendMessage('go')
    expect(activities(events)).toEqual([
      { type: 'activity', id: 'r1', phase: 'reading', label: 'Reading a.txt', state: 'running' },
      { type: 'activity', id: 'r1', phase: 'reading', label: 'Read a.txt', state: 'done' },
    ])
  })

  it('emits denied for a blocked call and failed for a tool error', async () => {
    const { agent, events } = await setup([
      callTurn([{ name: 'Write', args: { file_path: join('..', 'home', '.ssh', 'k'), content: 'x' }, id: 'd1' }]),
      callTurn([{ name: 'Read', args: { file_path: 'missing.txt' }, id: 'f1' }]),
      textTurn('ok'),
    ])
    await agent.sendMessage('go')
    const acts = activities(events)
    expect(acts.find((a) => a.id === 'd1')?.state).toBe('denied')
    expect(acts.filter((a) => a.id === 'f1').map((a) => a.state)).toEqual(['running', 'failed'])
  })

  it('walks the status through thinking, waiting-approval, working, thinking, idle', async () => {
    const { agent, events, root } = await setup([
      callTurn([{ name: 'Edit', args: { file_path: 'a.txt', old_string: 'x', new_string: 'y' } }]),
      textTurn('ok'),
    ])
    await writeFile(join(root, 'a.txt'), 'x')
    await agent.sendMessage('go')
    expect(statuses(events)).toEqual(['thinking', 'waiting-approval', 'working', 'thinking', 'idle'])
  })

  it('never puts the text of a Bash command in an activity or status label', async () => {
    const secretish = 'mkdir -p top-secret-dir-name'
    const { agent, events } = await setup(
      [callTurn([{ name: 'Bash', args: { command: secretish } }]), textTurn('ok')],
      { mode: 'auto' },
    )
    await agent.sendMessage('go')
    const labels = [
      ...activities(events).map((a) => a.label),
      ...events.filter((e) => e.type === 'status').map((e) => (e as { label: string }).label),
    ]
    expect(labels.length).toBeGreaterThan(0)
    for (const l of labels) expect(l).not.toContain('top-secret')
  })

  it('emits a todos event when the model updates its plan', async () => {
    const todos = [{ id: '1', content: 'Do it', status: 'in_progress' }]
    const { agent, events } = await setup([callTurn([{ name: 'TodoWrite', args: { todos } }]), textTurn('ok')])
    await agent.sendMessage('go')
    expect(events.filter((e) => e.type === 'todos')).toEqual([{ type: 'todos', todos }])
  })
})
