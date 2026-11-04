import type { IpcChannels } from '../shared/ipc-validation.ts'
import { contextBridge, ipcRenderer } from 'electron'
import { EDT_APP_IPC_CHANNELS } from '../backend/ipc/channels.ts'
import { toIpcError } from '../shared/ipc-error.ts'
import { isAllowedIpcChannel, isAllowedIpcEventChannel } from '../shared/ipc-validation.ts'
import { ipcNamespaces } from './ipc-namespaces.ts'

// eslint-disable-next-line node/prefer-global/process -- preload 内不能打包成运行时 require
const _platform = (globalThis as unknown as { process?: { platform?: string } }).process?.platform
  ?? 'win32'
const EDT_RUNTIME = {
  target: _platform === 'darwin' ? 'mac' : _platform === 'linux' ? 'linux' : 'win',
  platform: _platform,
  // 外部打开：window.open 已被主进程 deny，外跳统一由主进程校验协议后交给系统浏览器
  openExternal: (url: string) => {
    ipcRenderer.send(EDT_APP_IPC_CHANNELS.OPEN_EXTERNAL, url)
  },
} as const

type IpcListener = (payload: unknown) => void

function exposeIpcApi(channels: IpcChannels) {
  return {
    // 通道白名单：渲染层（含被注入脚本）只能用本命名空间登记的通道，
    // 避免借用任一句柄调用其它工具域的通道（越权到沙箱删除 / 进程启动等能力）
    invoke(channel: string, ...args: unknown[]): Promise<unknown> {
      if (!isAllowedIpcChannel(channels, channel)) {
        return Promise.reject(new Error(`IPC channel not allowed: ${String(channel)}`))
      }
      // Electron 会给跨进程错误加 `Error invoking remote method '<channel>':` 前缀，
      // 这层信息对用户没有意义（还会掩盖真正的业务错误），统一剥掉再抛给渲染层。
      return ipcRenderer.invoke(channel, ...args).catch((error: unknown) => {
        throw toIpcError(error)
      })
    },
    on(channel: string, callback: IpcListener): () => void {
      if (!isAllowedIpcEventChannel(channels, channel)) {
        throw new Error(`IPC event channel not allowed: ${String(channel)}`)
      }
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
