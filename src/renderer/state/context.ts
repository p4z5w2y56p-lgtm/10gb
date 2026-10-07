import { createContext, useContext, ReactNode, useEffect, useState } from 'react'
import type { AgentEvent } from '../../shared/types'
import type { BackendStatus } from '../../main/backend'

interface AppContextType {
  events: AgentEvent[]
  lastEvent: AgentEvent | null
  status: BackendStatus | null
  isReady: boolean
}

const AppContext = createContext<AppContextType | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [lastEvent, setLastEvent] = useState<AgentEvent | null>(null)
  const [status, setStatus] = useState<BackendStatus | null>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    // Listen for events from the main process
    if (typeof window !== 'undefined' && 'arc' in window) {
      const bridge = (window as any).arc
      if (bridge.onEvent) {
        const unsubscribe = bridge.onEvent((event: AgentEvent) => {
          setEvents((prev) => [...prev, event])
          setLastEvent(event)
          if (event.type === 'status') {
            setStatus((prev) => (prev ? { ...prev, busy: true } : null))
          }
        })
        setIsReady(true)
        return () => unsubscribe?.()
      }
    }
  }, [])

  return (
    <AppContext.Provider value={{ events, lastEvent, status, isReady }}>
      {children}
    </AppContext.Provider>
  )
}

export function useAppContext() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppContext must be used within AppProvider')
  return ctx
}
