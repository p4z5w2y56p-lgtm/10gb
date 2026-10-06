import { describe, expect, it } from 'vitest'
import {
  buildAppMenuTemplate,
  buildCsp,
  buildWebPreferences,
  buildWindowOptions,
  isSafeExternalUrl,
  isTrustedSender,
} from '../../src/main/windowConfig'

describe('buildWebPreferences', () => {
  it('is exactly the four secure flags plus the preload path', () => {
    expect(buildWebPreferences('/app/preload.cjs')).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: '/app/preload.cjs',
    })
  })
})

describe('buildWindowOptions', () => {
  const o = buildWindowOptions('/app/preload.cjs')

  it('paints the AIVEN surface colour and stays hidden until ready, so there is no white flash', () => {
    expect(o.show).toBe(false)
    expect(o.backgroundColor).toBe('#020203')
  })

  it('uses the inset macOS title bar with vibrancy', () => {
    expect(o.titleBarStyle).toBe('hiddenInset')
    expect(o.trafficLightPosition).toEqual({ x: 16, y: 18 })
    expect(o.vibrancy).toBe('sidebar')
    expect(o.visualEffectState).toBe('followWindow')
  })

  it('has sensible sizes and secure web preferences', () => {
    expect([o.width, o.height, o.minWidth, o.minHeight]).toEqual([1280, 840, 900, 600])
    expect(o.webPreferences).toEqual(buildWebPreferences('/app/preload.cjs'))
  })
})

describe('buildAppMenuTemplate', () => {
  const menu = buildAppMenuTemplate('AIVEN ARC')
  const roles = (label: string) => menu.find((m) => m.label === label)!.submenu!.map((i) => i.role).filter(Boolean)

  it('has only the standard top-level menus', () => {
    expect(menu.map((m) => m.label)).toEqual(['AIVEN ARC', 'Edit', 'Window'])
  })

  it('keeps copy and paste working through Edit roles', () => {
    for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) expect(roles('Edit')).toContain(role)
  })

  it('has the standard app and window roles and nothing custom', () => {
    expect(roles('AIVEN ARC')).toEqual(expect.arrayContaining(['about', 'hide', 'quit']))
    expect(roles('Window')).toEqual(expect.arrayContaining(['minimize', 'zoom', 'front']))
    const all = menu.flatMap((m) => m.submenu!)
    expect(all.every((i) => i.type === 'separator' || i.role)).toBe(true)
  })
})

describe('buildCsp', () => {
  const csp = buildCsp()
  it('locks everything to the app and blocks network from the page', () => {
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
  })
  it('allows no remote hosts and no inline or eval script', () => {
    expect(csp).not.toMatch(/https?:/)
    expect(csp).not.toContain('*')
    const script = csp.split(';').find((d) => d.trim().startsWith('script-src'))!
    expect(script).not.toContain('unsafe')
  })
})

describe('isTrustedSender', () => {
  const origin = 'arc://app'
  it('accepts pages of the app origin', () => {
    expect(isTrustedSender('arc://app/index.html', origin)).toBe(true)
    expect(isTrustedSender('arc://app/', origin)).toBe(true)
  })
  it.each([
    'https://evil.test/',
    'file:///tmp/x.html',
    'arc://app.evil/index.html',
    'arc://app@evil/index.html',
    'arc://evil/app',
    'http://localhost:5173/',
    '',
    'not a url',
  ])('rejects %s', (url) => {
    expect(isTrustedSender(url, origin)).toBe(false)
  })
  it('accepts the dev server only when it is the configured origin', () => {
    expect(isTrustedSender('http://localhost:5173/index.html', 'http://localhost:5173')).toBe(true)
    expect(isTrustedSender('http://localhost:5174/index.html', 'http://localhost:5173')).toBe(false)
  })
})

describe('isSafeExternalUrl', () => {
  it('allows only http and https', () => {
    expect(isSafeExternalUrl('https://example.com/a')).toBe(true)
    expect(isSafeExternalUrl('http://example.com')).toBe(true)
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'mailto:a@b.c', 'arc://app/x', 'nope']) {
      expect(isSafeExternalUrl(bad), bad).toBe(false)
    }
  })
})
