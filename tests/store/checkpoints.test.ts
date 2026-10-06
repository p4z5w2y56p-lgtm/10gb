import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CheckpointStore } from '../../src/main/store/checkpoints'

let base: string
let proj: string
let store: CheckpointStore
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'arc-ckpt-'))
  proj = join(base, 'proj')
  await (await import('node:fs/promises')).mkdir(proj)
  store = new CheckpointStore(join(base, 'ckpt'), 's1')
})
afterEach(() => rm(base, { recursive: true, force: true }))

describe('CheckpointStore', () => {
  it('restores the original bytes after an edit', async () => {
    const f = join(proj, 'a.bin')
    const original = Buffer.from([0, 1, 2, 255, 10, 13])
    await writeFile(f, original)
    store.beginTurn('t1')
    await store.snapshot(f)
    await writeFile(f, 'changed')
    const r = await store.undoLastTurn()
    expect(r.restored).toEqual([f])
    expect((await readFile(f)).equals(original)).toBe(true)
  })

  it('removes a file that did not exist before the turn', async () => {
    const f = join(proj, 'new.txt')
    store.beginTurn('t1')
    await store.snapshot(f)
    await writeFile(f, 'created')
    const r = await store.undoLastTurn()
    expect(r.removed).toEqual([f])
    await expect(stat(f)).rejects.toThrow()
  })

  it('keeps the first snapshot when a file is snapshotted twice in one turn', async () => {
    const f = join(proj, 'a.txt')
    await writeFile(f, 'v0')
    store.beginTurn('t1')
    await store.snapshot(f)
    await writeFile(f, 'v1')
    await store.snapshot(f)
    await writeFile(f, 'v2')
    await store.undoLastTurn()
    expect(await readFile(f, 'utf8')).toBe('v0')
  })

  it('undoes only the last turn each time', async () => {
    const f = join(proj, 'a.txt')
    await writeFile(f, 'v0')
    store.beginTurn('t1')
    await store.snapshot(f)
    await writeFile(f, 'v1')
    store.beginTurn('t2')
    await store.snapshot(f)
    await writeFile(f, 'v2')
    await store.undoLastTurn()
    expect(await readFile(f, 'utf8')).toBe('v1')
    await store.undoLastTurn()
    expect(await readFile(f, 'utf8')).toBe('v0')
    expect(await store.undoLastTurn()).toEqual({ restored: [], removed: [] })
  })

  it('skips turns that changed nothing', async () => {
    const f = join(proj, 'a.txt')
    await writeFile(f, 'v0')
    store.beginTurn('t1')
    await store.snapshot(f)
    await writeFile(f, 'v1')
    store.beginTurn('t2-no-changes')
    await store.undoLastTurn()
    expect(await readFile(f, 'utf8')).toBe('v0')
  })

  it('lists changed files and reports whether undo is possible', async () => {
    const a = join(proj, 'a.txt')
    const b = join(proj, 'b.txt')
    await writeFile(a, 'a')
    store.beginTurn('t1')
    expect(store.canUndo()).toBe(false)
    await store.snapshot(a)
    await store.snapshot(b)
    expect(store.changedFiles().sort()).toEqual([a, b].sort())
    expect(store.canUndo()).toBe(true)
  })

  it('restores the original file mode', async () => {
    const f = join(proj, 'run.sh')
    await writeFile(f, '#!/bin/sh')
    await chmod(f, 0o755)
    store.beginTurn('t1')
    await store.snapshot(f)
    await writeFile(f, 'x')
    await chmod(f, 0o644)
    await store.undoLastTurn()
    expect((await stat(f)).mode & 0o777).toBe(0o755)
  })
})
