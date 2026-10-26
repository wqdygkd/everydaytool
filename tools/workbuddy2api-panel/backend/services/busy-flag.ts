let busy = false
let activeAbort: AbortController | null = null

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
