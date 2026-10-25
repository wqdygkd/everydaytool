import type { IpcInvokeApi } from '@renderer/shared/ipc/types'
import { createIpcHelpers } from '@renderer/shared/ipc/createIpcHelpers'

const {
  channels: interceptorIpcChannels,
  invoke: invokeInterceptorIpc,
  on: onInterceptorIpc,
  getApi,
} = createIpcHelpers('interceptor', '拦截器')

/** 拦截器仅桌面端：无 preload 时直接抛错（由调用方决定如何提示） */
export function getInterceptorApi(): IpcInvokeApi {
  return getApi()
}

export { interceptorIpcChannels, invokeInterceptorIpc, onInterceptorIpc }
