import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { askUserTool, makeWebFetchTool, todoTool } from '../../src/main/tools/misc'
import { createRegistry } from '../../src/main/tools/registry'
import { makeFixture, type Fixture } from '../helpers/toolContext'

let fx: Fixture
beforeEach(async () => {
  fx = await makeFixture()
})
afterEach(() => fx.cleanup())

const todo = (id: string, status: 'pending' | 'in_progress' | 'completed') => ({ id, content: `task ${id}`, status })

describe('TodoWrite', () => {
  it('replaces the list and emits one todos event', async () => {
    const todos = [todo('1', 'completed'), todo('2', 'in_progress'), todo('3', 'pending')]
    const r = await todoTool.run({ todos }, fx.ctx)
    expect(r.ok).toBe(true)
    expect(fx.ctx.session.todos).toEqual(todos)
    expect(fx.events.filter((e) => e.type === 'todos')).toEqual([{ type: 'todos', todos }])
    await todoTool.run({ todos: [] }, fx.ctx)
    expect(fx.ctx.session.todos).toEqual([])
  })

  it('rejects more than one in_progress item and leaves the list alone', async () => {
    await todoTool.run({ todos: [todo('1', 'pending')] }, fx.ctx)
    const r = await todoTool.run({ todos: [todo('1', 'in_progress'), todo('2', 'in_progress')] }, fx.ctx)
    expect(r.ok).toBe(false)
    expect(r.output).toContain('in_progress')
    expect(fx.ctx.session.todos).toEqual([todo('1', 'pending')])
    expect(fx.events.filter((e) => e.type === 'todos')).toHaveLength(1)
  })

  it('the schema rejects an unknown status', async () => {
    const reg = createRegistry([todoTool])
    const r = await reg.execute({ id: 'x', name: 'TodoWrite', args: { todos: [{ id: '1', content: 'a', status: 'nope' }] } }, fx.ctx)
    expect(r.ok).toBe(false)
  })
})

describe('AskUser', () => {
  it('returns the answer and passes the options through', async () => {
    const asked: unknown[] = []
    fx.ctx.askUser = async (q) => (asked.push(q), 'Blue')
    const r = await askUserTool.run({ question: 'Which colour?', options: ['Red', 'Blue'] }, fx.ctx)
    expect(r).toEqual({ ok: true, output: 'Blue' })
    expect(asked).toEqual([{ question: 'Which colour?', options: ['Red', 'Blue'] }])
  })
})

describe('WebFetch', () => {
  const resolvePublic = async () => ['93.184.216.34']
  const html = (body: string, status = 200) =>
    new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })

  it('refuses a private address without calling fetch', async () => {
    let calls = 0
    const tool = makeWebFetchTool({ fetch: async () => (calls++, html('x')), resolve: resolvePublic })
    for (const url of ['http://127.0.0.1/', 'http://10.0.0.5/x', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/']) {
      const r = await tool.run({ url }, fx.ctx)
      expect(r.ok, url).toBe(false)
    }
    expect(calls).toBe(0)
  })

  it('refuses a redirect into a private address', async () => {
    const tool = makeWebFetchTool({
      fetch: async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }),
      resolve: resolvePublic,
    })
    const r = await tool.run({ url: 'https://example.com/' }, fx.ctx)
    expect(r.ok).toBe(false)
    expect(r.output).toContain('non-public')
  })

  it('follows a safe redirect', async () => {
    const seen: string[] = []
    const tool = makeWebFetchTool({
      fetch: async (url) => {
        seen.push(String(url))
        return seen.length === 1
          ? new Response(null, { status: 301, headers: { location: '/final' } })
          : html('<p>done</p>')
      },
      resolve: resolvePublic,
    })
    const r = await tool.run({ url: 'https://example.com/start' }, fx.ctx)
    expect(r).toEqual({ ok: true, output: 'done' })
    expect(seen).toEqual(['https://example.com/start', 'https://example.com/final'])
  })

  it('stops after 5 redirects', async () => {
    let calls = 0
    const tool = makeWebFetchTool({
      fetch: async () => (calls++, new Response(null, { status: 302, headers: { location: 'https://example.com/again' } })),
      resolve: resolvePublic,
    })
    const r = await tool.run({ url: 'https://example.com/' }, fx.ctx)
    expect(r.ok).toBe(false)
    expect(r.output).toContain('redirects')
    expect(calls).toBe(6)
  })

  it('turns HTML into text without tags, scripts or styles', async () => {
    const page = '<html><head><style>p{color:red}</style><script>alert(1)</script></head><body><h1>Title</h1><p>Hello &amp; welcome</p><ul><li>one</li><li>two</li></ul><!-- hidden --></body></html>'
    const tool = makeWebFetchTool({ fetch: async () => html(page), resolve: resolvePublic })
    const r = await tool.run({ url: 'https://example.com/' }, fx.ctx)
    expect(r.ok).toBe(true)
    expect(r.output).toBe('Title\nHello & welcome\none\ntwo')
    expect(r.output).not.toMatch(/alert|color:red|hidden|</)
  })

  it('returns plain text and JSON as they are', async () => {
    const tool = makeWebFetchTool({
      fetch: async () => new Response('{"a":1}', { headers: { 'content-type': 'application/json' } }),
      resolve: resolvePublic,
    })
    expect((await tool.run({ url: 'https://example.com/x.json' }, fx.ctx)).output).toBe('{"a":1}')
  })

  it('reports HTTP errors and unsupported content types', async () => {
    const notFound = makeWebFetchTool({ fetch: async () => html('nope', 404), resolve: resolvePublic })
    const r1 = await notFound.run({ url: 'https://example.com/' }, fx.ctx)
    expect(r1.ok).toBe(false)
    expect(r1.output).toContain('404')
    const image = makeWebFetchTool({
      fetch: async () => new Response('x', { headers: { 'content-type': 'image/png' } }),
      resolve: resolvePublic,
    })
    expect((await image.run({ url: 'https://example.com/a.png' }, fx.ctx)).ok).toBe(false)
  })

  it('cuts a body over 2 MB and says so', async () => {
    const big = 'a'.repeat(3 * 1024 * 1024)
    const tool = makeWebFetchTool({
      fetch: async () => new Response(big, { headers: { 'content-type': 'text/plain' } }),
      resolve: resolvePublic,
    })
    const r = await tool.run({ url: 'https://example.com/big.txt' }, fx.ctx)
    expect(r.ok).toBe(true)
    expect(r.output).toContain('cut at 2 MB')
    expect(r.output.length).toBeLessThan(2 * 1024 * 1024 + 200)
  })

  it('stops when the turn is aborted', async () => {
    fx.abort.abort()
    const tool = makeWebFetchTool({
      fetch: async (_u, init) => {
        if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
        return html('x')
      },
      resolve: resolvePublic,
    })
    const r = await tool.run({ url: 'https://example.com/' }, fx.ctx)
    expect(r.ok).toBe(false)
  })
})
