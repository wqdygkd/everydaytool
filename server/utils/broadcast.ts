// 主进程 → 渲染层广播的统一封装：Node 业务运行时通过平台通道把事件交给 Rust 宿主，
// 由 Rust 以 Tauri 事件广播到所有应用窗口。
import { getPlatformTransport } from './platform.ts'

export interface BroadcastOptions {
  /** 记录失败原因（可选） */
  onError?: (error: Error) => void
}

export function broadcastToWindows(
  channel: string,
  payload: unknown,
  options: BroadcastOptions = {},
): void {
  try {
    getPlatformTransport().event(channel, payload)
  } catch (error) {
    options.onError?.(error as Error)
  }
}
