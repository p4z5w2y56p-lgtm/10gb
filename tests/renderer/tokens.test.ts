import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = (name: string) => readFileSync(new URL(`../../src/renderer/theme/${name}`, import.meta.url), 'utf8')
const norm = (v: string) => v.replace(/\s+/g, '').toLowerCase().replace(/0\./g, '.')

/** Custom properties per block: ":root", "ai", "studios". */
function parseTokens(source: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  const re = /(:root(?:\[data-theme="(\w+)"\])?)\s*\{([^}]*)\}/g
  for (const m of source.matchAll(re)) {
    const key = m[2] ?? 'root'
    const decls = (out[key] ??= {})
    for (const d of m[3].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decls[d[1]] = d[2].trim()
  }
  return out
}

const tokens = parseTokens(css('tokens.css'))
const valueOf = (theme: 'ai' | 'studios', name: string) => tokens[theme]?.[name] ?? tokens.root?.[name]

const REQUIRED = [
  '--surface', '--surface-panel', '--surface-deep', '--surface-field', '--ink', '--ink-heading', '--ink-muted',
  '--ink-on-deep', '--border', '--accent', '--accent-ink', '--signal', '--signal-soft', '--success',
  '--success-strong', '--warning', '--danger', '--radius-sm', '--radius-md', '--radius-lg', '--radius-xl',
  '--radius-pill', '--space-12', '--space-15', '--space-20', '--space-24', '--space-30', '--space-40',
  '--blur-glass', '--shadow-panel', '--shadow-cta', '--shadow-signal', '--font-ui', '--font-mono', '--ease', '--dur',
]

describe('design tokens', () => {
  it('defines every required token for both themes', () => {
    for (const theme of ['ai', 'studios'] as const) {
      for (const name of REQUIRED) expect(valueOf(theme, name), `${theme} ${name}`).toBeTruthy()
    }
  })

  it('AI theme carries the exact AIVEN values', () => {
    const expected: Record<string, string> = {
      '--surface': '#020203',
      '--surface-panel': 'rgba(15, 15, 20, 0.4)',
      '--surface-deep': 'rgba(0, 0, 0, 0.5)',
      '--ink': '#f0f0f5',
      '--ink-muted': '#8a8a9e',
      '--border': 'rgba(255, 255, 255, 0.08)',
      '--accent': '#ff6b00',
      '--accent-ink': '#000000',
      '--signal': '#00e5ff',
      '--signal-soft': 'rgba(0, 229, 255, 0.1)',
      '--success': '#00ff88',
      '--success-strong': '#00c851',
      '--warning': '#ffbb33',
      '--danger': '#ff4444',
      '--blur-glass': '20px',
    }
    for (const [name, value] of Object.entries(expected)) {
      expect(norm(valueOf('ai', name)!), name).toBe(norm(value))
    }
  })

  it('Studios theme swaps colours to the AIVEN Studios values', () => {
    const expected: Record<string, string> = {
      '--surface': '#f7f7f9',
      '--surface-panel': '#ffffff',
      '--ink': '#030303',
      '--ink-muted': '#666666',
      '--border': '#e2e2e5',
      '--accent': '#030303',
      '--accent-ink': '#f7f7f9',
      '--signal': '#111111',
      '--signal-soft': 'rgba(3, 3, 3, 0.06)',
    }
    for (const [name, value] of Object.entries(expected)) {
      expect(norm(valueOf('studios', name)!), name).toBe(norm(value))
    }
  })

  it('shares radii, spacing and fonts across themes', () => {
    for (const [name, value] of Object.entries({ '--radius-sm': '8px', '--radius-md': '12px', '--radius-lg': '16px', '--radius-xl': '24px', '--space-12': '12px', '--space-30': '30px' })) {
      expect(valueOf('ai', name)).toBe(value)
      expect(valueOf('studios', name)).toBe(value)
    }
    expect(valueOf('ai', '--font-ui')).toContain('Inter')
    expect(valueOf('ai', '--font-mono')).toContain('JetBrains Mono')
  })
})

describe('base styles', () => {
  const base = css('base.css')
  it('shows a signal-coloured focus ring', () => {
    expect(base).toMatch(/:focus-visible[^{]*\{[^}]*var\(--signal\)/)
  })
  it('turns motion off under prefers-reduced-motion', () => {
    expect(base).toContain('prefers-reduced-motion: reduce')
  })
  it('provides drag and no-drag regions for the inset title bar', () => {
    expect(base).toMatch(/\.drag\s*\{[^}]*-webkit-app-region:\s*drag/)
    expect(base).toMatch(/\.no-drag\s*\{[^}]*-webkit-app-region:\s*no-drag/)
  })
})
