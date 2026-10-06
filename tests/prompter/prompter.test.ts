import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateSuggestions, summarizeProject, transcriptOf } from '../../src/main/prompter/prompter'
import { VertexError, type Content } from '../../src/main/vertex/types'
import { scriptedVertex, textTurn } from '../helpers/scriptedVertex'

const three = [
  { title: 'Add shortcuts', prompt: 'Add keyboard shortcuts for the main actions.', kind: 'feature' },
  { title: 'Test the parser', prompt: 'Write unit tests for the parser module.', kind: 'test' },
  { title: 'Sound effects', prompt: 'Add subtle sound effects when a task finishes.', kind: 'wild' },
]
const json = (v: unknown) => textTurn(JSON.stringify(v))
const ctx = { projectSummary: 'A small Node app.', transcript: 'User: hi' }

describe('generateSuggestions', () => {
  it('returns three validated suggestions with no tools, high temperature and a JSON mime type', async () => {
    const v = scriptedVertex([json(three)])
    const out = await generateSuggestions(v, ctx)
    expect(out).toEqual(three)
    expect(v.requests).toHaveLength(1)
    const req = v.requests[0]
    expect(req.tools).toBeUndefined()
    expect(req.temperature).toBe(1.3)
    expect(req.responseMimeType).toBe('application/json')
    expect(JSON.stringify(req.contents)).toContain('A small Node app.')
    expect(JSON.stringify(req.contents)).toContain('User: hi')
  })

  it('mentions the user goal when there is one', async () => {
    const v = scriptedVertex([json(three)])
    await generateSuggestions(v, { ...ctx, goal: 'ship a CLI' })
    expect(JSON.stringify(v.requests[0].contents)).toContain('ship a CLI')
  })

  it('accepts JSON wrapped in a code fence', async () => {
    const v = scriptedVertex([textTurn('```json\n' + JSON.stringify(three) + '\n```')])
    expect(await generateSuggestions(v, ctx)).toEqual(three)
  })

  it('retries once on two items, then gives up with []', async () => {
    const v = scriptedVertex([json(three.slice(0, 2)), json(three.slice(0, 2))])
    expect(await generateSuggestions(v, ctx)).toEqual([])
    expect(v.requests).toHaveLength(2)
  })

  it('retries once when no item is wild', async () => {
    const noWild = three.map((s) => ({ ...s, kind: 'feature' }))
    const v = scriptedVertex([json(noWild), json(three)])
    expect(await generateSuggestions(v, ctx)).toEqual(three)
    expect(v.requests).toHaveLength(2)
  })

  it('retries on non-JSON and returns the retry result when it is valid', async () => {
    const v = scriptedVertex([textTurn('Sure! Here are some ideas...'), json(three)])
    expect(await generateSuggestions(v, ctx)).toEqual(three)
    expect(v.requests).toHaveLength(2)
    expect(JSON.stringify(v.requests[1].contents)).toContain('not valid')
  })

  it('rejects an unknown kind or an empty prompt', async () => {
    const bad = [{ ...three[0], kind: 'magic' }, three[1], three[2]]
    expect(await generateSuggestions(scriptedVertex([json(bad), json(bad)]), ctx)).toEqual([])
    const empty = [{ ...three[0], prompt: '' }, three[1], three[2]]
    expect(await generateSuggestions(scriptedVertex([json(empty), json(empty)]), ctx)).toEqual([])
  })

  it('never throws: API failures give []', async () => {
    const v = scriptedVertex([{ error: new VertexError('nope', 'rate', 429) }])
    expect(await generateSuggestions(v, ctx)).toEqual([])
  })

  it('returns [] without a request when already aborted', async () => {
    const v = scriptedVertex([json(three)])
    const ctl = new AbortController()
    ctl.abort()
    expect(await generateSuggestions(v, ctx, ctl.signal)).toEqual([])
    expect(v.requests).toHaveLength(0)
  })
})

describe('transcriptOf', () => {
  const history: Content[] = [
    { role: 'user', parts: [{ text: 'Add a login page' }] },
    { role: 'model', parts: [{ text: 'On it.' }, { functionCall: { name: 'Write', args: { content: 'SECRET CODE' } } }] },
    { role: 'user', parts: [{ functionResponse: { name: 'Write', response: { output: 'big output' } } }] },
    { role: 'model', parts: [{ text: 'Done.' }] },
  ]

  it('keeps chat text and drops tool calls and results', () => {
    const t = transcriptOf(history)
    expect(t).toContain('User: Add a login page')
    expect(t).toContain('Assistant: On it.')
    expect(t).toContain('Assistant: Done.')
    expect(t).not.toContain('SECRET CODE')
    expect(t).not.toContain('big output')
  })

  it('keeps the most recent text when over the cap', () => {
    const long: Content[] = Array.from({ length: 50 }, (_, i) => ({ role: 'user' as const, parts: [{ text: `message number ${i}` }] }))
    const t = transcriptOf(long, 200)
    expect(t.length).toBeLessThanOrEqual(200)
    expect(t).toContain('message number 49')
    expect(t).not.toContain('message number 0\n')
  })

  it('says so for an empty conversation', () => {
    expect(transcriptOf([])).toBe('(no conversation yet)')
  })
})

describe('summarizeProject', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'arc-sum-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('includes project notes, a two-level file tree, and skips node_modules and .git', async () => {
    await writeFile(join(dir, 'ARC.md'), 'Use tabs.')
    await mkdir(join(dir, 'src', 'deep', 'deeper'), { recursive: true })
    await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(dir, 'src', 'a.ts'), '')
    await writeFile(join(dir, 'src', 'deep', 'b.ts'), '')
    await writeFile(join(dir, 'src', 'deep', 'deeper', 'c.ts'), '')
    await writeFile(join(dir, 'node_modules', 'pkg', 'x.js'), '')
    const s = await summarizeProject(dir)
    expect(s).toContain('Use tabs.')
    expect(s).toContain('src/')
    expect(s).toContain('a.ts')
    expect(s).toContain('b.ts')
    expect(s).not.toContain('c.ts')
    expect(s).not.toContain('node_modules')
  })

  it('caps the tree at 200 entries', async () => {
    for (let i = 0; i < 300; i++) await writeFile(join(dir, `file-${String(i).padStart(3, '0')}.txt`), '')
    const s = await summarizeProject(dir)
    expect(s.match(/file-\d+\.txt/g)!.length).toBe(200)
    expect(s).toContain('more files not shown')
  })

  it('includes git status when the folder is a repository', async () => {
    execFileSync('git', ['init', '-q'], { cwd: dir })
    await writeFile(join(dir, 'new.txt'), 'x')
    expect(await summarizeProject(dir)).toMatch(/\?\? new\.txt/)
  })

  it('works on an empty folder', async () => {
    expect(await summarizeProject(dir)).toContain('empty')
  })
})
