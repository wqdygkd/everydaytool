import { openExternal as openExternalUrl } from '@/desktop/platform'
import { createCommandHelpers } from '@/shared/commands/createCommandHelpers'

const { getApi } = createCommandHelpers('workbuddy2apiPanel', 'WorkBuddy2API')

/**
 * 本工具唯一的命令入口实例：页面从 `api.ts` 取，不各自 `createCommandHelpers`。
 * 网页预览（无 Tauri 桌面桥接）时返回 null —— 该工具仅桌面端注册，正常不会走到。
 */
export function getWorkbuddyApi() {
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
