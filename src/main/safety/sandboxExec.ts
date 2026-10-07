import { existsSync } from 'node:fs'
import { join } from 'node:path'

const SANDBOX_EXEC = '/usr/bin/sandbox-exec'

/** True only on macOS with the system sandbox-exec present. */
export function detectSandboxExec(
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = existsSync,
): boolean {
  return platform === 'darwin' && exists(SANDBOX_EXEC)
}

const sbplString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/**
 * Seatbelt profile: everything is allowed except file writes, which are limited
 * to the project, the OS temp directory and a few device nodes.
 */
export function buildSandboxProfile(projectRoot: string, tmpDir: string): string {
  return [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    '(allow file-write*',
    `  (subpath ${sbplString(projectRoot)})`,
    `  (subpath ${sbplString(tmpDir)})`,
    '  (literal "/dev/null")',
    '  (literal "/dev/tty")',
    '  (literal "/dev/dtracehelper")',
    '  (regex #"^/dev/ttys[0-9]+$"))',
    // Re-deny after the allow: these would otherwise be writable as part of the project.
    // .arc is ARC's own area; git hooks run later, outside the sandbox.
    `(deny file-write* (subpath ${sbplString(join(projectRoot, '.arc'))}) (subpath ${sbplString(join(projectRoot, '.git', 'hooks'))}))`,
    '',
  ].join('\n')
}

export function wrapCommand(shell: string, command: string, profile: string): { file: string; args: string[] } {
  return { file: SANDBOX_EXEC, args: ['-p', profile, shell, '-c', command] }
}
