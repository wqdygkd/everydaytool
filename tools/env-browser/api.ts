import { openExternal as openExternalUrl } from '@/desktop/platform'
import { createCommandHelpers } from '@/shared/commands/createCommandHelpers'

const { getApi } = createCommandHelpers('envBrowser', '环境浏览器')

/**
 * 本工具唯一的命令入口实例：store / 页面都从这里取，不各自 `createCommandHelpers`。
 * 网页预览（无 Tauri 桌面桥接）时返回 null，调用方走 localStorage 等降级分支。
 */
export function getEnvBrowserApi() {
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
