import { mkdtemp, mkdir, realpath, symlink, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canonicalRoot, resolveInside } from '../../src/main/safety/pathSandbox'

let base: string
let root: string
let outside: string

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'arc-ps-')))
  root = join(base, 'project')
  outside = join(base, 'outside')
  await mkdir(root)
  await mkdir(outside)
  await writeFile(join(root, 'a.txt'), 'a')
  await writeFile(join(outside, 'secret.txt'), 's')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('resolveInside', () => {
  it('accepts a relative file inside the project', async () => {
    const r = await resolveInside(root, 'a.txt')
    expect(r).toEqual({ ok: true, real: join(root, 'a.txt') })
  })

  it('rejects ../ escapes', async () => {
    const r = await resolveInside(root, '../outside/secret.txt')
    expect(r.ok).toBe(false)
  })

  it('rejects an absolute path outside the project', async () => {
    const r = await resolveInside(root, join(outside, 'secret.txt'))
    expect(r.ok).toBe(false)
  })

  it('rejects a symlink inside the project that points outside', async () => {
    await symlink(outside, join(root, 'link'))
    const r = await resolveInside(root, 'link/secret.txt')
    expect(r.ok).toBe(false)
  })

  it('rejects a new file whose parent is a symlink to outside', async () => {
    await symlink(outside, join(root, 'link'))
    const r = await resolveInside(root, 'link/new.txt')
    expect(r.ok).toBe(false)
  })

  it('accepts a new file in an existing inside directory', async () => {
    await mkdir(join(root, 'src'))
    const r = await resolveInside(root, 'src/new.txt')
    expect(r).toEqual({ ok: true, real: join(root, 'src', 'new.txt') })
  })

  it('accepts a new file in a not-yet-existing inside directory', async () => {
    const r = await resolveInside(root, 'deep/er/new.txt')
    expect(r).toEqual({ ok: true, real: join(root, 'deep', 'er', 'new.txt') })
  })

  it('accepts paths inside an extra directory', async () => {
    const r = await resolveInside(root, join(outside, 'secret.txt'), { extraDirs: [outside] })
    expect(r.ok).toBe(true)
  })

  it('does not treat a sibling that shares the root prefix as inside', async () => {
    const sibling = `${root}-evil`
    await mkdir(sibling)
    await writeFile(join(sibling, 'x.txt'), 'x')
    const r = await resolveInside(root, join(sibling, 'x.txt'))
    expect(r.ok).toBe(false)
  })

  it('compares case-insensitively when asked (APFS)', async () => {
    const upper = join(base, 'PROJECT', 'a.txt')
    const r = await resolveInside(root, upper, { caseInsensitive: true })
    expect(r.ok).toBe(true)
  })
})

describe('canonicalRoot (review focus 1: symlinked project root)', () => {
  it('returns the real path of a symlinked root and containment still works', async () => {
    const linkRoot = join(base, 'linked-project')
    await symlink(root, linkRoot)
    const canon = await canonicalRoot(linkRoot)
    expect(canon).toBe(root)
    const r = await resolveInside(canon, 'a.txt')
    expect(r).toEqual({ ok: true, real: join(root, 'a.txt') })
  })

  it('also accepts a file addressed through the symlinked root', async () => {
    const linkRoot = join(base, 'linked-project')
    await symlink(root, linkRoot)
    const canon = await canonicalRoot(linkRoot)
    const r = await resolveInside(canon, join(linkRoot, 'a.txt'))
    expect(r.ok).toBe(true)
  })
})
