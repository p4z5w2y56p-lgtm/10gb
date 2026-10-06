import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

let counter = 0

/** Write via a temp file in the same directory, then rename, so readers never see a partial file. */
export async function atomicWrite(path: string, data: string | Buffer, mode?: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.${counter++}.tmp`
  try {
    await writeFile(tmp, data, mode === undefined ? undefined : { mode })
    await rename(tmp, path)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}
