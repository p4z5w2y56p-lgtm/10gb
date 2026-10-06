import { readFile, stat } from 'node:fs/promises'
import { relative } from 'node:path'
import { createTwoFilesPatch } from 'diff'
import { z } from 'zod'
import type { ToolResult } from '../../shared/types'
import { resolveInside } from '../safety/pathSandbox'
import { isProtectedWrite } from '../safety/protected'
import { atomicWrite } from '../store/fsutil'
import type { Tool, ToolContext } from './registry'

const fail = (output: string): ToolResult => ({ ok: false, output })

/** Unified diff of two texts, used for approval cards and tool output. */
export function makeDiff(oldText: string, newText: string, path: string): string {
  return createTwoFilesPatch(path, path, oldText, newText, '', '', { context: 3 })
}

async function writableTarget(
  ctx: ToolContext,
  filePath: string,
): Promise<{ ok: true; real: string; rel: string } | { ok: false; output: string }> {
  const r = await resolveInside(ctx.projectRoot, filePath, { extraDirs: ctx.extraDirs })
  if (!r.ok) return { ok: false, output: r.reason }
  if (isProtectedWrite(r.real, ctx.protectedPaths, ctx.projectRoot)) {
    return { ok: false, output: `Writing to a protected path is never allowed: ${filePath}` }
  }
  return { ok: true, real: r.real, rel: relative(ctx.projectRoot, r.real) || filePath }
}

/** Pure CRLF files are edited in LF space and written back as CRLF; mixed files are left exactly alone. */
const isPureCrlf = (text: string) => /\r\n/.test(text) && !/(^|[^\r])\n/.test(text)

function replaceOnce(text: string, from: string, to: string): string {
  const i = text.indexOf(from)
  return text.slice(0, i) + to + text.slice(i + from.length)
}

export const editTool: Tool<{ file_path: string; old_string: string; new_string: string; replace_all?: boolean }> = {
  name: 'Edit',
  description:
    'Replace exact text in an existing file. old_string must match exactly and be unique unless replace_all is true.',
  schema: z.object({
    file_path: z.string().describe('Path to the file to edit'),
    old_string: z.string().min(1).describe('Exact text to replace'),
    new_string: z.string().describe('Replacement text'),
    replace_all: z.boolean().optional().describe('Replace every occurrence'),
  }),
  async run({ file_path, old_string, new_string, replace_all }, ctx) {
    const target = await writableTarget(ctx, file_path)
    if (!target.ok) return fail(target.output)
    if (old_string === new_string) return fail('old_string and new_string are identical; nothing to change')

    let original: string
    try {
      original = await readFile(target.real, 'utf8')
    } catch {
      return fail(`File not found: ${file_path}. Use Write to create a new file.`)
    }

    const crlf = isPureCrlf(original)
    const text = crlf ? original.replace(/\r\n/g, '\n') : original
    const from = crlf ? old_string.replace(/\r\n/g, '\n') : old_string
    const to = crlf ? new_string.replace(/\r\n/g, '\n') : new_string

    const count = text.split(from).length - 1
    if (count === 0) return fail(`old_string not found in ${file_path}. It must match the file exactly, including whitespace.`)
    if (count > 1 && !replace_all) {
      return fail(`old_string appears ${count} times in ${file_path}. Add more context to make it unique, or set replace_all.`)
    }

    const edited = replace_all ? text.split(from).join(to) : replaceOnce(text, from, to)
    const output = crlf ? edited.replace(/\n/g, '\r\n') : edited

    await ctx.checkpoints.snapshot(target.real)
    const st = await stat(target.real)
    await atomicWrite(target.real, output, st.mode & 0o777)
    if (ctx.session.readFiles.has(target.real)) {
      ctx.session.readFiles.set(target.real, (await stat(target.real)).mtimeMs)
    }
    return { ok: true, output: `Edited ${target.rel}\n${makeDiff(original, output, target.rel)}` }
  },
}

export const writeTool: Tool<{ file_path: string; content: string }> = {
  name: 'Write',
  description:
    'Create a file or overwrite one. An existing file must have been read with Read in this session first.',
  schema: z.object({
    file_path: z.string().describe('Path to write'),
    content: z.string().describe('Full file contents'),
  }),
  async run({ file_path, content }, ctx) {
    const target = await writableTarget(ctx, file_path)
    if (!target.ok) return fail(target.output)

    const st = await stat(target.real).catch(() => null)
    let before = ''
    if (st) {
      if (st.isDirectory()) return fail(`Is a directory: ${file_path}`)
      const readAt = ctx.session.readFiles.get(target.real)
      if (readAt === undefined) {
        return fail(`${file_path} already exists. Read it with Read before overwriting it.`)
      }
      if (readAt !== st.mtimeMs) {
        return fail(`${file_path} changed on disk since you read it. Read it again before overwriting.`)
      }
      before = await readFile(target.real, 'utf8').catch(() => '')
    }

    await ctx.checkpoints.snapshot(target.real)
    await atomicWrite(target.real, content, st ? st.mode & 0o777 : 0o644)
    ctx.session.readFiles.set(target.real, (await stat(target.real)).mtimeMs)
    const lead = st ? `Wrote ${target.rel}` : `Created ${target.rel} (${content.split('\n').length} lines)`
    return { ok: true, output: `${lead}\n${makeDiff(before, content, target.rel)}` }
  },
}
