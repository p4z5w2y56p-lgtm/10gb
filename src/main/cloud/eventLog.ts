import type { AgentEvent } from '../../shared/types'

export interface EventLogOptions {
  maxEvents?: number
  maxBytes?: number
}

export type EventListener = (seq: number, event: AgentEvent) => void

export interface Subscription {
  unsubscribe(): void
  /** Set when the subscriber missed events the buffer no longer holds: it must reload the history. */
  gap: { oldest: number } | null
}

interface Entry {
  seq: number
  event: AgentEvent
  bytes: number
}

/** Bounded, numbered event buffer for one session: replay for reconnecting clients, then live delivery. */
export class EventLog {
  private entries: Entry[] = []
  private bytes = 0
  private seq = 0
  private readonly listeners = new Set<EventListener>()
  private readonly maxEvents: number
  private readonly maxBytes: number

  constructor(opts: EventLogOptions = {}) {
    this.maxEvents = opts.maxEvents ?? 10_000
    this.maxBytes = opts.maxBytes ?? 8 * 1024 * 1024
  }

  append(event: AgentEvent): number {
    const seq = ++this.seq
    const bytes = Buffer.byteLength(JSON.stringify(event))
    this.entries.push({ seq, event, bytes })
    this.bytes += bytes
    while (this.entries.length > this.maxEvents || this.bytes > this.maxBytes) {
      const dropped = this.entries.shift()
      if (!dropped) break
      this.bytes -= dropped.bytes
    }
    for (const listener of [...this.listeners]) {
      if (!this.listeners.has(listener)) continue
      this.call(listener, seq, event)
    }
    return seq
  }

  subscribe(after: number, listener: EventListener): Subscription {
    const oldest = this.entries[0]?.seq ?? this.seq + 1
    const gap = after < oldest - 1 ? { oldest } : null
    for (const entry of [...this.entries]) {
      if (entry.seq > after) this.call(listener, entry.seq, entry.event)
    }
    this.listeners.add(listener)
    return {
      gap,
      unsubscribe: () => {
        this.listeners.delete(listener)
      },
    }
  }

  current(): number {
    return this.seq
  }

  listenerCount(): number {
    return this.listeners.size
  }

  private call(listener: EventListener, seq: number, event: AgentEvent): void {
    try {
      listener(seq, event)
    } catch {
      // one broken subscriber must not affect the others
    }
  }
}
