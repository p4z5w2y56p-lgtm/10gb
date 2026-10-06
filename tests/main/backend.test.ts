import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BackendApp, NoProjectError, NotReadyError } from '../../src/main/backend'
import type { Cipher } from '../../src/main/store/secrets'
import type { AgentEvent } from '../../src/shared/types'
import { chunk, startFakeVertex, type FakeEntry, type FakeVertex } from '../helpers/fakeVertexServer'

const KEY = 'AIzaSy' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'
const xor: Cipher = {
  isAvailable: () => true,
  encrypt: (p) => Buffer.from(Buffer.from(p, 'utf8').map((b) => b ^ 0x5a)),
  decrypt: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString('utf8'),
}

const text = (t: string): FakeEntry => ({ chunks: [chunk([{ text: t }], {}, 'STOP')] })
const call = (name: string, args: Record<string, unknown>, id = 'c1'): FakeEntry => ({
  chunks: [chunk([{ functionCall: { name, args, id } }], {}, 'STOP')],
})
const ideas = (n: number): FakeEntry =>
  text(
    JSON.stringify([
      { title: `Idea ${n}a`, prompt: `Do thing ${n}a`, kind: 'feature' },
      { title: `Idea ${n}b`, prompt: `Do thing ${n}b`, kind: 'test' },
      { title: `Idea ${n}c`, prompt: `Do thing ${n}c`, kind: 'wild' },
    ]),
  )

let server: FakeVertex | undefined
let base: string | undefined
afterEach(async () => {
  await server?.close()
  if (base) await rm(base, { recursive: true, force: true })
  server = undefined
  base = undefined
})

async function make(script: FakeEntry[], opts: { key?: boolean; project?: boolean } = {}) {
  server = await startFakeVertex(script)
  base = await realpath(await mkdtemp(join(tmpdir(), 'arc-backend-')))
  const dataDir = join(base, 'data')
  const home = join(base, 'home')
  const projectDir = join(base, 'project')
  await mkdir(projectDir, { recursive: true })
  await mkdir(home, { recursive: true })
  const events: AgentEvent[] = []
  const build = () =>
    new BackendApp({ dataDir, cipher: xor, home, emit: (e) => events.push(e), vertexBaseUrl: server!.baseUrl, vertexSleep: async () => {}, sandboxAvailable: true })
  const app = build()
  await app.init()
  await app.saveSettings({ prompter: { mode: 'off' } })
  if (opts.key !== false) await app.setApiKey(KEY)
  if (opts.project !== false) await app.openProject(projectDir)
  return { app, events, projectDir, dataDir, home, build, base }
}

const waitFor = async (cond: () => boolean, ms = 5000) => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 15))
  }
}
const ofType = <T extends AgentEvent['type']>(events: AgentEvent[], type: T) =>
  events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type)

describe('run gate', () => {
  it('is not ready without a key, and ready right after one is saved', async () => {
    const { app } = await make([], { key: false, project: false })
    expect(await app.status()).toMatchObject({ ready: false, hasApiKey: false, reason: 'no-api-key' })
    await app.setApiKey(KEY)
    expect(await app.status()).toMatchObject({ ready: true, hasApiKey: true })
    await app.clearApiKey()
    expect((await app.status()).ready).toBe(false)
  })

  it('refuses send, spark and autopilot without a key and never contacts Vertex', async () => {
    const { app, projectDir } = await make([text('nope')], { key: false, project: false })
    await app.openProject(projectDir)
    await expect(app.send('hi')).rejects.toBeInstanceOf(NotReadyError)
    await expect(app.spark()).rejects.toBeInstanceOf(NotReadyError)
    await expect(app.autopilot(true)).rejects.toBeInstanceOf(NotReadyError)
    expect(server!.requests).toHaveLength(0)
  })

  it('needs a project to send', async () => {
    const { app } = await make([text('x')], { project: false })
    await expect(app.send('hi')).rejects.toBeInstanceOf(NoProjectError)
  })

  it('a key saved after a refusal works at once, without a restart', async () => {
    const { app, projectDir } = await make([text('hello')], { key: false, project: false })
    await app.openProject(projectDir)
    await expect(app.send('hi')).rejects.toBeInstanceOf(NotReadyError)
    await app.setApiKey(KEY)
    expect(await app.send('hi')).toBe('done')
  })

  it('never stores the key in settings.json', async () => {
    const { app, dataDir } = await make([], { project: false })
    await app.saveSettings({ maxSteps: 12 })
    expect(await readFile(join(dataDir, 'settings.json'), 'utf8')).not.toContain(KEY)
  })
})

