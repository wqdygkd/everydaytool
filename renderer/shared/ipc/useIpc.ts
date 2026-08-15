import type { IpcInvokeApi } from './types'

export function getChromeSandboxApi(): IpcInvokeApi {
  const api = window.chromeSandbox
  if (!api) {
    throw new Error('未检测到 Electron IPC，请通过 pnpm dev 或 pnpm start 启动 everydaytool')
  }
  return api
}

export function ipcChannels() {
  return getChromeSandboxApi().channels
}

export function invokeIpc<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  return getChromeSandboxApi().invoke(channel, ...args) as Promise<T>
}

export function onIpc<T = unknown>(channel: string, callback: (payload: T) => void): () => void {
  return getChromeSandboxApi().on(channel, callback as (payload: unknown) => void)
}
