import { describe, expect, it } from 'vitest'
import { ArcError, createClient } from '../../src/renderer/arc/client'
import { INVOKE_CHANNELS, IPC } from '../../src/shared/channels'
import { IPC_SCHEMAS } from '../../src/shared/ipc'
import { createFakeArc } from './helpers/fakeArc'

describe('createClient', () => {
  it('returns the data of a successful result', async () => {
    const arc = createFakeArc({ [IPC.send]: { ok: true, data: 'done' } })
    expect(await createClient(arc).send('hi')).toBe('done')
    expect(arc.callsTo(IPC.send)).toEqual([{ text: 'hi' }])
  })

  it('throws an ArcError carrying the code and message of a failed result', async () => {
    const arc = createFakeArc({
      [IPC.send]: { ok: false, error: 'Add your Vertex API key in Settings to start.', code: 'no-api-key' },
    })
    const err = await createClient(arc).send('hi').catch((e) => e)
    expect(err).toBeInstanceOf(ArcError)
    expect(err.code).toBe('no-api-key')
    expect(err.message).toBe('Add your Vertex API key in Settings to start.')
  })

  it('wraps a transport failure in an ArcError without a code', async () => {
    const arc = createFakeArc()
    arc.invoke = async () => {
      throw new Error('ipc exploded')
    }
    const err = await createClient(arc).status().catch((e) => e)
    expect(err).toBeInstanceOf(ArcError)
    expect(err.code).toBeUndefined()
    expect(err.message).toContain('ipc exploded')
  })

  it('only ever invokes known channels, with payloads the backend schemas accept', async () => {
    const arc = createFakeArc()
    const c = createClient(arc)
    await Promise.all([
      c.send('hello'), c.stop(), c.approve('r1', 'always', 'ok'), c.approve('r2', 'deny'), c.answer('q1', 'Blue'),
      c.setMode('auto-edit'), c.undo(), c.changes(), c.chooseProject(), c.openProject('/work/demo'), c.status(),
      c.getSettings(), c.saveSettings({ prompterModel: 'x', prompter: { mode: 'off' } }), c.setKey('abc'), c.clearKey(),
      c.testKey(), c.listSessions(), c.resumeSession('s1'), c.listRules(), c.removeRule({ tool: 'Bash', prefix: 'npm test' }),
      c.readAudit(), c.spark(), c.setAutopilot(true),
      c.cloudStatus(), c.cloudSetSecret('github-token', 'ghp_x'), c.cloudClearSecret('cloud-token'), c.cloudTest(),
      c.cloudStart({ repo: 'me/app', baseBranch: 'main', name: 'fix' }), c.cloudSessions(), c.cloudAttach('c1'), c.cloudLeave(),
      c.cloudEnd('c1'), c.cloudDiff(), c.cloudPush(), c.cloudPr({ title: 'Fix', body: 'b', draft: true }),
    ])
    const seen = new Set(arc.calls.map((x) => x.channel))
    for (const call of arc.calls) {
      expect(INVOKE_CHANNELS, call.channel).toContain(call.channel)
      const schema = IPC_SCHEMAS[call.channel as keyof typeof IPC_SCHEMAS]
      expect(schema.safeParse(call.payload).success, `${call.channel} ${JSON.stringify(call.payload)}`).toBe(true)
    }
    expect([...seen].sort()).toEqual([...INVOKE_CHANNELS].sort())
  })

  it('passes events through and lets the listener unsubscribe', () => {
    const arc = createFakeArc()
    const got: string[] = []
    const off = createClient(arc).onEvent((e) => got.push(e.type))
    arc.emit({ type: 'turn-end', reason: 'done' })
    off()
    arc.emit({ type: 'turn-end', reason: 'done' })
    expect(got).toEqual(['turn-end'])
  })
})
