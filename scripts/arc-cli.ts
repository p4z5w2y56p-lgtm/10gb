/**
 * Terminal harness for AIVEN ARC's backend. Drives the same BackendApp the app uses,
 * so the agent, safety layer and Vertex client can be tried with a real key before
 * (or without) the UI.
 *
 *   ARC_API_KEY=... npm run arc -- --project <dir> [--mode ask|auto-edit|auto] [--model <id>] [--verbose] "<prompt>"
 *   ARC_API_KEY=... npm run arc -- --project <dir> --test-connection
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'
import { BackendApp } from '../src/main/backend'
import { MemoryKeyStore, type Cipher, type KeyStore } from '../src/main/store/secrets'
import type { AgentEvent, ApprovalDecision, PermissionMode } from '../src/shared/types'

const USAGE = `Usage: npm run arc -- --project <dir> [--mode ask|auto-edit|auto] [--model <id>] [--verbose] "<prompt>"
       npm run arc -- --project <dir> --test-connection
The API key is read from ARC_API_KEY.`

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    project: { type: 'string' },
    mode: { type: 'string' },
    model: { type: 'string' },
    verbose: { type: 'boolean' },
    'test-connection': { type: 'boolean' },
    'vertex-url': { type: 'string' },
    'data-dir': { type: 'string' },
    help: { type: 'boolean' },
  },
})

const fail = (message: string, code: number): never => {
  process.stderr.write(`${message}\n`)
  process.exit(code)
}

/** The harness never writes the key to disk. */
const memoryKeyStore = (): KeyStore => new MemoryKeyStore()

const unusedCipher: Cipher = {
  isAvailable: () => false,
  encrypt: () => Buffer.alloc(0),
  decrypt: () => '',
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)

async function main(): Promise<number> {
  if (values.help) return fail(USAGE, 2) as never
  const testOnly = values['test-connection'] === true
  const prompt = positionals.join(' ').trim()
  if (!values.project) return fail(`${USAGE}`, 2) as never
  if (!testOnly && !prompt) return fail(USAGE, 2) as never
  const key = process.env.ARC_API_KEY?.trim()
  if (!key) return fail('No API key. Set ARC_API_KEY or add one in Settings.', 2) as never
  const mode = values.mode as PermissionMode | undefined
  if (mode && !['ask', 'auto-edit', 'auto'].includes(mode)) return fail(`Unknown mode: ${mode}`, 2) as never

  const verbose = values.verbose === true
  const tempData = values['data-dir'] ? null : await mkdtemp(join(tmpdir(), 'arc-cli-'))
  const dataDir = values['data-dir'] ?? tempData!
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false })
  // Lines can arrive before anyone asks for them (piped input), so queue them.
  const queued: string[] = []
  const waiting: Array<(line: string) => void> = []
  let closed = false
  rl.on('line', (line) => {
    const next = waiting.shift()
    if (next) next(line)
    else queued.push(line)
  })
  rl.on('close', () => {
    closed = true
    for (const next of waiting.splice(0)) next('')
  })
  const ask = (question: string): Promise<string> => {
    process.stdout.write(question)
    if (queued.length > 0) return Promise.resolve(queued.shift()!)
    if (closed) return Promise.resolve('')
    return new Promise((resolve) => waiting.push(resolve))
  }

  let backend: BackendApp
  const onEvent = (e: AgentEvent): void => {
    switch (e.type) {
      case 'text-delta':
        process.stdout.write(e.text)
        break
      case 'activity': {
        const tag = { running: '[run] ', done: '[ ok] ', failed: '[fail]', denied: '[deny]' }[e.state]
        process.stdout.write(`\n${tag} ${e.label}`)
        break
      }
      case 'status':
        if (verbose) process.stdout.write(`\n(${e.state}: ${e.label})`)
        break
      case 'tool-call':
        if (verbose) process.stdout.write(`\n  call ${e.call.name} ${clip(JSON.stringify(e.call.args), 300)}`)
        break
      case 'tool-result':
        if (verbose) process.stdout.write(`\n${clip(e.result.output, 2000)}`)
        break
      case 'notice':
        process.stderr.write(`\nnote (${e.level}): ${e.message}\n`)
        break
      case 'todos':
        if (verbose) process.stdout.write(`\n  plan: ${e.todos.filter((t) => t.status === 'completed').length}/${e.todos.length} done`)
        break
      case 'turn-end':
        process.stdout.write('\n')
        break
      case 'approval-request': {
        const { call, reason, diff } = e.request
        void (async () => {
          process.stdout.write(`\n? ${reason}\n`)
          if (call.name === 'Bash') process.stdout.write(`  command: ${String(call.args.command)}\n`)
          else if (typeof call.args.file_path === 'string') process.stdout.write(`  file: ${call.args.file_path}\n`)
          if (verbose && diff) process.stdout.write(`${diff}\n`)
          const answer = (await ask('Allow? [y] once  [a] always  [n] no > ')).trim().toLowerCase()
          const decision: ApprovalDecision =
            answer === 'y' || answer === 'yes'
              ? { decision: 'allow-once' }
              : answer === 'a' || answer === 'always'
                ? { decision: 'always' }
                : { decision: 'deny', note: 'Declined in the terminal' }
          backend.resolveApproval(call.id, decision)
        })()
        break
      }
      case 'question':
        void (async () => backend.resolveAnswer(e.id, (await ask(`\n? ${e.question}${e.options ? ` (${e.options.join(' / ')})` : ''} > `)).trim()))()
        break
      default:
        break
    }
  }

  backend = new BackendApp({
    dataDir,
    cipher: unusedCipher,
    keyStore: memoryKeyStore(),
    home: homedir(),
    emit: onEvent,
    vertexBaseUrl: values['vertex-url'],
  })
  process.on('SIGINT', () => {
    backend.stop()
    setTimeout(() => process.exit(130), 200).unref()
  })

  let code = 0
  try {
    await backend.init()
    await backend.setApiKey(key)
    await backend.saveSettings({
      prompter: { mode: 'off' },
      ...(mode ? { permissionMode: mode } : {}),
      ...(values.model ? { model: values.model } : {}),
    })
    if (testOnly) {
      const results = await backend.testConnection()
      for (const r of results) process.stdout.write(`${r.ok ? 'OK  ' : 'FAIL'} ${r.label}: ${r.message}\n`)
      code = results.every((r) => r.ok) ? 0 : 1
    } else {
      await backend.openProject(values.project!)
      const reason = await backend.send(prompt)
      code = reason === 'done' ? 0 : 1
    }
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    code = 1
  } finally {
    rl.close()
    if (tempData) await rm(tempData, { recursive: true, force: true })
  }
  return code
}

main().then((code) => process.exit(code))
