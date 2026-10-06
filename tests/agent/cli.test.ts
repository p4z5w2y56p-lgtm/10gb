import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { chunk, startFakeVertex, type FakeEntry, type FakeVertex } from '../helpers/fakeVertexServer'

const KEY = 'AIzaSy' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'
const repo = process.cwd()
const text = (t: string): FakeEntry => ({ chunks: [chunk([{ text: t }], {}, 'STOP')] })
const call = (name: string, args: Record<string, unknown>, id = 'c1'): FakeEntry => ({
  chunks: [chunk([{ functionCall: { name, args, id } }], {}, 'STOP')],
})

let server: FakeVertex | undefined
let base: string | undefined
afterEach(async () => {
  await server?.close()
  if (base) await rm(base, { recursive: true, force: true })
  server = undefined
  base = undefined
})

interface Run {
  code: number | null
  out: string
  err: string
}

async function arc(script: FakeEntry[], args: string[], opts: { key?: string | null; stdin?: string } = {}) {
  server = await startFakeVertex(script)
  base = await realpath(await mkdtemp(join(tmpdir(), 'arc-cli-')))
  const project = join(base, 'project')
  await mkdir(project)
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.ARC_API_KEY
  if (opts.key !== null) env.ARC_API_KEY = opts.key ?? KEY
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'scripts/arc-cli.ts', '--project', project, '--vertex-url', server.baseUrl, ...args],
    { cwd: repo, env },
  )
  let out = ''
  let err = ''
  child.stdout.on('data', (d) => (out += d))
  child.stderr.on('data', (d) => (err += d))
  child.stdin.end(opts.stdin ?? '')
  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => (child.kill('SIGKILL'), resolve(null)), 25_000)
    child.on('close', (c) => (clearTimeout(timer), resolve(c)))
  })
  return { code, out, err, project } satisfies Run & { project: string }
}

describe('arc-cli', () => {
  it('refuses to run without a key (exit 2) and never contacts Vertex', async () => {
    const r = await arc([text('x')], ['--mode', 'ask', 'hello'], { key: null })
    expect(r.code).toBe(2)
    expect(r.err).toContain('No API key. Set ARC_API_KEY or add one in Settings.')
    expect(server!.requests).toHaveLength(0)
  })

  it('asks for a prompt when none is given (exit 2)', async () => {
    const r = await arc([], [])
    expect(r.code).toBe(2)
    expect(r.err.toLowerCase()).toContain('usage')
  })

  it('runs a turn in auto-edit mode and shows the clean progress view, not raw output', async () => {
    const r = await arc(
      [call('Write', { file_path: 'hello.txt', content: 'hi\n' }), text('Created the file.')],
      ['--mode', 'auto-edit', 'make hello.txt'],
    )
    expect(r.code).toBe(0)
    expect(await readFile(join(r.project, 'hello.txt'), 'utf8')).toBe('hi\n')
    expect(r.out).toContain('Created the file.')
    expect(r.out).toContain('Creating hello.txt')
    expect(r.out).toContain('Created hello.txt')
    expect(r.out).not.toContain('@@')
    expect(server!.requests[0].headers['x-goog-api-key']).toBe(KEY)
    expect(r.out + r.err).not.toContain(KEY)
  })

  it('--verbose adds the diff and tool output', async () => {
    const r = await arc(
      [call('Write', { file_path: 'hello.txt', content: 'hi\n' }), text('ok')],
      ['--mode', 'auto-edit', '--verbose', 'make hello.txt'],
    )
    expect(r.out).toContain('@@')
  })

  it('asks on the terminal in ask mode and applies the edit on "y"', async () => {
    const r = await arc(
      [call('Write', { file_path: 'hello.txt', content: 'hi\n' }), text('Done.')],
      ['--mode', 'ask', 'make hello.txt'],
      { stdin: 'y\n' },
    )
    expect(r.code).toBe(0)
    expect(r.out).toContain('Allow?')
    expect(await readFile(join(r.project, 'hello.txt'), 'utf8')).toBe('hi\n')
  })

  it('leaves the file out on "n"', async () => {
    const r = await arc(
      [call('Write', { file_path: 'hello.txt', content: 'hi\n' }), text('Understood.')],
      ['--mode', 'ask', 'make hello.txt'],
      { stdin: 'n\n' },
    )
    expect(r.code).toBe(0)
    await expect(stat(join(r.project, 'hello.txt'))).rejects.toThrow()
  })

  it('denies when stdin closes without an answer', async () => {
    const r = await arc(
      [call('Write', { file_path: 'hello.txt', content: 'hi\n' }), text('ok')],
      ['--mode', 'ask', 'make hello.txt'],
    )
    await expect(stat(join(r.project, 'hello.txt'))).rejects.toThrow()
  })

  it('always shows the exact command when a Bash call needs approval', async () => {
    const r = await arc([call('Bash', { command: 'mkdir -p made-dir' }), text('ok')], ['--mode', 'ask', 'make a dir'], {
      stdin: 'n\n',
    })
    expect(r.out).toContain('mkdir -p made-dir')
    await expect(stat(join(r.project, 'made-dir'))).rejects.toThrow()
  })

  it('--test-connection reports success and failure with the exit code', async () => {
    const good = await arc([text('ok')], ['--test-connection'])
    expect(good.code).toBe(0)
    expect(good.out).toContain('Connected')
    await server!.close()
    const bad = await arc([{ status: 401 }, { status: 401 }], ['--test-connection'])
    expect(bad.code).toBe(1)
    expect(bad.out + bad.err).not.toContain(KEY)
  })
})
