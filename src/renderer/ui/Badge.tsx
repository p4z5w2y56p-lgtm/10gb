import type { ReactNode } from 'react'

export type Tone = 'neutral' | 'signal' | 'success' | 'warning' | 'danger'

/** Small mono status chip, with an optional pulsing dot for anything live. */
export function Badge({ tone = 'neutral', dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`badge badge--${tone}`}>
      {dot ? <span className="dot" aria-hidden="true" /> : null}
      {children}
    </span>
  )
}
