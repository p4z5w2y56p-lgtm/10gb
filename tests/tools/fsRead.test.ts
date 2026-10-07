import { mkdir, symlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { globTool, lsTool, makeGrepTool, readTool } from '../../src/main/tools/fsRead'
import { makeFixture, type Fixture } from '../helpers/toolContext'

let fx: Fixture
beforeEach(async () => {
  fx = await makeFixture()
})
afterEach(() => fx.cleanup())

const hasRg = spawnSync('rg', ['--version']).status === 0

describe('Read', () => {
  it('returns numbered lines and records the read', async () => {
    await writeFile(join(fx.root, 'a.txt'), 'one\ntwo\nthree\n')
    const r = await readTool.run({ file_path: 'a.txt' }, fx.ctx)
    expect(r.ok).toBe(true)
    expect(r.output).toBe('     1\tone\n     2\ttwo\n     3\tthree')
    expect(fx.ctx.session.readFiles.has(join(fx.root, 'a.txt'))).toBe(true)
  })

  it('honours offset (1-based) and limit', async () => {
    await writeFile(join(fx.root, 'a.txt'), 'l1\nl2\nl3\nl4\nl5\n')
    const r = await readTool.run({ file_path: 'a.txt', offset: 2, limit: 2 }, fx.ctx)
    expect(r.output).toContain('     2\tl2')
    expect(r.output).toContain('     3\tl3')
    expect(r.output).not.toContain('l4')
    expect(r.output).not.toContain('l1')
    expect(r.output).toContain('more lines')
  })

  it('review focus 4: refuses a binary file', async () => {
    await writeFile(join(fx.root, 'bin.dat'), Buffer.from([0x89, 0x50, 0x00, 0x47, 0x0d]))
    const r = await readTool.run({ file_path: 'bin.dat' }, fx.ctx)
    expect(r.ok).toBe(false)
    expect(r.output).toContain('binary')
  })

  it('review focus 4: a 3 MB text file returns only the default 2000-line window', async () => {
    const lines = Array.from({ length: 300_000 }, (_, i) => `line ${i + 1} ${'x'.repeat(5)}`)
    await writeFile(join(fx.root, 'big.txt'), lines.join('\n'))
    const r = await readTool.run({ file_path: 'big.txt' }, fx.ctx)
    expect(r.ok).toBe(true)
    expect(r.output).toContain('line 2000 ')
    expect(r.output).not.toContain('line 2001 ')
    expect(r.output.length).toBeLessThan(60_000)
    expect(r.output).toContain('more lines')
  })

  it('review focus 4: strips CRLF line endings', async () => {
    await writeFile(join(fx.root, 'crlf.txt'), 'a\r\nb\r\n')
    const r = await readTool.run({ file_path: 'crlf.txt' }, fx.ctx)
    expect(r.output).toBe('     1\ta\n     2\tb')
    expect(r.output).not.toContain('\r')
  })

  it('review focus 4: returns a final line with no trailing newline', async () => {
    await writeFile(join(fx.root, 'nonl.txt'), 'first\nlast')
    const r = await readTool.run({ file_path: 'nonl.txt' }, fx.ctx)
    expect(r.output).toBe('     1\tfirst\n     2\tlast')
  })

  it('cuts very long lines at 2000 characters', async () => {
    await writeFile(join(fx.root, 'long.txt'), 'y'.repeat(5000))
    const r = await readTool.run({ file_path: 'long.txt' }, fx.ctx)
    expect(r.output.length).toBeLessThan(2100)
  })

  it('reports an empty file', async () => {
    await writeFile(join(fx.root, 'empty.txt'), '')
    const r = await readTool.run({ file_path: 'empty.txt' }, fx.ctx)
    expect(r).toEqual({ ok: true, output: '(empty file)' })
  })

  it('fails for a missing file, a directory, and a path outside the project', async () => {
    await mkdir(join(fx.root, 'dir'))
    await writeFile(join(fx.base, 'secret.txt'), 's')
    expect((await readTool.run({ file_path: 'nope.txt' }, fx.ctx)).ok).toBe(false)
    const dir = await readTool.run({ file_path: 'dir' }, fx.ctx)
    expect(dir.ok).toBe(false)
    expect(dir.output).toContain('directory')
    const out = await readTool.run({ file_path: join(fx.base, 'secret.txt') }, fx.ctx)
    expect(out.ok).toBe(false)
    expect(out.output).toContain('outside')
  })
})

describe('Read and special files (review finding 9)', () => {
  it('refuses a FIFO instead of blocking forever', async () => {
    execFileSync('mkfifo', [join(fx.root, 'pipe')])
    const r = await Promise.race([
      readTool.run({ file_path: 'pipe' }, fx.ctx),
      new Promise<'hung'>((res) => setTimeout(() => res('hung'), 2000)),
    ])
    expect(r).not.toBe('hung')
    expect((r as { ok: boolean; output: string }).ok).toBe(false)
    expect((r as { output: string }).output).toContain('regular file')
  })
})

describe('LS', () => {
  it('lists entries with / on directories', async () => {
    await mkdir(join(fx.root, 'src'))
    await writeFile(join(fx.root, 'a.txt'), 'a')
    const r = await lsTool.run({ path: '.' }, fx.ctx)
    expect(r.ok).toBe(true)
    expect(r.output.split('\n')).toEqual(['a.txt', 'src/'])
  })

  it('fails outside the project and on a file', async () => {
    await writeFile(join(fx.root, 'a.txt'), 'a')
    expect((await lsTool.run({ path: fx.base }, fx.ctx)).ok).toBe(false)
    expect((await lsTool.run({ path: 'a.txt' }, fx.ctx)).ok).toBe(false)
  })
})

describe('Glob', () => {
  it('returns matches newest first and skips node_modules and .git', async () => {
    await mkdir(join(fx.root, 'src'), { recursive: true })
    await mkdir(join(fx.root, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(fx.root, 'src', 'old.ts'), '')
    await writeFile(join(fx.root, 'src', 'new.ts'), '')
    await writeFile(join(fx.root, 'node_modules', 'pkg', 'x.ts'), '')
    await utimes(join(fx.root, 'src', 'old.ts'), new Date(2020, 0, 1), new Date(2020, 0, 1))
    await utimes(join(fx.root, 'src', 'new.ts'), new Date(2024, 0, 1), new Date(2024, 0, 1))
    const r = await globTool.run({ pattern: '**/*.ts' }, fx.ctx)
    expect(r.output.split('\n')).toEqual(['src/new.ts', 'src/old.ts'])
  })

  it('rejects patterns that escape the directory', async () => {
    for (const pattern of ['../*', '/etc/*', 'a/../../b']) {
      const r = await globTool.run({ pattern }, fx.ctx)
      expect(r.ok, pattern).toBe(false)
    }
  })

  it('says so when nothing matches', async () => {
    const r = await globTool.run({ pattern: '**/*.zzz' }, fx.ctx)
    expect(r).toEqual({ ok: true, output: 'No files matched.' })
  })
})

describe('Grep', () => {
  async function seed() {
    await mkdir(join(fx.root, 'src'), { recursive: true })
    await mkdir(join(fx.root, 'node_modules'), { recursive: true })
    await writeFile(join(fx.root, 'src', 'a.ts'), 'const Foo = 1\nconst bar = 2\nFOO again\n')
    await writeFile(join(fx.root, 'src', 'b.md'), 'foo in docs\n')
    await writeFile(join(fx.root, 'node_modules', 'x.js'), 'foo hidden\n')
    await writeFile(join(fx.root, 'bin.dat'), Buffer.from([0x66, 0x6f, 0x6f, 0x00]))
  }

  const sorted = (s: string) => s.split('\n').sort()

  it('JS fallback finds matches as file:line:text and skips node_modules and binaries', async () => {
    await seed()
    const grep = makeGrepTool({ rgPath: null })
    const r = await grep.run({ pattern: 'foo' }, fx.ctx)
    expect(sorted(r.output)).toEqual(['src/b.md:1:foo in docs'])
  })

  it('JS fallback supports ignore_case, glob and a sub-path', async () => {
    await seed()
    const grep = makeGrepTool({ rgPath: null })
    const ci = await grep.run({ pattern: 'foo', ignore_case: true, glob: '*.ts' }, fx.ctx)
    expect(sorted(ci.output)).toEqual(['src/a.ts:1:const Foo = 1', 'src/a.ts:3:FOO again'])
    const sub = await grep.run({ pattern: 'foo', ignore_case: true, path: 'src' }, fx.ctx)
    expect(sub.output.split('\n').length).toBe(3)
  })

  it('reports no matches and bad regexes', async () => {
    await seed()
    const grep = makeGrepTool({ rgPath: null })
    expect(await grep.run({ pattern: 'zzzz' }, fx.ctx)).toEqual({ ok: true, output: 'No matches.' })
    const bad = await grep.run({ pattern: '(' }, fx.ctx)
    expect(bad.ok).toBe(false)
  })

  it.runIf(hasRg)('ripgrep and the JS fallback agree', async () => {
    await seed()
    const viaRg = await makeGrepTool({ rgPath: 'rg' }).run({ pattern: 'foo', ignore_case: true }, fx.ctx)
    const viaJs = await makeGrepTool({ rgPath: null }).run({ pattern: 'foo', ignore_case: true }, fx.ctx)
    expect(sorted(viaRg.output)).toEqual(sorted(viaJs.output))
  })

  it('refuses a search path outside the project', async () => {
    const r = await makeGrepTool({ rgPath: null }).run({ pattern: 'x', path: fx.base }, fx.ctx)
    expect(r.ok).toBe(false)
  })

  it('does not follow a symlink out of the project', async () => {
    await writeFile(join(fx.base, 'outside.txt'), 'foo outside\n')
    await symlink(fx.base, join(fx.root, 'escape'))
    await writeFile(join(fx.root, 'in.txt'), 'foo inside\n')
    const r = await makeGrepTool({ rgPath: null }).run({ pattern: 'foo' }, fx.ctx)
    expect(r.output).toContain('in.txt')
    expect(r.output).not.toContain('outside')
  })
})
