import { BrowserWindow, shell } from 'electron'
import { buildWindowOptions, isSafeExternalUrl } from './windowConfig'

/** The one window: secure web preferences, shown only once painted, and locked to the app. */
export function createMainWindow(preloadPath: string): BrowserWindow {
  const win = new BrowserWindow(buildWindowOptions(preloadPath))
  win.once('ready-to-show', () => win.show())
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  return win
}
