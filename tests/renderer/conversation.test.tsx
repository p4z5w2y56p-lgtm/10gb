// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ApprovalCard } from '../../src/renderer/features/conversation/ApprovalCard'
import { EmptyState } from '../../src/renderer/features/conversation/EmptyState'
import { QuestionCard } from '../../src/renderer/features/conversation/QuestionCard'
import { Transcript } from '../../src/renderer/features/conversation/Transcript'
import { Markdown } from '../../src/renderer/ui/Markdown'
import { IPC } from '../../src/shared/channels'
import type { ToolCall } from '../../src/shared/types'
import { createFakeArc, readyStatus } from './helpers/fakeArc'
import { renderWithApp } from './helpers/render'

type R = Awaited<ReturnType<typeof renderWithApp>>
const allow = { verdict: 'allow' as const, reason: 'ok' }

/** Play one tool call through the backend events the reducer folds into an activity item. */
async function activity(r: R, id: string, name: string, args: Record<string, unknown>, opts: { running?: string; done?: string; state?: 'done' | 'failed' | 'denied' | 'running'; output?: string; phase?: string } = {}) {
  const call: ToolCall = { id, name, args }
  const phase = (opts.phase ?? 'reading') as never
  await r.emit({ type: 'tool-call', call, verdict: allow })
  await r.emit({ type: 'activity', id, phase, label: opts.running ?? `Working ${id}`, state: 'running' })
  if (opts.state === 'running') return
  if (opts.output !== undefined) await r.emit({ type: 'tool-result', id, result: { ok: opts.state !== 'failed', output: opts.output } })
  await r.emit({ type: 'activity', id, phase, label: opts.done ?? `Done ${id}`, state: opts.state ?? 'done' })
}

describe('Markdown (review focus 2)', () => {
  it('renders bold, code and lists', () => {
    const { container } = render(<Markdown text={'**bold** and `code`\n\n- one\n- two'} />)
    expect(container.querySelector('strong')).toHaveTextContent('bold')
    expect(container.querySelector('code')).toHaveTextContent('code')
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  it('strips scripts, event handlers and javascript: links', () => {
    const { container } = render(
      <Markdown text={'<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[click](javascript:alert(1))\n\n<a href="javascript:alert(2)" onclick="alert(3)">x</a>'} />,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).not.toMatch(/onerror|onclick/i)
    for (const a of container.querySelectorAll('a')) expect(a.getAttribute('href') ?? '').not.toMatch(/^javascript:/i)
  })

  it('opens links outside the app', () => {
    const { container } = render(<Markdown text="[docs](https://example.com)" />)
    const a = container.querySelector('a')!
    expect(a).toHaveAttribute('target', '_blank')
    expect(a.getAttribute('rel')).toContain('noopener')
    expect(a.getAttribute('rel')).toContain('noreferrer')
  })
})

describe('Transcript', () => {
  it('shows the user message and the streamed answer with a caret until the turn ends', async () => {
    const r = await renderWithApp(<Transcript />)
    await act(async () => r.app().dispatch({ type: 'user-message', text: 'Fix the login bug' }))
    await r.emit({ type: 'text-delta', text: 'On it. I will **check** the form.' })
    expect(screen.getByText('Fix the login bug')).toBeInTheDocument()
    expect(screen.getByText('check').tagName).toBe('STRONG')
    expect(document.querySelector('.caret')).toBeTruthy()
    await r.emit({ type: 'turn-end', reason: 'done' })
    expect(document.querySelector('.caret')).toBeNull()
  })

  it('shows notices, with errors announced', async () => {
    const r = await renderWithApp(<Transcript />)
    await r.emit({ type: 'notice', level: 'error', message: 'The connection was lost.' })
    expect(screen.getByRole('alert')).toHaveTextContent('The connection was lost.')
    await r.emit({ type: 'notice', level: 'info', message: 'Compacted the conversation.' })
    expect(screen.getByText('Compacted the conversation.')).toBeInTheDocument()
  })

  it('review focus 1: a 200,000 character message is collapsed until asked for', async () => {
    const r = await renderWithApp(<Transcript />)
    await r.emit({ type: 'text-delta', text: 'word '.repeat(40_000) })
    await r.emit({ type: 'turn-end', reason: 'done' })
    const before = document.body.textContent!.length
    expect(before).toBeLessThan(40_000)
    await userEvent.click(screen.getByRole('button', { name: 'Show full message' }))
    expect(document.body.textContent!.length).toBeGreaterThanOrEqual(200_000)
  })

  it('review focus 1: only the latest items are in the DOM, with a way to load earlier ones', async () => {
    const r = await renderWithApp(<Transcript />)
    const history = Array.from({ length: 1000 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'model') as 'user' | 'model',
      parts: [{ text: `message ${i}` }],
    }))
    await act(async () => r.app().dispatch({ type: 'history', history }))
    expect(screen.getByText('message 999')).toBeInTheDocument()
    expect(screen.queryByText('message 0')).toBeNull()
    expect(document.querySelectorAll('[data-item]').length).toBeLessThanOrEqual(400)
    await userEvent.click(screen.getByRole('button', { name: /Show 600 earlier/ }))
    expect(document.querySelectorAll('[data-item]').length).toBeGreaterThan(400)
  })

  it('review focus 1: stays pinned to the bottom only while the reader is at the bottom', async () => {
    const r = await renderWithApp(<Transcript />)
    const scroller = document.querySelector('.transcript')! as HTMLElement
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 500 })
    scroller.scrollTop = 0
    fireEvent.scroll(scroller)
    await r.emit({ type: 'text-delta', text: 'first' })
    expect(scroller.scrollTop).toBe(0)
    scroller.scrollTop = 500
    fireEvent.scroll(scroller)
    await r.emit({ type: 'text-delta', text: ' second' })
    expect(scroller.scrollTop).toBe(1000)
  })
})

