import type { HTMLAttributes } from 'react'

/** Glass surface (default) or a darker inset block (`deep`). */
export function Panel({ tone = 'glass', className, ...rest }: HTMLAttributes<HTMLDivElement> & { tone?: 'glass' | 'deep' }) {
  return <div className={['panel', tone === 'deep' ? 'panel--deep' : '', className ?? ''].filter(Boolean).join(' ')} {...rest} />
}
