import { useCallback, useEffect, useRef, useState } from 'react'
import type { Backend } from '../../main/backendApi'
import type { BackendStatus, ConnectionResult } from '../../main/backend'
import type { CloudStatus, CloudSessionInfo, CloudDiff, PushResult, PullRequestResult, CloudTestResult, CloudStartRequest } from '../../shared/cloud'
import type { Settings } from '../../main/store/settings'

/**
 * Central hook for all backend IPC calls.
 * Provides type-safe access to BackendApp methods via electron IPC.
 */
export function useBackend(): Backend | null {
  const [backend, setBackend] = useState<Backend | null>(null)

  useEffect(() => {
    // Dynamically import and initialize the preload bridge
    if (typeof window !== 'undefined' && 'arc' in window) {
      const bridge = (window as any).arc as Backend
      setBackend(bridge)
    }
  }, [])

  return backend
}

/**
 * Hook to fetch and subscribe to backend status.
 */
export function useBackendStatus() {
  const backend = useBackend()
  const [status, setStatus] = useState<BackendStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!backend) return

    const fetchStatus = async () => {
      try {
        setLoading(true)
        const result = await backend.status()
        setStatus(result)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetchStatus()

    // Poll for status changes every 2 seconds
    const interval = setInterval(fetchStatus, 2000)
    return () => clearInterval(interval)
  }, [backend])

  return { status, loading, error }
}

/**
 * Hook to fetch and cache settings.
 */
export function useSettings() {
  const backend = useBackend()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!backend) return

    const fetch = async () => {
      try {
        setLoading(true)
        const { settings } = await backend.getSettings()
        setSettings(settings)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetch()
  }, [backend])

  const save = useCallback(
    async (patch: Partial<Settings>) => {
      if (!backend) throw new Error('Backend not ready')
      try {
        const { settings } = await backend.saveSettings(patch)
        setSettings(settings)
        return settings
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        setError(message)
        throw err
      }
    },
    [backend]
  )

  return { settings, loading, error, save }
}

/**
 * Hook to manage cloud status and secrets.
 */
export function useCloudStatus() {
  const backend = useBackend()
  const [cloudStatus, setCloudStatus] = useState<CloudStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!backend) return

    const fetch = async () => {
      try {
        setLoading(true)
        const status = await backend.cloudStatus()
        setCloudStatus(status)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetch()

    // Poll for cloud status changes
    const interval = setInterval(fetch, 3000)
    return () => clearInterval(interval)
  }, [backend])

  const setSecret = useCallback(
    async (name: 'cloud-token' | 'github-token', value: string) => {
      if (!backend) throw new Error('Backend not ready')
      try {
        const status = await backend.cloudSetSecret(name, value)
        setCloudStatus(status)
        return status
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        setError(message)
        throw err
      }
    },
    [backend]
  )

  const clearSecret = useCallback(
    async (name: 'cloud-token' | 'github-token') => {
      if (!backend) throw new Error('Backend not ready')
      try {
        const status = await backend.cloudClearSecret(name)
        setCloudStatus(status)
        return status
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        setError(message)
        throw err
      }
    },
    [backend]
  )

  return { cloudStatus, loading, error, setSecret, clearSecret }
}

/**
 * Hook to test cloud connectivity.
 */
export function useCloudTest() {
  const backend = useBackend()
  const [results, setResults] = useState<CloudTestResult[] | null>(null)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const test = useCallback(async () => {
    if (!backend) throw new Error('Backend not ready')
    try {
      setTesting(true)
      setError(null)
      const res = await backend.cloudTest()
      setResults(res)
      return res
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(message)
      throw err
    } finally {
      setTesting(false)
    }
  }, [backend])

  return { results, testing, error, test }
}

/**
 * Hook to manage cloud sessions.
 */
export function useCloudSessions() {
  const backend = useBackend()
  const [sessions, setSessions] = useState<CloudSessionInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!backend) return

    const fetch = async () => {
      try {
        setLoading(true)
        const list = await backend.cloudSessions()
        setSessions(list)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetch()

    // Poll for session changes
    const interval = setInterval(fetch, 2000)
    return () => clearInterval(interval)
  }, [backend])

  const start = useCallback(
    async (req: CloudStartRequest) => {
      if (!backend) throw new Error('Backend not ready')
      try {
        const result = await backend.cloudStart(req)
        const list = await backend.cloudSessions()
        setSessions(list)
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        setError(message)
        throw err
      }
    },
    [backend]
  )

  const attach = useCallback(
    async (id: string) => {
      if (!backend) throw new Error('Backend not ready')
      try {
        return await backend.cloudAttach(id)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        setError(message)
        throw err
      }
    },
    [backend]
  )

  const end = useCallback(
    async (id: string) => {
      if (!backend) throw new Error('Backend not ready')
      try {
        await backend.cloudEnd(id)
        const list = await backend.cloudSessions()
        setSessions(list)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        setError(message)
        throw err
      }
    },
    [backend]
  )

  return { sessions, loading, error, start, attach, end }
}

/**
 * Hook to manage the active cloud session's diff and push.
 */
export function useCloudSession() {
  const backend = useBackend()
  const [diff, setDiff] = useState<CloudDiff | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)

  const fetchDiff = useCallback(async () => {
    if (!backend) throw new Error('Backend not ready')
    try {
      setDiffLoading(true)
      const d = await backend.cloudDiff()
      setDiff(d)
      setDiffError(null)
      return d
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setDiffError(message)
      throw err
    } finally {
      setDiffLoading(false)
    }
  }, [backend])

  const push = useCallback(async (): Promise<PushResult> => {
    if (!backend) throw new Error('Backend not ready')
    try {
      return await backend.cloudPush()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setDiffError(message)
      throw err
    }
  }, [backend])

  const openPr = useCallback(
    async (title: string, body?: string, draft?: boolean): Promise<PullRequestResult> => {
      if (!backend) throw new Error('Backend not ready')
      try {
        return await backend.cloudPr({ title, body, draft })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        setDiffError(message)
        throw err
      }
    },
    [backend]
  )

  return { diff, diffLoading, diffError, fetchDiff, push, openPr }
}

/**
 * Hook for agent interaction: send message, stop, etc.
 */
export function useAgent() {
  const backend = useBackend()
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = useCallback(
    async (text: string) => {
      if (!backend) throw new Error('Backend not ready')
      try {
        setSending(true)
        setError(null)
        const result = await backend.send(text)
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        setError(message)
        throw err
      } finally {
        setSending(false)
      }
    },
    [backend]
  )

  const stop = useCallback(async () => {
    if (!backend) throw new Error('Backend not ready')
    try {
      await backend.stop()
      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(message)
      throw err
    }
  }, [backend])

  return { sending, error, send, stop }
}
