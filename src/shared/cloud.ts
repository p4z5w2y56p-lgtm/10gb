/** Cloud contracts shared by the main process, the worker, the preload bridge and the renderer. Browser-safe: types and constants only. */
import type { PermissionMode } from './types'

/** Secrets the desktop keeps for the cloud (the Vertex key stays under its own methods). */
export type CloudSecretName = 'cloud-token' | 'github-token'
export const CLOUD_SECRET_NAMES: readonly CloudSecretName[] = ['cloud-token', 'github-token']

/** Every cloud branch lives under this prefix. The worker never pushes anywhere else, and never force-pushes. */
export const CLOUD_BRANCH_PREFIX = 'arc/'

/** One session on the worker, as the desktop sees it. */
export interface CloudSessionInfo {
  id: string
  /** `owner/name` on the configured GitHub host. */
  repo: string
  branch: string
  baseBranch: string
  busy: boolean
  mode: PermissionMode | null
  createdAt: string
  lastActiveAt: string
  /** True once the current branch tip has been pushed to GitHub. */
  pushed: boolean
}

export interface CloudStatus {
  /** Worker URL and access token are both saved. */
  configured: boolean
  workerUrl: string
  hasCloudToken: boolean
  hasGithubToken: boolean
  autoPush: boolean
  /** The cloud session the app is attached to right now, if any. */
  active: CloudSessionInfo | null
}

export interface CloudDiffFile {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'
  additions: number
  deletions: number
}

export interface CloudDiff {
  branch: string
  baseBranch: string
  files: CloudDiffFile[]
  /** Files changed in the working tree that are not committed yet. */
  uncommitted: boolean
  /** Commits on the branch that the base branch does not have. */
  ahead: number
  pushed: boolean
}

export interface PushResult {
  branch: string
  /** Short hash of the commit that was pushed (null when there was nothing new to commit or push). */
  commit: string | null
  pushed: boolean
  /** Files deliberately left out because they look like secrets or are very large. */
  skipped: string[]
  /** Link to the branch on GitHub. */
  url: string
}

export interface PullRequestResult {
  number: number
  url: string
  draft: boolean
  /** An open pull request for this branch already existed and was reused. */
  existing: boolean
}

/** What the user types to start a cloud session. */
export interface CloudStartRequest {
  /** `owner/name` or a GitHub URL. */
  repo: string
  baseBranch?: string
  /** Short label that becomes part of the branch name. */
  name?: string
}

export interface CloudTestResult {
  label: string
  ok: boolean
  message: string
}
