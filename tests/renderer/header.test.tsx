// @vitest-environment jsdom
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Header } from '../../src/renderer/features/header/Header'
import { IPC } from '../../src/shared/channels'
import { createFakeArc, readyStatus } from './helpers/fakeArc'
import { renderWithApp } from './helpers/render'

const todos = (done: number, total: number, current?: number) =>
  Array.from({ length: total }, (_, i) => ({
    id: String(i),
    content: `Step ${i + 1}`,
    status: (i < done ? 'completed' : i === current ? 'in_progress' : 'pending') as 'completed' | 'in_progress' | 'pending',
  }))

describe('ProgressPill', () => {
  it('says what the bot is doing, with a live dot', async () => {
    const r = await renderWithApp(<Header />)
    await r.emit({ type: 'status', state: 'working', label: 'Editing app.ts' })
    const pill = screen.getByRole('button', { name: /Editing app\.ts/ })
    expect(pill).toBeInTheDocument()
    expect(pill.querySelector('.dot')).toBeTruthy()
  })

  it('is calm when idle', async () => {
    await renderWithApp(<Header />)
    const pill = screen.getByRole('button', { name: /All systems nominal/ })
    expect(pill.querySelector('.dot')).toBeNull()
  })

  it('shows plan progress and opens the plan', async () => {
    const r = await renderWithApp(<Header />)
    await r.emit({ type: 'todos', todos: todos(3, 7, 3) })
    const pill = screen.getByRole('button', { name: /3 of 7/ })
    expect(screen.getByRole('progressbar', { name: 'Plan progress' })).toHaveAttribute('aria-valuenow', '3')
    await userEvent.click(pill)
    const plan = screen.getByRole('dialog', { name: 'Plan' })
    const items = within(plan).getAllByRole('listitem')
    expect(items).toHaveLength(7)
    const current = within(plan).getByText('Step 4').closest('li')!
    expect(current).toHaveAttribute('data-status', 'in_progress')
    expect(current).toHaveAttribute('aria-current', 'step')
    expect(within(plan).getByText('Step 1').closest('li')).toHaveAttribute('data-status', 'completed')
  })

  it('explains an empty plan', async () => {
    await renderWithApp(<Header />)
    await userEvent.click(screen.getByRole('button', { name: /All systems nominal/ }))
    expect(within(screen.getByRole('dialog', { name: 'Plan' })).getByText(/No plan yet/)).toBeInTheDocument()
  })
})

describe('Changes', () => {
  it('is disabled with no changes', async () => {
    await renderWithApp(<Header />)
    expect(screen.getByRole('button', { name: /Changes/ })).toBeDisabled()
  })

  it('lists changed files by name with the path as a tooltip, and undoes them', async () => {
    const arc = createFakeArc()
    const r = await renderWithApp(<Header />, { arc })
    await r.emit({ type: 'changes', files: ['/work/demo/src/app.ts', '/work/demo/b.ts'], canUndo: true })
    const button = screen.getByRole('button', { name: /Changes/ })
    expect(button).toHaveTextContent('2')
    await userEvent.click(button)
    const popover = screen.getByRole('dialog', { name: 'Changes' })
    const row = within(popover).getByText('app.ts').closest('li')!
    expect(row).toHaveAttribute('title', '/work/demo/src/app.ts')
    await userEvent.click(within(popover).getByRole('button', { name: /Undo/ }))
    expect(arc.callsTo(IPC.undo)).toHaveLength(1)
    expect(arc.callsTo(IPC.changes).length).toBeGreaterThan(1)
  })

  it('disables Undo when nothing can be undone', async () => {
    const r = await renderWithApp(<Header />)
    await r.emit({ type: 'changes', files: ['/work/demo/a.ts'], canUndo: false })
    await userEvent.click(screen.getByRole('button', { name: /Changes/ }))
    expect(within(screen.getByRole('dialog', { name: 'Changes' })).getByRole('button', { name: /Undo/ })).toBeDisabled()
  })
})

