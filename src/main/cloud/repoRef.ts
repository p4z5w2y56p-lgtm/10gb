import { randomBytes } from 'node:crypto'

export interface RepoRef {
  host: string
  owner: string
  name: string
  /** `owner/name` */
  slug: string
  /** Credential-free `https://<host>/<owner>/<name>`, the only URL the worker ever hands to git. */
  httpsUrl: string
}

const DEFAULT_HOSTS = ['github.com']
const MAX_INPUT = 300
const NAME_CHARS = /^[A-Za-z0-9._-]+$/
const USAGE = 'Use owner/name or a link like https://github.com/owner/name.'

const fail = (message: string): never => {
  throw new Error(message)
}

function checkPart(kind: 'owner' | 'name', value: string): void {
  if (value === '') fail(`The repository ${kind} is missing. ${USAGE}`)
  if (!NAME_CHARS.test(value)) fail(`The repository ${kind} contains characters GitHub does not allow (use letters, digits, ".", "-" and "_").`)
  if (value === '.' || value === '..') fail(`The repository ${kind} cannot be "." or "..".`)
  if (kind === 'owner' && value.startsWith('-')) fail('The repository owner cannot start with a dash.')
}

/**
 * Parse what the user typed into a validated repository reference. Only `owner/name` and https links on an
 * allowed host are accepted, so nothing that git could treat as a transport, an option or a credential gets through.
 * `opts.hosts` replaces the default `["github.com"]` (GitHub Enterprise); the first host is used for `owner/name`.
 */
export function parseRepoRef(input: string, opts: { hosts?: string[] } = {}): RepoRef {
  const hosts = (opts.hosts?.length ? opts.hosts : DEFAULT_HOSTS).map((h) => h.toLowerCase())
  if (typeof input !== 'string' || input === '') return fail(`The repository is empty. ${USAGE}`)
  if (input.length > MAX_INPUT) return fail('The repository is too long.')
  if (/[\s\u0000-\u001f\u007f-\u009f]/.test(input)) return fail('The repository contains whitespace or control characters.')
  if (input.startsWith('-')) return fail('The repository cannot start with a dash, it would look like a command option.')
  if (input.includes('\\')) return fail('The repository cannot contain backslashes or other unusual characters.')

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(input)?.[1]?.toLowerCase()
  let hostPart: string | null = null
  let path: string

  if (scheme === 'https' && /^https:\/\//i.test(input)) {
    const rest = input.slice('https://'.length)
    if (rest.includes('@')) return fail('The repository link cannot contain credentials. The GitHub token is set separately in Settings.')
    if (/[?#]/.test(rest)) return fail('The repository link cannot have a query string or fragment.')
    const slash = rest.indexOf('/')
    hostPart = (slash < 0 ? rest : rest.slice(0, slash)).toLowerCase()
    path = slash < 0 ? '' : rest.slice(slash + 1)
    if (hostPart.includes(':')) return fail('The repository link cannot name a port.')
  } else if (scheme === 'http') {
    return fail('Only https:// repository links are allowed, plain http is not.')
  } else if (scheme || input.includes(':')) {
    return fail(`That kind of repository address (ssh, git, file and other transports) is not supported. ${USAGE}`)
  } else if (input.includes('@')) {
    return fail('The repository cannot contain credentials. The GitHub token is set separately in Settings.')
  } else {
    path = input
  }

  let segments = path.split('/')
  if (hostPart === null && segments.slice(0, -1).some((s) => s === '')) return fail(`The repository needs an owner and a name. ${USAGE}`)
  if (hostPart === null && segments.length >= 3) {
    hostPart = segments[0].toLowerCase()
    segments = segments.slice(1)
  }
  if (hostPart !== null && !hosts.includes(hostPart)) {
    return fail(`"${hostPart.slice(0, 80)}" is not an allowed host (allowed: ${hosts.join(', ')}).`)
  }
  const host = hostPart ?? hosts[0]

  if (segments.length > 0 && segments[segments.length - 1] === '') segments = segments.slice(0, -1)
  if (segments.some((s) => s === '') || segments.length < 2) return fail(`The repository needs an owner and a name. ${USAGE}`)
  if (segments.length > 2) return fail('The repository link has too many parts. Use the repository root, not a branch or file link.')

  const owner = segments[0]
  let name = segments[1]
  if (name.endsWith('.git')) name = name.slice(0, -4)
  checkPart('owner', owner)
  checkPart('name', name)
  return { host, owner, name, slug: `${owner}/${name}`, httpsUrl: `https://${host}/${owner}/${name}` }
}

/** `arc/<slug of label, or "session">-<4 hex>`; the slug is lowercase ascii letters, digits and dashes, at most 30 characters. */
export function makeBranchName(label: string | undefined, rand: () => string = () => randomBytes(2).toString('hex')): string {
  const suffix = rand()
  if (!/^[0-9a-f]{4}$/.test(suffix)) throw new Error('Branch suffix must be 4 lowercase hex characters.')
  const slug = (label ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 30)
    .replace(/-+$/, '')
  return `arc/${slug || 'session'}-${suffix}`
}

/** The only branches the worker will create or push: under `arc/`, with characters git never treats specially. */
export function isSafeBranchName(branch: string): boolean {
  if (typeof branch !== 'string' || branch.length > 120) return false
  if (!branch.startsWith('arc/') || branch.startsWith('-')) return false
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) return false
  if (branch.includes('..') || branch.includes('//') || branch.includes('@{')) return false
  const segments = branch.split('/')
  return segments.every((s) => s !== '' && !s.startsWith('.') && !s.endsWith('.') && !s.endsWith('.lock'))
}
