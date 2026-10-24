// Tauri 桌面平台能力：目标客户端、系统平台与受控外链打开。
// 直接读取 Tauri 运行环境，不使用全局注入。
import { invokeDesktop, isTauriEnvironment } from './tauri'

export type ClientTarget = 'web' | 'win' | 'mac'
export type DesktopPlatform = 'darwin' | 'win32' | 'linux' | 'web'

export function getDesktopPlatform(): DesktopPlatform {
  if (!isTauriEnvironment()) return 'web'
  const ua = navigator.userAgent ?? ''
  if (/Macintosh|MacIntel|Mac OS/i.test(ua)) return 'darwin'
  if (/Windows/i.test(ua)) return 'win32'
  if (/Linux/i.test(ua)) return 'linux'
  return 'web'
}

export function getClientTarget(): ClientTarget {
  const platform = getDesktopPlatform()
  if (platform === 'darwin') return 'mac'
  if (platform === 'win32') return 'win'
  return 'web'
}

/** 外链统一交给 Rust 校验协议后由系统浏览器打开 */
export function openExternal(url: string): void {
  if (!isTauriEnvironment()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  void invokeDesktop('edt_open_external', { url }).catch((error) => {
    console.error('[desktop] open external failed', error)
  })
}