describe('projects and turns', () => {
  it('canonicalizes a symlinked project root (review focus 1)', async () => {
    const { app, projectDir, base } = await make([text('ok')], { project: false })
    const link = join(base, 'linked')
    await symlink(projectDir, link)
    await app.openProject(link)
    expect((await app.status()).projectRoot).toBe(projectDir)
    await writeFile(join(projectDir, 'a.txt'), 'x')
    expect(await app.send('hi')).toBe('done')
  })

  it('rejects a folder that does not exist', async () => {
    const { app, base } = await make([], { project: false })
    await expect(app.openProject(join(base, 'missing'))).rejects.toThrow()
  })

  it('runs a turn against Vertex with the stored key and streams events out', async () => {
    const { app, events } = await make([text('Hello from Gemini')])
    expect(await app.send('hi')).toBe('done')
    expect(server!.requests[0].headers['x-goog-api-key']).toBe(KEY)
    expect(ofType(events, 'text-delta').map((e) => e.text).join('')).toBe('Hello from Gemini')
    expect(ofType(events, 'turn-end').at(-1)?.reason).toBe('done')
    expect(ofType(events, 'changes').length).toBeGreaterThan(0)
  })

  it('refuses a second send while one is running', async () => {
    const { app, events } = await make([{ chunks: [chunk([{ text: 'slow' }])], holdMs: Infinity }])
    await app.saveSettings({ prompter: { mode: 'off' } })
    const first = app.send('one')
    await waitFor(() => ofType(events, 'text-delta').length > 0)
    await expect(app.send('two')).rejects.toThrow(/already running/i)
    app.stop()
    expect(await first).toBe('stopped')
  })

  it('gives the coder and the prompter their own models', async () => {
    const { app } = await make([text('hi'), ideas(1), text('again')])
    await app.saveSettings({ prompter: { mode: 'off' }, prompterModel: 'prompter-x' })
    await app.send('hello')
    await app.spark()
    expect(server!.requests[0].url).toContain('/models/gemini-3.8-flash:')
    expect(server!.requests[1].url).toContain('/models/prompter-x:')
    await app.saveSettings({ model: 'coder-y' })
    await app.send('again')
    expect(server!.requests[2].url).toContain('/models/coder-y:')
  })

  it('applies settings changes to the live session', async () => {
    const turns = Array.from({ length: 4 }, (_, i) => call('LS', {}, `c${i}`))
    const { app } = await make([...turns, text('x')])
    await app.saveSettings({ prompter: { mode: 'off' }, maxSteps: 2 })
    expect(await app.send('loop')).toBe('step-cap')
    expect(server!.requests).toHaveLength(2)
  })

  it('reports connection test results for both models when they differ', async () => {
    const { app } = await make([text('ok'), text('ok')], { project: false })
    await app.saveSettings({ prompterModel: 'prompter-x' })
    const res = await app.testConnection()
    expect(res.map((r) => [r.label, r.ok])).toEqual([
      ['Coder (gemini-3.8-flash)', true],
      ['Prompter (prompter-x)', true],
    ])
  })
})

