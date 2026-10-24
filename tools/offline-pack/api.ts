import { openExternal as openExternalUrl } from '@/desktop/platform'
import { createCommandHelpers } from '@/shared/commands/createCommandHelpers'

const { getApi } = createCommandHelpers('offlinePack', '离线包下载')

/** 网页预览（无 Tauri 桌面桥接）时返回 null，调用方各自走降级分支 */
export function getOfflinePackApi() {
  try {
    return getApi()
  } catch {
    return null
  }
}

/** 外链经 Rust 校验协议后交给系统浏览器打开 */
export function openExternal(url: string): void {
  openExternalUrl(url)
}
