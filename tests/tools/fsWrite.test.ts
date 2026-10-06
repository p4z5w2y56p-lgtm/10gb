import { chmod, mkdir, readFile, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readTool } from '../../src/main/tools/fsRead'
import { editTool, makeDiff, writeTool } from '../../src/main/tools/fsWrite'
import { protectedWritePaths } from '../../src/main/safety/protected'
import { makeFixture, type Fixture } from '../helpers/toolContext'

let fx: Fixture
beforeEach(async () => {
  fx = await makeFixture()
})
afterEach(() => fx.cleanup())

const file = (name: string) => join(fx.root, name)

describe('Edit', () => {
  it('replaces a unique match and returns a diff', async () => {
    await writeFile(file('a.txt'), 'hello world\n')
    const r = await editTool.run({ file_path: 'a.txt', old_string: 'world', new_string: 'there' }, fx.ctx)
    expect(r.ok).toBe(true)
    expect(await readFile(file('a.txt'), 'utf8')).toBe('hello there\n')
    expect(r.output).toContain('-hello world')
    expect(r.output).toContain('+hello there')
  })

  it('fails naming the count when old_string is not unique', async () => {
    await writeFile(file('a.txt'), 'x x x')
    const r = await editTool.run({ file_path: 'a.txt', old_string: 'x', new_string: 'y' }, fx.ctx)
    expect(r.ok).toBe(false)
    expect(r.output).toContain('3 times')
    expect(await readFile(file('a.txt'), 'utf8')).toBe('x x x')
  })

  it('replace_all replaces every occurrence', async () => {
    await writeFile(file('a.txt'), 'x x x')
    const r = await editTool.run({ file_path: 'a.txt', old_string: 'x', new_string: 'y', replace_all: true }, fx.ctx)
    expect(r.ok).toBe(true)
    expect(await readFile(file('a.txt'), 'utf8')).toBe('y y y')
  })

  it('fails when the text is not found, or old and new are identical', async () => {
    await writeFile(file('a.txt'), 'abc')
    expect((await editTool.run({ file_path: 'a.txt', old_string: 'zzz', new_string: 'y' }, fx.ctx)).output).toContain('not found')
    expect((await editTool.run({ file_path: 'a.txt', old_string: 'abc', new_string: 'abc' }, fx.ctx)).ok).toBe(false)
  })

  it('review focus 4: matches an LF old_string in a CRLF file and keeps CRLF everywhere', async () => {
    await writeFile(file('crlf.txt'), 'one\r\ntwo\r\nthree\r\n')
    const r = await editTool.run({ file_path: 'crlf.txt', old_string: 'one\ntwo', new_string: 'uno\ndos' }, fx.ctx)
    expect(r.ok).toBe(true)
    expect(await readFile(file('crlf.txt'), 'utf8')).toBe('uno\r\ndos\r\nthree\r\n')
  })

  it('review focus 4: a file without a trailing newline stays without one', async () => {
    await writeFile(file('nonl.txt'), 'a\nb')
    await editTool.run({ file_path: 'nonl.txt', old_string: 'b', new_string: 'c' }, fx.ctx)
    expect(await readFile(file('nonl.txt'), 'utf8')).toBe('a\nc')
  })

  it('leaves a mixed-ending file exactly as is outside the replaced text', async () => {
    await writeFile(file('mixed.txt'), 'a\r\nb\nc\r\n')
    await editTool.run({ file_path: 'mixed.txt', old_string: 'b', new_string: 'B' }, fx.ctx)
    expect(await readFile(file('mixed.txt'), 'utf8')).toBe('a\r\nB\nc\r\n')
  })

  it('does not interpret $ patterns in the replacement', async () => {
    await writeFile(file('a.txt'), 'price: X')
    await editTool.run({ file_path: 'a.txt', old_string: 'X', new_string: "$& $1 $'" }, fx.ctx)
    expect(await readFile(file('a.txt'), 'utf8')).toBe("price: $& $1 $'")
  })

  it('snapshots the original content before writing', async () => {
    await writeFile(file('a.txt'), 'original')
    const seen: string[] = []
    fx.ctx.checkpoints = { snapshot: async (p) => void seen.push(await readFile(p, 'utf8')) }
    await editTool.run({ file_path: 'a.txt', old_string: 'original', new_string: 'changed' }, fx.ctx)
    expect(seen).toEqual(['original'])
  })

  it('fails for a missing file, outside the project, and protected paths', async () => {
    expect((await editTool.run({ file_path: 'nope.txt', old_string: 'a', new_string: 'b' }, fx.ctx)).output).toContain('not found')
    await writeFile(join(fx.base, 'outside.txt'), 'a')
    expect((await editTool.run({ file_path: join(fx.base, 'outside.txt'), old_string: 'a', new_string: 'b' }, fx.ctx)).ok).toBe(false)
    await mkdir(join(fx.root, '.arc'))
    await writeFile(join(fx.root, '.arc', 'settings.json'), '{}')
    const prot = { ...fx.ctx, protectedPaths: protectedWritePaths(fx.ctx.home, '') }
    const r = await editTool.run({ file_path: '.arc/settings.json', old_string: '{}', new_string: '{"a":1}' }, prot)
    expect(r.ok).toBe(false)
    expect(r.output).toContain('protected')
  })

  it('edits through a symlink without replacing the link', async () => {
    await writeFile(file('real.txt'), 'before')
    await symlink(file('real.txt'), file('link.txt'))
    await editTool.run({ file_path: 'link.txt', old_string: 'before', new_string: 'after' }, fx.ctx)
    expect((await stat(file('link.txt'))).isSymbolicLink()).toBe(false) // stat follows
    expect(await readFile(file('real.txt'), 'utf8')).toBe('after')
    const { lstat } = await import('node:fs/promises')
    expect((await lstat(file('link.txt'))).isSymbolicLink()).toBe(true)
  })
})

