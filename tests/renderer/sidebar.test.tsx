// @vitest-environment jsdom
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Shell } from '../../src/renderer/features/shell/Shell'
import { Sidebar } from '../../src/renderer/features/shell/Sidebar'
import { IPC } from '../../src/shared/channels'
import { createFakeArc, readyStatus } from './helpers/fakeArc'
import { renderWithApp } from './helpers/render'

const meta = (id: string, title: string, updatedAt: string) => ({ id, title, projectRoot: '/work/demo', createdAt: updatedAt, updatedAt })

describe('Sidebar', () => {
  const arcWithSessions = () =>
    createFakeArc({
      [IPC.sessionsList]: {
        ok: true,
        data: [meta('s2', 'Fix the login bug', '2026-10-07T10:00:00Z'), meta('s1', 'Add dark mode', '2026-10-05T10:00:00Z')],
      },
    })

  it('lists sessions in the order given and resumes one on click', async () => {
    const arc = arcWithSessions()
    await renderWithApp(<Sidebar />, { arc })
    const list = screen.getByRole('list', { name: 'Sessions' })
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual([
      expect.stringContaining('Fix the login bug'),
      expect.stringContaining('Add dark mode'),
    ])
    await userEvent.click(within(list).getByRole('button', { name: /Add dark mode/ }))
    expect(arc.callsTo(IPC.sessionsResume)).toEqual([{ id: 's1' }])
  })

  it('marks the active session', async () => {
    const arc = createFakeArc({
      [IPC.status]: { ok: true, data: { ...readyStatus, sessionId: 's2' } },
      [IPC.sessionsList]: { ok: true, data: [meta('s2', 'Fix the login bug', '2026-10-07T10:00:00Z'), meta('s1', 'Add dark mode', '2026-10-05T10:00:00Z')] },
    })
    await renderWithApp(<Sidebar />, { arc })
    expect(screen.getByRole('button', { name: /Fix the login bug/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: /Add dark mode/ })).not.toHaveAttribute('aria-current')
  })

  it('starts a new session in the same project', async () => {
    const arc = createFakeArc()
    await renderWithApp(<Sidebar />, { arc })
    await userEvent.click(screen.getByRole('button', { name: 'New session' }))
    expect(arc.callsTo(IPC.openProject)).toEqual([{ path: '/work/demo' }])
  })

  it('opens a folder through the native picker', async () => {
    const arc = createFakeArc()
    await renderWithApp(<Sidebar />, { arc })
    await userEvent.click(screen.getByRole('button', { name: 'Open folder' }))
    expect(arc.callsTo(IPC.chooseProject)).toHaveLength(1)
  })

  it('shows the project and an empty state for sessions', async () => {
    await renderWithApp(<Sidebar />)
    expect(screen.getByText('demo')).toBeInTheDocument()
    expect(screen.getByText('/work/demo')).toBeInTheDocument()
    expect(screen.getByText(/No sessions yet/)).toBeInTheDocument()
  })

  it('invites you to open a folder when none is open', async () => {
    const arc = createFakeArc({ [IPC.status]: { ok: true, data: { ...readyStatus, hasProject: false, projectRoot: null, mode: null, sessionId: null } } })
    await renderWithApp(<Sidebar />, { arc })
    expect(screen.getByText('No project open')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New session' })).toBeNull()
  })

  it('shows whether the key is connected', async () => {
    await renderWithApp(<Sidebar />)
    expect(screen.getByText(/KEY \/\/ CONNECTED/)).toBeInTheDocument()
  })

  it('shows KEY // MISSING and opens Models settings from the footer', async () => {
    const arc = createFakeArc({ [IPC.status]: { ok: true, data: { ...readyStatus, ready: false, hasApiKey: false } } })
    const r = await renderWithApp(<Sidebar />, { arc })
    expect(screen.getByText(/KEY \/\/ MISSING/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(r.state().ui.settingsOpen).toBe(true)
  })

  it('renders nothing when collapsed', async () => {
    const r = await renderWithApp(<Sidebar />)
    await act(async () => r.app().actions.ui({ sidebar: false }))
    expect(screen.queryByRole('complementary')).toBeNull()
  })
})

describe('Shell', () => {
  it('lays out sidebar, header and the page content', async () => {
    await renderWithApp(<Shell><p>conversation here</p></Shell>)
    expect(screen.getByRole('complementary')).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveTextContent('conversation here')
  })

  it('leaves room for the window buttons when the sidebar is collapsed', async () => {
    const r = await renderWithApp(<Shell><p>x</p></Shell>)
    expect(screen.getByRole('banner')).not.toHaveClass('header--lights')
    await act(async () => r.app().actions.ui({ sidebar: false }))
    expect(screen.getByRole('banner')).toHaveClass('header--lights')
  })
})
