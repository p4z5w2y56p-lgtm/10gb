// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/main/store/settings'
import { IPC } from '../../src/shared/channels'
import { createFakeArc, readyStatus } from './helpers/fakeArc'
import { renderWithApp } from './helpers/render'

describe('AppProvider', () => {
  it('loads status, settings, changes and sessions on mount and applies the theme', async () => {
    const arc = createFakeArc({
      [IPC.settingsGet]: { ok: true, data: { settings: { ...DEFAULT_SETTINGS, theme: 'studios' }, status: readyStatus } },
      [IPC.sessionsList]: { ok: true, data: [{ id: 's1', title: 'First', projectRoot: '/work/demo', createdAt: 'a', updatedAt: 'b' }] },
    })
    const r = await renderWithApp(<div />, { arc })
    expect(r.state().app?.ready).toBe(true)
    expect(r.state().settings?.theme).toBe('studios')
    expect(r.state().sessions).toHaveLength(1)
    expect(document.documentElement.dataset.theme).toBe('studios')
    expect(r.state().mode).toBe('ask')
  })

  it('feeds backend events into state and unsubscribes on unmount', async () => {
    const r = await renderWithApp(<div />)
    await r.emit({ type: 'text-delta', text: 'hi' })
    expect(r.state().transcript[0]).toMatchObject({ kind: 'assistant', text: 'hi' })
    r.unmount()
    r.arc.emit({ type: 'text-delta', text: 'ignored' })
  })

  it('sendMessage shows the message at once and calls the backend', async () => {
    const r = await renderWithApp(<div />)
    await act(async () => {
      await r.app().actions.sendMessage('fix the bug')
    })
    expect(r.arc.callsTo(IPC.send)).toEqual([{ text: 'fix the bug' }])
    expect(r.state().transcript[0]).toMatchObject({ kind: 'user', text: 'fix the bug' })
  })

  it('review focus 3: a refused send unlocks the composer, explains why, and re-checks the lock', async () => {
    const arc = createFakeArc({ [IPC.send]: { ok: false, error: 'Add your Vertex API key in Settings to start.', code: 'no-api-key' } })
    const r = await renderWithApp(<div />, { arc })
    arc.respond(IPC.status, { ok: true, data: { ...readyStatus, ready: false, hasApiKey: false, reason: 'no-api-key' } })
    await act(async () => {
      await r.app().actions.sendMessage('go')
    })
    expect(r.state().busy).toBe(false)
    expect(r.state().status.state).toBe('idle')
    expect(r.state().transcript.at(-1)).toMatchObject({ kind: 'notice', level: 'error', message: 'Add your Vertex API key in Settings to start.' })
    expect(r.state().app?.ready).toBe(false)
  })

  it('saveSettings updates state and the theme', async () => {
    const arc = createFakeArc()
    const r = await renderWithApp(<div />, { arc })
    arc.respond(IPC.settingsSave, (p) => ({ ok: true, data: { settings: { ...DEFAULT_SETTINGS, ...(p as { patch: object }).patch }, status: readyStatus } }))
    await act(async () => {
      await r.app().actions.saveSettings({ theme: 'studios' })
    })
    expect(arc.callsTo(IPC.settingsSave)).toEqual([{ patch: { theme: 'studios' } }])
    expect(r.state().settings?.theme).toBe('studios')
    expect(document.documentElement.dataset.theme).toBe('studios')
  })

  it('saveKey stores the key and takes the new status from the backend', async () => {
    const arc = createFakeArc({ [IPC.status]: { ok: true, data: { ...readyStatus, ready: false, hasApiKey: false } } })
    const r = await renderWithApp(<div />, { arc })
    expect(r.state().app?.ready).toBe(false)
    arc.respond(IPC.setKey, { ok: true, data: readyStatus })
    await act(async () => {
      await r.app().actions.saveKey('AIza-example')
    })
    expect(arc.callsTo(IPC.setKey)).toEqual([{ key: 'AIza-example' }])
    expect(r.state().app?.ready).toBe(true)
  })

  it('review focus 4: removing the key stops a running turn first', async () => {
    const arc = createFakeArc()
    const r = await renderWithApp(<div />, { arc })
    await act(async () => {
      void r.app().actions.sendMessage('long task')
    })
    expect(r.state().busy).toBe(true)
    arc.respond(IPC.clearKey, { ok: true, data: { ...readyStatus, ready: false, hasApiKey: false } })
    await act(async () => {
      await r.app().actions.removeKey()
    })
    const channels = arc.calls.map((c) => c.channel)
    expect(channels.indexOf(IPC.stop)).toBeGreaterThan(-1)
    expect(channels.indexOf(IPC.stop)).toBeLessThan(channels.indexOf(IPC.clearKey))
    expect(r.state().app?.ready).toBe(false)
  })

  it('resumeSession loads the saved conversation into the transcript', async () => {
    const arc = createFakeArc({
      [IPC.sessionsResume]: {
        ok: true,
        data: { root: '/work/demo', sessionId: 's9', history: [{ role: 'user', parts: [{ text: 'Earlier question' }] }, { role: 'model', parts: [{ text: 'Earlier answer' }] }] },
      },
    })
    const r = await renderWithApp(<div />, { arc })
    await act(async () => {
      await r.app().actions.resumeSession('s9')
    })
    expect(r.state().transcript.map((i) => i.kind)).toEqual(['user', 'assistant'])
  })

  it('chooseProject does nothing when the dialog is cancelled and resets the chat when a folder is opened', async () => {
    const arc = createFakeArc({ [IPC.chooseProject]: { ok: true, data: null } })
    const r = await renderWithApp(<div />, { arc })
    await r.emit({ type: 'text-delta', text: 'old chat' })
    await act(async () => {
      await r.app().actions.chooseProject()
    })
    expect(r.state().transcript).toHaveLength(1)
    arc.respond(IPC.chooseProject, { ok: true, data: { root: '/work/other', sessionId: 's2', history: [] } })
    await act(async () => {
      await r.app().actions.chooseProject()
    })
    expect(r.state().transcript).toEqual([])
  })

  it('approve and answer address the pending request', async () => {
    const r = await renderWithApp(<div />)
    await r.emit({ type: 'approval-request', request: { call: { id: 'e1', name: 'Edit', args: {} }, reason: 'Edit a.ts' } })
    await act(async () => {
      await r.app().actions.approve('allow-once')
    })
    expect(r.arc.callsTo(IPC.approval)).toEqual([{ requestId: 'e1', decision: 'allow-once' }])
    await r.emit({ type: 'question', id: 'q1', question: 'Colour?' })
    await act(async () => {
      await r.app().actions.answer('Blue')
    })
    expect(r.arc.callsTo(IPC.answer)).toEqual([{ questionId: 'q1', answer: 'Blue' }])
  })
})
