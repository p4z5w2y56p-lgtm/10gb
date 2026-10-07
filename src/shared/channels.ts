/** IPC channel names. Kept free of dependencies so the preload bundle stays tiny. */
export const IPC = {
  send: 'agent:send',
  stop: 'agent:stop',
  approval: 'agent:approval',
  answer: 'agent:answer',
  setMode: 'agent:setMode',
  undo: 'agent:undo',
  changes: 'agent:changes',
  chooseProject: 'project:choose',
  openProject: 'project:open',
  status: 'app:status',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  setKey: 'secrets:setKey',
  clearKey: 'secrets:clear',
  testKey: 'secrets:test',
  sessionsList: 'sessions:list',
  sessionsResume: 'sessions:resume',
  rulesList: 'rules:list',
  rulesRemove: 'rules:remove',
  auditRead: 'audit:read',
  spark: 'prompter:spark',
  autopilot: 'prompter:autopilot',
  cloudStatus: 'cloud:status',
  cloudSetSecret: 'cloud:setSecret',
  cloudClearSecret: 'cloud:clearSecret',
  cloudTest: 'cloud:test',
  cloudStart: 'cloud:start',
  cloudSessions: 'cloud:sessions',
  cloudAttach: 'cloud:attach',
  cloudLeave: 'cloud:leave',
  cloudEnd: 'cloud:end',
  cloudDiff: 'cloud:diff',
  cloudPush: 'cloud:push',
  cloudPr: 'cloud:pr',
  /** Main to renderer only. */
  event: 'agent:event',
} as const

export type Channel = (typeof IPC)[Exclude<keyof typeof IPC, 'event'>]

/** Every channel the renderer may invoke. */
export const INVOKE_CHANNELS: readonly string[] = Object.entries(IPC)
  .filter(([key]) => key !== 'event')
  .map(([, value]) => value)

export type IpcResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: 'no-api-key' | 'no-project' | 'invalid' | 'untrusted' | 'busy' }
