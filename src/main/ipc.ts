import { dialog, ipcMain, type BrowserWindow } from 'electron'
import type { Channel } from '../shared/channels'
import type { Handler } from './ipcHandlers'

/** Wire the validated handlers to Electron. The sender frame's URL is what trust is judged on. */
export function registerIpc(handlers: Record<Channel, Handler>): void {
  for (const channel of Object.keys(handlers) as Channel[]) {
    ipcMain.handle(channel, (event, payload) => handlers[channel](event.senderFrame?.url ?? '', payload))
  }
}

export function makeFolderChooser(getWindow: () => BrowserWindow | null): () => Promise<string | null> {
  return async () => {
    const options = { title: 'Open a project folder', properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
    const win = getWindow()
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  }
}
