/** Pure window, menu and origin helpers. No Electron imports, so they are unit tested. */

export interface MenuTemplateItem {
  label?: string
  role?: string
  type?: 'separator'
  submenu?: MenuTemplateItem[]
}

export function buildWebPreferences(preloadPath: string) {
  return {
    contextIsolation: true as const,
    nodeIntegration: false as const,
    sandbox: true as const,
    webSecurity: true as const,
    preload: preloadPath,
  }
}

/** AIVEN surface colour, hidden until ready, inset title bar and sidebar vibrancy. */
export function buildWindowOptions(preloadPath: string) {
  return {
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#020203',
    titleBarStyle: 'hiddenInset' as const,
    trafficLightPosition: { x: 16, y: 18 },
    vibrancy: 'sidebar' as const,
    visualEffectState: 'followWindow' as const,
    webPreferences: buildWebPreferences(preloadPath),
  }
}

/** Only the standard macOS menus, so copy and paste work and nothing else clutters the menu bar. */
export function buildAppMenuTemplate(appName: string): MenuTemplateItem[] {
  const sep: MenuTemplateItem = { type: 'separator' }
  return [
    {
      label: appName,
      submenu: [{ role: 'about' }, sep, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, sep, { role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [{ role: 'undo' }, { role: 'redo' }, sep, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, sep, { role: 'front' }] },
  ]
}

/** Strict policy for the packaged renderer: nothing remote, no inline or eval script, no network from the page. */
export function buildCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/** True only when `frameUrl` belongs to exactly `appOrigin` (scheme and host, e.g. "arc://app"). */
export function isTrustedSender(frameUrl: string, appOrigin: string): boolean {
  try {
    const u = new URL(frameUrl)
    if (u.username || u.password) return false
    return `${u.protocol}//${u.host}` === appOrigin
  } catch {
    return false
  }
}

export function isSafeExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
