import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { AgentSession } from '../../src/main/agent/loop'
import { decide } from '../../src/main/safety/permissions'
import { protectedWritePaths } from '../../src/main/safety/protected'
import { AuditLog } from '../../src/main/store/audit'
import { CheckpointStore } from '../../src/main/store/checkpoints'
import { ProjectRules } from '../../src/main/store/projectRules'
import { SessionStore } from '../../src/main/store/sessions'
import { DEFAULT_SETTINGS } from '../../src/main/store/settings'
import { globTool, readTool } from '../../src/main/tools/fsRead'
import { editTool } from '../../src/main/tools/fsWrite'
import { createRegistry } from '../../src/main/tools/registry'
import type { AgentEvent } from '../../src/shared/types'
import { makeFixture, type Fixture } from '../helpers/toolContext'
import { callTurn, scriptedVertex, textTurn } from '../helpers/scriptedVertex'

let fx: Fixture | undefined
afterEach(async () => {
  await fx?.cleanup()
  fx = undefined
})

async function agentWith(script: ReturnType<typeof callTurn>[]) {
  fx = await makeFixture()
  const home = join(fx.base, 'home')
  await mkdir(home, { recursive: true })
  const events: AgentEvent[] = []
  const vertex = scriptedVertex(script)
  const agent = new AgentSession({
    projectRoot: fx.root,
    settings: { ...DEFAULT_SETTINGS, permissionMode: 'ask' },
    vertex,
    registry: createRegistry([readTool]),
    audit: new AuditLog(join(fx.base, 'audit'), 's1'),
    checkpoints: new CheckpointStore(join(fx.base, 'ckpt'), 's1'),
    sessions: new SessionStore(join(fx.base, 'sessions')).create(fx.root),
    rules: new ProjectRules(fx.root),
    approver: async () => ({ decision: 'allow-once' }),
    askUser: async () => '',
    emit: (e) => events.push(e),
    home,
    protectedPaths: protectedWritePaths(home, join(fx.base, 'arc-data')),
    sandboxAvailable: false,
  })
  return { agent, events, vertex }
}

it('PROBE long path component', async () => {
  const { agent, vertex, events } = await agentWith([
    callTurn([{ name: 'Read', args: { file_path: 'a'.repeat(300) }, id: 'c1' }]),
    textTurn('x'),
    textTurn('y'),
  ])
  const r1 = await agent.sendMessage('go')
  const r2 = await agent.sendMessage('again')
  const h = agent.getHistory()
  console.log('PROBE1', r1, r2, JSON.stringify(h.map((c) => [c.role, c.parts.map((p) => Object.keys(p)[0])])))
  console.log('PROBE1 notices', JSON.stringify(events.filter((e) => e.type === 'notice')))
  console.log('PROBE1 req2 tail', JSON.stringify(vertex.requests[1]?.contents.slice(-3).map((c) => [c.role, c.parts.map((p) => Object.keys(p)[0])])))
})

it('PROBE symlink loop', async () => {
  const { agent } = await agentWith([callTurn([{ name: 'Read', args: { file_path: 'loop/x' }, id: 'c1' }]), textTurn('x')])
  await symlink('loop', join(fx!.root, 'loop'))
  const r1 = await agent.sendMessage('go')
  console.log('PROBE2', r1, JSON.stringify(agent.getHistory().map((c) => [c.role, c.parts.map((p) => Object.keys(p)[0])])))
})

it('PROBE case variant of .arc', async () => {
  fx = await makeFixture()
  const home = join(fx.base, 'home')
  const ctx = {
    mode: 'auto-edit' as const,
    projectRoot: fx.root,
    extraDirs: [],
    home,
    protectedPaths: protectedWritePaths(home, join(fx.base, 'arc-data')),
    rules: [],
    sandboxAvailable: false,
    caseInsensitive: true,
  }
  for (const p of ['.arc/settings.json', '.ARC/settings.json', '.Arc/settings.json']) {
    const v = await decide({ id: '1', name: 'Write', args: { file_path: p, content: '{}' } }, ctx)
    console.log('PROBE3', p, v.verdict, v.reason)
  }
})

it('PROBE edit latin1', async () => {
  fx = await makeFixture()
  const f = join(fx.root, 'l1.txt')
  await writeFile(f, Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a, 0x78, 0x0a])) // "café\nx\n" latin-1
  const r = await editTool.run({ file_path: 'l1.txt', old_string: 'x', new_string: 'y' }, fx.ctx)
  const after = await readFile(f)
  console.log('PROBE4', r.ok, JSON.stringify([...after]))
})

it('PROBE glob braces', async () => {
  fx = await makeFixture()
  await writeFile(join(fx.base, 'outside-secret.txt'), 's')
  await mkdir(join(fx.root, 'src'))
  await writeFile(join(fx.root, 'src', 'a.ts'), 'a')
  for (const pattern of ['{..,src}/*', 'src/{..,.}/../*', '{/tmp,src}/*']) {
    const r = await globTool.run({ pattern }, fx.ctx)
    console.log('PROBE5', pattern, JSON.stringify(r))
  }
})
