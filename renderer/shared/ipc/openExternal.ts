// 外链统一出口：window.open 已被主进程 deny，这里经 edtRuntime 交给主进程校验协议与来源后
// 用系统浏览器打开；网页预览（无 preload）下静默忽略。
export function openExternal(url: string): void {
  const runtime = (window as unknown as { edtRuntime?: { openExternal?: (url: string) => void } }).edtRuntime
  runtime?.openExternal?.(url)
}
