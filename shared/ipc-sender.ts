// IPC 调用方合法性校验（主进程侧）：只允许应用自身页面（file:// 打包产物或
// dev server 源）发起调用，阻断被注入脚本 / 远程页面借用 preload 句柄的越权调用。
import process from 'node:process'

export interface IpcSafetyOptions {
  /** 打包后应用入口目录（通常为 app.getAppPath()） */
  appPath?: string
}

function normalizeForCompare(target: string): string {
  // 只做分隔符统一与结尾裁剪（不能用 path.resolve：它会把 "C:/app" 这类
  // 非当前盘符的路径解析成相对路径），Windows 再做大小写无关比较
  const normalized = target.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function isTrustedIpcSenderUrl(url: string | undefined, options: IpcSafetyOptions = {}): boolean {
  if (!url) return false

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol === 'file:') {
    const appPath = options.appPath?.trim()
    if (!appPath) return false
    // 比较前统一分隔符/结尾，Windows 再做大小写无关比较
    // （不能用 path.resolve：它会把 "C:/app" 这类非当前盘符解析成相对路径）
    const filePath = normalizeForCompare(decodeURIComponent(parsed.pathname).replace(/^\/([A-Z]:)/i, '$1'))
    const root = normalizeForCompare(appPath.replace(/^\/([A-Z]:)/i, '$1'))
    if (filePath === root) return true
    return filePath.startsWith(`${root}/`)
  }

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    const host = parsed.hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
  }

  // devtools://、data:、about:blank 等一律不信任
  return false
}
