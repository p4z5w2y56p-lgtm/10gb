import { useState } from 'react'
import type { PermissionMode } from '../../../shared/types'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { Icon } from '../../ui/Icon'
import { Popover } from '../../ui/Popover'
import { useApp } from '../../state/store'

export const MODES: Array<{ value: PermissionMode; label: string; name: string; hint: string }> = [
  { value: 'ask', label: 'ASK', name: 'Ask', hint: 'Approve every edit and every command.' },
  { value: 'auto-edit', label: 'AUTO-EDIT', name: 'Auto-edit', hint: 'Edits in the project run on their own. Commands still ask.' },
  { value: 'auto', label: 'AUTO', name: 'Auto', hint: 'Edits and commands run on their own, inside the sandbox.' },
]

/** Current permission mode. Auto always asks first. */
export function ModeChip() {
  const { state, actions } = useApp()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const mode = state.mode ?? state.settings?.permissionMode ?? 'ask'
  const current = MODES.find((m) => m.value === mode)!
  const disabled = !state.app?.hasProject

  const choose = (next: PermissionMode) => {
    setOpen(false)
    if (next === 'auto' && mode !== 'auto') setConfirming(true)
    else if (next !== mode) void actions.setMode(next)
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        align="end"
        label="Permission mode"
        trigger={
          <button type="button" disabled={disabled} aria-label={`Mode: ${current.label}`} className={`mode-chip mode-chip--${mode}`}>
            <span className="mode-chip__label">{current.label}</span>
            <Icon name="chevron-down" size={14} />
          </button>
        }
      >
        <div role="menu" aria-label="Permission mode" className="mode-menu">
          <p className="eyebrow">PERMISSIONS // MODE</p>
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="menuitemradio"
              aria-checked={m.value === mode}
              aria-label={m.name}
              aria-describedby={`mode-hint-${m.value}`}
              className={`mode-menu__item${m.value === mode ? ' is-selected' : ''}${m.value === 'auto' ? ' is-danger' : ''}`}
              onClick={() => choose(m.value)}
            >
              <span className="mode-menu__text">
                <span className="mode-menu__name">{m.name}</span>
                <span className="mode-menu__hint" id={`mode-hint-${m.value}`}>
                  {m.hint}
                </span>
              </span>
              {m.value === mode ? <Icon name="check" size={16} /> : null}
            </button>
          ))}
        </div>
      </Popover>
      <Dialog
        open={confirming}
        title="Switch to Auto mode?"
        onClose={() => setConfirming(false)}
        actions={
          <>
            <Button data-autofocus onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirming(false)
                void actions.setMode('auto')
              }}
            >
              Switch to Auto
            </Button>
          </>
        }
      >
        <p>ARC will edit files and run commands without asking. Commands run in a sandbox that only allows writes inside this project.</p>
        <p style={{ marginTop: 10 }}>Hard limits stay in place: no sudo, no deleting outside the project, no force-push.</p>
      </Dialog>
    </>
  )
}
