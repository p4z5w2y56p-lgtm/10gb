import { describe, expect, it } from 'vitest'
import { EventLog } from '../../src/main/cloud/eventLog'
import type { AgentEvent } from '../../src/shared/types'

const note = (message: string): AgentEvent => ({ type: 'notice', level: 'info', message })
const msgs = (rows: Array<[number, AgentEvent]>) => rows.map(([, e]) => (e as { message: string }).message)

describe('EventLog', () => {
  it('numbers events from 1 and reports the current sequence', () => {
    const log = new EventLog()
    expect(log.current()).toBe(0)
    expect(log.append(note('a'))).toBe(1)
    expect(log.append(note('b'))).toBe(2)
    expect(log.current()).toBe(2)
  })

  it('replays buffered events after a given sequence, synchronously and in order', () => {
    const log = new EventLog()
    for (const m of ['a', 'b', 'c', 'd']) log.append(note(m))
    const got: Array<[number, AgentEvent]> = []
    const sub = log.subscribe(2, (seq, e) => got.push([seq, e]))
    expect(got.map(([s]) => s)).toEqual([3, 4])
    expect(msgs(got)).toEqual(['c', 'd'])
    expect(sub.gap).toBeNull()
  })

  it('replays everything for after = 0', () => {
    const log = new EventLog()
    log.append(note('a'))
    log.append(note('b'))
    const got: number[] = []
    log.subscribe(0, (s) => got.push(s))
    expect(got).toEqual([1, 2])
  })

  it('delivers live events after the replay, in order', () => {
    const log = new EventLog()
    log.append(note('a'))
    const got: Array<[number, AgentEvent]> = []
    log.subscribe(0, (seq, e) => got.push([seq, e]))
    log.append(note('b'))
    log.append(note('c'))
    expect(got.map(([s]) => s)).toEqual([1, 2, 3])
    expect(msgs(got)).toEqual(['a', 'b', 'c'])
  })

  it('does not replay anything when the subscriber is already up to date', () => {
    const log = new EventLog()
    log.append(note('a'))
    const got: number[] = []
    log.subscribe(1, (s) => got.push(s))
    log.append(note('b'))
    expect(got).toEqual([2])
  })

  it('reports a gap when the subscriber is further behind than the buffer, and replays what is left', () => {
    const log = new EventLog({ maxEvents: 3 })
    for (const m of ['a', 'b', 'c', 'd', 'e']) log.append(note(m))
    const got: number[] = []
    const sub = log.subscribe(1, (s) => got.push(s))
    expect(sub.gap).toEqual({ oldest: 3 })
    expect(got).toEqual([3, 4, 5])
  })

  it('reports no gap when the subscriber is exactly one behind the oldest buffered event', () => {
    const log = new EventLog({ maxEvents: 3 })
    for (const m of ['a', 'b', 'c', 'd', 'e']) log.append(note(m))
    const got: number[] = []
    const sub = log.subscribe(2, (s) => got.push(s))
    expect(sub.gap).toBeNull()
    expect(got).toEqual([3, 4, 5])
  })

  it('caps the buffer by event count, dropping the oldest', () => {
    const log = new EventLog({ maxEvents: 2 })
    for (const m of ['a', 'b', 'c']) log.append(note(m))
    const got: number[] = []
    log.subscribe(0, (s) => got.push(s))
    expect(got).toEqual([2, 3])
  })

  it('caps the buffer by bytes, dropping the oldest', () => {
    const big = (c: string) => note(c.repeat(400))
    const log = new EventLog({ maxBytes: 1000 })
    log.append(big('a'))
    log.append(big('b'))
    log.append(big('c'))
    const got: string[] = []
    const sub = log.subscribe(0, (_s, e) => got.push((e as { message: string }).message[0]))
    expect(got).toEqual(['b', 'c'])
    expect(sub.gap).toEqual({ oldest: 2 })
  })

  it('keeps counting sequences even when a single event is larger than the byte cap', () => {
    const log = new EventLog({ maxBytes: 100 })
    expect(log.append(note('x'.repeat(500)))).toBe(1)
    expect(log.append(note('y'))).toBe(2)
    const got: number[] = []
    log.subscribe(0, (s) => got.push(s))
    expect(got).toEqual([2])
  })

  it('stops delivering after unsubscribe', () => {
    const log = new EventLog()
    const got: number[] = []
    const sub = log.subscribe(0, (s) => got.push(s))
    log.append(note('a'))
    sub.unsubscribe()
    sub.unsubscribe()
    log.append(note('b'))
    expect(got).toEqual([1])
    expect(log.listenerCount()).toBe(0)
  })

  it('a throwing listener does not break other listeners or the append', () => {
    const log = new EventLog()
    const got: number[] = []
    log.subscribe(0, () => {
      throw new Error('boom')
    })
    log.subscribe(0, (s) => got.push(s))
    expect(() => log.append(note('a'))).not.toThrow()
    log.append(note('b'))
    expect(got).toEqual([1, 2])
  })

  it('a listener that throws during replay does not stop the replay for itself or break the subscription', () => {
    const log = new EventLog()
    log.append(note('a'))
    log.append(note('b'))
    const seen: number[] = []
    const sub = log.subscribe(0, (s) => {
      seen.push(s)
      throw new Error('boom')
    })
    log.append(note('c'))
    expect(seen).toEqual([1, 2, 3])
    sub.unsubscribe()
  })

  it('a listener may unsubscribe itself while it is being called', () => {
    const log = new EventLog()
    const got: number[] = []
    const other: number[] = []
    const sub = log.subscribe(0, (s) => {
      got.push(s)
      sub.unsubscribe()
    })
    log.subscribe(0, (s) => other.push(s))
    log.append(note('a'))
    log.append(note('b'))
    expect(got).toEqual([1])
    expect(other).toEqual([1, 2])
  })
})
