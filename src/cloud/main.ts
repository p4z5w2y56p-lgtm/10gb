import { mkdir, readFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CliGitOps } from '../main/cloud/gitOps'
import { RestGithubApi } from '../main/cloud/github'
import type { GitOps, GithubApi } from '../main/cloud/protocol'
import { createWorkerServer } from '../main/cloud/server'
import { CloudWorker } from '../main/cloud/worker'
import { redact } from '../main/safety/redact'

const MIN_TOKEN_CHARS = 32
const SWEEP_EVERY_MS = 5 * 60 * 1000
const FORCE_EXIT_MS = 10_000

/** A setting is wrong: the message is shown to whoever runs the worker, so it never contains a secret. */
export class ConfigError extends Error {}

export interface WorkerHandle {
  server: Server
  worker: CloudWorker
  port: number
  /** Stop turns, end streams, close the server. */
  stop(): Promise<void>
}

export interface StartDeps {
  git?: GitOps
  github?: GithubApi
  log?: (line: string) => void
}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) throw new ConfigError(`${name} must be a whole number from ${min} to ${max}.`)
  return n
}

/**
 * The worker token. ARC_CLOUD_TOKEN_FILE (a path, for example a mounted secret) wins over ARC_CLOUD_TOKEN: a file is not in
 * /proc/<pid>/environ, an environment variable is. Read once; surrounding whitespace is trimmed. Messages never contain the value.
 */
async function readToken(env: NodeJS.ProcessEnv): Promise<string> {
  const tooShort = (name: string): ConfigError =>
    new ConfigError(`${name} must hold a token of at least ${MIN_TOKEN_CHARS} characters. Generate one with: openssl rand -hex 32`)
  const file = env.ARC_CLOUD_TOKEN_FILE?.trim()
  if (file) {
    let content: string
    try {
      content = await readFile(file, 'utf8')
    } catch {
      throw new ConfigError(`ARC_CLOUD_TOKEN_FILE could not be read (${file}). Check that the file exists and the worker may read it.`)
    }
    const token = content.trim()
    if (token.length < MIN_TOKEN_CHARS) throw tooShort('ARC_CLOUD_TOKEN_FILE')
    return token
  }
  const token = env.ARC_CLOUD_TOKEN ?? ''
  if (token.length < MIN_TOKEN_CHARS) {
    throw new ConfigError(
      `ARC_CLOUD_TOKEN (or ARC_CLOUD_TOKEN_FILE) is required and must be at least ${MIN_TOKEN_CHARS} characters. Generate one with: openssl rand -hex 32`,
    )
  }
  return token
}

/** Read the configuration, build everything and listen. Throws ConfigError before touching the disk or network when a setting is wrong. */
export async function startWorker(env: NodeJS.ProcessEnv, deps: StartDeps = {}): Promise<WorkerHandle> {
  const log = deps.log ?? ((line: string) => console.log(line))

  const token = await readToken(env)
  // Out of the environment at once, so nothing the agent starts can inherit it.
  delete env.ARC_CLOUD_TOKEN
  delete env.ARC_CLOUD_TOKEN_FILE

  const port = int(env, 'PORT', 8080, 0, 65535)
  const maxSessions = int(env, 'ARC_MAX_SESSIONS', 4, 1, 64)
  const idleHoursRaw = env.ARC_IDLE_HOURS
  let idleMs: number | undefined
  if (idleHoursRaw !== undefined && idleHoursRaw.trim() !== '') {
    const hours = Number(idleHoursRaw)
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 365) throw new ConfigError('ARC_IDLE_HOURS must be a number of hours greater than 0.')
    idleMs = hours * 60 * 60 * 1000
  }
  let hosts: string[] | undefined
  if (env.ARC_GITHUB_HOSTS !== undefined && env.ARC_GITHUB_HOSTS.trim() !== '') {
    hosts = env.ARC_GITHUB_HOSTS.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
    if (hosts.length === 0) throw new ConfigError('ARC_GITHUB_HOSTS must list at least one host, for example github.com.')
  }
  const apiBase = env.ARC_GITHUB_API?.trim() || undefined
  const dataDir = env.ARC_DATA_DIR?.trim() || '/data'
  const trustProxy = ['1', 'true', 'yes'].includes((env.ARC_TRUST_PROXY ?? '').trim().toLowerCase())

  await mkdir(dataDir, { recursive: true })
  const git = deps.git ?? new CliGitOps({ workDir: join(dataDir, 'git') })
  const github = deps.github ?? new RestGithubApi(apiBase ? { apiBase } : {})
  const worker = new CloudWorker({ dataDir, git, github, hosts, maxSessions, idleMs })
  await worker.purgeOrphans()

  const server = createWorkerServer({
    worker,
    token,
    trustProxy,
    logger: (line) => log(redact(line, [token])),
  })
  const sweepTimer = setInterval(() => {
    worker.sweep().catch((err: unknown) => log(redact(`[worker] sweep failed: ${err instanceof Error ? err.message : String(err)}`, [token])))
  }, SWEEP_EVERY_MS)
  sweepTimer.unref()

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '0.0.0.0', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const actualPort = (server.address() as AddressInfo).port
  log(`ARC worker listening on port ${actualPort} (max ${maxSessions} sessions, data in ${dataDir})`)

  let stopping: Promise<void> | null = null
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      clearInterval(sweepTimer)
      await worker.shutdown()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeIdleConnections()
      })
    })()
    return stopping
  }
  return { server, worker, port: actualPort, stop }
}

async function run(): Promise<void> {
  let handle: WorkerHandle
  try {
    handle = await startWorker(process.env)
  } catch (err) {
    console.error(err instanceof ConfigError ? `ARC worker: ${err.message}` : `ARC worker could not start: ${redact(err instanceof Error ? err.message : String(err))}`)
    process.exit(1)
  }
  const shutdown = (signal: string): void => {
    console.log(`ARC worker: ${signal} received, shutting down`)
    setTimeout(() => process.exit(1), FORCE_EXIT_MS).unref()
    handle.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    )
  }
  process.once('SIGTERM', () => shutdown('SIGTERM'))
  process.once('SIGINT', () => shutdown('SIGINT'))
  // A stray rejection should not end every running session; a real crash still should.
  process.on('unhandledRejection', (reason) => console.error(redact(`[worker] unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`)))
  process.on('uncaughtException', (err) => {
    console.error(redact(`[worker] fatal: ${err.stack ?? err.message}`))
    process.exit(1)
  })
}

const entry = process.argv[1]
if (entry) {
  try {
    if (realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) void run()
  } catch {
    // imported from a test or a tool: do not start
  }
}
