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

/** 外链经主进程校验协议后交给系统浏览器打开 */
export function openExternal(url: string): void {
  const w = window as unknown as { edtRuntime?: { openExternal?: (u: string) => void } }
  w.edtRuntime?.openExternal?.(url)
}
