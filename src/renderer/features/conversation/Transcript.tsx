import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../../state/store'
import type { Item } from '../../state/reducer'
import { Button } from '../../ui/Button'
import { Markdown } from '../../ui/Markdown'
import { ActivityFeed, CUT_LIMIT, type ActivityItem } from './ActivityFeed'
import { EmptyState } from './EmptyState'

/** Items in the DOM at once; each "Show earlier" adds this many. */
const WINDOW = 400
/** Within this many pixels of the bottom still counts as "at the bottom". */
const PIN_SLACK = 48
const ANNOUNCE_CHARS = 1000

type MessageItem = Exclude<Item, { kind: 'activity' }>
type Block = { kind: 'feed'; key: string; items: ActivityItem[] } | { kind: 'item'; key: string; item: MessageItem }

/** Consecutive tool calls become one feed; everything else stands alone. */
function toBlocks(items: Item[]): Block[] {
  const out: Block[] = []
  let run: ActivityItem[] = []
  const flush = () => {
    if (run.length > 0) out.push({ kind: 'feed', key: `feed:${run[0].id}`, items: run })
    run = []
  }
  for (const item of items) {
    if (item.kind === 'activity') {
      run.push(item)
    } else {
      flush()
      out.push({ kind: 'item', key: item.id, item })
    }
  }
  flush()
  return out
}

/** A long message is cut at CUT_LIMIT characters until the reader asks for all of it. */
function Clamped({ text, children }: { text: string; children: (shown: string) => ReactNode }) {
  const [full, setFull] = useState(false)
  const long = text.length > CUT_LIMIT
  return (
    <>
      {children(long && !full ? text.slice(0, CUT_LIMIT) : text)}
      {long ? (
        <div className="cut">
          <span className="cut__note tabular">{full ? `${text.length.toLocaleString('en-US')} characters` : `First ${CUT_LIMIT.toLocaleString('en-US')} of ${text.length.toLocaleString('en-US')} characters`}</span>
          <Button size="sm" variant="ghost" onClick={() => setFull(!full)}>
            {full ? 'Show less' : 'Show full message'}
          </Button>
        </div>
      ) : null}
    </>
  )
}

const MessageBlock = memo(function MessageBlock({ item, live }: { item: MessageItem; live: boolean }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="msg msg--user selectable" data-item={item.id}>
          <Clamped text={item.text}>{(shown) => <p className="msg__text">{shown}</p>}</Clamped>
        </div>
      )
    case 'assistant':
      if (item.text.trim() === '' && !live) return null
      return (
        <div className="msg msg--assistant" data-item={item.id}>
          <Clamped text={item.text}>{(shown) => <Markdown text={shown} caret={live} />}</Clamped>
        </div>
      )
    case 'notice':
      return (
        <div className={`notice notice--${item.level}`} role={item.level === 'error' ? 'alert' : 'status'} data-item={item.id}>
          <span className="notice__mark" aria-hidden="true" />
          <span className="notice__text selectable">{item.message}</span>
        </div>
      )
  }
})

function lastAssistant(items: Item[], id: string): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === 'assistant' && it.id === id) return it.text
  }
  return ''
}

export function Transcript() {
  const { state } = useApp()
  const items = state.transcript
  const [extra, setExtra] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const heightBefore = useRef<number | null>(null)

  const hidden = Math.max(0, items.length - (WINDOW + extra))
  const blocks = useMemo(() => toBlocks(hidden > 0 ? items.slice(hidden) : items), [items, hidden])

  const last = items[items.length - 1]
  // Only the newest message can still be streaming; older ones just never got their flag cleared mid-turn.
  const liveId = last?.kind === 'assistant' && last.streaming ? last.id : null

  useEffect(() => {
    if (items.length === 0) setExtra(0)
  }, [items.length])

  const onScroll = () => {
    const el = scroller.current
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_SLACK
  }

  const lastUser = useRef<string | null>(null)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    // Sending a message always jumps to the bottom; streaming only follows a reader who is already there.
    if (last?.kind === 'user' && last.id !== lastUser.current) pinned.current = true
    lastUser.current = last?.kind === 'user' ? last.id : lastUser.current
    if (pinned.current) el.scrollTop = el.scrollHeight
  }, [items, last])

  // Keep the reader's place when older items are put back above them.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && heightBefore.current !== null) {
      el.scrollTop += el.scrollHeight - heightBefore.current
      heightBefore.current = null
    }
  }, [extra])

  // One polite announcement per finished answer; streaming text itself is not a live region.
  const [announce, setAnnounce] = useState('')
  const wasLive = useRef<string | null>(null)
  useEffect(() => {
    const prev = wasLive.current
    wasLive.current = liveId
    if (prev && prev !== liveId) setAnnounce(lastAssistant(items, prev).slice(0, ANNOUNCE_CHARS))
  }, [liveId, items])

  return (
    <div className="transcript" ref={scroller} onScroll={onScroll} role="log" aria-label="Conversation" aria-live="off" tabIndex={0}>
      <div className="transcript__inner">
        {hidden > 0 ? (
          <div className="transcript__earlier">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                heightBefore.current = scroller.current?.scrollHeight ?? null
                setExtra((e) => e + WINDOW)
              }}
            >
              {`Show ${hidden} earlier…`}
            </Button>
          </div>
        ) : null}
        {items.length === 0 ? <EmptyState /> : null}
        {blocks.map((b) =>
          b.kind === 'feed' ? (
            <div key={b.key} className="transcript__feed" data-item={b.items[0].id}>
              <ActivityFeed items={b.items} />
            </div>
          ) : (
            <MessageBlock key={b.key} item={b.item} live={b.item.id === liveId} />
          ),
        )}
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announce}
      </div>
    </div>
  )
}