describe('ModeChip (review focus 4)', () => {
  it('shows the current mode', async () => {
    const r = await renderWithApp(<Header />)
    expect(screen.getByRole('button', { name: /Mode: ASK/ })).toBeInTheDocument()
    await r.emit({ type: 'mode', mode: 'auto-edit' })
    expect(screen.getByRole('button', { name: /Mode: AUTO-EDIT/ })).toBeInTheDocument()
    await r.emit({ type: 'mode', mode: 'auto' })
    expect(screen.getByRole('button', { name: /Mode: AUTO/ })).toHaveClass('mode-chip--auto')
  })

  it('switches to Auto-edit without a confirmation', async () => {
    const arc = createFakeArc()
    await renderWithApp(<Header />, { arc })
    await userEvent.click(screen.getByRole('button', { name: /Mode: ASK/ }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Auto-edit' }))
    expect(arc.callsTo(IPC.setMode)).toEqual([{ mode: 'auto-edit' }])
    expect(screen.queryByRole('dialog', { name: /Auto mode/ })).toBeNull()
  })

  it('asks before Auto, names what changes, and only then switches', async () => {
    const arc = createFakeArc()
    await renderWithApp(<Header />, { arc })
    await userEvent.click(screen.getByRole('button', { name: /Mode: ASK/ }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Auto' }))
    const dialog = screen.getByRole('dialog', { name: /Switch to Auto mode/ })
    expect(dialog).toHaveTextContent(/without asking/)
    expect(dialog).toHaveTextContent(/sandbox/)
    expect(arc.callsTo(IPC.setMode)).toEqual([])
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(arc.callsTo(IPC.setMode)).toEqual([])
    await userEvent.click(screen.getByRole('button', { name: /Mode: ASK/ }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Auto' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: /Switch to Auto mode/ })).getByRole('button', { name: 'Switch to Auto' }))
    expect(arc.callsTo(IPC.setMode)).toEqual([{ mode: 'auto' }])
  })

  it('marks the active mode in the menu', async () => {
    await renderWithApp(<Header />)
    await userEvent.click(screen.getByRole('button', { name: /Mode: ASK/ }))
    expect(screen.getByRole('menuitemradio', { name: 'Ask' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'false')
  })
})

describe('Header controls', () => {
  it('names the project and toggles the sidebar', async () => {
    const r = await renderWithApp(<Header />)
    expect(screen.getByText('demo')).toBeInTheDocument()
    expect(r.state().ui.sidebar).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    expect(r.state().ui.sidebar).toBe(false)
  })

  it('Spark asks the backend for ideas and is off while busy or locked', async () => {
    const arc = createFakeArc()
    const r = await renderWithApp(<Header />, { arc })
    await userEvent.click(screen.getByRole('button', { name: /Spark/ }))
    expect(arc.callsTo(IPC.spark)).toHaveLength(1)
    await act(async () => {
      void r.app().actions.sendMessage('go')
    })
    expect(screen.getByRole('button', { name: /Spark/ })).toBeDisabled()
  })

  it('Spark is disabled when there is no key', async () => {
    const arc = createFakeArc({ [IPC.status]: { ok: true, data: { ...readyStatus, ready: false, hasApiKey: false } } })
    await renderWithApp(<Header />, { arc })
    expect(screen.getByRole('button', { name: /Spark/ })).toBeDisabled()
  })

  it('the settings button opens settings', async () => {
    const r = await renderWithApp(<Header />)
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(r.state().ui.settingsOpen).toBe(true)
  })

  it('shows a placeholder when no project is open', async () => {
    const arc = createFakeArc({ [IPC.status]: { ok: true, data: { ...readyStatus, hasProject: false, projectRoot: null, mode: null } } })
    await renderWithApp(<Header />, { arc })
    expect(screen.getByText('No project')).toBeInTheDocument()
  })
})
