import { spawn, spawnSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { lstat, open, readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { createInterface } from 'node:readline'
import { glob } from 'tinyglobby'
import { z } from 'zod'
import type { ToolResult } from '../../shared/types'
import { resolveInside } from '../safety/pathSandbox'
import type { Tool, ToolContext } from './registry'

const DEFAULT_LINE_LIMIT = 2000
const MAX_LINE_CHARS = 2000
const MAX_LIST = 500
const MAX_GLOB = 1000
const MAX_GREP_FILE_BYTES = 2 * 1024 * 1024
const IGNORE = ['**/.git/**', '**/node_modules/**']

const fail = (output: string): ToolResult => ({ ok: false, output })

async function confine(ctx: ToolContext, target: string) {
  return resolveInside(ctx.projectRoot, target, { extraDirs: ctx.extraDirs })
}

async function isBinaryFile(path: string): Promise<boolean> {
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(8000)
    const { bytesRead } = await fh.read(buf, 0, 8000, 0)
    return buf.subarray(0, bytesRead).includes(0)
  } finally {
    await fh.close()
  }
}

export const readTool: Tool<{ file_path: string; offset?: number; limit?: number }> = {
  name: 'Read',
  description:
    'Read a text file. Returns numbered lines. Use offset (1-based first line) and limit to read a window of a large file.',
  schema: z.object({
    file_path: z.string().describe('Path to the file, relative to the project or absolute'),
    offset: z.number().int().min(1).optional().describe('1-based line number to start from'),
    limit: z.number().int().min(1).max(10_000).optional().describe('Maximum number of lines (default 2000)'),
  }),
  async run({ file_path, offset, limit }, ctx) {
    const r = await confine(ctx, file_path)
    if (!r.ok) return fail(r.reason)
    let st
    try {
      st = await stat(r.real)
    } catch {
      return fail(`File not found: ${file_path}`)
    }
    if (st.isDirectory()) return fail(`Is a directory, use LS instead: ${file_path}`)
    if (!st.isFile()) return fail(`Not a regular file (pipe, socket or device): ${file_path}`)
    if (await isBinaryFile(r.real)) return fail(`Cannot read binary file: ${file_path}`)

    const start = offset ?? 1
    const max = limit ?? DEFAULT_LINE_LIMIT
    const stream = createReadStream(r.real, { encoding: 'utf8' })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    const lines: string[] = []
    let lineNo = 0
    let more = false
    try {
      for await (const line of rl) {
        lineNo++
        if (lineNo < start) continue
        if (lines.length >= max) {
          more = true
          break
        }
        const text = line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line
        lines.push(`${String(lineNo).padStart(6)}\t${text}`)
      }
    } finally {
      rl.close()
      stream.destroy()
    }
    ctx.session.readFiles.set(r.real, st.mtimeMs)
    if (lineNo === 0) return { ok: true, output: '(empty file)' }
    if (lines.length === 0) return { ok: true, output: `(no lines at offset ${start}; the file has ${lineNo} lines)` }
    let output = lines.join('\n')
    if (more) output += `\n[more lines follow; use offset ${start + lines.length} to continue]`
    return { ok: true, output }
  },
}

export const lsTool: Tool<{ path?: string }> = {
  name: 'LS',
  description: 'List the entries of a directory. Directories end with a slash.',
  schema: z.object({ path: z.string().optional().describe('Directory, relative to the project (default: the project root)') }),
  async run({ path }, ctx) {
    const target = path ?? '.'
    const r = await confine(ctx, target)
    if (!r.ok) return fail(r.reason)
    let entries
    try {
      entries = await readdir(r.real, { withFileTypes: true })
    } catch {
      return fail(`Not a directory or not readable: ${target}`)
    }
    const names = await Promise.all(
      entries.map(async (e) => {
        let isDir = e.isDirectory()
        if (e.isSymbolicLink()) isDir = await stat(join(r.real, e.name)).then((s) => s.isDirectory(), () => false)
        return isDir ? `${e.name}/` : e.name
      }),
    )
    names.sort()
    const shown = names.slice(0, MAX_LIST)
    if (names.length > MAX_LIST) shown.push(`[${names.length - MAX_LIST} more entries]`)
    return { ok: true, output: shown.join('\n') || '(empty directory)' }
  },
}

export const globTool: Tool<{ pattern: string; path?: string }> = {
  name: 'Glob',
  description: 'Find files by glob pattern (for example "**/*.ts"). Newest files first. Skips .git and node_modules.',
  schema: z.object({
    pattern: z.string().min(1).describe('Relative glob pattern'),
    path: z.string().optional().describe('Directory to search (default: the project root)'),
  }),
  async run({ pattern, path }, ctx) {
    if (pattern.startsWith('/') || pattern.split('/').includes('..')) {
      return fail('Pattern must be relative and stay inside the directory (no leading / and no ..)')
    }
    const r = await confine(ctx, path ?? '.')
    if (!r.ok) return fail(r.reason)
    const found = await glob(pattern, {
      cwd: r.real,
      ignore: IGNORE,
      dot: true,
      followSymbolicLinks: false,
      onlyFiles: true,
    })
    const withTimes = await Promise.all(
      found.map(async (f) => {
        const full = join(r.real, f)
        const st = await lstat(full).catch(() => null)
        return st && !st.isSymbolicLink() ? { rel: relative(ctx.projectRoot, full), mtime: st.mtimeMs } : null
      }),
    )
    const files = withTimes.filter((x): x is { rel: string; mtime: number } => x !== null)
    files.sort((a, b) => b.mtime - a.mtime || a.rel.localeCompare(b.rel))
    if (files.length === 0) return { ok: true, output: 'No files matched.' }
    const shown = files.slice(0, MAX_GLOB).map((f) => f.rel)
    if (files.length > MAX_GLOB) shown.push(`[${files.length - MAX_GLOB} more not shown]`)
    return { ok: true, output: shown.join('\n') }
  },
}

let cachedRg: string | null | undefined
function detectRg(): string | null {
  if (cachedRg === undefined) cachedRg = spawnSync('rg', ['--version']).status === 0 ? 'rg' : null
  return cachedRg
}

interface GrepArgs {
  pattern: string
  path?: string
  glob?: string
  ignore_case?: boolean
}

function runRg(rg: string, args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(rg, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (e) => resolve({ code: 2, stdout, stderr: String(e) }))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

function capLines(lines: string[]): string {
  const shown = lines.slice(0, MAX_LIST)
  if (lines.length > MAX_LIST) shown.push(`[${lines.length - MAX_LIST} more matches not shown]`)
  return shown.join('\n')
}

/** Regex search. Uses ripgrep when available, otherwise a JS walker with the same output shape. */
export function makeGrepTool(opts: { rgPath?: string | null } = {}): Tool<GrepArgs> {
  return {
    name: 'Grep',
    description:
      'Search file contents with a regular expression. Returns file:line:text. Skips .git, node_modules and binary files.',
    schema: z.object({
      pattern: z.string().min(1).describe('Regular expression'),
      path: z.string().optional().describe('File or directory to search (default: the project root)'),
      glob: z.string().optional().describe('Only search files matching this glob, for example "*.ts"'),
      ignore_case: z.boolean().optional(),
    }),
    async run({ pattern, path, glob: fileGlob, ignore_case }, ctx) {
      const r = await confine(ctx, path ?? '.')
      if (!r.ok) return fail(r.reason)
      const rg = opts.rgPath === undefined ? detectRg() : opts.rgPath
      const rel = relative(ctx.projectRoot, r.real)

      if (rg) {
        const args = ['-H', '--line-number', '--no-heading', '--color', 'never', '--max-columns', '500']
        if (ignore_case) args.push('-i')
        if (fileGlob) args.push('--glob', fileGlob)
        args.push('--glob', '!**/node_modules/**', '--glob', '!**/.git/**', '-e', pattern, '--')
        args.push(rel || '.')
        const res = await runRg(rg, args, ctx.projectRoot)
        const lines = res.stdout
          .split('\n')
          .filter((l) => l && !l.includes('binary file matches'))
          .map((l) => l.replace(/^\.\//, ''))
        if (res.code === 2 && lines.length === 0) return fail(`Search failed: ${res.stderr.trim() || 'ripgrep error'}`)
        return lines.length ? { ok: true, output: capLines(lines) } : { ok: true, output: 'No matches.' }
      }

      let re: RegExp
      try {
        re = new RegExp(pattern, ignore_case ? 'i' : '')
      } catch (e) {
        return fail(`Invalid regex: ${e instanceof Error ? e.message : String(e)}`)
      }
      const targetStat = await stat(r.real).catch(() => null)
      if (!targetStat) return fail(`Path not found: ${path ?? '.'}`)
      const dir = targetStat.isDirectory() ? r.real : null
      const files = dir
        ? (
            await glob(fileGlob ? (fileGlob.includes('/') ? fileGlob : `**/${fileGlob}`) : '**/*', {
              cwd: dir,
              ignore: IGNORE,
              followSymbolicLinks: false,
              onlyFiles: true,
            })
          )
            .sort()
            .map((f) => join(dir, f))
        : [r.real]
      const hits: string[] = []
      for (const file of files) {
        if (hits.length > MAX_LIST) break
        const st = await lstat(file).catch(() => null)
        if (!st || st.isSymbolicLink() || !st.isFile() || st.size > MAX_GREP_FILE_BYTES) continue
        if (await isBinaryFile(file).catch(() => true)) continue
        const text = await readFile(file, 'utf8').catch(() => null)
        if (text === null) continue
        const name = relative(ctx.projectRoot, file)
        const lines = text.split(/\r?\n/)
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) hits.push(`${name}:${i + 1}:${lines[i].slice(0, 500)}`)
        }
      }
      return hits.length ? { ok: true, output: capLines(hits) } : { ok: true, output: 'No matches.' }
    },
  }
}

export const grepTool = makeGrepTool()
