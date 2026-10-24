// 桌面端判定：Tauri 运行时内部对象存在即为桌面端；纯浏览器预览为 false。
import { isTauriEnvironment } from '../desktop/tauri'

export function isDesktopEnvironment(): boolean {
  return isTauriEnvironment()
}
