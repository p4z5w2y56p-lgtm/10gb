// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CloudSessionInfo, CloudStatus } from '../../src/shared/cloud'
import { IPC } from '../../src/shared/channels'
import { initialState, reduce } from '../../src/renderer/state/reducer'
import { createFakeArc } from './helpers/fakeArc'
import { renderWithApp } from './helpers/render'

const info: CloudSessionInfo = {
  id: 'c1', repo: 'me/app', branch: 'arc/fix-1a2b', baseBranch: 'main', busy: false, mode: 'ask',
  createdAt: '2026-10-07T10:00:00Z', lastActiveAt: '2026-10-07T10:05:00Z', pushed: false,
}
const configured: CloudStatus = { configured: true, workerUrl: 'https://w.example', hasCloudToken: true, hasGithubToken: true, autoPush: true, active: null }

describe('cloud reducer state', () => {
  it('starts with no cloud data and closed dialogs', () => {
    expect(initialState.cloud).toEqual({ status: null, sessions: [], diff: null })
    expect(initialState.ui).toMatchObject({ cloudStartOpen: false, prOpen: false })
  })

  it('merges cloud patches without losing the other parts', () => {
    let s = reduce(initialState, { type: 'cloud', status: configured })
    s = reduce(s, { type: 'cloud', sessions: [info] })
    expect(s.cloud.status).toEqual(configured)
    expect(s.cloud.sessions).toEqual([info])
    s = reduce(s, { type: 'cloud', diff: null })
    expect(s.cloud.sessions).toHaveLength(1)
  })

  it('a reset drops the old diff but keeps the cloud setup', () => {
    let s = reduce(initialState, { type: 'cloud', status: configured, sessions: [info], diff: { branch: 'b', baseBranch: 'main', files: [], uncommitted: false, ahead: 0, pushed: false } })
    s = reduce(s, { type: 'reset' })
    expect(s.cloud.diff).toBeNull()
    expect(s.cloud.status).toEqual(configured)
  })

  it('an answered question is cleared at once, not only at turn end', () => {
    let s = reduce(initialState, { type: 'event', event: { type: 'question', id: 'q', question: 'Which?' } })
    s = reduce(s, { type: 'question-answered' })
    expect(s.question).toBeNull()
  })
})

describe('cloud actions', () => {
  it('loads the cloud status and the worker sessions on mount when configured', async () => {
    const arc = createFakeArc({ [IPC.cloudStatus]: { ok: true, data: configured }, [IPC.cloudSessions]: { ok: true, data: [info] } })
    const r = await renderWithApp(<div />, { arc })
    expect(r.state().cloud.status).toEqual(configured)
    expect(r.state().cloud.sessions).toEqual([info])
  })

  it('does not call the worker when the cloud is not set up', async () => {
    const arc = createFakeArc({ [IPC.cloudStatus]: { ok: true, data: { ...configured, configured: false, hasCloudToken: false } } })
    const r = await renderWithApp(<div />, { arc })
    expect(arc.callsTo(IPC.cloudSessions)).toEqual([])
    expect(r.state().cloud.sessions).toEqual([])
  })

  it('an unreachable worker leaves an empty list and no error banner', async () => {
    const arc = createFakeArc({ [IPC.cloudStatus]: { ok: true, data: configured }, [IPC.cloudSessions]: { ok: false, error: 'Could not reach the cloud worker.' } })
    const r = await renderWithApp(<div />, { arc })
    expect(r.state().cloud.sessions).toEqual([])
    expect(r.state().transcript).toHaveLength(0)
  })

  it('cloudStart opens the session like a project: reset, history, then a refresh', async () => {
    const arc = createFakeArc({
      [IPC.cloudStatus]: { ok: true, data: configured },
      [IPC.cloudStart]: { ok: true, data: { root: 'me/app @ arc/fix-1a2b', sessionId: 'c1', cloud: info, history: [{ role: 'user', parts: [{ text: 'earlier' }] }] } },
    })
    const r = await renderWithApp(<div />, { arc })
    await act(async () => { await r.app().actions.cloudStart({ repo: 'me/app' }) })
    expect(arc.callsTo(IPC.cloudStart)).toEqual([{ repo: 'me/app' }])
    expect(r.state().transcript[0]).toMatchObject({ kind: 'user', text: 'earlier' })
    expect(r.state().ui.cloudStartOpen).toBe(false)
  })

  it('cloudStart failures reach the caller (the dialog shows them) and do not clutter the transcript', async () => {
    const arc = createFakeArc({ [IPC.cloudStart]: { ok: false, error: 'Add your GitHub token in Settings > Cloud.' } })
    const r = await renderWithApp(<div />, { arc })
    let message = ''
    await act(async () => { await r.app().actions.cloudStart({ repo: 'me/app' }).catch((e: Error) => { message = e.message }) })
    expect(message).toBe('Add your GitHub token in Settings > Cloud.')
    expect(r.state().transcript).toHaveLength(0)
  })

  it('push refreshes the diff and reports the result', async () => {
    const diff = { branch: 'arc/x', baseBranch: 'main', files: [], uncommitted: false, ahead: 1, pushed: true }
    const arc = createFakeArc({
      [IPC.cloudPush]: { ok: true, data: { branch: 'arc/x', commit: 'abc1234', pushed: true, skipped: [], url: 'https://github.com/me/app/tree/arc/x' } },
      [IPC.cloudDiff]: { ok: true, data: diff },
    })
    const r = await renderWithApp(<div />, { arc })
    let result: unknown
    await act(async () => { result = await r.app().actions.cloudPush() })
    expect(result).toMatchObject({ commit: 'abc1234' })
    expect(r.state().cloud.diff).toEqual(diff)
  })

  it('saving a secret updates the cloud status from the reply', async () => {
    const arc = createFakeArc({ [IPC.cloudSetSecret]: { ok: true, data: configured } })
    const r = await renderWithApp(<div />, { arc })
    await act(async () => { await r.app().actions.cloudSetSecret('github-token', 'ghp_x') })
    expect(arc.callsTo(IPC.cloudSetSecret)).toEqual([{ name: 'github-token', value: 'ghp_x' }])
    expect(r.state().cloud.status).toEqual(configured)
  })

  it('answering a question clears it before the backend replies', async () => {
    const arc = createFakeArc()
    const r = await renderWithApp(<div />, { arc })
    await r.emit({ type: 'question', id: 'q1', question: 'Which?' })
    await act(async () => { await r.app().actions.answer('Blue') })
    expect(r.state().question).toBeNull()
  })
})
