import { createIpcHelpers } from '@renderer/shared/ipc/createIpcHelpers'

const { getApi } = createIpcHelpers('offlinePack', '离线包下载')

/** 网页预览（无 preload 注入）时返回 null，调用方各自走降级分支 */
export function getOfflinePackApi() {
  try {
    return getApi()
  } catch {
    return null
  }
}
