import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

/**
 * Fixed-position style that places a floating panel under (or above, when there is
 * no room) its anchor. Panels render in a portal, so they are positioned in
 * viewport coordinates and never clipped by a glass parent's blur or overflow.
 */
export function useAnchor(
  anchor: RefObject<HTMLElement | null>,
  open: boolean,
  align: 'start' | 'end' = 'start',
  matchWidth = false,
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', top: 0, left: 0, visibility: 'hidden' })

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const el = anchor.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const below = window.innerHeight - r.bottom
      const flip = below < 280 && r.top > below
      const next: CSSProperties = { position: 'fixed', visibility: 'visible' }
      if (flip) next.bottom = window.innerHeight - r.top + 8
      else next.top = r.bottom + 8
      if (align === 'end') next.right = Math.max(8, window.innerWidth - r.right)
      else next.left = Math.max(8, r.left)
      if (matchWidth) next.minWidth = r.width
      setStyle(next)
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor, open, align, matchWidth])

  return style
}
