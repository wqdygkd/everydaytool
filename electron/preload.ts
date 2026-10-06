import type { ShellMenuAction } from '../shared/types.js'
import { contextBridge, ipcRenderer } from 'electron'
import { ipcNamespaces } from './ipc-namespaces.js'

// eslint-disable-next-line node/prefer-global/process -- preload 内不能打包成运行时 require
const _platform = (globalThis as unknown as { process?: { platform?: string } }).process?.platform
  ?? 'win32'
const EDT_RUNTIME = {
  target: _platform === 'darwin' ? 'mac' : 'win',
  platform: _platform,
  // 应用菜单动作桥接（主进程执行；页内菜单已移除，保留备用）
  menuAction: (action: ShellMenuAction) => {
    ipcRenderer.send('edt:menu-action', action)
  },
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
for (const namespace of ipcNamespaces) {
  contextBridge.exposeInMainWorld(namespace.preloadNamespace, exposeIpcApi(namespace.channels))
}
