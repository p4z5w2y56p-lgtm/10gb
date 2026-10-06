import { contextBridge, ipcRenderer } from 'electron'
import { INVOKE_CHANNELS, IPC } from '../shared/channels'
import type { AgentEvent } from '../shared/types'

const allowed = new Set<string>(INVOKE_CHANNELS)

/** The only door between the page and the backend: a fixed list of channels, plus the event stream. */
contextBridge.exposeInMainWorld('arc', {
  invoke(channel: string, payload?: unknown): Promise<unknown> {
    return allowed.has(channel) ? ipcRenderer.invoke(channel, payload) : Promise.reject(new Error(`Unknown channel: ${channel}`))
  },
  onEvent(listener: (event: AgentEvent) => void): () => void {
    const handler = (_e: unknown, event: AgentEvent) => listener(event)
    ipcRenderer.on(IPC.event, handler)
    return () => ipcRenderer.removeListener(IPC.event, handler)
  },
})
