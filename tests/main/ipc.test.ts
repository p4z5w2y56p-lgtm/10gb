import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackendApp, NoProjectError, NotReadyError } from '../../src/main/backend'
import type { Backend } from '../../src/main/backendApi'
import { BackendRouter } from '../../src/main/cloud/router'
import { createHandlers } from '../../src/main/ipcHandlers'
import { isTrustedSender } from '../../src/main/windowConfig'
import { SecretStore, type Cipher } from '../../src/main/store/secrets'
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
  const store = new SecretStore(join(base, 'data'), cipher)
  const app = new BackendApp({
    dataDir: join(base, 'data'),
    cipher,
    keyStore: store,
    home: join(base, 'home'),
    emit: () => undefined,
    vertexBaseUrl: server.baseUrl,
    vertexSleep: async () => {},
    sandboxAvailable: true,
  })
  await app.init()
  await app.saveSettings({ prompter: { mode: 'off' } })
  const router = new BackendRouter({ local: app, vault: store, keys: store, emit: () => undefined })
  const chosen: Array<string | null> = []
  const handlers = createHandlers({
    app: router,
    isTrusted: (url) => isTrustedSender(url, 'arc://app'),
    chooseFolder: async () => chosen.shift() ?? null,
  })
  return { app, router, handlers, projectDir, chosen }
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
    [IPC.cloudSetSecret, {}],
    [IPC.cloudSetSecret, { name: 'vertex-key', value: 'abc' }],
    [IPC.cloudSetSecret, { name: 'cloud-token', value: '   ' }],
    [IPC.cloudSetSecret, { name: 'cloud-token' }],
    [IPC.cloudClearSecret, {}],
    [IPC.cloudClearSecret, { name: 'apiKey' }],
    [IPC.cloudStart, {}],
    [IPC.cloudStart, { repo: '' }],
    [IPC.cloudStart, { repo: '   ' }],
    [IPC.cloudStart, { repo: 'o/r', name: 'x'.repeat(61) }],
    [IPC.cloudStart, { repo: 'o/r', baseBranch: '' }],
    [IPC.cloudAttach, {}],
    [IPC.cloudAttach, { id: '' }],
    [IPC.cloudEnd, {}],
    [IPC.cloudEnd, undefined],
    [IPC.cloudEnd, { id: '' }],
    [IPC.cloudPr, {}],
    [IPC.cloudPr, { title: '' }],
    [IPC.cloudPr, { title: '   ' }],
    [IPC.cloudPr, { title: 'ok', draft: 'yes' }],
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

