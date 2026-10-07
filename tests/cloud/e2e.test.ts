import { readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/types'
import { chunk, type FakeEntry } from '../helpers/fakeVertexServer'
import {
  ALL_SECRETS,
  GITHUB_TOKEN,
  VERTEX_KEY,
  WORKER_TOKEN,
  createStack,
  filesContaining,
  git,
  noticeTexts,
  ofType,
  seedBare,
  waitFor,
  type Desktop,
  type Stack,
} from './helpers/e2eStack'

/**
 * End to end, one process, nothing in the middle mocked: BackendRouter + BackendApp (the desktop) -> CloudClient
 * -> real HTTP/SSE -> createWorkerServer -> CloudWorker -> real git (CliGitOps) against a local bare repository and
 * RestGithubApi against a local fake GitHub -> BackendApp (the agent) -> VertexClient against the fake Vertex.
 *
 * Findings from running this file against the real stack are marked `BUG:` next to the `it.fails` / `it.skip`.
 */

const text = (t: string): FakeEntry => ({ chunks: [chunk([{ text: t }], {}, 'STOP')] })
const call = (name: string, args: Record<string, unknown>, id: string): FakeEntry => ({
  chunks: [chunk([{ functionCall: { name, args, id } }], {}, 'STOP')],
})

let stack: Stack | null = null
afterEach(async () => {
  await stack?.close()
  stack = null
})

const savedNotices = (d: Desktop) => noticeTexts(d.events).filter((m) => m.startsWith('Saved to GitHub'))
const turnEnds = (d: Desktop) => ofType(d.events, 'turn-end').length
const json = (v: unknown) => JSON.stringify(v)

/** Send a prompt through the router and wait for the turn to end. */
async function runTurn(d: Desktop, prompt: string): Promise<void> {
  const before = turnEnds(d)
  expect(await d.router.send(prompt)).toBe('started')
  await waitFor(() => turnEnds(d) > before, `turn-end after "${prompt}"`)
}

/** Wait until the worker has finished an auto-push (success notice) or refused it (warn notice). */
async function autoPushOutcome(d: Desktop, since = 0): Promise<string> {
  let found = ''
  await waitFor(() => {
    const hit = noticeTexts(d.events).slice(since).find((m) => m.startsWith('Saved to GitHub') || m.startsWith('Could not save to GitHub'))
    if (hit) found = hit
    return Boolean(hit)
  }, 'auto-push notice')
  return found
}

const repoDir = (s: Stack, id: string) => join(s.dataDir, 'work', id, 'repo')
const branches = (s: Stack, owner = 'octo', name = 'hello') =>
  git(s.barePath(owner, name), 'for-each-ref', '--format=%(refname:short)', 'refs/heads/arc').split('\n').filter(Boolean)

describe('ARC Cloud end to end (real router, client, server, worker, git; fake GitHub and Vertex)', () => {
  // ------------------------------------------------------------------ 1
  it('runs a turn: Write + Bash events reach the renderer in order and auto-push lands an arc/ branch', async () => {
    stack = await createStack({
      script: [
        call('Write', { file_path: 'hello.txt', content: 'hi from the cloud\n' }, 'w1'),
        call('Bash', { command: 'echo built > built.txt && ls' }, 'b1'),
        text('All done.'),
      ],
    })
    const mainBefore = git(stack.barePath('octo', 'hello'), 'rev-parse', 'main')
    const d = await stack.desktop()

    const opened = await d.router.cloudStart({ repo: 'octo/hello', name: 'e2e' })
    expect(opened.cloud).toMatchObject({ repo: 'octo/hello', baseBranch: 'main', busy: false, pushed: false })
    expect(opened.cloud.branch).toMatch(/^arc\/e2e-[0-9a-f]{4}$/)
    expect(opened.root).toBe(`octo/hello @ ${opened.cloud.branch}`)
    expect(opened.history).toEqual([])
    expect(await d.router.status()).toMatchObject({ hasProject: true, projectRoot: opened.root, mode: 'auto', cloud: { id: opened.sessionId } })

    await runTurn(d, 'Add hello.txt and run ls\nthen stop')
    const pushNotice = await autoPushOutcome(d)
    expect(pushNotice).toContain(`Saved to GitHub: ${opened.cloud.branch}`)

    // Order: tool-call -> tool-start -> tool-result for Write, then the same for Bash, then text, turn-end, push notice.
    const at = (pred: (e: AgentEvent) => boolean) => d.events.findIndex(pred)
    const writeCall = at((e) => e.type === 'tool-call' && e.call.name === 'Write')
    const writeStart = at((e) => e.type === 'tool-start' && e.id === 'w1')
    const writeResult = at((e) => e.type === 'tool-result' && e.id === 'w1')
    const bashCall = at((e) => e.type === 'tool-call' && e.call.name === 'Bash')
    const bashResult = at((e) => e.type === 'tool-result' && e.id === 'b1')
    const text1 = at((e) => e.type === 'text-delta' && e.text.includes('All done.'))
    const end = at((e) => e.type === 'turn-end')
    const saved = at((e) => e.type === 'notice' && e.message.startsWith('Saved to GitHub'))
    const order = [writeCall, writeStart, writeResult, bashCall, bashResult, text1, end, saved]
    expect(order.every((i) => i >= 0), `all present: ${order}`).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(ofType(d.events, 'tool-result').find((e) => e.id === 'b1')?.result).toMatchObject({ ok: true })
    expect(ofType(d.events, 'turn-end').map((e) => e.reason)).toEqual(['done'])

    // The worker's checkout and the remote.
    expect(await readFile(join(repoDir(stack, opened.sessionId), 'hello.txt'), 'utf8')).toBe('hi from the cloud\n')
    expect(branches(stack)).toEqual([opened.cloud.branch])
    const bare = stack.barePath('octo', 'hello')
    expect(git(bare, 'show', `${opened.cloud.branch}:hello.txt`)).toBe('hi from the cloud')
    expect(git(bare, 'show', `${opened.cloud.branch}:built.txt`)).toBe('built')
    expect(git(bare, 'show', `${opened.cloud.branch}:README.md`)).toContain('octo/hello')
    expect(git(bare, 'log', '-1', '--format=%an <%ae>%n%s', opened.cloud.branch)).toBe('AIVEN ARC <arc@users.noreply.github.com>\narc: Add hello.txt and run ls')
    expect(git(bare, 'rev-parse', 'main')).toBe(mainBefore)
    // One clone and one push went through the git wrapper with the token in the child's environment, none without.
    const log = await stack.gitLog()
    expect(log.filter((l) => l.includes('[clone]')).every((l) => l.startsWith('token=set'))).toBe(true)
    expect(log.filter((l) => l.includes('[push]')).every((l) => l.startsWith('token=set'))).toBe(true)
    expect(log.filter((l) => l.includes('[push]'))).toHaveLength(1)
    expect(log.filter((l) => !l.includes('[clone]') && !l.includes('[push]')).every((l) => l.startsWith('token= args='))).toBe(true)
  })

  it('a second turn adds a second commit to the same branch (fast-forward, never forced)', async () => {
    stack = await createStack({ script: [call('Write', { file_path: 'one.txt', content: '1\n' }, 'w1'), text('one'), call('Write', { file_path: 'two.txt', content: '2\n' }, 'w2'), text('two')] })
    const d = await stack.desktop()
    const { cloud } = await d.router.cloudStart({ repo: 'octo/hello', name: 'two turns' })
    await runTurn(d, 'first prompt')
    await autoPushOutcome(d)
    const since = noticeTexts(d.events).length
    await runTurn(d, 'second prompt')
    expect(await autoPushOutcome(d, since)).toContain('Saved to GitHub')
    const bare = stack.barePath('octo', 'hello')
    expect(git(bare, 'log', '--format=%s', `main..${cloud.branch}`).split('\n')).toEqual(['arc: second prompt', 'arc: first prompt'])
    expect(git(bare, 'ls-tree', '--name-only', cloud.branch).split('\n')).toEqual(expect.arrayContaining(['one.txt', 'two.txt']))
    expect(await stack.gitLog().then((l) => l.filter((x) => x.includes('[push]') && /force|\+HEAD/.test(x)))).toEqual([])
  })

  // ------------------------------------------------------------------ 2
  it('approval round trip over the wire in ask mode, then deny', async () => {
    stack = await createStack({
      script: [call('Write', { file_path: 'a.txt', content: 'A\n' }, 'w1'), text('wrote a'), call('Write', { file_path: 'b.txt', content: 'B\n' }, 'w2'), text('b was refused')],
    })
    const d = await stack.desktop({ mode: 'ask' })
    const { cloud, sessionId } = await d.router.cloudStart({ repo: 'octo/hello', name: 'ask' })
    expect(cloud.mode).toBe('ask')

    expect(await d.router.send('write a.txt')).toBe('started')
    await waitFor(() => ofType(d.events, 'approval-request').length === 1, 'approval-request')
    const req = ofType(d.events, 'approval-request')[0].request
    expect(req.call.name).toBe('Write')
    // The turn is parked on the approval: the file does not exist, the worker says busy, and nothing was pushed.
    await expect(stat(join(repoDir(stack, sessionId), 'a.txt'))).rejects.toThrow()
    expect(await d.router.status()).toMatchObject({ busy: true })
    expect(turnEnds(d)).toBe(0)
    expect(ofType(d.events, 'tool-start')).toHaveLength(0)

    await d.router.resolveApproval(req.call.id, { decision: 'allow-once' })
    await waitFor(() => turnEnds(d) === 1, 'turn-end after approval')
    expect(ofType(d.events, 'tool-result').find((e) => e.id === 'w1')?.result.ok).toBe(true)
    expect(await readFile(join(repoDir(stack, sessionId), 'a.txt'), 'utf8')).toBe('A\n')
    expect(await autoPushOutcome(d)).toContain('Saved to GitHub')
    expect(git(stack.barePath('octo', 'hello'), 'show', `${cloud.branch}:a.txt`)).toBe('A')

    // Second turn: deny with a note. The tool must not run and nothing new is committed.
    const since = d.events.length
    expect(await d.router.send('write b.txt')).toBe('started')
    await waitFor(() => ofType(d.events, 'approval-request').length === 2, 'second approval-request')
    await d.router.resolveApproval(ofType(d.events, 'approval-request')[1].request.call.id, { decision: 'deny', note: 'not now' })
    await waitFor(() => turnEnds(d) === 2, 'turn-end after deny')
    await expect(stat(join(repoDir(stack, sessionId), 'b.txt'))).rejects.toThrow()
    expect(ofType(d.events.slice(since), 'tool-result').find((e) => e.id === 'w2')).toBeUndefined()
    expect(ofType(d.events.slice(since), 'activity').some((e) => e.state === 'denied')).toBe(true)
    // The model was told, with the user's note.
    expect(json(stack.vertex.requests.at(-1)?.body)).toContain('The user denied this action. Their note: not now.')
    await new Promise((r) => setTimeout(r, 200))
    expect(git(stack.barePath('octo', 'hello'), 'log', '--format=%s', `main..${cloud.branch}`).split('\n')).toEqual(['arc: write a.txt'])
  })

  it('stopping a turn that waits for approval over the wire ends it cleanly', async () => {
    stack = await createStack({ script: [call('Write', { file_path: 'a.txt', content: 'A\n' }, 'w1')] })
    const d = await stack.desktop({ mode: 'ask' })
    await d.router.cloudStart({ repo: 'octo/hello', name: 'stop' })
    await d.router.send('write it')
    await waitFor(() => ofType(d.events, 'approval-request').length === 1, 'approval-request')
    await d.router.stop()
    await waitFor(() => turnEnds(d) === 1, 'turn-end after stop')
    expect(ofType(d.events, 'turn-end')[0].reason).toBe('stopped')
    await waitFor(async () => !(await d.router.status()).busy, 'idle')
  })

  // ------------------------------------------------------------------ 3
  it('a second router (the app reopened) attaches mid-turn, gets history and live events, and both clients follow a follow-up turn', async () => {
    stack = await createStack({
      script: [call('Bash', { command: 'sleep 2; echo late > late.txt' }, 'b1'), text('finished the slow one'), text('and the follow-up')],
    })
    const d1 = await stack.desktop()
    const { cloud } = await d1.router.cloudStart({ repo: 'octo/hello', name: 'reopen' })
    await d1.router.send('run the slow command')
    await waitFor(() => d1.events.some((e) => e.type === 'tool-start' && e.id === 'b1'), 'Bash started')

    // "Close and reopen the app": a brand new desktop. It sees the session on the list, still busy.
    const d2 = await stack.desktop()
    const listed = await d2.router.cloudSessions()
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ id: cloud.id, busy: true, branch: cloud.branch })
    const opened = await d2.router.cloudAttach(cloud.id)
    expect(opened.cloud).toMatchObject({ id: cloud.id, busy: true })
    // History carries the prompt and the model's tool call so far.
    const userTexts = opened.history.filter((c) => c.role === 'user').flatMap((c) => c.parts.map((p) => p.text ?? ''))
    expect(userTexts.join('\n')).toContain('run the slow command')
    expect(opened.history.some((c) => c.parts.some((p) => p.functionCall?.name === 'Bash'))).toBe(true)
    expect(await d2.router.status()).toMatchObject({ busy: true, sessionId: cloud.id, projectRoot: `octo/hello @ ${cloud.branch}` })

    // Live events from the attach point on, and they match what the first client sees.
    await waitFor(() => turnEnds(d2) === 1 && savedNotices(d2).length === 1, 'turn-end and push seen by the second client')
    await waitFor(() => savedNotices(d1).length === 1, 'push seen by the first client')
    // Everything up to the router's catch-up `status` is the attach itself (history-reload, mode, status).
    const tail2 = d2.events.slice(d2.events.findIndex((e) => e.type === 'status') + 1)
    expect(tail2.length).toBeGreaterThan(2)
    expect(json(d1.events.slice(-tail2.length))).toBe(json(tail2))
    expect(tail2.some((e) => e.type === 'tool-result' && e.id === 'b1')).toBe(true)
    expect(tail2.some((e) => e.type === 'tool-call')).toBe(false) // that happened before the attach: it is in history, not replayed
    expect(await d2.router.status()).toMatchObject({ busy: false })

    // The new app instance can drive the session; the old one sees it too.
    await runTurn(d2, 'follow up from the new window')
    await waitFor(() => turnEnds(d1) === 2, 'first client sees the follow-up turn')
    expect(ofType(d1.events, 'text-delta').map((e) => e.text).join('')).toContain('and the follow-up')
    expect(git(stack.barePath('octo', 'hello'), 'show', `${cloud.branch}:late.txt`)).toBe('late')
  })

  // Fixed: /history carries the pending approval and the router replays it on attach.
  it('a client that attaches while an approval is pending can still see and answer it', async () => {
    stack = await createStack({ script: [call('Write', { file_path: 'a.txt', content: 'A\n' }, 'w1'), text('done')] })
    const d1 = await stack.desktop({ mode: 'ask' })
    const { cloud } = await d1.router.cloudStart({ repo: 'octo/hello', name: 'pending' })
    await d1.router.send('write a.txt')
    await waitFor(() => ofType(d1.events, 'approval-request').length === 1, 'approval-request')

    const d2 = await stack.desktop({ mode: 'ask' })
    await d2.router.cloudAttach(cloud.id)
    expect(ofType(d2.events, 'approval-request')).toHaveLength(1)
    expect(ofType(d2.events, 'approval-request')[0].request.call.id).toBe('w1')
    expect(d2.events.map((e) => e.type).indexOf('history-reload')).toBeLessThan(d2.events.findIndex((e) => e.type === 'approval-request'))
    expect(d2.events.at(-1)).toMatchObject({ type: 'status', state: 'waiting-approval' })
    expect(await d2.router.status()).toMatchObject({ busy: true })

    // The new window answers it and the turn (which would have hung) completes for both.
    await d2.router.resolveApproval('w1', { decision: 'allow-once' })
    await waitFor(() => turnEnds(d2) === 1 && turnEnds(d1) === 1, 'turn-end in both windows')
    await waitFor(() => savedNotices(d1).length === 1, 'push')
    expect(git(stack.barePath('octo', 'hello'), 'show', `${cloud.branch}:a.txt`)).toBe('A')
  })

  it('a client that attaches while a question is pending, or text is streaming, sees both', async () => {
    stack = await createStack({
      script: [
        { chunks: [chunk([{ text: 'Let me ask. ' }, { functionCall: { name: 'AskUser', args: { question: 'Which colour?', options: ['red', 'blue'] }, id: 'q1' } }], {}, 'STOP')] },
        { chunks: [chunk([{ text: 'Half a sent' }], {})], holdMs: Infinity },
      ],
    })
    const d1 = await stack.desktop()
    const { cloud } = await d1.router.cloudStart({ repo: 'octo/hello', name: 'q' })
    await d1.router.send('ask me')
    await waitFor(() => ofType(d1.events, 'question').length === 1, 'question')
    const question = ofType(d1.events, 'question')[0]

    const d2 = await stack.desktop()
    await d2.router.cloudAttach(cloud.id)
    expect(ofType(d2.events, 'question')).toEqual([question])
    expect(ofType(d2.events, 'history-reload')[0].history.some((c) => c.parts.some((p) => p.text === 'Let me ask. '))).toBe(true)

    await d2.router.resolveAnswer(question.id, 'blue')
    await waitFor(() => ofType(d1.events, 'text-delta').some((e) => e.text === 'Half a sent'), 'streaming text')
    const d3 = await stack.desktop()
    await d3.router.cloudAttach(cloud.id)
    expect(ofType(d3.events, 'text-delta').map((e) => e.text).join('')).toBe('Half a sent')
    expect(ofType(d3.events, 'question')).toHaveLength(0)
    await d3.router.stop()
    await waitFor(() => turnEnds(d3) >= 1, 'stopped')
  })

  // ------------------------------------------------------------------ 4
  it('survives the SSE connection being killed mid-turn: reconnects and misses no event', async () => {
    stack = await createStack({ script: [call('Bash', { command: 'echo before > before.txt; sleep 1.5; echo after > after.txt' }, 'b1'), text('after the outage')] })
    const d = await stack.desktop()
    const { cloud } = await d.router.cloudStart({ repo: 'octo/hello', name: 'sse' })
    const skip = d.events.length
    const reference: AgentEvent[] = []
    let refSeq = 0
    const startSeq = stack.worker.history(cloud.id).seq
    stack.worker.subscribe(cloud.id, startSeq, (seq, e) => {
      refSeq = seq
      reference.push(e)
    })

    await d.router.send('do the slow thing')
    await waitFor(() => d.events.some((e) => e.type === 'tool-start' && e.id === 'b1'), 'Bash started')
    expect(stack.sseSockets.size).toBe(1)
    expect(stack.worker.subscriberCount(cloud.id)).toBe(2) // the renderer's stream and the reference listener

    // Hold the client's reconnect, then cut the connection from the server side.
    d.gate.hold()
    for (const s of stack.sseSockets) s.destroy()
    await waitFor(() => noticeTexts(d.events).includes('Lost the connection to the cloud worker. Retrying...'), 'lost notice')
    await waitFor(() => stack!.worker.subscriberCount(cloud.id) === 1, 'server released the dead stream')
    const seenWhileDown = d.events.length

    // The turn finishes on the worker while the app is disconnected.
    await waitFor(() => !stack!.worker.get(cloud.id).busy && reference.some((e) => e.type === 'notice' && e.message.startsWith('Saved to GitHub')), 'turn and push done on the worker')
    expect(d.events.length).toBe(seenWhileDown)
    expect(reference.length).toBeGreaterThan(5)

    d.gate.release()
    await waitFor(() => noticeTexts(d.events).includes('Reconnected to the cloud worker.'), 'reconnected notice')
    await waitFor(() => savedNotices(d).length === 1, 'replayed push notice')

    // Exactly the worker's events, in order, none missing, none twice.
    const router = new Set(['Lost the connection to the cloud worker. Retrying...', 'Reconnected to the cloud worker.'])
    const rendered = d.events.slice(skip).filter((e) => !(e.type === 'notice' && router.has(e.message)))
    expect(json(rendered)).toBe(json(JSON.parse(json(reference))))
    expect(rendered.at(-1)).toMatchObject({ type: 'notice' })
    expect(turnEnds(d)).toBe(1)
    expect(refSeq).toBeGreaterThan(startSeq)
    expect(stack.sseSockets.size).toBe(1)
    expect(await d.router.status()).toMatchObject({ busy: false })
    expect(git(stack.barePath('octo', 'hello'), 'show', `${cloud.branch}:after.txt`)).toBe('after')
  })

  it('survives repeated connection kills while events keep flowing', async () => {
    stack = await createStack({ script: [call('Bash', { command: 'for i in 1 2 3 4 5 6; do echo $i >> n.txt; sleep 0.4; done' }, 'b1'), text('counted')] })
    const d = await stack.desktop()
    const { cloud } = await d.router.cloudStart({ repo: 'octo/hello', name: 'flap' })
    const skip = d.events.length
    const reference: AgentEvent[] = []
    stack.worker.subscribe(cloud.id, stack.worker.history(cloud.id).seq, (_s, e) => reference.push(e))
    await d.router.send('count')
    await waitFor(() => d.events.some((e) => e.type === 'tool-start'), 'started')
    for (let i = 0; i < 3; i++) {
      for (const s of stack.sseSockets) s.destroy()
      await new Promise((r) => setTimeout(r, 350))
    }
    await waitFor(() => savedNotices(d).length === 1, 'push notice after flapping')
    const router = new Set(['Lost the connection to the cloud worker. Retrying...', 'Reconnected to the cloud worker.'])
    const rendered = d.events.slice(skip).filter((e) => !(e.type === 'notice' && router.has(e.message)))
    expect(json(rendered)).toBe(json(JSON.parse(json(reference))))
  })

  // Fixed: after a gap the router emits history-reload and derives the turn end from the worker's session info.
  it('after a replay gap the renderer still learns that the turn ended', async () => {
    stack = await createStack({
      eventLog: { maxEvents: 4 },
      script: [call('Bash', { command: 'sleep 1.2; echo x > x.txt' }, 'b1'), text('long after')],
    })
    const d = await stack.desktop()
    const { cloud } = await d.router.cloudStart({ repo: 'octo/hello', name: 'gap' })
    await d.router.send('go')
    await waitFor(() => d.events.some((e) => e.type === 'tool-start'), 'started')
    d.gate.hold()
    for (const s of stack.sseSockets) s.destroy()
    await waitFor(() => !stack!.worker.get(cloud.id).busy, 'turn finished on the worker')
    d.gate.release()
    await waitFor(() => noticeTexts(d.events).includes('Caught up with the cloud session.'), 'gap handled')
    await new Promise((r) => setTimeout(r, 500))
    expect(turnEnds(d)).toBe(1)
    const reloads = ofType(d.events, 'history-reload')
    expect(reloads.length).toBeGreaterThan(0)
    // The reloaded transcript already holds the finished turn (the tool call and the final text).
    expect(JSON.stringify(reloads.at(-1)!.history)).toContain('long after')
    expect((await d.router.status()).busy).toBe(false)
  })

  // ------------------------------------------------------------------ 5
  it('push(), diff and a pull request through the fake GitHub, and reuse of an existing PR', async () => {
    stack = await createStack({ script: [call('Write', { file_path: 'feature.txt', content: 'feature\n' }, 'w1'), text('done')] })
    const d = await stack.desktop({ autoPush: false })
    const { cloud } = await d.router.cloudStart({ repo: 'octo/hello', name: 'pr' })
    await runTurn(d, 'add the feature')
    await new Promise((r) => setTimeout(r, 300))
    expect(savedNotices(d)).toEqual([]) // auto-push is off
    expect(branches(stack)).toEqual([])

    const diff = await d.router.cloudDiff()
    expect(diff).toMatchObject({ branch: cloud.branch, baseBranch: 'main', uncommitted: true, ahead: 0, pushed: false })
    expect(diff.files).toEqual([{ path: 'feature.txt', status: 'untracked', additions: 1, deletions: 0 }])

    const pushed = await d.router.cloudPush()
    expect(pushed).toMatchObject({ branch: cloud.branch, pushed: true, skipped: [], url: `https://github.com/octo/hello/tree/${cloud.branch}` })
    expect(pushed.commit).toMatch(/^[0-9a-f]{7,12}$/)
    expect(branches(stack)).toEqual([cloud.branch])
    expect(git(stack.barePath('octo', 'hello'), 'show', `${cloud.branch}:feature.txt`)).toBe('feature')
    expect(await d.router.cloudDiff()).toMatchObject({ uncommitted: false, ahead: 1, pushed: true })
    expect((await d.router.status()).cloud?.pushed).toBe(true)

    // Nothing new: pushing again is harmless and makes no commit.
    const again = await d.router.cloudPush()
    expect(again.commit).toBeNull()
    expect(git(stack.barePath('octo', 'hello'), 'rev-list', '--count', `main..${cloud.branch}`)).toBe('1')

    const pr = await d.router.cloudPr({ title: 'Add the feature', body: 'Made by ARC', draft: true })
    expect(pr).toEqual({ number: 1, url: 'https://github.com/octo/hello/pull/1', draft: true, existing: false })
    const post = stack.github.requests.filter((r) => r.method === 'POST')
    expect(post).toHaveLength(1)
    expect(post[0].path).toBe('/repos/octo/hello/pulls')
    expect(post[0].body).toEqual({ title: 'Add the feature', head: cloud.branch, base: 'main', body: 'Made by ARC', draft: true })
    expect(stack.github.requests.every((r) => r.headers.authorization === `Bearer ${GITHUB_TOKEN}`)).toBe(true)

    // The branch already has an open PR: GitHub answers 422, the worker looks it up and reuses it.
    const again2 = await d.router.cloudPr({ title: 'Add the feature (retitled)' })
    expect(again2).toEqual({ number: 1, url: 'https://github.com/octo/hello/pull/1', draft: true, existing: true })
    expect(stack.github.pulls).toHaveLength(1)
    const lookup = stack.github.requests.filter((r) => r.method === 'GET' && r.path === '/repos/octo/hello/pulls')
    expect(lookup).toHaveLength(1)
    expect(lookup[0].query.get('head')).toBe(`octo:${cloud.branch}`)
  })

  it('opening a PR pushes first, so the head branch exists on the remote', async () => {
    stack = await createStack({ script: [call('Write', { file_path: 'x.txt', content: 'x\n' }, 'w1'), text('done')] })
    const d = await stack.desktop({ autoPush: false })
    const { cloud } = await d.router.cloudStart({ repo: 'octo/hello', name: 'prfirst' })
    await runTurn(d, 'write x')
    expect(branches(stack)).toEqual([])
    const pr = await d.router.cloudPr({ title: 'X' })
    expect(pr).toMatchObject({ number: 1, existing: false })
    expect(branches(stack)).toEqual([cloud.branch])
  })

  it('refuses a session when the GitHub token cannot push, with a plain message', async () => {
    stack = await createStack({ script: [] })
    stack.github.canPush = false
    const d = await stack.desktop()
    await expect(d.router.cloudStart({ repo: 'octo/hello' })).rejects.toThrow(/cannot push to octo\/hello/)
    expect(await d.router.cloudSessions()).toEqual([])
    await expect(d.router.cloudStart({ repo: 'octo/missing' })).rejects.toThrow(/cannot see or change that repository/)
    await expect(d.router.cloudStart({ repo: 'file:///etc' })).rejects.toThrow(/not supported/)
    expect(stack.worker.list()).toEqual([])
  })

  // ------------------------------------------------------------------ 6
  it('a wrong worker token yields the plain unauthorized message and never reveals either token', async () => {
    stack = await createStack({ script: [] })
    const wrong = 'SENTINEL-wrong-token-' + 'x'.repeat(32)
    const d = await stack.desktop({ workerToken: wrong })
    const plain = 'The worker rejected the access token. Check it in Settings > Cloud.'
    await expect(d.router.cloudSessions()).rejects.toMatchObject({ message: plain, code: 'unauthorized' })
    await expect(d.router.cloudStart({ repo: 'octo/hello' })).rejects.toThrow(plain)
    await expect(d.router.cloudAttach('00000000-0000-0000-0000-000000000000')).rejects.toThrow(plain)
    const results = await d.router.cloudTest()
    expect(results.map((r) => [r.label, r.ok])).toEqual([
      ['Worker reachable', true],
      ['Access token accepted', false],
      ['GitHub token valid', false], // GitHub is only reachable at api.github.com from the router, which tests do not hit
    ])
    expect(results[1].message).toBe(plain)
    expect(json([results, d.events])).not.toContain(wrong)
    expect(json([results, d.events])).not.toContain(WORKER_TOKEN)
    expect(stack.worker.list()).toEqual([])
    expect(stack.serverLog).toEqual([])
  })

  it('failed logins are rate limited, and the message says so in plain words', async () => {
    stack = await createStack({ script: [], failLimit: 3 })
    const d = await stack.desktop({ workerToken: 'SENTINEL-wrong-token-' + 'y'.repeat(32) })
    for (let i = 0; i < 3; i++) await expect(d.router.cloudSessions()).rejects.toMatchObject({ code: 'unauthorized' })
    await expect(d.router.cloudSessions()).rejects.toMatchObject({ code: 'rate-limited', message: expect.stringMatching(/too many requests\. Wait \d+ seconds/) })
  })

  it('a stream whose token is revoked ends with the plain unauthorized notice (detaches)', async () => {
    stack = await createStack({ script: [] })
    const d = await stack.desktop()
    const { cloud } = await d.router.cloudStart({ repo: 'octo/hello', name: 'revoke' })
    // The user pastes a different token in Settings; the stream reconnects with it and the worker refuses it.
    await d.router.cloudSetSecret('cloud-token', 'SENTINEL-other-token-' + 'z'.repeat(32))
    await waitFor(() => noticeTexts(d.events).includes('The cloud worker rejected the access token. Update it in Settings > Cloud.'), 'unauthorized notice')
    expect((await d.router.status()).cloud ?? null).toBeNull()
    expect(stack.worker.get(cloud.id).id).toBe(cloud.id) // the session itself keeps running
  })

  // ------------------------------------------------------------------ 7
  it('ending a session deletes its workspace and session data, and the link stops working', async () => {
    stack = await createStack({ script: [call('Write', { file_path: 'a.txt', content: 'A\n' }, 'w1'), text('done')] })
    const d = await stack.desktop()
    const { cloud } = await d.router.cloudStart({ repo: 'octo/hello', name: 'bye' })
    await runTurn(d, 'write a')
    await autoPushOutcome(d)
    const work = join(stack.dataDir, 'work', cloud.id)
    const sess = join(stack.dataDir, 'sessions', cloud.id)
    expect((await stat(join(work, 'repo', 'a.txt'))).isFile()).toBe(true)
    expect((await stat(sess)).isDirectory()).toBe(true)

    await d.router.cloudEnd(cloud.id)
    await expect(stat(work)).rejects.toThrow()
    await expect(stat(sess)).rejects.toThrow()
    expect(stack.worker.list()).toEqual([])
    expect((await d.router.status()).cloud ?? null).toBeNull()
    expect(stack.sseSockets.size).toBe(0)
    // The pushed branch is safe on the remote.
    expect(branches(stack)).toEqual([cloud.branch])
    await expect(d.router.cloudAttach(cloud.id)).rejects.toMatchObject({ code: 'session-gone' })
    // Ending twice is fine from the app's point of view.
    await expect(d.router.cloudEnd(cloud.id)).resolves.toBeNull()
  })

  it('ending a session in the middle of a turn leaves nothing behind and no late notices', async () => {
    stack = await createStack({ script: [call('Bash', { command: 'sleep 5; echo z > z.txt' }, 'b1'), text('never')] })
    const d = await stack.desktop()
    const { cloud } = await d.router.cloudStart({ repo: 'octo/hello', name: 'midturn' })
    await d.router.send('slow')
    await waitFor(() => d.events.some((e) => e.type === 'tool-start'), 'Bash started')
    await d.router.cloudEnd(cloud.id)
    await new Promise((r) => setTimeout(r, 800))
    await expect(stat(join(stack.dataDir, 'work', cloud.id))).rejects.toThrow()
    await expect(stat(join(stack.dataDir, 'sessions', cloud.id))).rejects.toThrow()
    expect(branches(stack)).toEqual([])
    expect(noticeTexts(d.events).filter((m) => /Saved to GitHub|Could not save/.test(m))).toEqual([])
  })

  it('ending a session also cleans up when the app that started it is gone (another router deletes it)', async () => {
    stack = await createStack({ script: [] })
    const d1 = await stack.desktop()
    const { cloud } = await d1.router.cloudStart({ repo: 'octo/hello', name: 'other' })
    const d2 = await stack.desktop()
    await d2.router.cloudEnd(cloud.id)
    await waitFor(() => noticeTexts(d1.events).some((m) => m.includes('worker restarted')), 'first client told the session is gone')
    expect((await d1.router.status()).cloud ?? null).toBeNull()
    await expect(stat(join(stack.dataDir, 'work', cloud.id))).rejects.toThrow()
  })

  // ------------------------------------------------------------------ misc over the wire
  it('undo, changes, mode and settings go over the wire to the worker session', async () => {
    stack = await createStack({ script: [call('Write', { file_path: 'u.txt', content: 'u\n' }, 'w1'), text('done')] })
    const d = await stack.desktop({ autoPush: false })
    const { cloud } = await d.router.cloudStart({ repo: 'octo/hello', name: 'undo' })
    await runTurn(d, 'write u')
    const changes = await d.router.getChanges()
    expect(changes.canUndo).toBe(true)
    // Paths are relative to the repository root, not the worker's data dir.
    expect(changes.files).toEqual(['u.txt'])
    const undone = await d.router.undo()
    expect(undone.removed).toEqual(['u.txt'])
    await expect(stat(join(repoDir(stack, cloud.id), 'u.txt'))).rejects.toThrow()
    await d.router.setMode('auto-edit')
    await waitFor(() => ofType(d.events, 'mode').at(-1)?.mode === 'auto-edit', 'mode event')
    expect((await d.router.status()).cloud?.mode).toBe('auto-edit')
    expect(stack.worker.get(cloud.id).mode).toBe('auto-edit')
    // Saving settings on the Mac reaches the worker, but the cloud/theme fields stay local.
    await d.router.saveSettings({ maxSteps: 7, theme: 'studios', cloud: { workerUrl: stack.workerUrl, autoPush: false } })
    const remote = await stack.worker.invoke(cloud.id, 'app:status', undefined)
    expect(remote).toMatchObject({ ok: true })
    expect((await d.router.listSessions()).length).toBeGreaterThanOrEqual(1)
    expect(await d.router.listRules()).toEqual([])
  })

  it('turning auto-push off in Settings while attached reaches the running worker session, and on again', async () => {
    stack = await createStack({
      script: [call('Write', { file_path: 'one.txt', content: '1\n' }, 'w1'), text('one'), call('Write', { file_path: 'two.txt', content: '2\n' }, 'w2'), text('two')],
    })
    const d = await stack.desktop()
    const { cloud } = await d.router.cloudStart({ repo: 'octo/hello', name: 'switch' })
    await d.router.saveSettings({ cloud: { autoPush: false } })
    await runTurn(d, 'one')
    await new Promise((r) => setTimeout(r, 400))
    expect(savedNotices(d)).toHaveLength(0)
    expect(branches(stack)).not.toContain(cloud.branch)
    await d.router.saveSettings({ cloud: { autoPush: true } })
    await runTurn(d, 'two')
    await autoPushOutcome(d)
    expect(git(stack.barePath('octo', 'hello'), 'show', `${cloud.branch}:one.txt`)).toBe('1')
  })

  it('clearing the Vertex key while attached stops the cloud turn and the worker forgets the key', async () => {
    stack = await createStack({ script: [{ chunks: [], holdMs: Infinity }] })
    const d = await stack.desktop()
    const { cloud } = await d.router.cloudStart({ repo: 'octo/hello', name: 'nokey' })
    await d.router.send('long')
    await waitFor(() => stack!.worker.get(cloud.id).busy, 'busy')
    await d.router.clearApiKey()
    await waitFor(() => turnEnds(d) >= 1, 'turn ended')
    expect(await stack.worker.invoke(cloud.id, 'app:status', undefined)).toMatchObject({ ok: true, data: { hasApiKey: false } })
  })

  // Fixed: the router re-reads the session after notices, so the chip follows the auto-push.
  it('the attached session shows as pushed once the auto-push notice arrives', async () => {
    stack = await createStack({ script: [call('Write', { file_path: 'p.txt', content: 'p\n' }, 'w1'), text('done')] })
    const d = await stack.desktop()
    await d.router.cloudStart({ repo: 'octo/hello', name: 'chip' })
    await runTurn(d, 'write p')
    await autoPushOutcome(d)
    await new Promise((r) => setTimeout(r, 300))
    expect(stack.worker.list()[0].pushed).toBe(true)
    expect((await d.router.status()).cloud?.pushed).toBe(true)
  })

  // ------------------------------------------------------------------ 8
  describe('secrets', () => {
    const ENV = {
      ARC_CLOUD_TOKEN: 'SENTINEL-env-arc-token-aa11bb22',
      GITHUB_TOKEN: 'SENTINEL-env-github-token-cc33dd44',
      GOOGLE_API_KEY: 'SENTINEL-env-google-key-ee55ff66',
    }

    it('the GitHub token, Vertex key and worker token never appear in events, history, files, the remote or git arguments', async () => {
      stack = await createStack({
        env: ENV,
        script: [
          call('Bash', { command: 'env; printenv; ls -la ..' }, 'b1'),
          call('Write', { file_path: 'note.txt', content: 'harmless\n' }, 'w1'),
          call('Bash', { command: 'git remote -v; git config --local --list; cat .git/config' }, 'b2'),
          text('looked around'),
        ],
      })
      const d = await stack.desktop()
      const { cloud, sessionId } = await d.router.cloudStart({ repo: 'octo/hello', name: 'secrets' })
      await runTurn(d, 'look around and write a note')
      await autoPushOutcome(d)
      await d.router.cloudPush()
      await d.router.cloudPr({ title: 'Secrets check' })
      const wire = [
        d.events,
        await d.router.cloudDiff(),
        await d.router.cloudSessions(),
        await d.router.status(),
        await d.router.readAudit(),
        await d.router.getChanges(),
        d.local.getHistory(),
        stack.worker.history(sessionId),
      ]
      // The agent's shell really ran and really looked at its environment and the clone's config.
      const out = ofType(d.events, 'tool-result').filter((e) => e.id === 'b1' || e.id === 'b2').map((e) => e.result.output).join('\n')
      expect(out).toMatch(/PATH=/)
      expect(out).toContain('remote.origin.url=https://github.com/octo/hello')
      for (const v of Object.values(ENV)) expect(out).not.toContain(v)

      const everything = json(wire) + json(stack.vertex.requests.map((r) => r.body)) + stack.serverLog.join('\n') + (await stack.gitLog()).join('\n')
      for (const secret of [...ALL_SECRETS, ...Object.values(ENV)]) {
        expect(everything.includes(secret), `leaked ${secret.slice(0, 20)}...`).toBe(false)
      }
      // Vertex was reached with the key (that is the one place it is meant to go), and only there.
      expect(stack.vertex.requests.length).toBeGreaterThan(0)
      expect(stack.vertex.requests.every((r) => r.headers['x-goog-api-key'] === VERTEX_KEY)).toBe(true)

      expect(await filesContaining(stack.dataDir, ALL_SECRETS), 'files under the worker data dir').toEqual([])
      expect(await filesContaining(stack.dataDir, Object.values(ENV))).toEqual([])
      expect(await filesContaining(stack.barePath('octo', 'hello'), ALL_SECRETS), 'files in the bare remote').toEqual([])
      const bareConfig = await readFile(join(stack.barePath('octo', 'hello'), 'config'), 'utf8')
      expect(bareConfig).not.toMatch(/token|insteadOf|credential|extraheader|@/i)
      // Pushed content is clean too.
      const pushedText = git(stack.barePath('octo', 'hello'), 'log', '--all', '-p', '--format=%H%n%an%n%ae%n%s')
      for (const secret of ALL_SECRETS) expect(pushedText).not.toContain(secret)
      // The clone's own config holds the plain https URL, nothing else of interest.
      const cfg = await readFile(join(repoDir(stack, sessionId), '.git', 'config'), 'utf8')
      expect(cfg).toContain('url = https://github.com/octo/hello')
      expect(cfg).not.toMatch(/insteadOf|credential|extraheader|token/i)
      expect(cloud.branch).toMatch(/^arc\//)

      // The wrapper saw the token only as an environment variable of clone and push, never as an argument.
      const log = await stack.gitLog()
      expect(log.some((l) => l.startsWith('token=set'))).toBe(true)
      for (const l of log) if (l.startsWith('token=set')) expect(l).toMatch(/\[(clone|push)\]/)
    })

    it('a secret that does reach the agent (a pasted prompt, a command) is scrubbed on the wire and from history', async () => {
      stack = await createStack({
        script: [call('Bash', { command: `echo ${GITHUB_TOKEN} ${VERTEX_KEY}` }, 'b1'), text(`the keys are ${GITHUB_TOKEN} and ${VERTEX_KEY}`)],
      })
      const d = await stack.desktop()
      const { sessionId } = await d.router.cloudStart({ repo: 'octo/hello', name: 'paste' })
      await runTurn(d, `use ${GITHUB_TOKEN} please`)
      await autoPushOutcome(d)
      const history = await d.router.cloudAttach(sessionId).then((o) => o.history)
      expect(json([d.events, history])).not.toContain(GITHUB_TOKEN)
      expect(json([d.events, history])).not.toContain(VERTEX_KEY)
      expect(json(d.events)).toContain('[REDACTED]')
      // The commit message comes from the prompt: the token must not travel to GitHub in it.
      expect(git(stack.barePath('octo', 'hello'), 'log', '--all', '--format=%s')).not.toContain(GITHUB_TOKEN)
    })

    // BUG: the worker scrubs events and the history API, but the agent's own transcript and checkpoints on disk
    // are written unscrubbed for the GitHub token (only the Vertex key is in the agent's redaction list).
    it.fails('even a pasted GitHub token is not written to the worker disk', async () => {
      stack = await createStack({ script: [call('Bash', { command: `echo ${GITHUB_TOKEN}` }, 'b1'), text('ok')] })
      const d = await stack.desktop()
      await d.router.cloudStart({ repo: 'octo/hello', name: 'paste-disk' })
      await runTurn(d, `use ${GITHUB_TOKEN} please`)
      await autoPushOutcome(d)
      expect(await filesContaining(stack.dataDir, [GITHUB_TOKEN])).toEqual([])
    })
  })

  // ------------------------------------------------------------------ more of the real stack
  it('a second window cannot start a turn while one runs: plain message, the running turn is unharmed', async () => {
    stack = await createStack({ script: [call('Bash', { command: 'sleep 1.5; echo ok > ok.txt' }, 'b1'), text('slow done')] })
    const d1 = await stack.desktop()
    const { cloud } = await d1.router.cloudStart({ repo: 'octo/hello', name: 'busy' })
    await d1.router.send('slow one')
    await waitFor(() => d1.events.some((e) => e.type === 'tool-start'), 'Bash started')
    const d2 = await stack.desktop()
    await d2.router.cloudAttach(cloud.id)
    await expect(d2.router.send('another one')).rejects.toMatchObject({ code: 'busy', message: 'A turn is already running. Stop it or wait for it to finish.' })
    await waitFor(() => turnEnds(d1) === 1 && savedNotices(d1).length === 1, 'first turn finishes and pushes')
    expect(git(stack.barePath('octo', 'hello'), 'log', '--format=%s', `main..${cloud.branch}`)).toBe('arc: slow one')
    expect(stack.vertex.requests).toHaveLength(2)
  })

  it('a worker restart ends the session with the plain notice; the pushed branch survives, disk leftovers are purged', async () => {
    stack = await createStack({ script: [call('Write', { file_path: 'r.txt', content: 'r\n' }, 'w1'), text('done'), text('unused')] })
    const d = await stack.desktop()
    const { cloud } = await d.router.cloudStart({ repo: 'octo/hello', name: 'restart' })
    await runTurn(d, 'write r')
    await autoPushOutcome(d)
    expect((await stat(join(stack.dataDir, 'work', cloud.id))).isDirectory()).toBe(true)

    await stack.restartWorker()
    await waitFor(() => noticeTexts(d.events).includes('The cloud session ended because the worker restarted. Your pushed branch is safe on GitHub.'), 'worker-restarted notice')
    expect((await d.router.status()).cloud ?? null).toBeNull()
    expect(ofType(d.events, 'turn-end').at(-1)).toMatchObject({ reason: 'error' })
    await expect(stat(join(stack.dataDir, 'work', cloud.id))).rejects.toThrow()
    await expect(stat(join(stack.dataDir, 'sessions', cloud.id))).rejects.toThrow()
    expect(await d.router.cloudSessions()).toEqual([])
    expect(branches(stack)).toEqual([cloud.branch])
    await expect(d.router.cloudAttach(cloud.id)).rejects.toMatchObject({ code: 'session-gone' })
    // The new worker takes new sessions.
    const again = await d.router.cloudStart({ repo: 'octo/hello', name: 'after restart' })
    expect(again.cloud.id).not.toBe(cloud.id)
  })

  it('Autopilot runs unattended on the worker and its turn is pushed with the idea as the commit message', async () => {
    const ideas = text(
      JSON.stringify([
        { title: 'Add g', prompt: 'Write g.txt now', kind: 'feature' },
        { title: 'Add h', prompt: 'Do thing h', kind: 'test' },
        { title: 'Add i', prompt: 'Do thing i', kind: 'wild' },
      ]),
    )
    stack = await createStack({
      script: [text('first turn done'), ideas, call('Write', { file_path: 'g.txt', content: 'g\n' }, 'w1'), text('autopilot turn done'), { status: 500, body: '{}' }],
    })
    const d = await stack.desktop({ mode: 'auto-edit', settings: { prompter: { mode: 'autopilot', maxRounds: 1 } } })
    const { cloud } = await d.router.cloudStart({ repo: 'octo/hello', name: 'auto' })
    await d.router.send('Start something')
    await waitFor(() => ofType(d.events, 'autopilot').some((e) => !e.running), 'autopilot finished', 20_000)
    // The branch only exists on the remote once the push has landed, so a missing ref just means "not yet".
    await waitFor(() => {
      try {
        return git(stack!.barePath('octo', 'hello'), 'log', '--format=%s', `main..${cloud.branch}`).includes('arc: Write g.txt now')
      } catch {
        return false
      }
    }, 'autopilot commit pushed', 20_000)
    expect(git(stack.barePath('octo', 'hello'), 'show', `${cloud.branch}:g.txt`)).toBe('g')
  })

  it('files that look like secrets are left out of the commit and reported; the rest is pushed', async () => {
    stack = await createStack({
      script: [
        call('Write', { file_path: '.env', content: 'API=1\n' }, 'w1'),
        call('Write', { file_path: 'key.pem', content: 'x\n' }, 'w2'),
        call('Write', { file_path: 'notes.txt', content: '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----\n' }, 'w3'),
        call('Write', { file_path: 'ok.txt', content: 'fine\n' }, 'w4'),
        text('done'),
      ],
    })
    const d = await stack.desktop()
    const { cloud } = await d.router.cloudStart({ repo: 'octo/hello', name: 'leftout' })
    await runTurn(d, 'write some files')
    await waitFor(() => savedNotices(d).length === 1, 'push notice')
    const left = noticeTexts(d.events).find((m) => m.startsWith('Left out of the commit'))
    expect(left).toBe('Left out of the commit (they look like secrets or are very large): .env, key.pem, notes.txt')
    expect(ofType(d.events, 'notice').find((n) => n.message === left)?.level).toBe('warn')
    expect(git(stack.barePath('octo', 'hello'), 'ls-tree', '-r', '--name-only', cloud.branch).split('\n')).toEqual(['README.md', 'ok.txt', 'src/index.ts'])
    // They are still in the workspace, and the explicit push reports them again.
    expect((await d.router.cloudPush()).skipped).toEqual(['.env', 'key.pem', 'notes.txt'])
  })

  it('never force-pushes: a branch that moved on GitHub makes the auto-push fail with a plain message and stays as it is', async () => {
    stack = await createStack({ script: [call('Write', { file_path: 'a.txt', content: 'a\n' }, 'w1'), text('one'), call('Write', { file_path: 'b.txt', content: 'b\n' }, 'w2'), text('two')] })
    const d = await stack.desktop()
    const { cloud } = await d.router.cloudStart({ repo: 'octo/hello', name: 'moved' })
    await runTurn(d, 'first')
    await autoPushOutcome(d)
    // Someone else rewrites the branch on GitHub.
    const bare = stack.barePath('octo', 'hello')
    const other = join(stack.root, 'other')
    git(stack.root, 'clone', '--quiet', `file://${bare}`, other)
    await writeFile(join(other, 'theirs.txt'), 'theirs\n')
    git(other, 'add', '-A')
    git(other, 'commit', '-m', 'their commit')
    git(other, 'push', '--force', 'origin', `HEAD:refs/heads/${cloud.branch}`)
    const theirs = git(bare, 'rev-parse', cloud.branch)

    const since = noticeTexts(d.events).length
    await runTurn(d, 'second')
    const outcome = await autoPushOutcome(d, since)
    expect(outcome).toMatch(/^Could not save to GitHub: The branch on GitHub has commits this session does not have \(not a fast-forward\), so ARC did not overwrite it\. ARC never force-pushes\./)
    expect(git(bare, 'rev-parse', cloud.branch)).toBe(theirs)
    expect(git(bare, 'log', '--format=%s', '-1', cloud.branch)).toBe('their commit')
    await expect(d.router.cloudPush()).rejects.toMatchObject({ code: 'git', message: expect.stringContaining('ARC never force-pushes') })
    expect((await d.router.status()).cloud?.pushed).toBe(false)
  })

  it('rotating the Vertex key and the GitHub token in Settings reaches the running worker session', async () => {
    const NEW_VERTEX = 'SENTINEL-vertex-key-rotated-5d2e8a90c1b7'
    const NEW_GITHUB = 'SENTINEL-github-token-rotated-91f4c6a2e0d8'
    stack = await createStack({ script: [call('Write', { file_path: 'a.txt', content: 'a\n' }, 'w1'), text('one'), text('two')] })
    const d = await stack.desktop({ autoPush: false })
    const { cloud } = await d.router.cloudStart({ repo: 'octo/hello', name: 'rotate' })
    await runTurn(d, 'one')
    expect(stack.vertex.requests.every((r) => r.headers['x-goog-api-key'] === VERTEX_KEY)).toBe(true)

    await d.router.setApiKey(NEW_VERTEX)
    await runTurn(d, 'two')
    expect(stack.vertex.requests.at(-1)?.headers['x-goog-api-key']).toBe(NEW_VERTEX)

    // GitHub now only accepts the new token. Without the rotation reaching the worker, the PR would be a 401.
    stack.github.token = NEW_GITHUB
    await expect(d.router.cloudPr({ title: 'old token' })).rejects.toThrow(/GitHub rejected the token/)
    await d.router.cloudSetSecret('github-token', NEW_GITHUB)
    const pr = await d.router.cloudPr({ title: 'new token' })
    expect(pr).toMatchObject({ number: 1, existing: false })
    expect(stack.github.requests.at(-1)?.headers.authorization).toBe(`Bearer ${NEW_GITHUB}`)
    expect(branches(stack)).toEqual([cloud.branch])

    const everything = json([d.events, stack.worker.history(cloud.id), await stack.gitLog(), stack.serverLog])
    for (const secret of [VERTEX_KEY, NEW_VERTEX, GITHUB_TOKEN, NEW_GITHUB, WORKER_TOKEN]) expect(everything).not.toContain(secret)
    expect(await filesContaining(stack.dataDir, [VERTEX_KEY, NEW_VERTEX, GITHUB_TOKEN, NEW_GITHUB, WORKER_TOKEN])).toEqual([])
  })

  it('the commit message is the first line of the prompt, literal and capped at 72 characters', async () => {
    stack = await createStack({ script: [call('Write', { file_path: 'a.txt', content: 'a\n' }, 'w1'), text('one'), call('Write', { file_path: 'b.txt', content: 'b\n' }, 'w2'), text('two')] })
    const d = await stack.desktop()
    const { cloud } = await d.router.cloudStart({ repo: 'octo/hello', name: 'msg' })
    await runTurn(d, '$(touch /tmp/arc-e2e-pwn) `touch /tmp/arc-e2e-pwn2` --amend -n\nsecond line is not used')
    await autoPushOutcome(d)
    const since = noticeTexts(d.events).length
    await runTurn(d, 'x'.repeat(200))
    await autoPushOutcome(d, since)
    const subjects = git(stack.barePath('octo', 'hello'), 'log', '--format=%s', `main..${cloud.branch}`).split('\n')
    expect(subjects[1]).toBe('arc: $(touch /tmp/arc-e2e-pwn) `touch /tmp/arc-e2e-pwn2` --amend -n')
    expect(subjects[0]).toBe('arc: ' + 'x'.repeat(67))
    await expect(stat('/tmp/arc-e2e-pwn')).rejects.toThrow()
    await expect(stat('/tmp/arc-e2e-pwn2')).rejects.toThrow()
  })

  it('hard denies still hold on the worker in Auto mode: metadata endpoints and writes outside the clone', async () => {
    stack = await createStack({
      script: [
        call('Bash', { command: 'curl -s -H "Metadata-Flavor: Google" http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token' }, 'm1'),
        call('Bash', { command: 'wget -qO- http://metadata.google.internal/' }, 'm2'),
        call('Write', { file_path: join(tmpdir(), 'arc-e2e-outside.txt'), content: 'x' }, 'w1'),
        text('blocked'),
      ],
    })
    const d = await stack.desktop()
    await d.router.cloudStart({ repo: 'octo/hello', name: 'denies' })
    await runTurn(d, 'try forbidden things')
    const calls = ofType(d.events, 'tool-call')
    expect(calls.map((c) => c.verdict.verdict)).toEqual(['deny', 'deny', 'deny'])
    expect(calls[0].verdict.reason).toMatch(/cloud metadata service is off limits/)
    expect(ofType(d.events, 'tool-start')).toHaveLength(0)
    expect(ofType(d.events, 'approval-request')).toHaveLength(0)
    await expect(stat(join(tmpdir(), 'arc-e2e-outside.txt'))).rejects.toThrow()
  })

  // ------------------------------------------------------------------ 9
  describe('a malicious agent turn that tampers with the clone', () => {
    interface Variant {
      name: string
      command: (evil: string) => string
      /** Optional proof that, without the guard, the tamper would have redirected git to the evil remote. */
      redirects?: (repo: string, remotes: string) => string
    }
    const variants: Variant[] = [
      {
        name: 'appends url.insteadOf to .git/config',
        command: (evil) => `printf '[url "file://${evil}"]\\n\\tinsteadOf = https://github.com/octo/hello\\n' >> .git/config`,
        redirects: (repo, remotes) => git(repo, '-c', `url.file://${remotes}/.insteadOf=https://github.com/`, 'ls-remote', 'https://github.com/octo/hello'),
      },
      {
        name: 'sets credential.helper to a script that would capture the token',
        command: () => `git config --local credential.helper '!f() { cat > /tmp/arc-e2e-stolen; }; f'`,
      },
      {
        name: 'appends an include.path pointing at a file it controls',
        command: () => `printf '[include]\\n\\tpath = /tmp/evil.gitconfig\\n' >> .git/config`,
      },
      {
        name: 'adds core.sshCommand',
        command: () => `printf '[core]\\n\\tsshCommand = /tmp/evil\\n' >> .git/config`,
      },
      {
        name: 'sets a pushurl on origin',
        command: (evil) => `git config --local remote.origin.pushurl file://${evil}`,
      },
      {
        name: 'points origin somewhere else',
        command: (evil) => `git config --local remote.origin.url file://${evil}`,
        redirects: (repo) => git(repo, 'ls-remote', 'origin'),
      },
      {
        name: 'replaces .git by a symlink',
        command: () => 'mv .git .git-real && ln -s .git-real .git',
      },
    ]

    it.each(variants)('$name: the push is refused with a plain notice and no token leaves the worker', async ({ command, redirects }) => {
      stack = await createStack({
        script: ({ root }) => [
          call('Write', { file_path: 'innocent.txt', content: 'hi\n' }, 'w1'),
          text('first'),
          call('Write', { file_path: 'second.txt', content: 'two\n' }, 'w2'),
          call('Bash', { command: command(join(root, 'evil', 'octo', 'hello')) }, 'evil'),
          text('second'),
        ],
      })
      const evilBare = await seedBare(join(stack.root, 'evil'), 'octo', 'hello')
      git(evilBare, 'branch', 'evil-marker', 'main')
      const d = await stack.desktop()
      const { cloud, sessionId } = await d.router.cloudStart({ repo: 'octo/hello', name: 'evil' })

      // A normal turn first: pushes fine, so the refusal below is about the tamper and nothing else.
      await runTurn(d, 'innocent change')
      expect(await autoPushOutcome(d)).toContain('Saved to GitHub')
      const tipBefore = git(stack.barePath('octo', 'hello'), 'rev-parse', cloud.branch)
      const tokenCallsBefore = (await stack.gitLog()).filter((l) => l.startsWith('token=set')).length
      const ghBefore = stack.github.requests.length
      const noticesBefore = noticeTexts(d.events).length

      // The malicious turn: the shell tampers with the clone's git settings.
      await runTurn(d, 'now do something sneaky')
      const sneaky = ofType(d.events, 'tool-result').find((e) => e.id === 'evil')
      expect(sneaky?.result, 'the tampering command ran (the guard did not stop it)').toMatchObject({ ok: true })
      if (redirects) expect(redirects(repoDir(stack, sessionId), stack.remotes), 'control: the tamper really redirects git').toContain('evil-marker')

      const outcome = await autoPushOutcome(d, noticesBefore)
      expect(outcome).toMatch(/^Could not save to GitHub: The repository settings were changed during the session, so ARC did not push\./)
      expect(outcome).not.toMatch(/\bat \w+ \(|node_modules|Error:|\.ts:\d+/) // plain words, no stack
      const warn = ofType(d.events, 'notice').filter((n) => n.message === outcome)
      expect(warn.map((n) => n.level)).toEqual(['warn'])

      // Nothing moved: not the arc branch, not the evil remote, no GitHub call, no git call with the token.
      expect(git(stack.barePath('octo', 'hello'), 'rev-parse', cloud.branch)).toBe(tipBefore)
      expect(() => git(stack!.barePath('octo', 'hello'), 'cat-file', '-e', `${cloud.branch}:second.txt`)).toThrow()
      expect(git(evilBare, 'for-each-ref', '--format=%(refname:short)', 'refs/heads')).toBe('evil-marker\nmain')
      expect((await stack.gitLog()).filter((l) => l.startsWith('token=set')).length).toBe(tokenCallsBefore)
      expect(stack.github.requests.length).toBe(ghBefore)
      await expect(readFile('/tmp/arc-e2e-stolen', 'utf8')).rejects.toThrow()

      // The explicit buttons are refused the same way, with the same plain message, and the PR is never created.
      await expect(d.router.cloudPush()).rejects.toMatchObject({ code: 'git', message: expect.stringContaining('The repository settings were changed during the session') })
      await expect(d.router.cloudPr({ title: 'sneaky' })).rejects.toMatchObject({ code: 'git' })
      expect(stack.github.pulls).toEqual([])
      expect(stack.github.requests.length).toBe(ghBefore)
      expect((await stack.gitLog()).filter((l) => l.startsWith('token=set')).length).toBe(tokenCallsBefore)
      expect(json([d.events, outcome])).not.toContain(GITHUB_TOKEN)
      expect(json(d.events)).not.toContain(VERTEX_KEY)
    })
  })

  // ------------------------------------------------------------------ 9b
  describe('what the agent plants next to the clone', () => {
    it('git hooks planted in .git/hooks never run during the worker\'s commit and push (so they never see the token)', async () => {
      stack = await createStack({
        script: ({ root }) => {
          const marker = join(root, 'hook-ran')
          const hook = '#!/bin/sh\\necho "$0 token=${ARC_GIT_TOKEN:+set}" >> ' + marker + '\\n'
          const plant = `for h in pre-commit prepare-commit-msg commit-msg post-commit pre-push reference-transaction pre-auto-gc post-checkout; do printf '${hook}' > .git/hooks/$h; chmod +x .git/hooks/$h; done`
          return [call('Write', { file_path: 'a.txt', content: 'a\n' }, 'w1'), call('Bash', { command: plant }, 'plant'), text('planted')]
        },
      })
      const d = await stack.desktop()
      const { cloud, sessionId } = await d.router.cloudStart({ repo: 'octo/hello', name: 'hooks' })
      await runTurn(d, 'plant hooks')
      expect(ofType(d.events, 'tool-result').find((e) => e.id === 'plant')?.result).toMatchObject({ ok: true })
      expect(await autoPushOutcome(d)).toContain('Saved to GitHub')
      expect(git(stack.barePath('octo', 'hello'), 'show', `${cloud.branch}:a.txt`)).toBe('a')
      const marker = join(stack.root, 'hook-ran')
      await expect(stat(marker)).rejects.toThrow()
      // Control: the hooks are real. A plain git commit in that clone runs them.
      git(repoDir(stack, sessionId), '-c', 'user.name=c', '-c', 'user.email=c@example.com', 'commit', '--allow-empty', '-m', 'control')
      expect(await readFile(marker, 'utf8')).toContain('pre-commit')
    })

    // The token scripts are per-call temp files now; the worker's git work dir is also off limits to the agent's shell.
    it('the agent cannot write into the worker git work dir, where the token scripts live', async () => {
      let askpass = ''
      stack = await createStack({
        script: ({ root }) => {
          askpass = join(root, 'data', 'git', 'askpass.sh')
          return [call('Write', { file_path: 'a.txt', content: 'a\n' }, 'w1'), call('Bash', { command: `printf '#!/bin/sh\\necho stolen > /tmp/arc-e2e-askpass-ran\\n' > ${askpass}` }, 'swap'), text('swapped')]
        },
      })
      const d = await stack.desktop()
      await d.router.cloudStart({ repo: 'octo/hello', name: 'askpass' })
      await runTurn(d, 'swap the askpass script')
      const verdict = ofType(d.events, 'tool-call').find((e) => e.call.id === 'swap')?.verdict
      expect(verdict?.verdict).toBe('deny')
      await expect(readFile(askpass, 'utf8')).rejects.toThrow()
    })
  })
})
