import { useState } from 'react'
import { progressOf } from '../../../main/agent/narrate'
import { Popover } from '../../ui/Popover'
import { ProgressBar } from '../../ui/ProgressBar'
import { useApp } from '../../state/store'
import { PlanPopover } from './PlanPopover'

/** One line of plain language: what the bot is doing right now, with the plan's progress underneath. */
export function ProgressPill() {
  const { state } = useApp()
  const [open, setOpen] = useState(false)
  const { done, total } = progressOf(state.todos)
  const active = state.status.state !== 'idle'
  const waiting = state.status.state === 'waiting-approval' || state.status.state === 'waiting-answer'
  const label = active ? state.status.label : 'All systems nominal'

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Plan"
      trigger={
        <button type="button" className={`pill${active ? ' pill--active' : ''}${waiting ? ' pill--waiting' : ''}`}>
          <span className="pill__row">
            {active ? <span className="dot pill__dot" aria-hidden="true" /> : <span className="pill__idle" aria-hidden="true" />}
            <span className="pill__label">{label}</span>
            {total > 0 ? <span className="pill__count tabular">{`${done} of ${total}`}</span> : null}
          </span>
          {total > 0 ? <ProgressBar value={done} max={total} label="Plan progress" /> : null}
        </button>
      }
    >
      <PlanPopover todos={state.todos} />
    </Popover>
  )
}
