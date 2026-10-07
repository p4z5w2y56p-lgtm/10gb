import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from 'react'
import type { SettingsPatch } from '../../main/store/settings'
import type { CloudSecretName, CloudStartRequest, PullRequestResult, PushResult } from '../../shared/cloud'
import type { PermissionMode } from '../../shared/types'
import { ArcError, createClient, type Arc, type ArcClient, type OpenedProject } from '../arc/client'
import { initialState, reduce, type Action, type AppState } from './reducer'

export interface Actions {
  refresh(): Promise<void>
  sendMessage(text: string): Promise<void>
  stop(): Promise<void>
  saveSettings(patch: SettingsPatch): Promise<void>
  saveKey(key: string): Promise<void>
  removeKey(): Promise<void>
  chooseProject(): Promise<void>
  openProject(path: string): Promise<void>
  newSession(): Promise<void>
  resumeSession(id: string): Promise<void>
  setMode(mode: PermissionMode): Promise<void>
  approve(decision: 'allow-once' | 'always' | 'deny', note?: string): Promise<void>
  answer(text: string): Promise<void>
  spark(): Promise<void>
  undo(): Promise<void>
  setAutopilot(on: boolean): Promise<void>
  cloudRefresh(): Promise<void>
  cloudStart(req: CloudStartRequest): Promise<void>
  cloudAttach(id: string): Promise<void>
  cloudLeave(): Promise<void>
  cloudEnd(id: string): Promise<void>
  cloudDiff(): Promise<void>
  cloudPush(): Promise<PushResult>
  cloudPr(req: { title: string; body?: string; draft?: boolean }): Promise<PullRequestResult>
  cloudSetSecret(name: CloudSecretName, value: string): Promise<void>
  cloudClearSecret(name: CloudSecretName): Promise<void>
  ui(patch: Partial<AppState['ui']>): void
  notify(level: 'info' | 'warn' | 'error', message: string): void
}

export interface AppContextValue {
  state: AppState
  dispatch: Dispatch<Action>
  api: ArcClient
  actions: Actions
}

const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}

