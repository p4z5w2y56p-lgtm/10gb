import { homedir } from 'node:os'
import { join, normalize, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app, BrowserWindow, Menu, net, protocol, type MenuItemConstructorOptions } from 'electron'
import { IPC } from '../shared/channels'
import { BackendApp } from './backend'
import { makeFolderChooser, registerIpc } from './ipc'
import { createHandlers } from './ipcHandlers'
import { electronCipher } from './store/electronCipher'
import { createMainWindow } from './window'
import { buildAppMenuTemplate, buildCsp, isTrustedSender } from './windowConfig'

const here = fileURLToPath(new URL('.', import.meta.url))
const APP_NAME = 'AIVEN ARC'
const DEV_URL = process.env['ELECTRON_RENDERER_URL']

protocol.registerSchemesAsPrivileged([
  { scheme: 'arc', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

function appOrigin(): string {
  if (!DEV_URL) return 'arc://app'
  const u = new URL(DEV_URL)
  return `${u.protocol}//${u.host}`
}

/** Serve the packaged renderer from arc://app/, with the strict CSP, and never outside its folder. */
function serveRenderer(): void {
  const root = normalize(join(here, '../renderer'))
  protocol.handle('arc', async (request) => {
    const url = new URL(request.url)
    if (url.host !== 'app') return new Response('Not found', { status: 404 })
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    const file = normalize(join(root, rel))
    if (!file.startsWith(root + sep)) return new Response('Forbidden', { status: 403 })
    const res = await net.fetch(pathToFileURL(file).toString())
    const headers = new Headers(res.headers)
    headers.set('content-security-policy', buildCsp())
    return new Response(res.body, { status: res.status, headers })
  })
}

async function start(): Promise<void> {
  let win: BrowserWindow | null = null
  serveRenderer()

  const backend = new BackendApp({
    dataDir: app.getPath('userData'),
    cipher: electronCipher(),
    home: homedir(),
    emit: (event) => win?.webContents.send(IPC.event, event),
  })
  await backend.init()
  registerIpc(
    createHandlers({
      app: backend,
      isTrusted: (url) => isTrustedSender(url, appOrigin()),
      chooseFolder: makeFolderChooser(() => win),
    }),
  )
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildAppMenuTemplate(APP_NAME) as MenuItemConstructorOptions[]))

  const open = () => {
    win = createMainWindow(join(here, '../preload/index.cjs'))
    win.on('closed', () => (win = null))
    void win.loadURL(DEV_URL ?? 'arc://app/index.html')
  }
  open()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) open()
  })
  app.on('before-quit', () => backend.stop())
}

app.setName(APP_NAME)
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void app.whenReady().then(start)
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
