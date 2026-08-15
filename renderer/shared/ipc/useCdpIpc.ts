import type { IpcInvokeApi } from './types'

export function getCdpInjectorApi(): IpcInvokeApi {
  const api = window.cdpInjector
  if (!api) {
    throw new Error('未检测到 CDP 注入 IPC，请通过 pnpm dev 或 pnpm start 启动 everydaytool')
  }
  return api
}

export function cdpIpcChannels() {
  return getCdpInjectorApi().channels
}

export function invokeCdpIpc<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  return getCdpInjectorApi().invoke(channel, ...args) as Promise<T>
}

export function onCdpIpc<T = unknown>(channel: string, callback: (payload: T) => void): () => void {
  return getCdpInjectorApi().on(channel, callback as (payload: unknown) => void)
}