describe('Activity feed', () => {
  it('collapses consecutive reads into one line and expands to the files', async () => {
    const r = await renderWithApp(<Transcript />)
    for (const [i, name] of ['a.ts', 'b.ts', 'c.ts'].entries()) {
      await activity(r, `r${i}`, 'Read', { file_path: `src/${name}` }, { running: `Reading ${name}`, done: `Read ${name}` })
    }
    expect(screen.getByText('Read 3 files')).toBeInTheDocument()
    expect(screen.queryByText('Read a.ts')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Read 3 files/ }))
    for (const n of ['a.ts', 'b.ts', 'c.ts']) expect(screen.getByText(`Read ${n}`)).toBeInTheDocument()
  })

  it('leaves a single read as its own line', async () => {
    const r = await renderWithApp(<Transcript />)
    await activity(r, 'r1', 'Read', { file_path: 'a.ts' }, { running: 'Reading a.ts', done: 'Read a.ts' })
    expect(screen.getByText('Read a.ts')).toBeInTheDocument()
  })

  it('a finished edit is one calm line; the diff only appears under Details', async () => {
    const r = await renderWithApp(<Transcript />)
    const diff = 'Edited app.ts\n--- app.ts\n+++ app.ts\n@@ -1 +1 @@\n-const a = 1\n+const a = 2\n'
    await activity(r, 'e1', 'Edit', { file_path: 'app.ts' }, { phase: 'editing', running: 'Editing app.ts', done: 'Edited app.ts', output: diff })
    const line = screen.getByRole('button', { name: /Edited app\.ts/ })
    expect(line.closest('[data-state]')).toHaveAttribute('data-state', 'done')
    expect(screen.queryByText('const a = 2')).toBeNull()
    await userEvent.click(line)
    expect(screen.getByText('+const a = 2')).toHaveClass('diff__line--add')
    expect(screen.getByText('-const a = 1')).toHaveClass('diff__line--del')
  })

  it('a running item shows a spinner and its running label', async () => {
    const r = await renderWithApp(<Transcript />)
    await activity(r, 'e1', 'Edit', { file_path: 'app.ts' }, { phase: 'editing', running: 'Editing app.ts', state: 'running' })
    const row = screen.getByText('Editing app.ts').closest('[data-state]')!
    expect(row).toHaveAttribute('data-state', 'running')
    expect(row.querySelector('.spinner')).toBeTruthy()
  })

  it('shows denied and failed items distinctly', async () => {
    const r = await renderWithApp(<Transcript />)
    await activity(r, 'd1', 'Write', { file_path: '~/.ssh/x' }, { phase: 'writing', running: 'Creating x', done: 'Blocked: Creating x', state: 'denied' })
    await activity(r, 'f1', 'Bash', { command: 'npm test' }, { phase: 'running', running: 'Running the tests', done: 'Tests failed', state: 'failed', output: 'FAIL' })
    expect(screen.getByText('Blocked: Creating x').closest('[data-state]')).toHaveAttribute('data-state', 'denied')
    expect(screen.getByText('Tests failed').closest('[data-state]')).toHaveAttribute('data-state', 'failed')
  })

  it('shows raw tool output only under Details, as plain text', async () => {
    const r = await renderWithApp(<Transcript />)
    await activity(r, 'b1', 'Bash', { command: 'npm test' }, { phase: 'running', running: 'Running the tests', done: 'Tests passed', output: '12 passed <b>bold</b>' })
    expect(screen.queryByText(/12 passed/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Tests passed/ }))
    expect(screen.getByText(/12 passed/)).toBeInTheDocument()
    expect(document.querySelector('.activity__output b')).toBeNull()
  })

  it('review focus 1: very long output is cut with a Show all control', async () => {
    const r = await renderWithApp(<Transcript />)
    await activity(r, 'b1', 'Bash', { command: 'cat big' }, { phase: 'running', running: 'Running a command', done: 'Command finished', output: 'x'.repeat(50_000) })
    await userEvent.click(screen.getByRole('button', { name: /Command finished/ }))
    const out = document.querySelector('.activity__output')!
    expect(out.textContent!.length).toBeLessThan(21_000)
    await userEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(document.querySelector('.activity__output')!.textContent!.length).toBeGreaterThanOrEqual(50_000)
  })

  it('"show details" expands everything at once', async () => {
    const r = await renderWithApp(<Transcript />)
    await activity(r, 'b1', 'Bash', { command: 'npm test' }, { phase: 'running', running: 'Running the tests', done: 'Tests passed', output: 'all green' })
    expect(screen.queryByText('all green')).toBeNull()
    await act(async () => r.app().actions.ui({ showDetails: true }))
    expect(screen.getByText('all green')).toBeInTheDocument()
  })
})

