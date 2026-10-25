// Telegram Web A 的 webview 标签最小类型（与 env-browser / treease-editor 同款做法）：
// Electron 的 <webview> 是自定义元素，DOM lib 里没有这些方法；这里只声明本工具用到的部分，
// 避免 `as any` 到处散落。getWebContentsId 只有 guest 就绪后才可调用，调用方需 try/catch。
export type WebviewTag = Omit<HTMLElement, 'addEventListener'> & {
  src: string
  partition: string
  getURL: () => string
  canGoBack: () => boolean
  canGoForward: () => boolean
  goBack: () => void
  goForward: () => void
  reload: () => void
  loadURL: (url: string) => Promise<void>
  getWebContentsId: () => number
  openDevTools: () => void
  closeDevTools: () => void
  isDevToolsOpened: () => boolean
  addEventListener: (event: string, listener: (event: unknown) => void) => void
}