describe('Write', () => {
  it('creates a new file and missing parent directories', async () => {
    const r = await writeTool.run({ file_path: 'deep/er/new.txt', content: 'hi\n' }, fx.ctx)
    expect(r.ok).toBe(true)
    expect(await readFile(file('deep/er/new.txt'), 'utf8')).toBe('hi\n')
    expect(r.output).toContain('Created')
  })

  it('refuses to overwrite an existing file that was not read this session', async () => {
    await writeFile(file('a.txt'), 'old')
    const r = await writeTool.run({ file_path: 'a.txt', content: 'new' }, fx.ctx)
    expect(r.ok).toBe(false)
    expect(r.output).toContain('Read')
    expect(await readFile(file('a.txt'), 'utf8')).toBe('old')
  })

  it('overwrites after a Read and shows a diff', async () => {
    await writeFile(file('a.txt'), 'old\n')
    await readTool.run({ file_path: 'a.txt' }, fx.ctx)
    const r = await writeTool.run({ file_path: 'a.txt', content: 'new\n' }, fx.ctx)
    expect(r.ok).toBe(true)
    expect(await readFile(file('a.txt'), 'utf8')).toBe('new\n')
    expect(r.output).toContain('@@')
    expect(r.output).toContain('-old')
    expect(r.output).toContain('+new')
  })

  it('refuses when the file changed on disk after the Read', async () => {
    await writeFile(file('a.txt'), 'old')
    await readTool.run({ file_path: 'a.txt' }, fx.ctx)
    await writeFile(file('a.txt'), 'someone else')
    const later = new Date(Date.now() + 60_000)
    await utimes(file('a.txt'), later, later)
    const r = await writeTool.run({ file_path: 'a.txt', content: 'mine' }, fx.ctx)
    expect(r.ok).toBe(false)
    expect(r.output).toContain('changed')
    expect(await readFile(file('a.txt'), 'utf8')).toBe('someone else')
  })

  it('allows a second Write right after the first without another Read', async () => {
    await writeTool.run({ file_path: 'n.txt', content: '1' }, fx.ctx)
    const r = await writeTool.run({ file_path: 'n.txt', content: '2' }, fx.ctx)
    expect(r.ok).toBe(true)
    expect(await readFile(file('n.txt'), 'utf8')).toBe('2')
  })

  it('preserves the file mode', async () => {
    await writeFile(file('run.sh'), '#!/bin/sh\n')
    await chmod(file('run.sh'), 0o755)
    await readTool.run({ file_path: 'run.sh' }, fx.ctx)
    await writeTool.run({ file_path: 'run.sh', content: '#!/bin/sh\necho\n' }, fx.ctx)
    expect((await stat(file('run.sh'))).mode & 0o777).toBe(0o755)
  })

  it('snapshots before writing and refuses outside, protected and directory targets', async () => {
    await writeTool.run({ file_path: 'snap.txt', content: 'x' }, fx.ctx)
    expect(fx.snapshots).toEqual([file('snap.txt')])
    expect((await writeTool.run({ file_path: join(fx.base, 'o.txt'), content: 'x' }, fx.ctx)).ok).toBe(false)
    const prot = { ...fx.ctx, protectedPaths: protectedWritePaths(fx.ctx.home, '') }
    const r = await writeTool.run({ file_path: '.arc/settings.json', content: '{}' }, prot)
    expect(r.ok).toBe(false)
    await mkdir(file('dir'))
    expect((await writeTool.run({ file_path: 'dir', content: 'x' }, fx.ctx)).ok).toBe(false)
  })
})

describe('makeDiff', () => {
  it('produces a unified diff', () => {
    const d = makeDiff('a\nb\n', 'a\nc\n', 'f.txt')
    expect(d).toContain('--- f.txt')
    expect(d).toContain('+++ f.txt')
    expect(d).toContain('-b')
    expect(d).toContain('+c')
    expect(d).toContain('@@')
  })
})
