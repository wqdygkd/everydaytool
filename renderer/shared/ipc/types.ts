import type { ToolClientTarget } from '../types/tool'

// IPC 边界类型：window.chromeSandbox / window.wxpEnhancer 等全局声明。
// preload 仅桌面端注入，纯浏览器预览（pnpm web）下这些命名空间与 edtRuntime 都不存在，
// 因此全部声明为可选；渲染层统一经 createIpcHelpers 取用（缺失时给出可读错误）。

export interface EdtRuntimeApi {
  target: ToolClientTarget
  platform: string
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
    edtApp?: IpcInvokeApi
    interceptor?: IpcInvokeApi
    chromeSandbox?: IpcInvokeApi
    envBrowser?: IpcInvokeApi
    treeaseEditor?: IpcInvokeApi
    wxpEnhancer?: IpcInvokeApi
    offlinePack?: IpcInvokeApi
    telegramCache?: IpcInvokeApi
    workbuddy2apiPanel?: IpcInvokeApi
  }
}

export {}
