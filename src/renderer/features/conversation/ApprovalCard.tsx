import { useEffect, useId, useRef, useState } from 'react'
import type { ApprovalRequest } from '../../../shared/types'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { Kbd } from '../../ui/Kbd'
import { baseName } from '../../ui/format'
import { useApp } from '../../state/store'
import { DiffView } from './ActivityFeed'

type Decision = 'allow-once' | 'always' | 'deny'

/** Tools for which "always allow" saves a rule (mirrors the agent loop; reads never get one). */
const STANDING_RULE_TOOLS = new Set(['Bash', 'Edit', 'Write', 'WebFetch'])

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function hostOf(url: string): string {
  try {
    return new URL(url).hostname || url
  } catch {
    return url
  }
}

/** Plain-language question, and the one line of detail (exact command, path or address) the reader should check. */
export function describeApproval(req: ApprovalRequest): { heading: string; target: string; kind: 'command' | 'path' | 'url' | 'none' } {
  const { name, args } = req.call
  const path = str(args.file_path) || str(args.path)
  switch (name) {
    case 'Bash':
      return { heading: 'Run this command?', target: str(args.command), kind: 'command' }
    case 'Edit':
      return { heading: `Edit ${baseName(path) || 'a file'}?`, target: path, kind: 'path' }
    case 'Write':
      return { heading: `Create ${baseName(path) || 'a file'}?`, target: path, kind: 'path' }
    case 'Read':
      return { heading: 'Read outside the project?', target: path, kind: 'path' }
    case 'LS':
    case 'Glob':
    case 'Grep':
      return { heading: 'Look outside the project?', target: path, kind: path ? 'path' : 'none' }
    case 'WebFetch': {
      const url = str(args.url)
      return { heading: `Fetch ${url ? hostOf(url) : 'a web page'}?`, target: url, kind: url ? 'url' : 'none' }
    }
    default:
      return { heading: `Allow ${name}?`, target: '', kind: 'none' }
  }
}

/** Keys that belong to a text field are never answers. */
function typingTarget(t: EventTarget | null): boolean {
  return t instanceof Element && t.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null
}

export function ApprovalCard() {
  const { state, actions } = useApp()
  const req = state.approval
  // Compared by identity: models reuse call ids, but every request is a new object.
  const [decided, setDecided] = useState<ApprovalRequest | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const headingId = useId()
  const reasonId = useId()
  const diffId = useId()
  const overlayOpen = state.ui.settingsOpen || state.ui.paletteOpen || state.ui.shortcutsOpen
  const canAlways = req ? STANDING_RULE_TOOLS.has(req.call.name) : false
  // The key handler is subscribed once; it reads the latest values from here.
  const live = useRef({ req, decided, canAlways, blocked: overlayOpen, actions })
  live.current = { req, decided, canAlways, blocked: overlayOpen, actions }

  const decide = (decision: Decision) => {
    const cur = live.current
    if (!cur.req || cur.decided === cur.req) return
    live.current = { ...cur, decided: cur.req }
    setDecided(cur.req)
    void cur.actions.approve(decision)
  }
  const decideRef = useRef(decide)
  decideRef.current = decide

  useEffect(() => setShowDiff(false), [req])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cur = live.current
      if (!cur.req || e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      if (typingTarget(e.target) || cur.blocked) return
      const key = e.key.toLowerCase()
      const decision: Decision | null = key === 'y' ? 'allow-once' : key === 'a' && cur.canAlways ? 'always' : key === 'n' ? 'deny' : null
      if (!decision) return
      e.preventDefault()
      decideRef.current(decision)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!req) return null
  const { heading, target, kind } = describeApproval(req)
  const locked = decided === req

  return (
    <section className="approval" role="alertdialog" aria-labelledby={headingId} aria-describedby={reasonId} data-locked={locked || undefined}>
      <div className="approval__head">
        <span className="approval__mark" aria-hidden="true">
          <Icon name="shield" size={16} />
        </span>
        <div className="approval__text">
          <p className="eyebrow">ARC // APPROVAL</p>
          <h2 className="approval__title" id={headingId}>
            {heading}
          </h2>
          <p className="approval__reason" id={reasonId}>
            {req.reason}
          </p>
        </div>
      </div>

      {target ? (
        <div className={`approval__target approval__target--${kind} selectable`}>
          {kind === 'command' ? <span className="approval__prompt" aria-hidden="true">$</span> : null}
          <code className="approval__code">{target}</code>
        </div>
      ) : null}

      {req.diff ? (
        <div className="approval__changes">
          <Button size="sm" variant="ghost" icon={showDiff ? 'chevron-down' : 'chevron-right'} aria-expanded={showDiff} aria-controls={showDiff ? diffId : undefined} onClick={() => setShowDiff(!showDiff)}>
            View changes
          </Button>
          {showDiff ? (
            <div id={diffId}>
              <DiffView text={req.diff} />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="approval__actions">
        <Button variant="primary" disabled={locked} aria-keyshortcuts="y" onClick={() => decide('allow-once')}>
          Allow once
          <Kbd>Y</Kbd>
        </Button>
        {canAlways ? (
          <Button variant="outline" disabled={locked} aria-keyshortcuts="a" onClick={() => decide('always')}>
            Always allow this
            <Kbd>A</Kbd>
          </Button>
        ) : null}
        <Button variant="ghost" disabled={locked} aria-keyshortcuts="n" onClick={() => decide('deny')}>
          Deny
          <Kbd>N</Kbd>
        </Button>
      </div>
    </section>
  )
}
