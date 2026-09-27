// Electron 桌面端判定：优先读 preload 注入的 edtRuntime（preload 与各工具 IPC 命名空间同批注入），
// UA 兜底覆盖注入前的时序窗口。
export function isElectronEnvironment(): boolean {
  return Boolean(window.edtRuntime) || navigator.userAgent.includes('Electron')
}
