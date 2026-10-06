import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, SettingsStore } from '../../src/main/store/settings'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'arc-settings-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('SettingsStore', () => {
  it('defaults: both agents use gemini-3.8-flash, permission mode is ask', async () => {
    const s = await new SettingsStore(dir).load()
    expect(s).toEqual(DEFAULT_SETTINGS)
    expect(s.model).toBe('gemini-3.8-flash')
    expect(s.prompterModel).toBe('gemini-3.8-flash')
    expect(s.permissionMode).toBe('ask')
    expect(s.prompter).toEqual({ mode: 'suggest', maxRounds: 5, tokenBudget: 200_000 })
    expect(s.maxSteps).toBe(40)
    expect(s.turnTokenBudget).toBe(500_000)
    expect(s.contextWindowTokens).toBe(1_048_576)
    expect(s.extraDirs).toEqual([])
    expect(s.theme).toBe('ai')
  })

  it('saving a different prompterModel leaves the coder model untouched', async () => {
    const store = new SettingsStore(dir)
    const saved = await store.save({ prompterModel: 'my-custom-model' })
    expect(saved.prompterModel).toBe('my-custom-model')
    expect(saved.model).toBe('gemini-3.8-flash')
  })

  it('round-trips through disk with a fresh store instance', async () => {
    await new SettingsStore(dir).save({ model: 'abc', permissionMode: 'auto-edit', theme: 'studios' })
    const again = await new SettingsStore(dir).load()
    expect(again).toMatchObject({ model: 'abc', permissionMode: 'auto-edit', theme: 'studios' })
  })

  it('merges a partial prompter patch with the existing prompter settings', async () => {
    const saved = await new SettingsStore(dir).save({ prompter: { mode: 'autopilot' } })
    expect(saved.prompter).toEqual({ mode: 'autopilot', maxRounds: 5, tokenBudget: 200_000 })
  })

  it('falls back to defaults and keeps a .bak for corrupt JSON', async () => {
    await writeFile(join(dir, 'settings.json'), '{ not json')
    const s = await new SettingsStore(dir).load()
    expect(s).toEqual(DEFAULT_SETTINGS)
    expect(await readFile(join(dir, 'settings.json.bak'), 'utf8')).toBe('{ not json')
  })

  it('falls back to defaults and keeps a .bak when values are invalid', async () => {
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ maxSteps: -5 }))
    const s = await new SettingsStore(dir).load()
    expect(s).toEqual(DEFAULT_SETTINGS)
    expect((await readdir(dir)).includes('settings.json.bak')).toBe(true)
  })

  it('rejects an out-of-range patch and leaves the file unchanged', async () => {
    const store = new SettingsStore(dir)
    await store.save({ maxSteps: 12 })
    await expect(store.save({ maxSteps: -1 })).rejects.toThrow()
    expect((await store.load()).maxSteps).toBe(12)
  })

  it('does not lose updates from concurrent saves', async () => {
    const store = new SettingsStore(dir)
    await Promise.all([store.save({ maxSteps: 10 }), store.save({ theme: 'studios' })])
    expect(await store.load()).toMatchObject({ maxSteps: 10, theme: 'studios' })
  })

  it('never writes a partial file (no tmp left behind)', async () => {
    await new SettingsStore(dir).save({ maxSteps: 11 })
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})
