import { createHash, randomBytes } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

export interface SessionMeta {
  id: string
  title: string
  projectRoot: string
  createdAt: string
  updatedAt: string
}

export interface SessionHandle {
  id: string
  append(content: unknown): Promise<void>
  setTitle(title: string): Promise<void>
}

const ID_RE = /^[a-f0-9]{8}-[a-z0-9]+-[a-z0-9]+$/
const TITLE_CHARS = 60

const projectHash = (projectRoot: string) => createHash('sha1').update(projectRoot).digest('hex').slice(0, 8)

function firstUserText(content: unknown): string | null {
  const c = content as { role?: string; parts?: Array<{ text?: string }> }
  if (c?.role !== 'user') return null
  const text = c.parts?.map((p) => p.text ?? '').join(' ').trim()
  return text ? text : null
}

interface ParsedSession {
  meta: SessionMeta
  history: unknown[]
}

function parse(id: string, raw: string): ParsedSession | null {
  let meta: SessionMeta | null = null
  const history: unknown[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let row: any
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (row.t === 'meta') {
      meta = { id, title: row.title ?? '', projectRoot: row.projectRoot, createdAt: row.at, updatedAt: row.at }
    } else if (meta && row.t === 'msg') {
      history.push(row.content)
      meta.updatedAt = row.at
    } else if (meta && row.t === 'title') {
      meta.title = row.title
      meta.updatedAt = row.at
    }
  }
  return meta ? { meta, history } : null
}

/** Sessions as JSONL files: `<dir>/<project hash>/<session id>.jsonl`. */
export class SessionStore {
  constructor(
    private readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private fileFor(id: string): string {
    if (!ID_RE.test(id)) throw new Error(`Invalid session id: ${id}`)
    return join(this.dir, id.split('-')[0], `${id}.jsonl`)
  }

  private handle(id: string, projectRoot: string | null, initialized: boolean, titled: boolean): SessionHandle {
    const file = this.fileFor(id)
    let chain: Promise<unknown> = Promise.resolve()
    let started = initialized
    let hasTitle = titled
    const write = (row: object) => {
      const run = async () => {
        await mkdir(join(this.dir, id.split('-')[0]), { recursive: true })
        let out = ''
        if (!started) {
          started = true
          out += JSON.stringify({ t: 'meta', projectRoot, title: '', at: this.now().toISOString() }) + '\n'
        }
        out += JSON.stringify({ ...row, at: this.now().toISOString() }) + '\n'
        await appendFile(file, out)
      }
      const next = chain.then(run, run)
      chain = next.catch(() => undefined)
      return next as Promise<void>
    }
    return {
      id,
      append: async (content) => {
        await write({ t: 'msg', content })
        const text = hasTitle ? null : firstUserText(content)
        if (text) {
          hasTitle = true
          await write({ t: 'title', title: text.slice(0, TITLE_CHARS) })
        }
      },
      setTitle: async (title) => {
        hasTitle = true
        await write({ t: 'title', title })
      },
    }
  }

  create(projectRoot: string): SessionHandle {
    const id = `${projectHash(projectRoot)}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
    return this.handle(id, projectRoot, false, false)
  }

  async open(id: string): Promise<SessionHandle> {
    const parsed = parse(id, await readFile(this.fileFor(id), 'utf8'))
    if (!parsed) throw new Error(`Session not found: ${id}`)
    return this.handle(id, parsed.meta.projectRoot, true, parsed.meta.title !== '')
  }

  async load(id: string): Promise<ParsedSession> {
    const parsed = parse(id, await readFile(this.fileFor(id), 'utf8'))
    if (!parsed) throw new Error(`Session not found: ${id}`)
    return parsed
  }

  async list(projectRoot: string): Promise<SessionMeta[]> {
    const folder = join(this.dir, projectHash(projectRoot))
    let files: string[]
    try {
      files = await readdir(folder)
    } catch {
      return []
    }
    const metas: SessionMeta[] = []
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      const id = f.slice(0, -'.jsonl'.length)
      if (!ID_RE.test(id)) continue
      const parsed = parse(id, await readFile(join(folder, f), 'utf8').catch(() => ''))
      if (parsed && parsed.meta.projectRoot === projectRoot && parsed.history.length > 0) metas.push(parsed.meta)
    }
    return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
}
