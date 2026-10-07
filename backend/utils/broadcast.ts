// 主进程 → 渲染层广播的统一封装：工具域不必各自遍历 BrowserWindow，
// 这里统一处理「窗口正在关闭 / 已销毁」导致的发送失败（单窗口失败不影响其余）。
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { BrowserWindow } = require('electron') as typeof import('electron')

export interface BroadcastOptions {
  /** 记录失败原因（可选） */
  onError?: (error: Error) => void
}

export function broadcastToWindows(
  channel: string,
  payload: unknown,
  options: BroadcastOptions = {},
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue
      win.webContents.send(channel, payload)
    } catch (error) {
      options.onError?.(error as Error)
    }
  }
}