describe('cloud channels over IPC', () => {
  it('reports the saved cloud settings and the presence of each secret, never a secret itself', async () => {
    const { handlers } = await real([])
    await handlers[IPC.cloudSetSecret](APP, { name: 'cloud-token', value: 'tok-' + 'x'.repeat(40) })
    const r = await handlers[IPC.cloudStatus](APP, undefined)
    expect(r).toMatchObject({ ok: true, data: { configured: false, hasCloudToken: true, hasGithubToken: false, active: null } })
    expect(JSON.stringify(r)).not.toContain('x'.repeat(40))
  })

  it('stores and clears each named secret', async () => {
    const { handlers } = await real([])
    expect(await handlers[IPC.cloudSetSecret](APP, { name: 'github-token', value: 'ghp_' + 'a'.repeat(36) })).toMatchObject({ ok: true, data: { hasGithubToken: true } })
    expect(await handlers[IPC.cloudClearSecret](APP, { name: 'github-token' })).toMatchObject({ ok: true, data: { hasGithubToken: false } })
  })

  it('does not echo a secret when saving it fails', async () => {
    const { handlers } = await real([], xor(false))
    const value = 'ghp_' + 'Q'.repeat(36)
    const r = await handlers[IPC.cloudSetSecret](APP, { name: 'github-token', value })
    expect(r).toMatchObject({ ok: false })
    expect((r as { error: string }).error).toMatch(/secure storage/i)
    expect(JSON.stringify(r)).not.toContain(value)
  })

  it('starting a cloud session without a worker URL fails in plain language', async () => {
    const { handlers } = await real([])
    const r = await handlers[IPC.cloudStart](APP, { repo: 'octo/demo' })
    expect(r).toMatchObject({ ok: false })
    expect((r as { error: string }).error).toMatch(/worker URL/i)
  })

  it('starting a cloud session without a Vertex key answers with the no-api-key code', async () => {
    const { handlers, app } = await real([])
    await app.saveSettings({ cloud: { workerUrl: 'https://arc.example.com' } })
    await handlers[IPC.cloudSetSecret](APP, { name: 'cloud-token', value: 'tok-' + 'x'.repeat(40) })
    await handlers[IPC.cloudSetSecret](APP, { name: 'github-token', value: 'ghp_' + 'a'.repeat(36) })
    expect(await handlers[IPC.cloudStart](APP, { repo: 'octo/demo' })).toMatchObject({ ok: false, code: 'no-api-key' })
  })

  it('diff, push and pull request need an attached cloud session', async () => {
    const { handlers } = await real([])
    for (const [channel, payload] of [
      [IPC.cloudDiff, undefined],
      [IPC.cloudPush, undefined],
      [IPC.cloudPr, { title: 'Fix' }],
    ] as const) {
      const r = await handlers[channel](APP, payload)
      expect(r, channel).toMatchObject({ ok: false })
      expect((r as { error: string }).error, channel).toMatch(/cloud session/i)
    }
  })

  it('leaving with nothing attached just returns the status', async () => {
    const { handlers } = await real([])
    expect(await handlers[IPC.cloudLeave](APP, undefined)).toMatchObject({ ok: true, data: { hasProject: false } })
  })

  it('cloud:test reports every step without any network when nothing is configured', async () => {
    const { handlers } = await real([])
    const r = await handlers[IPC.cloudTest](APP, undefined)
    expect(r).toMatchObject({ ok: true })
    expect((r as { data: unknown[] }).data).toHaveLength(3)
  })

  it('passes parsed, trimmed values to the backend and drops unknown fields', async () => {
    const app = {
      cloudStart: vi.fn(async () => ({ ok: 1 })),
      cloudSetSecret: vi.fn(async () => ({ ok: 2 })),
      cloudClearSecret: vi.fn(async () => ({ ok: 3 })),
      cloudAttach: vi.fn(async () => ({ ok: 4 })),
      cloudEnd: vi.fn(async () => null),
      cloudPr: vi.fn(async () => ({ ok: 5 })),
      cloudSessions: vi.fn(async () => []),
    }
    const handlers = createHandlers({ app: app as unknown as Backend, isTrusted: () => true, chooseFolder: async () => null })
    await handlers[IPC.cloudStart](APP, { repo: '  octo/demo  ', baseBranch: 'main', name: 'fix' })
    await handlers[IPC.cloudSetSecret](APP, { name: 'cloud-token', value: '  tok  ' })
    await handlers[IPC.cloudClearSecret](APP, { name: 'github-token' })
    await handlers[IPC.cloudAttach](APP, { id: 'abc' })
    expect(await handlers[IPC.cloudEnd](APP, { id: 'abc' })).toEqual({ ok: true, data: null })
    await handlers[IPC.cloudPr](APP, { title: '  Fix  ', body: 'b', draft: true, evil: 'dropped' })
    await handlers[IPC.cloudSessions](APP, undefined)
    expect(app.cloudStart).toHaveBeenCalledWith({ repo: 'octo/demo', baseBranch: 'main', name: 'fix' })
    expect(app.cloudSetSecret).toHaveBeenCalledWith('cloud-token', 'tok')
    expect(app.cloudClearSecret).toHaveBeenCalledWith('github-token')
    expect(app.cloudAttach).toHaveBeenCalledWith('abc')
    expect(app.cloudEnd).toHaveBeenCalledWith('abc')
    expect(app.cloudPr).toHaveBeenCalledWith({ title: 'Fix', body: 'b', draft: true })
    expect(app.cloudSessions).toHaveBeenCalled()
  })

  it('refuses every cloud channel from an untrusted page without touching the backend', async () => {
    const touched: string[] = []
    const app = new Proxy({}, { get: (_t, prop) => () => void touched.push(String(prop)) }) as unknown as Backend
    const handlers = createHandlers({ app, isTrusted: (u) => isTrustedSender(u, 'arc://app'), chooseFolder: async () => null })
    const payloads: Record<string, unknown> = {
      [IPC.cloudSetSecret]: { name: 'cloud-token', value: 'x' },
      [IPC.cloudClearSecret]: { name: 'cloud-token' },
      [IPC.cloudStart]: { repo: 'o/r' },
      [IPC.cloudAttach]: { id: 'a' },
      [IPC.cloudEnd]: { id: 'a' },
      [IPC.cloudPr]: { title: 't' },
    }
    const cloud = INVOKE_CHANNELS.filter((c) => c.startsWith('cloud:'))
    expect(cloud).toHaveLength(12)
    for (const channel of cloud) {
      const r = await handlers[channel as keyof typeof handlers]('https://evil.test/', payloads[channel])
      expect(r, channel).toMatchObject({ ok: false, code: 'untrusted' })
    }
    expect(touched).toEqual([])
  })
})

describe('failures over IPC', () => {
  const failing = (err: unknown) => {
    const app = { cloudPush: vi.fn(async () => Promise.reject(err)), cloudSetSecret: vi.fn(async () => Promise.reject(err)) }
    return createHandlers({ app: app as unknown as Backend, isTrusted: () => true, chooseFolder: async () => null })
  }

  it('keeps the codes of the not-ready and no-project errors', async () => {
    expect(await failing(new NotReadyError())[IPC.cloudPush](APP, undefined)).toMatchObject({ ok: false, code: 'no-api-key' })
    expect(await failing(new NoProjectError())[IPC.cloudPush](APP, undefined)).toMatchObject({ ok: false, code: 'no-project' })
  })

  it.each([
    ['a bearer token', 'request failed: Authorization: Bearer abcDEF0123456789xyz.tail'],
    ['a GitHub token', 'push rejected for ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'],
    ['a fine-grained GitHub token', 'denied github_pat_' + '11ABCDEFG0abcdefghijkl_' + 'Z'.repeat(40)],
    ['a Vertex key', 'bad key AIzaSy' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'],
  ])('redacts %s from an unexpected error', async (_n, message) => {
    const r = await failing(new Error(message))[IPC.cloudPush](APP, undefined)
    expect(r).toMatchObject({ ok: false })
    const text = (r as { error: string }).error
    expect(text).toContain('[REDACTED]')
    expect(text).not.toMatch(/abcDEF0123456789xyz|ghp_|github_pat_|AIzaSy/)
  })

  it('redacts the very value that was submitted from the error of a failed save', async () => {
    const value = 'plain-looking-secret-value-123'
    const r = await failing(new Error(`could not store ${value}`))[IPC.cloudSetSecret](APP, { name: 'cloud-token', value })
    expect((r as { error: string }).error).not.toContain(value)
  })
})

describe('sender trust', () => {
  it('rejects an untrusted sender without touching the backend', async () => {
    const app = { stop: vi.fn(), resolveApproval: vi.fn(), send: vi.fn() }
    const handlers = createHandlers({
      app: app as unknown as Backend,
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
      app: app as unknown as Backend,
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
