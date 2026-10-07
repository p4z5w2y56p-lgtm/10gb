import { z } from 'zod'
import type { CloudDiff, CloudSessionInfo, PullRequestResult, PushResult } from '../../shared/cloud'
import { SettingsSchema } from '../store/settings'

/**
 * The worker's HTTP API (all JSON, all under /v1, all but /health need `Authorization: Bearer <token>`).
 *
 *   GET    /health                          -> { ok: true }                          (no auth, no details)
 *   POST   /v1/sessions                     -> CloudSessionInfo                      (clones, creates the branch)
 *   GET    /v1/sessions                     -> CloudSessionInfo[]
 *   GET    /v1/sessions/:id                 -> CloudSessionInfo
 *   DELETE /v1/sessions/:id                 -> { ok: true }                          (stops, deletes the workspace)
 *   POST   /v1/sessions/:id/invoke          -> IpcResult                             (body: InvokeBody; session channels only)
 *   PUT    /v1/sessions/:id/secrets         -> { ok: true }                          (body: SecretsBody; replaces in-memory secrets)
 *   GET    /v1/sessions/:id/history         -> { history: Content[], seq: number }
 *   GET    /v1/sessions/:id/events?after=N  -> text/event-stream (see SSE below)
 *   GET    /v1/sessions/:id/diff            -> CloudDiff
 *   POST   /v1/sessions/:id/push            -> PushResult
 *   POST   /v1/sessions/:id/pr              -> PullRequestResult                     (body: PrBody)
 *
 * Errors: `{ ok: false, error: string, code?: string }` with a matching HTTP status
 * (400 invalid, 401 bad token, 404 unknown session, 409 conflict/busy, 413 too large, 429 too many, 500 other).
 *
 * SSE: each event is `id: <seq>` + `data: <AgentEvent JSON>`. A comment line (`: ping`) every 15 s keeps the
 * stream alive. A client that reconnects sends `Last-Event-ID` (or `?after=`); the worker replays what it still
 * holds. If the client is further behind than the buffer, the first message is `event: gap` with
 * `data: { "oldest": <seq> }` and the client must reload `/history` and continue from its `seq`.
 */
export const CLOUD_API = '/v1'

/** Channels a cloud session answers over /invoke. Everything else is local to the desktop. */
export const CLOUD_INVOKE_CHANNELS = [
  'agent:send',
  'agent:stop',
  'agent:approval',
  'agent:answer',
  'agent:setMode',
  'agent:undo',
  'agent:changes',
  'settings:save',
  'sessions:list',
  'rules:list',
  'rules:remove',
  'audit:read',
  'prompter:spark',
  'prompter:autopilot',
  'app:status',
] as const

export const InvokeBody = z.object({ channel: z.enum(CLOUD_INVOKE_CHANNELS), payload: z.unknown().optional() })
export type InvokeBody = z.infer<typeof InvokeBody>

const Secret = z.string().trim().min(1).max(4096)

/** Secrets travel per session, over TLS, live only in worker memory and are never written to disk. */
export const SecretsBody = z.object({ apiKey: Secret.optional(), githubToken: Secret.optional() }).strict()
export type SecretsBody = z.infer<typeof SecretsBody>

export const CreateSessionBody = z
  .object({
    repo: z.string().trim().min(1).max(300),
    baseBranch: z.string().trim().min(1).max(200).optional(),
    name: z.string().trim().max(60).optional(),
    settings: SettingsSchema,
    secrets: z.object({ apiKey: Secret, githubToken: Secret }),
    autoPush: z.boolean().default(true),
  })
  .strict()
export type CreateSessionBody = z.infer<typeof CreateSessionBody>

export const PrBody = z
  .object({
    title: z.string().trim().min(1).max(256),
    body: z.string().max(60_000).optional(),
    draft: z.boolean().optional(),
  })
  .strict()
export type PrBody = z.infer<typeof PrBody>

export interface ApiError {
  ok: false
  error: string
  code?: string
}

/**
 * Server-side git for a session workspace. Implemented over the git CLI with a hardened environment
 * (see the spec, section 9.4). The token is passed per call and only ever reaches the git child's
 * environment for network operations.
 */
export interface GitOps {
  /** Clone `httpsUrl` into `dir`, check out `baseBranch` (default branch when omitted), create and switch to `branch`. */
  clone(opts: { httpsUrl: string; dir: string; token: string; baseBranch?: string; branch: string }): Promise<{ baseBranch: string; head: string }>
  /** Changed files against the base branch, plus commit and push state. */
  diff(opts: { dir: string; baseBranch: string; branch: string; pushedHead: string | null }): Promise<CloudDiff>
  /**
   * Stage everything except secret-looking and oversized new files, commit if there is anything to commit,
   * then push `HEAD:refs/heads/<branch>` (never forced, never outside `arc/`).
   * Refuses (throws) when the repository's git config was tampered with.
   */
  commitAndPush(opts: {
    dir: string
    httpsUrl: string
    token: string
    branch: string
    message: string
  }): Promise<Pick<PushResult, 'commit' | 'pushed' | 'skipped'> & { head: string }>
}

/** GitHub REST calls the worker makes with the session's token. */
export interface GithubApi {
  getRepo(opts: { owner: string; name: string; token: string }): Promise<{ defaultBranch: string; private: boolean; canPush: boolean }>
  createPullRequest(opts: {
    owner: string
    name: string
    token: string
    head: string
    base: string
    title: string
    body?: string
    draft?: boolean
  }): Promise<PullRequestResult>
}

export type { CloudSessionInfo }