describe('ApprovalCard', () => {
  const bash: ToolCall = { id: 'b1', name: 'Bash', args: { command: 'mkdir -p out' } }
  const edit: ToolCall = { id: 'e1', name: 'Edit', args: { file_path: 'src/app.ts', old_string: 'a', new_string: 'b' } }

  it('asks in plain language and shows a Bash command verbatim', async () => {
    const r = await renderWithApp(<ApprovalCard />)
    await r.emit({ type: 'approval-request', request: { call: bash, reason: 'Run a shell command' } })
    expect(screen.getByRole('heading', { name: 'Run this command?' })).toBeInTheDocument()
    expect(screen.getByText('mkdir -p out')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Allow once/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Always allow this/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Deny/ })).toBeInTheDocument()
  })

  it('answers from the keyboard: y, a and n', async () => {
    for (const [key, decision] of [['y', 'allow-once'], ['a', 'always'], ['n', 'deny']] as const) {
      const arc = createFakeArc()
      const r = await renderWithApp(<ApprovalCard />, { arc })
      await r.emit({ type: 'approval-request', request: { call: bash, reason: 'Run' } })
      await userEvent.keyboard(key)
      expect(arc.callsTo(IPC.approval), key).toEqual([{ requestId: 'b1', decision }])
      r.unmount()
    }
  })

  it('does not hijack typing in a text field', async () => {
    const arc = createFakeArc()
    const r = await renderWithApp(<><ApprovalCard /><input aria-label="note" /></>, { arc })
    await r.emit({ type: 'approval-request', request: { call: bash, reason: 'Run' } })
    await userEvent.click(screen.getByLabelText('note'))
    await userEvent.keyboard('yes')
    expect(arc.callsTo(IPC.approval)).toEqual([])
  })

  it('shows file names for an edit and only reveals the diff on request', async () => {
    const r = await renderWithApp(<ApprovalCard />)
    await r.emit({ type: 'approval-request', request: { call: edit, reason: 'Edit src/app.ts', diff: '--- app.ts\n+++ app.ts\n@@ -1 +1 @@\n-a\n+b\n' } })
    expect(screen.getByRole('heading', { name: 'Edit app.ts?' })).toBeInTheDocument()
    expect(screen.queryByText('+b')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'View changes' }))
    expect(screen.getByText('+b')).toHaveClass('diff__line--add')
  })

  it('locks the buttons after a decision', async () => {
    const arc = createFakeArc()
    const r = await renderWithApp(<ApprovalCard />, { arc })
    await r.emit({ type: 'approval-request', request: { call: bash, reason: 'Run' } })
    await userEvent.click(screen.getByRole('button', { name: /Allow once/ }))
    expect(screen.getByRole('button', { name: /Allow once/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Deny/ })).toBeDisabled()
    await userEvent.keyboard('n')
    expect(arc.callsTo(IPC.approval)).toHaveLength(1)
  })

  it('offers no standing rule for a read outside the project', async () => {
    const r = await renderWithApp(<ApprovalCard />)
    await r.emit({ type: 'approval-request', request: { call: { id: 'x', name: 'Read', args: { file_path: '/etc/hosts' } }, reason: 'Reads outside the project' } })
    expect(screen.queryByRole('button', { name: /Always allow this/ })).toBeNull()
  })

  it('renders nothing when no approval is pending', async () => {
    await renderWithApp(<ApprovalCard />)
    expect(screen.queryByRole('heading')).toBeNull()
  })
})