describe('approvals, questions and stopping', () => {
  it('waits for the UI to approve an edit, then applies it', async () => {
    const { app, events, projectDir } = await make([
      call('Edit', { file_path: 'a.txt', old_string: 'hello', new_string: 'bye' }, 'e1'),
      text('Edited.'),
    ])
    await writeFile(join(projectDir, 'a.txt'), 'hello\n')
    await app.saveSettings({ prompter: { mode: 'off' } })
    const turn = app.send('change it')
    await waitFor(() => ofType(events, 'approval-request').length > 0)
    const req = ofType(events, 'approval-request')[0].request
    expect(req.call.id).toBe('e1')
    expect(req.diff).toContain('+bye')
    app.resolveApproval('e1', { decision: 'allow-once' })
    expect(await turn).toBe('done')
    expect(await readFile(join(projectDir, 'a.txt'), 'utf8')).toBe('bye\n')
  })

  it('a denial keeps the file as it was', async () => {
    const { app, events, projectDir } = await make([
      call('Edit', { file_path: 'a.txt', old_string: 'hello', new_string: 'bye' }, 'e1'),
      text('Okay.'),
    ])
    await writeFile(join(projectDir, 'a.txt'), 'hello\n')
    await app.saveSettings({ prompter: { mode: 'off' } })
    const turn = app.send('change it')
    await waitFor(() => ofType(events, 'approval-request').length > 0)
    app.resolveApproval('e1', { decision: 'deny', note: 'no' })
    await turn
    expect(await readFile(join(projectDir, 'a.txt'), 'utf8')).toBe('hello\n')
  })

  it('ignores an approval for an unknown request id', async () => {
    const { app } = await make([])
    expect(() => app.resolveApproval('nope', { decision: 'allow-once' })).not.toThrow()
  })

  it('relays an AskUser question and feeds the answer back', async () => {
    const { app, events } = await make([call('AskUser', { question: 'Colour?', options: ['Red', 'Blue'] }, 'q1'), text('Thanks.')])
    await app.saveSettings({ prompter: { mode: 'off' } })
    const turn = app.send('go')
    await waitFor(() => ofType(events, 'question').length > 0)
    const q = ofType(events, 'question')[0]
    expect(q).toMatchObject({ question: 'Colour?', options: ['Red', 'Blue'] })
    app.resolveAnswer(q.id, 'Blue')
    expect(await turn).toBe('done')
    expect(JSON.stringify(server!.requests[1].body.contents)).toContain('Blue')
  })

  it('stop() ends a turn that is waiting on an approval (review focus 3)', async () => {
    const { app, events, projectDir } = await make([
      call('Edit', { file_path: 'a.txt', old_string: 'x', new_string: 'y' }, 'e1'),
    ])
    await writeFile(join(projectDir, 'a.txt'), 'x')
    await app.saveSettings({ prompter: { mode: 'off' } })
    const turn = app.send('edit')
    await waitFor(() => ofType(events, 'approval-request').length > 0)
    app.stop()
    expect(await turn).toBe('stopped')
    expect(await readFile(join(projectDir, 'a.txt'), 'utf8')).toBe('x')
  })

  it('setMode changes the live mode, announces it, and does not change the saved default', async () => {
    const { app, events } = await make([])
    app.setMode('auto-edit')
    expect(ofType(events, 'mode').at(-1)?.mode).toBe('auto-edit')
    expect((await app.status()).mode).toBe('auto-edit')
    expect((await app.getSettings()).settings.permissionMode).toBe('ask')
  })

  it('undo restores the files from the last turn', async () => {
    const { app, projectDir } = await make([call('Write', { file_path: 'made.txt', content: 'x' }, 'w1'), text('ok')])
    await app.saveSettings({ prompter: { mode: 'off' }, permissionMode: 'auto-edit' })
    await app.openProject(projectDir)
    await app.send('make it')
    expect((await app.getChanges()).canUndo).toBe(true)
    await app.undo()
    await expect(stat(join(projectDir, 'made.txt'))).rejects.toThrow()
  })
})

