import { createIpcHelpers } from '@renderer/shared/ipc/createIpcHelpers'

const {
  channels: telegramCacheIpcChannels,
  invoke: invokeTelegramCacheIpc,
  on: onTelegramCacheIpc,
  getApi,
} = createIpcHelpers('telegramCache', 'Telegram 网络优化')

/** 网页预览（无 preload / 工具未在 web 目标注册）时返回 null，调用方走降级分支 */
export function getTelegramCacheApi() {
  try {
    return getApi()
  } catch {
    return null
  }
}

export { invokeTelegramCacheIpc, onTelegramCacheIpc, telegramCacheIpcChannels }
