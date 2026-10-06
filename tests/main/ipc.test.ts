import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackendApp } from '../../src/main/backend'
import { createHandlers } from '../../src/main/ipcHandlers'
import { isTrustedSender } from '../../src/main/windowConfig'
import type { Cipher } from '../../src/main/store/secrets'
import { INVOKE_CHANNELS, IPC } from '../../src/shared/channels'
import { IPC_SCHEMAS } from '../../src/shared/ipc'
import { chunk, startFakeVertex, type FakeEntry, type FakeVertex } from '../helpers/fakeVertexServer'

const APP = 'arc://app/index.html'
const KEY = 'AIzaSy' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'
const xor = (available = true): Cipher => ({
  isAvailable: () => available,
  encrypt: (p) => Buffer.from(Buffer.from(p, 'utf8').map((b) => b ^ 0x5a)),
  decrypt: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString('utf8'),
})
const text = (t: string): FakeEntry => ({ chunks: [chunk([{ text: t }], {}, 'STOP')] })

let server: FakeVertex | undefined
let base: string | undefined
afterEach(async () => {
  await server?.close()
  if (base) await rm(base, { recursive: true, force: true })
  server = undefined
  base = undefined
})

async function real(script: FakeEntry[], cipher = xor()) {
  server = await startFakeVertex(script)
  base = await realpath(await mkdtemp(join(tmpdir(), 'arc-ipc-')))
  const projectDir = join(base, 'project')
  await mkdir(projectDir)
  const app = new BackendApp({
    dataDir: join(base, 'data'),
    cipher,
    home: join(base, 'home'),
    emit: () => undefined,
    vertexBaseUrl: server.baseUrl,
    vertexSleep: async () => {},
    sandboxAvailable: true,
  })
  await app.init()
  await app.saveSettings({ prompter: { mode: 'off' } })
  const chosen: Array<string | null> = []
  const handlers = createHandlers({
    app,
    isTrusted: (url) => isTrustedSender(url, 'arc://app'),
    chooseFolder: async () => chosen.shift() ?? null,
  })
  return { app, handlers, projectDir, chosen }
}

describe('channel registry', () => {
  it('registers a handler for every invokable channel and nothing else', async () => {
    const { handlers } = await real([])
    expect(Object.keys(handlers).sort()).toEqual([...INVOKE_CHANNELS].sort())
    expect(Object.keys(IPC_SCHEMAS).sort()).toEqual([...INVOKE_CHANNELS].sort())
    expect(INVOKE_CHANNELS).not.toContain(IPC.event)
    expect((handlers as Record<string, unknown>)['agent:evil']).toBeUndefined()
  })
})

describe('payload validation', () => {
  const missing: Array<[string, unknown]> = [
    [IPC.send, {}],
    [IPC.send, { text: '   ' }],
    [IPC.approval, { requestId: 'x' }],
    [IPC.approval, { requestId: 'x', decision: 'maybe' }],
    [IPC.answer, { questionId: 'q' }],
    [IPC.setMode, {}],
    [IPC.setMode, { mode: 'yolo' }],
    [IPC.openProject, {}],
    [IPC.settingsSave, {}],
    [IPC.settingsSave, { patch: { maxSteps: 'many' } }],
    [IPC.setKey, {}],
    [IPC.setKey, { key: '' }],
    [IPC.sessionsResume, {}],
    [IPC.rulesRemove, {}],
    [IPC.rulesRemove, { rule: { tool: 'Nope' } }],
    [IPC.autopilot, {}],
    [IPC.autopilot, { on: 'yes' }],
  ]
  it.each(missing)('rejects %s with %j', async (channel, payload) => {
    const { handlers } = await real([])
    const r = await handlers[channel as keyof typeof handlers](APP, payload)
    expect(r).toMatchObject({ ok: false, code: 'invalid' })
  })

  it('refuses to let an API key travel through settings:save', async () => {
    const { handlers } = await real([])
    const r = await handlers[IPC.settingsSave](APP, { patch: { apiKey: KEY } })
    expect(r).toMatchObject({ ok: false, code: 'invalid' })
  })
})

