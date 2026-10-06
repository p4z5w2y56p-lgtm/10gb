import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createRegistry, truncate, type Tool } from '../../src/main/tools/registry'
import { makeFixture, type Fixture } from '../helpers/toolContext'

let fx: Fixture
beforeEach(async () => {
  fx = await makeFixture()
})
afterEach(() => fx.cleanup())

const echoTool: Tool<{ text: string; times?: number }> = {
  name: 'Read',
  description: 'Echo text back.',
  schema: z.object({ text: z.string().describe('what to echo'), times: z.number().int().min(1).optional() }),
  run: async (args) => ({ ok: true, output: args.text.repeat(args.times ?? 1) }),
}

function deepKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => deepKeys(v, out))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k)
      deepKeys(v, out)
    }
  }
  return out
}

describe('createRegistry', () => {
  it('declares every tool in Gemini form without $schema or additionalProperties', () => {
    const reg = createRegistry([echoTool])
    const decls = reg.declarations()
    expect(decls).toHaveLength(1)
    expect(decls[0].name).toBe('Read')
    expect(decls[0].description).toBe('Echo text back.')
    const keys = deepKeys(decls[0].parameters)
    expect(keys.has('$schema')).toBe(false)
    expect(keys.has('additionalProperties')).toBe(false)
    expect(decls[0].parameters).toMatchObject({ type: 'object', required: ['text'] })
  })

  it('refuses duplicate tool names', () => {
    expect(() => createRegistry([echoTool, echoTool])).toThrow(/duplicate/i)
  })

  it('executes a tool with valid args', async () => {
    const reg = createRegistry([echoTool])
    const r = await reg.execute({ id: '1', name: 'Read', args: { text: 'ab', times: 2 } }, fx.ctx)
    expect(r).toEqual({ ok: true, output: 'abab' })
  })

  it('returns ok:false naming the bad field instead of throwing', async () => {
    const reg = createRegistry([echoTool])
    const r = await reg.execute({ id: '1', name: 'Read', args: { times: 'x' } }, fx.ctx)
    expect(r.ok).toBe(false)
    expect(r.output).toContain('text')
  })

  it('returns ok:false for an unknown tool', async () => {
    const reg = createRegistry([echoTool])
    const r = await reg.execute({ id: '1', name: 'Nope', args: {} }, fx.ctx)
    expect(r.ok).toBe(false)
    expect(r.output).toContain('Nope')
  })

  it('turns a throwing tool into ok:false', async () => {
    const boom: Tool<{}> = { ...echoTool, schema: z.object({}), run: async () => { throw new Error('kaput') } }
    const r = await createRegistry([boom]).execute({ id: '1', name: 'Read', args: {} }, fx.ctx)
    expect(r.ok).toBe(false)
    expect(r.output).toContain('kaput')
  })

  it('truncates output to 30,000 chars with a marker', async () => {
    const big: Tool<{}> = { ...echoTool, schema: z.object({}), run: async () => ({ ok: true, output: 'x'.repeat(40_000) }) }
    const r = await createRegistry([big]).execute({ id: '1', name: 'Read', args: {} }, fx.ctx)
    expect(r.output.startsWith('x'.repeat(30_000))).toBe(true)
    expect(r.output).toContain('[truncated 10000 chars]')
    expect(r.output.length).toBeLessThan(30_100)
  })
})

describe('truncate', () => {
  it('leaves short text alone', () => {
    expect(truncate('hello')).toBe('hello')
  })
  it('honours a custom cap', () => {
    expect(truncate('abcdef', 3)).toBe('abc\n[truncated 3 chars]')
  })
})
