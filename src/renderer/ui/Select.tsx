import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { useAnchor } from './useAnchor'

export interface SelectOption<T extends string = string> {
  value: T
  label: string
  hint?: string
}

const CUSTOM = '\u0000custom'

export interface SelectProps<T extends string = string> {
  value: string
  options: SelectOption<T>[]
  onChange: (value: string) => void
  /** Adds a "Custom…" entry that takes any text, for ids the list does not know. */
  allowCustom?: boolean
  customLabel?: string
  placeholder?: string
  disabled?: boolean
  'aria-label': string
}

/** A listbox dropdown built from native pieces: keyboard first, portal popup, optional custom entry. */
export function Select<T extends string = string>({
  value,
  options,
  onChange,
  allowCustom,
  customLabel = 'Custom value',
  placeholder = 'Choose…',
  disabled,
  'aria-label': ariaLabel,
}: SelectProps<T>) {
  const listId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState(false)
  const items: SelectOption[] = [...options, ...(allowCustom ? [{ value: CUSTOM, label: 'Custom…' }] : [])]
  const selectedIndex = items.findIndex((o) => o.value === value)
  const [active, setActive] = useState(Math.max(selectedIndex, 0))
  const style = useAnchor(triggerRef, open, 'start', true)

  const known = options.find((o) => o.value === value)
  const shown = known ? known.label : value || placeholder

  const close = (refocus = false) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  const choose = (item: SelectOption) => {
    if (item.value === CUSTOM) {
      setOpen(false)
      setCustom(true)
      return
    }
    onChange(item.value)
    close(true)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || listRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setActive(Math.max(selectedIndex, 0))
        setOpen(true)
      }
      return
    }
    if (e.key === 'ArrowDown') setActive((i) => (i + 1) % items.length)
    else if (e.key === 'ArrowUp') setActive((i) => (i - 1 + items.length) % items.length)
    else if (e.key === 'Home') setActive(0)
    else if (e.key === 'End') setActive(items.length - 1)
    else if (e.key === 'Enter' || e.key === ' ') choose(items[active])
    else if (e.key === 'Escape') close(true)
    else if (e.key === 'Tab') setOpen(false)
    else return
    e.preventDefault()
  }

  if (custom) {
    const commit = (raw: string) => {
      const text = raw.trim()
      setCustom(false)
      if (text && text !== value) onChange(text)
      requestAnimationFrame(() => triggerRef.current?.focus())
    }
    return (
      <input
        className="input select__custom"
        aria-label={customLabel}
        defaultValue={known ? '' : value}
        placeholder="Type an id"
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget.value)
          else if (e.key === 'Escape') setCustom(false)
        }}
        onBlur={(e) => commit(e.currentTarget.value)}
      />
    )
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className={`select${open ? ' is-open' : ''}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        disabled={disabled}
        onClick={() => {
          setActive(Math.max(selectedIndex, 0))
          setOpen((o) => !o)
        }}
        onKeyDown={onKeyDown}
      >
        <span className="select__value">{shown}</span>
        <Icon name="chevron-down" size={16} />
      </button>
      {open
        ? createPortal(
            <ul ref={listRef} id={listId} role="listbox" aria-label={ariaLabel} className="menu" style={style}>
              {items.map((item, i) => (
                <li
                  key={item.value}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={item.value === value}
                  className={`menu__item${i === active ? ' is-active' : ''}${item.value === value ? ' is-selected' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(item)}
                >
                  <span>{item.label}</span>
                  {item.hint ? <span className="menu__hint">{item.hint}</span> : null}
                  {item.value === value ? <Icon name="check" size={15} /> : null}
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </>
  )
}