describe('sender trust', () => {
  it('rejects an untrusted sender without touching the backend', async () => {
    const app = { stop: vi.fn(), resolveApproval: vi.fn(), send: vi.fn() }
    const handlers = createHandlers({
      app: app as unknown as BackendApp,
      isTrusted: (u) => isTrustedSender(u, 'arc://app'),
      chooseFolder: async () => null,
    })
    for (const url of ['https://evil.test/', 'file:///x.html', '']) {
      expect(await handlers[IPC.stop](url, undefined)).toMatchObject({ ok: false, code: 'untrusted' })
      expect(await handlers[IPC.send](url, { text: 'hi' })).toMatchObject({ ok: false, code: 'untrusted' })
    }
    expect(app.stop).not.toHaveBeenCalled()
    expect(app.send).not.toHaveBeenCalled()
  })

  it('passes a valid approval through with parsed values', async () => {
    const app = { resolveApproval: vi.fn() }
    const handlers = createHandlers({
      app: app as unknown as BackendApp,
      isTrusted: () => true,
      chooseFolder: async () => null,
    })
    const r = await handlers[IPC.approval](APP, { requestId: 'e1', decision: 'always', note: 'ok' })
    expect(r).toEqual({ ok: true, data: null })
    expect(app.resolveApproval).toHaveBeenCalledWith('e1', { decision: 'always', note: 'ok' })
  })
})

describe('run gate over IPC', () => {
  it('send, spark and autopilot return no-api-key without a key and never reach Vertex', async () => {
    const { handlers, projectDir } = await real([text('x')])
    await handlers[IPC.openProject](APP, { path: projectDir })
    for (const [channel, payload] of [
      [IPC.send, { text: 'hi' }],
      [IPC.spark, undefined],
      [IPC.autopilot, { on: true }],
    ] as const) {
      const r = await handlers[channel](APP, payload)
      expect(r, channel).toEqual({ ok: false, error: 'Add your Vertex API key in Settings to start.', code: 'no-api-key' })
    }
    expect(server!.requests).toHaveLength(0)
  })

  it('works right after secrets:setKey, without a restart', async () => {
    const { handlers, projectDir } = await real([text('hello')])
    await handlers[IPC.openProject](APP, { path: projectDir })
    expect(await handlers[IPC.send](APP, { text: 'hi' })).toMatchObject({ ok: false, code: 'no-api-key' })
    const saved = await handlers[IPC.setKey](APP, { key: KEY })
    expect(saved).toMatchObject({ ok: true, data: { ready: true, hasApiKey: true } })
    expect(await handlers[IPC.send](APP, { text: 'hi' })).toEqual({ ok: true, data: 'done' })
  })

  it('reports no-project when a key exists but no folder is open', async () => {
    const { handlers } = await real([])
    await handlers[IPC.setKey](APP, { key: KEY })
    expect(await handlers[IPC.send](APP, { text: 'hi' })).toMatchObject({ ok: false, code: 'no-project' })
  })

  it('surfaces a cipher failure as a plain error and stays locked', async () => {
    const { handlers } = await real([], xor(false))
    const r = await handlers[IPC.setKey](APP, { key: KEY })
    expect(r).toMatchObject({ ok: false })
    expect((r as { error: string }).error).toMatch(/secure storage/i)
    expect(await handlers[IPC.status](APP, undefined)).toMatchObject({ ok: true, data: { ready: false } })
  })

  it('never echoes the key in an error', async () => {
    const { handlers } = await real([])
    const r = await handlers[IPC.setKey](APP, { key: KEY })
    expect(JSON.stringify(r)).not.toContain(KEY)
  })
})

describe('settings over IPC', () => {
  it('changing the prompter model changes only the prompter requests', async () => {
    const ideas = text(
      JSON.stringify([
        { title: 'a', prompt: 'pa', kind: 'feature' },
        { title: 'b', prompt: 'pb', kind: 'fix' },
        { title: 'c', prompt: 'pc', kind: 'wild' },
      ]),
    )
    const { handlers, projectDir } = await real([text('hi'), ideas])
    await handlers[IPC.setKey](APP, { key: KEY })
    await handlers[IPC.openProject](APP, { path: projectDir })
    await handlers[IPC.settingsSave](APP, { patch: { prompterModel: 'prompter-x' } })
    await handlers[IPC.send](APP, { text: 'hello' })
    await handlers[IPC.spark](APP, undefined)
    expect(server!.requests[0].url).toContain('/models/gemini-3.8-flash:')
    expect(server!.requests[1].url).toContain('/models/prompter-x:')
    const got = await handlers[IPC.settingsGet](APP, undefined)
    expect(got).toMatchObject({ ok: true, data: { settings: { model: 'gemini-3.8-flash', prompterModel: 'prompter-x' } } })
  })
})

describe('project:choose', () => {
  it('opens the folder the dialog returns, and does nothing when it is cancelled', async () => {
    const { handlers, projectDir, chosen } = await real([])
    expect(await handlers[IPC.chooseProject](APP, undefined)).toEqual({ ok: true, data: null })
    chosen.push(projectDir)
    const r = await handlers[IPC.chooseProject](APP, undefined)
    expect(r).toMatchObject({ ok: true, data: { root: projectDir } })
  })
})
