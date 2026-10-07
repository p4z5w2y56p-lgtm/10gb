import { memo, useEffect, useId, useState } from 'react'
import { groupActivities } from '../../../main/agent/narrate'
import { redact } from '../../../main/safety/redact'
import type { ToolCall } from '../../../shared/types'
import { Button } from '../../ui/Button'
import { Icon, type IconName } from '../../ui/Icon'
import { useApp } from '../../state/store'
import type { ActivityState, Item } from '../../state/reducer'

export type ActivityItem = Extract<Item, { kind: 'activity' }>

/** Raw output and diffs are cut here until the reader asks for the rest. */
export const CUT_LIMIT = 20_000

const STATE_ICON: Record<Exclude<ActivityState, 'running'>, IconName> = { done: 'check', failed: 'x', denied: 'shield' }
const STATE_WORD: Record<ActivityState, string> = { running: 'Running', done: 'Done', failed: 'Failed', denied: 'Skipped' }

/** Arguments that only repeat what the diff already shows. */
const BULKY_ARGS = new Set(['content', 'old_string', 'new_string', 'new_str', 'old_str'])

export function looksLikeDiff(text: string): boolean {
  return /^--- .+\n\+\+\+ /m.test(text) || /^@@ .* @@/m.test(text)
}

/** Show the first CUT_LIMIT characters, with a control for the rest. */
function useCut(text: string): { shown: string; hidden: number; showAll: () => void } {
  const [all, setAll] = useState(false)
  const cut = !all && text.length > CUT_LIMIT
  return { shown: cut ? text.slice(0, CUT_LIMIT) : text, hidden: cut ? text.length - CUT_LIMIT : 0, showAll: () => setAll(true) }
}

function CutNote({ hidden, onAll }: { hidden: number; onAll: () => void }) {
  if (hidden <= 0) return null
  return (
    <div className="cut">
      <span className="cut__note tabular">{`${hidden.toLocaleString('en-US')} more characters`}</span>
      <Button size="sm" variant="ghost" onClick={onAll}>
        Show all
      </Button>
    </div>
  )
}

function lineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'diff__line--meta'
  if (line.startsWith('@@')) return 'diff__line--hunk'
  if (line.startsWith('+')) return 'diff__line--add'
  if (line.startsWith('-')) return 'diff__line--del'
  return 'diff__line--ctx'
}

/** A unified diff, one line per row, added and removed lines tinted. Plain text only. */
export function DiffView({ text, label = 'Changes' }: { text: string; label?: string }) {
  const { shown, hidden, showAll } = useCut(redact(text))
  const lines = shown.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return (
    <div className="diff" role="group" aria-label={label}>
      {lines.map((line, i) => (
        <div key={i} className={`diff__line ${lineClass(line)}`}>
          {line}
        </div>
      ))}
      <CutNote hidden={hidden} onAll={showAll} />
    </div>
  )
}

function Output({ text }: { text: string }) {
  const { shown, hidden, showAll } = useCut(redact(text))
  return (
    <div>
      <pre className="activity__output selectable">{shown}</pre>
      <CutNote hidden={hidden} onAll={showAll} />
    </div>
  )
}

/** Arguments for the Details view: short values only, nothing the diff already carries. */
export function describeArgs(call: ToolCall): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const [key, value] of Object.entries(call.args)) {
    if (BULKY_ARGS.has(key) || value === undefined || value === null) continue
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    const clean = redact(text)
    out.push([key, clean.length > 400 ? `${clean.slice(0, 399)}…` : clean])
  }
  return out
}

function Node({ state }: { state: ActivityState }) {
  return (
    <span className="activity__node" aria-hidden="true">
      {state === 'running' ? <span className="spinner" /> : <Icon name={STATE_ICON[state]} size={13} />}
    </span>
  )
}

