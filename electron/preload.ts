import process from 'node:process'
import { contextBridge, ipcRenderer } from 'electron'
import { CDP_IPC_CHANNELS } from '../tools/cdp-injector/backend/ipc/channels.js'
import { IPC_CHANNELS } from '../tools/chrome-sandbox/backend/ipc/channels.js'

const EDT_RUNTIME = {
  target: process.platform === 'darwin' ? 'mac' : 'win',
  platform: process.platform,
} as const

type IpcChannels = Record<string, string>
type IpcListener = (payload: unknown) => void

function exposeIpcApi(channels: IpcChannels) {
  return {
    invoke(channel: string, ...args: unknown[]): Promise<unknown> {
      return ipcRenderer.invoke(channel, ...args)
    },
    on(channel: string, callback: IpcListener): () => void {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    channels,
  }
}

contextBridge.exposeInMainWorld('edtRuntime', EDT_RUNTIME)
contextBridge.exposeInMainWorld('chromeSandbox', exposeIpcApi(IPC_CHANNELS))
contextBridge.exposeInMainWorld('cdpInjector', exposeIpcApi(CDP_IPC_CHANNELS))
