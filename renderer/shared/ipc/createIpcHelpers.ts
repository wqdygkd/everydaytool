import type { IpcInvokeApi } from './types'
import { isElectronEnvironment } from '../environment'

export function createIpcHelpers(namespace: string, label: string): {
  getApi: () => IpcInvokeApi
  channels: () => Record<string, string>
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>
  on: <T = unknown>(channel: string, callback: (payload: T) => void) => () => void
} {
  function getApi(): IpcInvokeApi {
    const api = (window as unknown as Record<string, IpcInvokeApi | undefined>)[namespace]
    if (!api) {
      // 两种缺失原因分开报：网页预览（pnpm web / 直接用浏览器打开 dev server）本来就没有
      // preload，属于预期；Electron 里缺 namespace 才是 preload 未注入的真故障。
      throw new Error(isElectronEnvironment()
        ? `未检测到 ${label} IPC：preload 未成功注入，请重新运行 pnpm dev（或 pnpm start）`
        : `网页预览不支持 ${label} 相关功能，请在 everydaytool 桌面端中使用`)
    }
    return api
  }

  function channels(): Record<string, string> {
    return getApi().channels
  }

  function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
    return getApi().invoke(channel, ...args) as Promise<T>
  }

  function on<T = unknown>(channel: string, callback: (payload: T) => void): () => void {
    return getApi().on(channel, callback as (payload: unknown) => void)
  }

  return { getApi, channels, invoke, on }
}
