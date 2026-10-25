import { createIpcHelpers } from '@renderer/shared/ipc/createIpcHelpers'

const { getApi } = createIpcHelpers('telegramCache', 'Telegram 网络优化')

/** 网页预览（无 preload / 工具未在 web 目标注册）时返回 null，调用方走降级分支 */
export function getTelegramCacheApi() {
  try {
    return getApi()
  } catch {
    return null
  }
}

/** 外链统一经主进程校验协议后交给系统浏览器（window.open 已被主进程 deny） */
export function openExternal(url: string): void {
  const w = window as unknown as { edtRuntime?: { openExternal?: (u: string) => void } }
  w.edtRuntime?.openExternal?.(url)
}