describe('prompter', () => {
  it('spark returns suggestions and announces them', async () => {
    const { app, events } = await make([ideas(1)])
    const items = await app.spark()
    expect(items.map((i) => i.title)).toEqual(['Idea 1a', 'Idea 1b', 'Idea 1c'])
    expect(ofType(events, 'suggestions').at(-1)?.items).toHaveLength(3)
  })

  it('suggest mode offers ideas after a finished turn', async () => {
    const { app, events } = await make([text('done'), ideas(1)])
    await app.saveSettings({ prompter: { mode: 'suggest' } })
    await app.send('hello')
    await waitFor(() => ofType(events, 'suggestions').length > 0)
    expect(ofType(events, 'suggestions')[0].items).toHaveLength(3)
  })

  it('autopilot runs the top suggestion each round, then stops at the cap', async () => {
    const { app, events } = await make([text('first'), ideas(1), text('round one'), ideas(2), text('round two')])
    await app.saveSettings({ prompter: { mode: 'autopilot', maxRounds: 2 } })
    await app.send('start')
    await waitFor(() => ofType(events, 'autopilot').some((e) => !e.running))
    expect(ofType(events, 'autopilot').map((e) => [e.running, e.reason])).toEqual([
      [true, undefined],
      [false, 'rounds'],
    ])
    const sent = server!.requests
      .filter((r) => r.url.includes('gemini-3.8-flash') && r.body.tools)
      .map((r) => r.body.contents.filter((c: any) => c.role === 'user').pop().parts[0].text)
    expect(sent).toEqual(['start', 'Do thing 1a', 'Do thing 2a'])
    expect((await app.status()).mode).toBe('ask')
  })

  it('stop() ends autopilot', async () => {
    const { app, events } = await make([text('first'), ideas(1), { chunks: [chunk([{ text: 'slow' }])], holdMs: Infinity }])
    await app.saveSettings({ prompter: { mode: 'autopilot', maxRounds: 5 } })
    await app.send('start')
    await waitFor(() => ofType(events, 'text-delta').some((e) => e.text === 'slow'))
    app.stop()
    await waitFor(() => ofType(events, 'autopilot').some((e) => !e.running))
    expect(ofType(events, 'autopilot').at(-1)?.reason).toBe('stopped')
  })
})

describe('sessions', () => {
  it('lists the project sessions and resumes one with its history', async () => {
    const { app, projectDir, build } = await make([text('first answer'), text('second answer')])
    await app.saveSettings({ prompter: { mode: 'off' } })
    await app.send('first question')
    const id = (await app.status()).sessionId!
    const fresh = build()
    await fresh.init()
    await fresh.openProject(projectDir)
    const listed = await fresh.listSessions()
    expect(listed.map((s) => [s.id, s.title])).toEqual([[id, 'first question']])
    const resumed = await fresh.resumeSession(id)
    expect(resumed.history).toHaveLength(2)
    expect((await fresh.status()).sessionId).toBe(id)
    await fresh.send('second question')
    expect(JSON.stringify(server!.requests[1].body.contents)).toContain('first answer')
    expect((await fresh.resumeSession(id)).history).toHaveLength(4)
  })
})

describe('audit and rules', () => {
  it('exposes the audit log and saved rules for the settings screen', async () => {
    const { app, projectDir } = await make([call('Bash', { command: 'mkdir -p out' }, 'b1'), text('ok')])
    await app.saveSettings({ prompter: { mode: 'off' } })
    await app.openProject(projectDir)
    const turn = app.send('make a dir')
    await waitFor(() => app.hasPendingApproval('b1'))
    app.resolveApproval('b1', { decision: 'always' })
    await turn
    expect((await app.readAudit()).map((e) => [e.tool, e.approvedBy])).toEqual([['Bash', 'user']])
    expect(await app.listRules()).toEqual([{ tool: 'Bash', prefix: 'mkdir -p' }])
    await app.removeRule({ tool: 'Bash', prefix: 'mkdir -p' })
    expect(await app.listRules()).toEqual([])
  })
})
