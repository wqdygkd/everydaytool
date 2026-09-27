import type { IpcInvokeApi } from './types'

export function createIpcHelpers(namespace: string, label: string): {
  getApi: () => IpcInvokeApi
  channels: () => Record<string, string>
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>
  on: <T = unknown>(channel: string, callback: (payload: T) => void) => () => void
} {
  function getApi(): IpcInvokeApi {
    const api = (window as unknown as Record<string, IpcInvokeApi | undefined>)[namespace]
    if (!api) {
      throw new Error(`未检测到 ${label} IPC，请通过 pnpm dev 或 pnpm start 启动 everydaytool`)
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
