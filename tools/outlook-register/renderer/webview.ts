// Electron <webview> 是自定义元素，DOM lib 没有这些方法。
export type OutlookWebviewTag = Omit<HTMLElement, 'addEventListener'> & {
  src: string
  partition: string
  getURL: () => string
  getTitle: () => string
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
  removeEventListener: (event: string, listener: (event: unknown) => void) => void
}

export function asOutlookWebview(value: unknown): OutlookWebviewTag | null {
  return value ? value as OutlookWebviewTag : null
}
