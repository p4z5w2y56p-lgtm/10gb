import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import type { Tone } from './Badge'

export interface ToastInput {
  tone?: Tone
  text: string
}

interface ToastItem extends ToastInput {
  id: number
}

interface ToastApi {
  push(toast: ToastInput): void
  dismiss(id: number): void
}

const ToastContext = createContext<ToastApi | null>(null)

const LIFETIME_MS = 4000

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast must be used inside <ToastProvider>')
  return api
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const next = useRef(1)

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.delete(id)
    setToasts((list) => list.filter((x) => x.id !== id))
  }, [])

  const push = useCallback(
    (toast: ToastInput) => {
      const id = next.current++
      setToasts((list) => [...list, { ...toast, id }].slice(-4))
      timers.current.set(id, setTimeout(() => dismiss(id), LIFETIME_MS))
    },
    [dismiss],
  )

  useEffect(() => {
    const live = timers.current
    return () => {
      for (const t of live.values()) clearTimeout(t)
    }
  }, [])

  const api = useMemo(() => ({ push, dismiss }), [push, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-host" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone ?? 'neutral'}`}>
            <span className="toast__dot" aria-hidden="true" />
            <span className="toast__text">{t.text}</span>
            <button type="button" className="toast__close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
