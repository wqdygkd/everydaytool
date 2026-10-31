// tweb 页面的 webview 最小类型（Electron 的 <webview> 是自定义元素，DOM lib 没有这些方法）。
export type TwebWebviewTag = Omit<HTMLElement, 'addEventListener'> & {
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
  executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>
  openDevTools: () => void
  closeDevTools: () => void
  isDevToolsOpened: () => boolean
  addEventListener: (event: string, listener: (event: unknown) => void) => void
}
