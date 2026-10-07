import { basename, join, resolve, sep } from 'node:path'

function under(path: string, base: string, caseInsensitive = false): boolean {
  const p = caseInsensitive ? path.toLowerCase() : path
  const b = caseInsensitive ? base.toLowerCase() : base
  return p === b || p.startsWith(b.endsWith(sep) ? b : b + sep)
}

/** Paths no tool may write to (spec 6.2). `arcDataDir` is ARC's own settings/secrets/audit directory. */
export function protectedWritePaths(home: string, arcDataDir: string): string[] {
  const paths = [
    join(home, '.ssh'),
    join(home, '.aws'),
    join(home, '.config', 'gcloud'),
    join(home, 'Library', 'Keychains'),
    join(home, 'Library', 'LaunchAgents'),
    '/etc',
    '/private/etc',
    '/System',
    '/Library',
    join(home, '.zshrc'),
    join(home, '.zprofile'),
    join(home, '.zshenv'),
    join(home, '.bashrc'),
    join(home, '.bash_profile'),
    join(home, '.profile'),
    join(home, '.zlogin'),
    join(home, '.zlogout'),
    join(home, '.bash_login'),
    join(home, '.bash_logout'),
    join(home, '.gitconfig'),
    join(home, '.config', 'git'),
  ]
  if (arcDataDir) paths.push(arcDataDir)
  return paths
}

/** True when `absPath` is a protected write target, or anything under `<projectRoot>/.arc`. */
export function isProtectedWrite(
  absPath: string,
  protectedPaths: string[],
  projectRoot: string,
  caseInsensitive = false,
): boolean {
  const p = resolve(absPath)
  if (under(p, join(resolve(projectRoot), '.arc'), caseInsensitive)) return true
  return protectedPaths.some((base) => under(p, resolve(base), caseInsensitive))
}

/** Directories whose contents are credentials: reading them needs an explicit ask. */
export function sensitiveReadPaths(home: string, arcDataDir: string): string[] {
  const paths = [
    join(home, '.ssh'),
    join(home, '.aws'),
    join(home, '.config', 'gcloud'),
    join(home, '.gnupg'),
    join(home, 'Library', 'Keychains'),
  ]
  if (arcDataDir) paths.push(arcDataDir)
  return paths
}

const SENSITIVE_NAMES = [/^id_(rsa|dsa|ecdsa|ed25519)$/, /\.pem$/, /\.p12$/, /\.pfx$/, /^\.netrc$/, /^\.npmrc$/]

export function isSensitiveRead(absPath: string, sensitivePaths: string[], caseInsensitive = false): boolean {
  const p = resolve(absPath)
  if (sensitivePaths.some((base) => under(p, resolve(base), caseInsensitive))) return true
  const name = basename(p)
  return SENSITIVE_NAMES.some((re) => re.test(name))
}
