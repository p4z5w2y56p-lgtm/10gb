import { useRef, type KeyboardEvent } from 'react'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  tone?: 'danger'
}

/** A radio group drawn as a pill. Arrow keys, Home and End move the selection. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  'aria-label': ariaLabel,
}: {
  value: T
  options: SegmentedOption<T>[]
  onChange: (value: T) => void
  'aria-label': string
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  const move = (index: number) => {
    const next = options[(index + options.length) % options.length]
    onChange(next.value)
    refs.current[(index + options.length) % options.length]?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(index + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(index - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(options.length - 1)
    else return
    e.preventDefault()
  }

  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o, i) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={`segmented__item${selected ? ' is-selected' : ''}${o.tone === 'danger' ? ' is-danger' : ''}`}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
