import { cloneElement, useEffect, useRef, type MouseEvent, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAnchor } from './useAnchor'

export interface PopoverProps {
  trigger: ReactElement<{ onClick?: (e: MouseEvent) => void }>
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  align?: 'start' | 'end'
  label?: string
}

/** A glass panel anchored to its trigger. Outside press and Escape close it; focus returns to the trigger. */
export function Popover({ trigger, open, onOpenChange, children, align = 'start', label }: PopoverProps) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const style = useAnchor(anchorRef, open, align)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (anchorRef.current?.contains(t) || panelRef.current?.contains(t)) return
      onOpenChange(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onOpenChange(false)
      anchorRef.current?.querySelector<HTMLElement>('button, [tabindex]')?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onOpenChange])

  const wired = cloneElement(trigger, {
    onClick: (e: MouseEvent) => {
      trigger.props.onClick?.(e)
      onOpenChange(!open)
    },
    'aria-expanded': open,
    'aria-haspopup': 'dialog',
  } as object)

  return (
    <>
      <span ref={anchorRef} className="popover-anchor">
        {wired}
      </span>
      {open
        ? createPortal(
            <div ref={panelRef} className="popover" role="dialog" aria-label={label} style={style}>
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