export function AppProvider({ arc, children }: { arc: Arc; children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, initialState)
  const api = useMemo(() => createClient(arc), [arc])
  const stateRef = useRef(state)
  stateRef.current = state

  const notify = useCallback(
    (level: 'info' | 'warn' | 'error', message: string) => dispatch({ type: 'event', event: { type: 'notice', level, message } }),
    [],
  )

  /** Cloud setup and the worker's sessions. An unreachable worker just means an empty list. */
  const cloudRefresh = useCallback(async () => {
    try {
      const status = await api.cloudStatus()
      dispatch({ type: 'cloud', status: status ?? null })
      if (status?.configured) {
        const sessions = await api.cloudSessions().catch(() => [])
        dispatch({ type: 'cloud', sessions: sessions ?? [] })
      } else {
        dispatch({ type: 'cloud', sessions: [] })
      }
    } catch {
      dispatch({ type: 'cloud', sessions: [] })
    }
  }, [api])

  const refresh = useCallback(async () => {
    try {
      const [app, loaded, changes] = await Promise.all([api.status(), api.getSettings(), api.changes()])
      const sessions = app.hasProject ? await api.listSessions().catch(() => []) : []
      dispatch({ type: 'loaded', app, settings: loaded.settings, sessions, mode: app.mode, changes })
      void cloudRefresh()
    } catch (err) {
      notify('error', err instanceof Error ? err.message : String(err))
    }
  }, [api, notify, cloudRefresh])

  /** A backend call that failed: show why, free the composer, and re-check whether we are locked. */
  const failed = useCallback(
    async (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      notify('error', message)
      dispatch({ type: 'event', event: { type: 'turn-end', reason: 'error' } })
      if (err instanceof ArcError && (err.code === 'no-api-key' || err.code === 'no-project')) await refresh()
    },
    [notify, refresh],
  )

  const enter = useCallback(
    async (opened: OpenedProject) => {
      dispatch({ type: 'reset' })
      dispatch({ type: 'history', history: opened.history })
      await refresh()
    },
    [refresh],
  )

  const actions = useMemo<Actions>(
    () => ({
      refresh,
      async sendMessage(text) {
        dispatch({ type: 'user-message', text })
        try {
          await api.send(text)
        } catch (err) {
          await failed(err)
        }
      },
      async stop() {
        try {
          await api.stop()
        } catch (err) {
          notify('error', err instanceof Error ? err.message : String(err))
        }
      },
      async saveSettings(patch) {
        try {
          const { settings, status } = await api.saveSettings(patch)
          dispatch({ type: 'loaded', settings, app: status })
        } catch (err) {
          notify('error', err instanceof Error ? err.message : String(err))
          throw err
        }
      },
      async saveKey(key) {
        const status = await api.setKey(key)
        dispatch({ type: 'loaded', app: status })
      },
      async removeKey() {
        if (stateRef.current.busy) await api.stop().catch(() => undefined)
        const status = await api.clearKey()
        dispatch({ type: 'loaded', app: status })
      },
      async chooseProject() {
        try {
          const opened = await api.chooseProject()
          if (opened) await enter(opened)
        } catch (err) {
          notify('error', err instanceof Error ? err.message : String(err))
        }
      },
      async openProject(path) {
        try {
          await enter(await api.openProject(path))
        } catch (err) {
          notify('error', err instanceof Error ? err.message : String(err))
        }
      },
      async newSession() {
        const root = stateRef.current.app?.projectRoot
        if (!root) return
        try {
          await enter(await api.openProject(root))
        } catch (err) {
          notify('error', err instanceof Error ? err.message : String(err))
        }
      },
      async resumeSession(id) {
        try {
          await enter(await api.resumeSession(id))
        } catch (err) {
          notify('error', err instanceof Error ? err.message : String(err))
        }
      },
      async setMode(mode) {
        try {
          await api.setMode(mode)
        } catch (err) {
          notify('error', err instanceof Error ? err.message : String(err))
        }
      },
      async approve(decision, note) {
        const pending = stateRef.current.approval
        if (!pending) return
        try {
          await api.approve(pending.call.id, decision, note)
        } catch (err) {
          notify('error', err instanceof Error ? err.message : String(err))
        }
      },
      async answer(text) {
        const pending = stateRef.current.question
        if (!pending) return
        dispatch({ type: 'question-answered' })
        try {
          await api.answer(pending.id, text)
        } catch (err) {
          notify('error', err instanceof Error ? err.message : String(err))
        }
      },
      async spark() {
        try {
          await api.spark()
        } catch (err) {
          notify('error', err instanceof Error ? err.message : String(err))
        }
      },
      async undo() {
        try {
          await api.undo()
          dispatch({ type: 'loaded', changes: await api.changes() })
        } catch (err) {
          notify('error', err instanceof Error ? err.message : String(err))
        }
      },
      async setAutopilot(on) {
        try {
          const { settings, status } = await api.setAutopilot(on)
          dispatch({ type: 'loaded', settings, app: status })
        } catch (err) {
          notify('error', err instanceof Error ? err.message : String(err))
        }
      },
      cloudRefresh,
      async cloudStart(req) {
        await enter(await api.cloudStart(req))
        dispatch({ type: 'ui', patch: { cloudStartOpen: false } })
        await cloudRefresh()
      },
      async cloudAttach(id) {
        try {
          await enter(await api.cloudAttach(id))
          await cloudRefresh()
        } catch (err) {
          notify('error', err instanceof Error ? err.message : String(err))
        }
      },
      async cloudLeave() {
        try {
          const status = await api.cloudLeave()
          dispatch({ type: 'reset' })
          dispatch({ type: 'loaded', app: status })
          await refresh()
        } catch (err) {
          notify('error', err instanceof Error ? err.message : String(err))
        }
      },
      async cloudEnd(id) {
        try {
          await api.cloudEnd(id)
          await refresh()
        } catch (err) {
          notify('error', err instanceof Error ? err.message : String(err))
        }
      },
      async cloudDiff() {
        try {
          dispatch({ type: 'cloud', diff: await api.cloudDiff() })
        } catch (err) {
          notify('error', err instanceof Error ? err.message : String(err))
        }
      },
      async cloudPush() {
        const result = await api.cloudPush()
        dispatch({ type: 'cloud', diff: await api.cloudDiff().catch(() => null) })
        return result
      },
      cloudPr: (req) => api.cloudPr(req),
      async cloudSetSecret(name, value) {
        dispatch({ type: 'cloud', status: await api.cloudSetSecret(name, value) })
        if (name === 'cloud-token') await cloudRefresh()
      },
      async cloudClearSecret(name) {
        dispatch({ type: 'cloud', status: await api.cloudClearSecret(name) })
        if (name === 'cloud-token') dispatch({ type: 'cloud', sessions: [] })
      },
      ui: (patch) => dispatch({ type: 'ui', patch }),
      notify,
    }),
    [api, cloudRefresh, enter, failed, notify, refresh],
  )

  useEffect(() => api.onEvent((event) => dispatch({ type: 'event', event })), [api])
  useEffect(() => {
    void refresh()
  }, [refresh])
  useEffect(() => {
    document.documentElement.dataset.theme = state.settings?.theme ?? 'ai'
  }, [state.settings?.theme])

  const value = useMemo(() => ({ state, dispatch, api, actions }), [state, api, actions])
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