/** Whether Details is open: the global flag, flipped for rows the reader clicked since it last changed. */
function useDetails(): { open: boolean; toggle: () => void } {
  const { state } = useApp()
  const global = state.ui.showDetails
  const [flipped, setFlipped] = useState(false)
  useEffect(() => setFlipped(false), [global])
  return { open: global !== flipped, toggle: () => setFlipped((f) => !f) }
}

function Details({ item }: { item: ActivityItem }) {
  const args = item.call ? describeArgs(item.call) : []
  const diff = item.diff ?? (item.output !== undefined && looksLikeDiff(item.output) ? item.output : undefined)
  // A diff-shaped result is shown as the diff, never twice.
  const output = item.output !== undefined && !looksLikeDiff(item.output) ? item.output : undefined
  return (
    <div className="activity__details">
      {args.length > 0 ? (
        <dl className="activity__args selectable">
          {args.map(([k, v]) => (
            <div key={k} className="activity__arg">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {diff !== undefined ? <DiffView text={diff} /> : null}
      {output !== undefined && output !== '' ? <Output text={output} /> : null}
    </div>
  )
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const { open, toggle } = useDetails()
  const panelId = useId()
  const hasDetails = item.call !== undefined || item.output !== undefined || item.diff !== undefined
  const body = (
    <>
      <Node state={item.state} />
      <span className="activity__label">{item.label}</span>
      <span className="sr-only">{STATE_WORD[item.state]}</span>
      {hasDetails ? <Icon name="chevron-right" size={14} className={`activity__chev${open ? ' is-open' : ''}`} /> : null}
    </>
  )
  return (
    <li className="activity__item" data-state={item.state}>
      {hasDetails ? (
        <button type="button" className="activity__row" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={toggle}>
          {body}
        </button>
      ) : (
        <div className="activity__row">{body}</div>
      )}
      {open && hasDetails ? (
        <div id={panelId}>
          <Details item={item} />
        </div>
      ) : null}
    </li>
  )
}

function aggregate(items: ActivityItem[]): ActivityState {
  if (items.some((i) => i.state === 'running')) return 'running'
  if (items.some((i) => i.state === 'failed')) return 'failed'
  if (items.every((i) => i.state === 'denied')) return 'denied'
  return 'done'
}

function ActivityGroup({ label, items }: { label: string; items: ActivityItem[] }) {
  const { open: expanded, toggle } = useDetails()
  const listId = useId()
  const agg = aggregate(items)
  return (
    <li className="activity__item activity__item--group" data-state={agg}>
      <button type="button" className="activity__row" aria-expanded={expanded} aria-controls={expanded ? listId : undefined} onClick={toggle}>
        <Node state={agg} />
        <span className="activity__label">{label}</span>
        <span className="sr-only">{STATE_WORD[agg]}</span>
        <Icon name="chevron-right" size={14} className={`activity__chev${expanded ? ' is-open' : ''}`} />
      </button>
      {expanded ? (
        <ul className="activity__sub" id={listId}>
          {items.map((i) => (
            <ActivityRow key={i.id} item={i} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/** Consecutive reads and searches become one line; every line is calm and one row tall. */
function ActivityFeedView({ items }: { items: ActivityItem[] }) {
  const byId = new Map(items.map((i) => [i.id, i]))
  const groups = groupActivities(items.map((i) => ({ id: i.id, phase: i.phase, label: i.label })))
  return (
    <ul className="activity" aria-label="Activity">
      {groups.map((g) => {
        const members = g.ids.flatMap((id) => byId.get(id) ?? [])
        return members.length > 1 ? <ActivityGroup key={g.ids[0]} label={g.label} items={members} /> : <ActivityRow key={g.ids[0]} item={members[0]} />
      })}
    </ul>
  )
}

const sameItems = (a: { items: ActivityItem[] }, b: { items: ActivityItem[] }) => a.items.length === b.items.length && a.items.every((x, i) => x === b.items[i])

export const ActivityFeed = memo(ActivityFeedView, sameItems)
