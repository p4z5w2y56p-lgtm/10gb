import { describe, expect, it } from 'vitest'
import { describeCall, describeResult, groupActivities, progressOf } from '../../src/main/agent/narrate'
import type { ToolCall } from '../../src/shared/types'

const call = (name: string, args: Record<string, unknown>, id = 'c'): ToolCall => ({ id, name, args })

describe('describeCall', () => {
  it.each([
    [call('Read', { file_path: '/p/src/app.ts' }), 'reading', 'Reading app.ts'],
    [call('LS', { path: 'src' }), 'searching', 'Listing src'],
    [call('LS', {}), 'searching', 'Listing the project'],
    [call('Glob', { pattern: '**/*.ts' }), 'searching', 'Finding files'],
    [call('Grep', { pattern: 'foo' }), 'searching', 'Searching the project'],
    [call('Edit', { file_path: 'src/app.ts' }), 'editing', 'Editing app.ts'],
    [call('Write', { file_path: 'docs/notes.md' }), 'writing', 'Creating notes.md'],
    [call('TodoWrite', { todos: [] }), 'planning', 'Updating the plan'],
    [call('AskUser', { question: 'x' }), 'asking', 'Asking you a question'],
    [call('WebFetch', { url: 'https://example.com/a/b?q=secret' }), 'fetching', 'Fetching example.com'],
    [call('WebFetch', { url: 'not a url' }), 'fetching', 'Fetching a web page'],
    [call('Mystery', {}), 'other', 'Working'],
  ])('%j', (c, phase, label) => {
    expect(describeCall(c)).toEqual({ phase, label })
  })

  it.each([
    ['npm test -- foo', 'Running the tests'],
    ['pnpm run test', 'Running the tests'],
    ['npx vitest run', 'Running the tests'],
    ['pytest -x', 'Running the tests'],
    ['cargo test', 'Running the tests'],
    ['npm install', 'Installing dependencies'],
    ['pip install requests', 'Installing dependencies'],
    ['npm run build', 'Building the project'],
    ['tsc --noEmit', 'Building the project'],
    ['git status', 'Checking git'],
    ['rm -rf build && echo hi', 'Running a command'],
    ['ls -la', 'Running a command'],
  ])('Bash %s -> %s and never echoes the command', (command, label) => {
    const d = describeCall(call('Bash', { command }))
    expect(d).toEqual({ phase: 'running', label })
    expect(d.label).not.toContain(command.split(' ')[0] === 'git' ? 'status' : command)
  })

  it('cuts long names to 80 characters and never emits a backtick', () => {
    const long = 'a'.repeat(200) + '.ts'
    const d = describeCall(call('Read', { file_path: `/p/${long}` }))
    expect(d.label.length).toBeLessThanOrEqual(80)
    const tick = describeCall(call('Edit', { file_path: 'we`ird.ts' }))
    expect(tick.label).not.toContain('`')
  })

  it('tolerates a missing or non-string path', () => {
    expect(describeCall(call('Read', {})).label).toBe('Reading a file')
    expect(describeCall(call('Edit', { file_path: 5 })).label).toBe('Editing a file')
  })
})

describe('describeResult', () => {
  const ok = { ok: true, output: '' }
  const bad = { ok: false, output: 'x' }
  it.each([
    [call('Read', { file_path: 'a/app.ts' }), ok, 'Read app.ts'],
    [call('Read', { file_path: 'a/app.ts' }), bad, 'Could not read app.ts'],
    [call('Edit', { file_path: 'a/app.ts' }), ok, 'Edited app.ts'],
    [call('Edit', { file_path: 'a/app.ts' }), bad, 'Could not edit app.ts'],
    [call('Write', { file_path: 'n.md' }), ok, 'Created n.md'],
    [call('Grep', { pattern: 'x' }), ok, 'Searched the project'],
    [call('Grep', { pattern: 'x' }), bad, 'Search failed'],
    [call('Bash', { command: 'npm test' }), ok, 'Tests passed'],
    [call('Bash', { command: 'npm test' }), bad, 'Tests failed'],
    [call('Bash', { command: 'npm install' }), ok, 'Dependencies installed'],
    [call('Bash', { command: 'npm run build' }), bad, 'Build failed'],
    [call('Bash', { command: 'git status' }), ok, 'Checked git'],
    [call('Bash', { command: 'ls' }), ok, 'Command finished'],
    [call('Bash', { command: 'ls' }), bad, 'Command failed'],
    [call('WebFetch', { url: 'https://example.com/x' }), ok, 'Fetched example.com'],
    [call('WebFetch', { url: 'https://example.com/x' }), bad, 'Could not fetch example.com'],
    [call('TodoWrite', { todos: [] }), ok, 'Plan updated'],
    [call('Mystery', {}), ok, 'Done'],
    [call('Mystery', {}), bad, 'Failed'],
  ])('%j / %j -> %s', (c, r, label) => {
    expect(describeResult(c, r)).toBe(label)
  })
})

describe('groupActivities', () => {
  const item = (id: string, phase: any, label: string) => ({ id, phase, label })

  it('collapses consecutive reads and keeps other items', () => {
    const out = groupActivities([
      item('1', 'reading', 'Reading a.ts'),
      item('2', 'reading', 'Reading b.ts'),
      item('3', 'reading', 'Reading c.ts'),
      item('4', 'editing', 'Editing a.ts'),
      item('5', 'reading', 'Reading d.ts'),
      item('6', 'reading', 'Reading e.ts'),
    ])
    expect(out).toEqual([
      { ids: ['1', '2', '3'], phase: 'reading', label: 'Read 3 files' },
      { ids: ['4'], phase: 'editing', label: 'Editing a.ts' },
      { ids: ['5', '6'], phase: 'reading', label: 'Read 2 files' },
    ])
  })

  it('leaves a single read as it is and groups mixed reads and searches', () => {
    expect(groupActivities([item('1', 'reading', 'Reading a.ts')])).toEqual([
      { ids: ['1'], phase: 'reading', label: 'Reading a.ts' },
    ])
    const mixed = groupActivities([
      item('1', 'reading', 'Reading a.ts'),
      item('2', 'searching', 'Searching the project'),
      item('3', 'reading', 'Reading b.ts'),
    ])
    expect(mixed).toEqual([{ ids: ['1', '2', '3'], phase: 'searching', label: 'Explored the project (3 steps)' }])
  })

  it('groups consecutive searches only', () => {
    const out = groupActivities([item('1', 'searching', 'Finding files'), item('2', 'searching', 'Searching the project')])
    expect(out).toEqual([{ ids: ['1', '2'], phase: 'searching', label: 'Explored the project (2 steps)' }])
  })

  it('returns [] for no items', () => {
    expect(groupActivities([])).toEqual([])
  })
})

describe('progressOf', () => {
  it('counts completed items and names the one in progress', () => {
    const todos = [
      { id: '1', content: 'Write tests', status: 'completed' as const },
      { id: '2', content: 'Fix the bug', status: 'in_progress' as const },
      { id: '3', content: 'Ship', status: 'pending' as const },
    ]
    expect(progressOf(todos)).toEqual({ done: 1, total: 3, current: 'Fix the bug' })
  })

  it('handles an empty list and no current item', () => {
    expect(progressOf([])).toEqual({ done: 0, total: 0, current: null })
    expect(progressOf([{ id: '1', content: 'a', status: 'pending' }]).current).toBeNull()
  })
})
