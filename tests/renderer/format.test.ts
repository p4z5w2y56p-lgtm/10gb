import { describe, expect, it } from 'vitest'
import { baseName, dirName, formatAgo } from '../../src/renderer/ui/format'

describe('formatAgo', () => {
  const now = Date.parse('2026-10-07T12:00:00Z')
  it.each([
    ['2026-10-07T11:59:40Z', 'just now'],
    ['2026-10-07T11:55:00Z', '5 min ago'],
    ['2026-10-07T09:00:00Z', '3 h ago'],
    ['2026-10-06T10:00:00Z', 'yesterday'],
    ['2026-10-03T10:00:00Z', '4 days ago'],
    ['2026-08-01T10:00:00Z', '1 Aug'],
  ])('%s -> %s', (iso, expected) => {
    expect(formatAgo(iso, now)).toBe(expected)
  })
  it('tolerates garbage', () => {
    expect(formatAgo('nope', now)).toBe('')
  })
})

describe('paths', () => {
  it('splits a path into name and folder', () => {
    expect(baseName('/p/src/app.ts')).toBe('app.ts')
    expect(dirName('/p/src/app.ts')).toBe('/p/src')
    expect(baseName('app.ts')).toBe('app.ts')
    expect(dirName('app.ts')).toBe('')
    expect(baseName('/p/src/')).toBe('src')
  })
})
