import { realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'

export type ResolveResult = { ok: true; real: string } | { ok: false; reason: string }

export interface ResolveOptions {
  extraDirs?: string[]
  /** Compare paths case-insensitively (default APFS volumes). */
  caseInsensitive?: boolean
}

/** Canonical (symlink-free) path of a project root. Call once when a project opens. */
export async function canonicalRoot(root: string): Promise<string> {
  return realpath(resolve(root))
}

/**
 * Realpath of `p`, or for a path that does not exist yet, the realpath of its
 * nearest existing ancestor with the missing remainder appended.
 */
async function realpathOrAncestor(p: string): Promise<string> {
  const missing: string[] = []
  let current = p
  for (;;) {
    try {
      const real = await realpath(current)
      return missing.length ? join(real, ...missing.reverse()) : real
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw err
      const parent = dirname(current)
      if (parent === current) return p
      missing.push(current.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)))
      current = parent
    }
  }
}

function isWithin(dir: string, target: string, caseInsensitive: boolean): boolean {
  const norm = (s: string) => (caseInsensitive ? s.toLowerCase() : s)
  const d = norm(dir.endsWith(sep) ? dir : dir + sep)
  const t = norm(target)
  return t === norm(dir) || t.startsWith(d)
}

/**
 * Resolve `target` (relative to `root`, or absolute, existing or not) and check
 * that, after following symlinks, it stays under `root` or one of `extraDirs`.
 */
export async function resolveInside(
  root: string,
  target: string,
  opts: ResolveOptions = {},
): Promise<ResolveResult> {
  const ci = opts.caseInsensitive ?? false
  const realRoot = await realpathOrAncestor(resolve(root))
  const abs = isAbsolute(target) ? resolve(target) : resolve(realRoot, target)
  const real = await realpathOrAncestor(abs)

  if (isWithin(realRoot, real, ci)) return { ok: true, real }
  for (const extra of opts.extraDirs ?? []) {
    const realExtra = await realpathOrAncestor(resolve(extra))
    if (isWithin(realExtra, real, ci)) return { ok: true, real }
  }
  return { ok: false, reason: `Path is outside the project: ${target}` }
}
