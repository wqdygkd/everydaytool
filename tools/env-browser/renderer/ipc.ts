import type { IpcInvokeApi } from '@renderer/shared/ipc/types'
import { createIpcHelpers } from '@renderer/shared/ipc/createIpcHelpers'

const {
  channels: envBrowserIpcChannels,
  invoke: invokeEnvBrowserIpc,
  on: onEnvBrowserIpc,
  getApi,
} = createIpcHelpers('envBrowser', '环境浏览器')

/** 网页预览（无 preload 注入）时返回 null，调用方回退 localStorage */
export function getEnvBrowserApi(): IpcInvokeApi | null {
  try {
    return getApi()
  } catch {
    return null
  }
}

export { envBrowserIpcChannels, invokeEnvBrowserIpc, onEnvBrowserIpc }
