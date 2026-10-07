import type { ShellMenuAction } from '../../../shared/types'
import type { ToolClientTarget } from '../types/tool'

// IPC 边界类型：window.chromeSandbox / window.wxpEnhancer 全局声明

export interface EdtRuntimeApi {
  target: ToolClientTarget
  platform: string
  menuAction: (action: ShellMenuAction) => void
  openExternal?: (url: string) => void
}

export interface IpcInvokeApi {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  on: (channel: string, callback: (payload: unknown) => void) => () => void
  channels: Record<string, string>
}

declare global {
  interface Window {
    edtRuntime?: EdtRuntimeApi
    edtApp: IpcInvokeApi
    chromeSandbox: IpcInvokeApi
    envBrowser: IpcInvokeApi
    treeaseEditor: IpcInvokeApi
    wxpEnhancer: IpcInvokeApi
  }
}

export {}
