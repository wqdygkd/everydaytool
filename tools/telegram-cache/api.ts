import { openExternal as openExternalUrl } from '@/desktop/platform'
import { createCommandHelpers } from '@/shared/commands/createCommandHelpers'

const { getApi } = createCommandHelpers('telegramCache', 'Telegram 网络优化')

/** 本工具唯一的命令入口实例；网页预览（无桌面桥接）返回 null。 */
export function getTelegramApi() {
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
