let busy = false
let activeAbort: AbortController | null = null

/**
 * 用户主动取消下载：既不是安装失败，也不该记进 lastError
 * （判「是不是取消」用 isWb2apiCancelled，跨模块只认类型，不比对文案）。
 */
export class Wb2apiCancelledError extends Error {
  constructor(message = '已取消下载') {
    super(message)
    this.name = 'Wb2apiCancelledError'
  }
}

export function isWb2apiCancelled(error: unknown): boolean {
  return error instanceof Wb2apiCancelledError
}

export function isInstallBusy(): boolean {
  return busy
}

export function setInstallBusy(value: boolean): void {
  busy = value
}

export function setActiveAbort(controller: AbortController | null): void {
  activeAbort = controller
}

export function cancelActiveDownload(): boolean {
  if (!activeAbort) return false
  activeAbort.abort()
  return true
}
