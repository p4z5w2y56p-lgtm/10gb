import { describe, expect, it } from 'vitest'
import { compact, shouldCompact } from '../../src/main/agent/compaction'
import type { Content, GenerateRequest } from '../../src/main/vertex/types'

const user = (text: string): Content => ({ role: 'user', parts: [{ text }] })
const model = (text: string): Content => ({ role: 'model', parts: [{ text }] })
const call = (name: string, id: string): Content => ({ role: 'model', parts: [{ functionCall: { name, args: { file_path: 'a.ts' }, id } }] })
const result = (name: string, id: string, output: string): Content => ({
  role: 'user',
  parts: [{ functionResponse: { name, id, response: { output } } }],
})

function fakeVertex(summary = 'SUMMARY TEXT') {
  const requests: GenerateRequest[] = []
  return {
    requests,
    streamGenerate: async (req: GenerateRequest) => {
      requests.push(req)
      return { parts: [{ text: summary }] }
    },
  }
}

const turns = (n: number): Content[] =>
  Array.from({ length: n }, (_, i) => [user(`question ${i + 1}`), model(`answer ${i + 1}`)]).flat()

describe('shouldCompact', () => {
  it('triggers at 85% of the window and not before', () => {
    expect(shouldCompact(849_999, 1_000_000)).toBe(false)
    expect(shouldCompact(850_000, 1_000_000)).toBe(true)
    expect(shouldCompact(1_000_000, 1_000_000)).toBe(true)
  })
})

describe('compact', () => {
  it('returns short histories unchanged without calling the model', async () => {
    const v = fakeVertex()
    const h = turns(4)
    expect(await compact(v, h)).toEqual(h)
    expect(v.requests).toHaveLength(0)
  })

  it('summarizes older turns and keeps the last 4 user turns verbatim', async () => {
    const v = fakeVertex()
    const h = turns(6)
    const out = await compact(v, h)
    // 4 kept turns = 8 messages, same count: the summary rides on the first kept user message
    expect(out).toHaveLength(8)
    expect(out[0].role).toBe('user')
    expect(out[0].parts[0].text).toBe('Summary of earlier conversation:\nSUMMARY TEXT')
    expect(out[0].parts[1]).toEqual({ text: 'question 3' })
    expect(out.slice(1)).toEqual(h.slice(5))
    // the model only saw the older turns
    const sent = JSON.stringify(v.requests[0].contents)
    expect(sent).toContain('question 1')
    expect(sent).toContain('answer 2')
    expect(sent).not.toContain('question 3')
  })

  it('does not mutate the input history', async () => {
    const h = turns(6)
    const copy = JSON.parse(JSON.stringify(h))
    await compact(fakeVertex(), h)
    expect(h).toEqual(copy)
  })

  it('honours keepLastTurns', async () => {
    const out = await compact(fakeVertex(), turns(6), 1)
    expect(out).toHaveLength(2)
    expect(out[0].parts[1]).toEqual({ text: 'question 6' })
  })

  it('never splits a functionCall from its functionResponse', async () => {
    const h: Content[] = [
      user('q1'), call('Read', 'a'), result('Read', 'a', 'file text'), model('done 1'),
      user('q2'), call('Grep', 'b'), result('Grep', 'b', 'matches'), model('done 2'),
      user('q3'), model('a3'),
      user('q4'), model('a4'),
      user('q5'), call('Edit', 'c'), result('Edit', 'c', 'ok'), model('done 5'),
    ]
    const out = await compact(fakeVertex(), h, 3)
    expect(out[0].role).toBe('user')
    expect(out[0].parts.some((p) => p.text && !p.text.startsWith('Summary'))).toBe(true)
    const calls = new Set<string>()
    for (const m of out) {
      for (const p of m.parts) {
        if (p.functionCall?.id) calls.add(p.functionCall.id)
        if (p.functionResponse?.id) expect(calls.has(p.functionResponse.id)).toBe(true)
      }
    }
    expect(out.slice(-4)).toEqual(h.slice(-4))
  })

  it('gives the summarizer a transcript with tool calls and truncated tool output', async () => {
    const v = fakeVertex()
    const h: Content[] = [
      user('q1'), call('Read', 'a'), result('Read', 'a', 'z'.repeat(5000)), model('done 1'),
      ...turns(4),
    ]
    await compact(v, h)
    const sent = v.requests[0].contents[0].parts[0].text!
    expect(sent).toContain('Read')
    expect(sent.length).toBeLessThan(2000)
  })

  it('propagates a summarizer failure', async () => {
    const v = { streamGenerate: async () => { throw new Error('boom') } }
    await expect(compact(v, turns(6))).rejects.toThrow('boom')
  })
})