describe('QuestionCard', () => {
  it('lists the options and sends the chosen answer', async () => {
    const arc = createFakeArc()
    const r = await renderWithApp(<QuestionCard />, { arc })
    await r.emit({ type: 'question', id: 'q1', question: 'Which colour?', options: ['Red', 'Blue'] })
    expect(screen.getByRole('heading', { name: 'Which colour?' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Blue' }))
    expect(arc.callsTo(IPC.answer)).toEqual([{ questionId: 'q1', answer: 'Blue' }])
  })

  it('takes a free-text answer', async () => {
    const arc = createFakeArc()
    const r = await renderWithApp(<QuestionCard />, { arc })
    await r.emit({ type: 'question', id: 'q1', question: 'What should it be called?' })
    await userEvent.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Orion{Enter}')
    expect(arc.callsTo(IPC.answer)).toEqual([{ questionId: 'q1', answer: 'Orion' }])
  })
})

describe('EmptyState', () => {
  it('invites you to start, with Spark ideas you can click', async () => {
    const arc = createFakeArc()
    const r = await renderWithApp(<EmptyState />, { arc })
    expect(screen.getByText('ARC // READY')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'What are we building?' })).toBeInTheDocument()
    await r.emit({
      type: 'suggestions',
      items: [
        { title: 'Add shortcuts', prompt: 'Add keyboard shortcuts.', kind: 'feature' },
        { title: 'Test the parser', prompt: 'Write parser tests.', kind: 'test' },
        { title: 'Sound effects', prompt: 'Add subtle sounds.', kind: 'wild' },
        { title: 'Fourth', prompt: 'ignored', kind: 'fix' },
      ],
    })
    expect(screen.getAllByRole('button', { name: /^(Add shortcuts|Test the parser|Sound effects)/ })).toHaveLength(3)
    expect(screen.queryByText('Fourth')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Test the parser/ }))
    expect(arc.callsTo(IPC.send)).toEqual([{ text: 'Write parser tests.' }])
  })

  it('offers to fetch ideas when there are none', async () => {
    const arc = createFakeArc()
    await renderWithApp(<EmptyState />, { arc })
    await userEvent.click(screen.getByRole('button', { name: /Get ideas/ }))
    expect(arc.callsTo(IPC.spark)).toHaveLength(1)
  })

  it('asks for a folder when none is open', async () => {
    const arc = createFakeArc({ [IPC.status]: { ok: true, data: { ...readyStatus, hasProject: false, projectRoot: null, mode: null } } })
    await renderWithApp(<EmptyState />, { arc })
    expect(screen.getByRole('heading', { name: 'Open a folder to begin' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open a folder' }))
    expect(arc.callsTo(IPC.chooseProject)).toHaveLength(1)
  })
})
